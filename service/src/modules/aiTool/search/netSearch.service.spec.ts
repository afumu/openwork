import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { NetSearchService } from './netSearch.service';

declare const afterEach: any;
declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

jest.mock(
  '@/common/utils',
  () => ({
    handleError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  }),
  { virtual: true },
);

jest.mock('../../globalConfig/globalConfig.service', () => ({
  GlobalConfigService: class GlobalConfigService {},
}));

function listenOnce(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve test server address'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/tavily.com/search`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close(error => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
    server.on('error', reject);
  });
}

describe('NetSearchService', () => {
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (disposers.length) {
      await disposers.pop()?.();
    }
  });

  it('aggregates multiple Tavily searches to reach the requested limit', async () => {
    let requestCount = 0;
    const listener = await listenOnce(async (req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        requestCount += 1;
        const parsed = JSON.parse(body);
        expect(parsed.max_results).toBe(20);

        const offset = (requestCount - 1) * 15;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            results: Array.from({ length: 15 }, (_, index) => ({
              title: `Result ${offset + index + 1}`,
              url: `https://example.com/${offset + index + 1}`,
              content: `Summary ${offset + index + 1} for ${parsed.query}`,
            })),
          }),
        );
      });
    });
    disposers.push(listener.close);

    const globalConfigService = {
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchSources: JSON.stringify([
          {
            name: 'Tavily Test',
            type: 'tavily',
            url: listener.url,
            key: 'test-key',
            enabled: 1,
            priority: 1,
          },
        ]),
      }),
    };

    const service = new NetSearchService(globalConfigService as any);

    const { searchResults } = await service.webSearchPro('Trump latest news', { limit: 40 });

    expect(requestCount).toBeGreaterThanOrEqual(3);
    expect(searchResults).toHaveLength(40);
    expect(searchResults[0].title).toBe('Result 1');
  });

  it('fetches 50 internal news items by default for Research', async () => {
    let requestCount = 0;
    const listener = await listenOnce(async (_req, res) => {
      requestCount += 1;
      const offset = (requestCount - 1) * 20;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: Array.from({ length: 20 }, (_, index) => ({
            title: `News ${offset + index + 1}`,
            url: `https://example.com/news-${offset + index + 1}`,
            content: `News summary ${offset + index + 1}`,
          })),
        }),
      );
    });
    disposers.push(listener.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchSources: JSON.stringify([
          {
            name: 'Tavily Test',
            type: 'tavily',
            url: listener.url,
            key: 'test-key',
            enabled: 1,
            priority: 1,
          },
        ]),
      }),
    } as any);

    const items = await service.fetchInternalNewsItems('Research topic');

    expect(items).toHaveLength(50);
  });

  it('filters unsafe adult search results before exposing them to chat or Research', async () => {
    const listener = await listenOnce(async (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            {
              title: '色情AV视频 clips',
              url: 'https://xvideos.example/adult',
              content: 'adult porn result',
            },
            {
              title: 'Reuters reports market reaction',
              url: 'https://www.reuters.com/markets/example',
              content: 'Clean market update from a reliable source',
            },
          ],
        }),
      );
    });
    disposers.push(listener.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchSources: JSON.stringify([
          {
            name: 'Tavily Test',
            type: 'tavily',
            url: listener.url,
            key: 'test-key',
            enabled: 1,
            priority: 1,
          },
        ]),
      }),
    } as any);

    const { searchResults } = await service.webSearchPro('market news', { limit: 10 });
    const items = await service.fetchInternalNewsItems('market news', 10);

    expect(searchResults.map(item => item.title)).toEqual(['Reuters reports market reaction']);
    expect(items.map(item => item.title)).toEqual(['Reuters reports market reaction']);
  });

  it('queries trusted news domains first for Research internal search', async () => {
    const queries: string[] = [];
    const listener = await listenOnce(async (req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        queries.push(parsed.query);
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            results: [
              {
                title: `Trusted result ${queries.length}`,
                url: `https://www.reuters.com/world/example-${queries.length}`,
                content: `Summary for ${parsed.query}`,
              },
            ],
          }),
        );
      });
    });
    disposers.push(listener.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchSources: JSON.stringify([
          {
            name: 'Tavily Test',
            type: 'tavily',
            url: listener.url,
            key: 'test-key',
            enabled: 1,
            priority: 1,
          },
        ]),
      }),
    } as any);

    await service.fetchInternalNewsItems('Iran US conflict', 3);

    expect(queries[0]).toContain('site:reuters.com');
    expect(queries[1]).toContain('site:apnews.com');
    expect(queries[2]).toContain('site:bbc.com');
  });

  it('aggregates enabled sources for chat search center mode and returns diagnostics', async () => {
    const sourceRequests: string[] = [];
    const primary = await listenOnce(async (req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        sourceRequests.push('primary');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            results: [
              {
                title: 'Primary source result',
                url: 'https://primary.example/news',
                content: 'Primary summary',
              },
            ],
          }),
        );
      });
    });
    const secondary = await listenOnce(async (req, res) => {
      req.on('data', () => undefined);
      req.on('end', () => {
        sourceRequests.push('secondary');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            results: [
              {
                title: 'Secondary source result',
                url: 'https://secondary.example/news',
                content: 'Secondary summary',
              },
            ],
          }),
        );
      });
    });
    disposers.push(primary.close, secondary.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchCenterMode: 'aggregate',
        searchCenterDiagnostics: '1',
        searchSources: JSON.stringify([
          {
            name: 'Primary',
            type: 'tavily',
            url: primary.url,
            key: 'primary-key',
            enabled: 1,
            priority: 1,
            useForChat: 1,
            maxResults: 1,
          },
          {
            name: 'Secondary',
            type: 'tavily',
            url: secondary.url,
            key: 'secondary-key',
            enabled: 1,
            priority: 2,
            useForChat: 1,
            maxResults: 1,
          },
        ]),
      }),
    } as any);

    const result = await service.webSearchPro('AI news', { limit: 5, scenario: 'chat' });

    expect(sourceRequests).toEqual(['primary', 'secondary']);
    expect(result.searchResults.map(item => item.title)).toEqual([
      'Primary source result',
      'Secondary source result',
    ]);
    expect(result.diagnostics?.mode).toBe('aggregate');
    expect(result.diagnostics?.sources.map(item => item.name)).toEqual(['Primary', 'Secondary']);
  });

  it('honors source scenario switches when Research searches', async () => {
    const requests: string[] = [];
    const chatOnly = await listenOnce(async (_req, res) => {
      requests.push('chat-only');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [{ title: 'Chat only', url: 'https://chat.example/news', content: 'Chat' }],
        }),
      );
    });
    const openworkSource = await listenOnce(async (_req, res) => {
      requests.push('research');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            { title: 'Research source', url: 'https://openwork.example/news', content: 'Research' },
          ],
        }),
      );
    });
    disposers.push(chatOnly.close, openworkSource.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchCenterMode: 'aggregate',
        searchSources: JSON.stringify([
          {
            name: 'Chat Only',
            type: 'tavily',
            url: chatOnly.url,
            key: 'chat-key',
            enabled: 1,
            priority: 1,
            useForChat: 1,
            useForResearch: 0,
            maxResults: 1,
          },
          {
            name: 'Research',
            type: 'tavily',
            url: openworkSource.url,
            key: 'openwork-key',
            enabled: 1,
            priority: 2,
            useForChat: 1,
            useForResearch: 1,
            maxResults: 1,
          },
        ]),
      }),
    } as any);

    const items = await service.fetchInternalNewsItems('AI policy', 5);

    expect(requests).toEqual(['research']);
    expect(items.map(item => item.title)).toEqual(['Research source']);
  });

  it('uses source weight to rank aggregated candidates before trimming to limit', async () => {
    const lowWeight = await listenOnce(async (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            { title: 'Low weight source', url: 'https://low.example/news', content: 'Low' },
          ],
        }),
      );
    });
    const highWeight = await listenOnce(async (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            { title: 'High weight source', url: 'https://high.example/news', content: 'High' },
          ],
        }),
      );
    });
    disposers.push(lowWeight.close, highWeight.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchCenterMode: 'aggregate',
        searchSources: JSON.stringify([
          {
            name: 'Low',
            type: 'tavily',
            url: lowWeight.url,
            key: 'low-key',
            enabled: 1,
            priority: 1,
            weight: 1,
            maxResults: 1,
          },
          {
            name: 'High',
            type: 'tavily',
            url: highWeight.url,
            key: 'high-key',
            enabled: 1,
            priority: 2,
            weight: 20,
            maxResults: 1,
          },
        ]),
      }),
    } as any);

    const result = await service.webSearchPro('AI news', { limit: 1, scenario: 'chat' });

    expect(result.searchResults.map(item => item.title)).toEqual(['High weight source']);
  });

  it('exposes managed free sources in the capability profile without requiring keys', async () => {
    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchCenterMode: 'smart',
        searchSources: JSON.stringify([
          {
            name: 'DuckDuckGo Free',
            type: 'duckduckgo',
            enabled: 1,
            priority: 1,
            useForChat: 1,
            useForResearch: 0,
          },
          {
            name: 'Hacker News Free',
            type: 'hackernews',
            enabled: 1,
            priority: 2,
            useForChat: 1,
            useForResearch: 1,
          },
        ]),
      }),
    } as any);

    const profile = await service.getWebSearchCapabilityProfile('chat');

    expect(profile.mode).toBe('smart');
    expect(profile.capabilityGroups).toEqual(
      expect.arrayContaining(['broad_web_search', 'developer_community']),
    );
    expect(profile.enabledSources.map(item => item.type)).toEqual(['duckduckgo', 'hackernews']);
  });

  it('uses chat-only sources for chat search items and skips Research-only sources', async () => {
    const requests: string[] = [];
    const chatOnly = await listenOnce(async (_req, res) => {
      requests.push('chat-only');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            { title: 'Chat source', url: 'https://chat.example/news', content: 'Chat result' },
          ],
        }),
      );
    });
    const openworkOnly = await listenOnce(async (_req, res) => {
      requests.push('openwork-only');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [
            {
              title: 'Research source',
              url: 'https://openwork.example/news',
              content: 'Research result',
            },
          ],
        }),
      );
    });
    disposers.push(chatOnly.close, openworkOnly.close);

    const service = new NetSearchService({
      getConfigs: async () => ({
        pluginUrl: '',
        pluginKey: '',
        searchCenterMode: 'fallback',
        searchSources: JSON.stringify([
          {
            name: 'Chat Only',
            type: 'tavily',
            url: chatOnly.url,
            key: 'chat-key',
            enabled: 1,
            priority: 1,
            useForChat: 1,
            useForResearch: 0,
          },
          {
            name: 'Research Only',
            type: 'tavily',
            url: openworkOnly.url,
            key: 'openwork-key',
            enabled: 1,
            priority: 2,
            useForChat: 0,
            useForResearch: 1,
          },
        ]),
      }),
    } as any);

    const items = await service.fetchInternalSearchItems('AI topic', {
      scenario: 'chat',
      limit: 3,
    });

    expect(new Set(requests)).toEqual(new Set(['chat-only']));
    expect(items.map(item => item.title)).toEqual(['Chat source']);
  });

  it('smart mode expands to the next source batch only when depth allows it', async () => {
    const requests: string[] = [];
    const sourceA = await listenOnce(async (_req, res) => {
      requests.push('source-a');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [{ title: 'Source A', url: 'https://a.example/news', content: 'A result' }],
        }),
      );
    });
    const sourceB = await listenOnce(async (_req, res) => {
      requests.push('source-b');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [{ title: 'Source B', url: 'https://b.example/news', content: 'B result' }],
        }),
      );
    });
    const sourceC = await listenOnce(async (_req, res) => {
      requests.push('source-c');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results: [{ title: 'Source C', url: 'https://c.example/news', content: 'C result' }],
        }),
      );
    });
    disposers.push(sourceA.close, sourceB.close, sourceC.close);

    const buildService = () =>
      new NetSearchService({
        getConfigs: async () => ({
          pluginUrl: '',
          pluginKey: '',
          searchCenterMode: 'smart',
          searchSources: JSON.stringify([
            {
              name: 'Source A',
              type: 'tavily',
              url: sourceA.url,
              key: 'a-key',
              enabled: 1,
              priority: 1,
            },
            {
              name: 'Source B',
              type: 'tavily',
              url: sourceB.url,
              key: 'b-key',
              enabled: 1,
              priority: 2,
            },
            {
              name: 'Source C',
              type: 'tavily',
              url: sourceC.url,
              key: 'c-key',
              enabled: 1,
              priority: 3,
            },
          ]),
        }),
      } as any);

    const quickResult = await buildService().webSearchPro('AI news', {
      scenario: 'chat',
      limit: 5,
      depth: 'quick',
    });

    expect(quickResult.searchResults.map(item => item.title)).toEqual(['Source A', 'Source B']);
    expect(new Set(requests)).toEqual(new Set(['source-a', 'source-b']));

    requests.length = 0;

    const balancedResult = await buildService().webSearchPro('AI news', {
      scenario: 'chat',
      limit: 5,
      depth: 'balanced',
    });

    expect(balancedResult.searchResults.map(item => item.title)).toEqual([
      'Source A',
      'Source B',
      'Source C',
    ]);
    expect(new Set(requests)).toEqual(new Set(['source-a', 'source-b', 'source-c']));
  });
});

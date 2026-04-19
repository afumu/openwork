import { handleError } from '@/common/utils';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import fetch from 'cross-fetch';
import { GlobalConfigService } from '../../globalConfig/globalConfig.service';

interface SearchSourceConfig {
  id?: string;
  name?: string;
  type?: SearchSourceType | string;
  url?: string;
  key?: string;
  enabled?: number | string | boolean;
  priority?: number;
  useForChat?: number | string | boolean;
  useForResearch?: number | string | boolean;
  weight?: number | string;
  maxResults?: number | string;
}

type SearchScenario = 'chat' | 'research' | 'admin_test';
type SearchCenterMode = 'fallback' | 'aggregate' | 'smart';
type SearchDepth = 'quick' | 'balanced' | 'deep';
type SearchIntent =
  | 'trusted_news'
  | 'developer_community'
  | 'china_web'
  | 'china_trends'
  | 'video_platform'
  | 'broad_web_search';
type SearchSourceType =
  | 'tavily'
  | 'bochai'
  | 'bigmodel'
  | 'custom'
  | 'duckduckgo'
  | 'hackernews'
  | 'sogou'
  | 'bilibili'
  | 'weibo'
  | 'bing'
  | 'google';

interface WebSearchOptions {
  limit?: number;
  preferTrustedSources?: boolean;
  scenario?: SearchScenario;
  depth?: SearchDepth;
}

interface SearchCenterConfig {
  mode: SearchCenterMode;
  diagnosticsEnabled: boolean;
}

interface SearchSourceDiagnostics {
  name: string;
  type: string;
  mode: SearchCenterMode;
  requestedLimit: number;
  resultCount: number;
  imageCount: number;
  skipped?: string;
}

interface WebSearchDiagnostics {
  mode: SearchCenterMode;
  scenario: SearchScenario;
  query: string;
  depth: SearchDepth;
  intent: SearchIntent;
  requestedLimit: number;
  returnedResultCount: number;
  returnedImageCount: number;
  sources: SearchSourceDiagnostics[];
}

interface WebSearchResult {
  searchResults: any[];
  images: string[];
  diagnostics?: WebSearchDiagnostics;
}

export interface InternalSearchNewsItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  category: string;
  score: number;
  time: string;
}

export interface WebSearchCapabilityProfile {
  mode: SearchCenterMode;
  capabilityGroups: string[];
  enabledSources: Array<{
    type: string;
    name: string;
    useForChat: boolean;
    useForResearch: boolean;
    capabilities: string[];
  }>;
  guidance: {
    recommendedDepth: SearchDepth;
    supportsMultiRound: boolean;
  };
}

const DEFAULT_WEB_SEARCH_LIMIT = 40;
const DEFAULT_OPENWORK_SEARCH_LIMIT = 50;
const SEARCH_SOURCE_REQUEST_LIMIT = 20;
const DEFAULT_SEARCH_DEPTH: SearchDepth = 'balanced';
const SEARCH_REQUEST_TIMEOUT_MS = 12000;
const TRUSTED_NEWS_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'cnn.com',
  'aljazeera.com',
  'cnbc.com',
  'theverge.com',
  'techcrunch.com',
  'arstechnica.com',
  'wired.com',
  'venturebeat.com',
  'xinhua.net',
  'xinhuanet.com',
] as const;

const BUILTIN_SEARCH_SOURCE_URLS: Record<SearchSourceType, string> = {
  tavily: 'https://api.tavily.com/search',
  bochai: 'https://api.bochaai.com/v1/web-search',
  bigmodel: 'https://open.bigmodel.cn/api/paas/v4/tools',
  custom: '',
  duckduckgo: 'https://html.duckduckgo.com/html/',
  hackernews: 'https://hn.algolia.com/api/v1/search',
  sogou: 'https://www.sogou.com/web',
  bilibili: 'https://api.bilibili.com/x/web-interface/search/type',
  weibo: 'https://weibo.com/ajax/side/hotSearch',
  bing: 'https://www.bing.com/search',
  google: 'https://www.google.com/search',
};

const SEARCH_SOURCE_CAPABILITY_MAP: Record<SearchSourceType, SearchIntent[]> = {
  tavily: ['trusted_news', 'broad_web_search'],
  bochai: ['trusted_news', 'broad_web_search'],
  bigmodel: ['trusted_news', 'broad_web_search'],
  custom: ['broad_web_search'],
  duckduckgo: ['broad_web_search'],
  hackernews: ['developer_community'],
  sogou: ['china_web'],
  bilibili: ['video_platform', 'china_web'],
  weibo: ['china_trends'],
  bing: ['broad_web_search'],
  google: ['broad_web_search'],
};

const MANAGED_SEARCH_SOURCE_TYPES = new Set<SearchSourceType>([
  'duckduckgo',
  'hackernews',
  'sogou',
  'bilibili',
  'weibo',
  'bing',
  'google',
]);

const SEARCH_RATE_LIMITS_MS: Partial<Record<SearchSourceType, number>> = {
  duckduckgo: 3000,
  hackernews: 1000,
  sogou: 3000,
  bilibili: 2000,
  weibo: 3000,
  bing: 5000,
  google: 10000,
};

const SEARCH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
] as const;

const UNSAFE_DOMAIN_KEYWORDS = [
  'xvideos',
  'xnxx',
  'pornhub',
  'redtube',
  'youporn',
  'onlyfans',
  'fansly',
  'casino',
  'bet365',
  '1xbet',
];

const UNSAFE_TEXT_PATTERNS = [
  /\b(adult|porn|porno|xxx|nsfw|onlyfans|fansly|escort|casino|gambling|betting)\b/i,
  /\b(sex|sexy)\s*(video|tube|cam|chat|clip|movie|site|pics?)\b/i,
  /(色情|黄色|成人|裸聊|约炮|成人视频|成人影片|博彩|赌场|赌球|成人视频|AV视频|无码AV)/i,
];

@Injectable()
export class NetSearchService {
  private readonly sourceLastRequestAt = new Map<string, number>();

  constructor(private readonly globalConfigService: GlobalConfigService) {}

  /**
   * 处理网络搜索流程
   * @param prompt 搜索关键词
   * @param inputs 输入参数
   * @param result 结果对象
   * @returns 搜索结果对象
   */
  async processNetSearch(
    prompt: string,
    inputs: {
      usingNetwork?: boolean;
      onProgress?: (data: any) => void;
      onDatabase?: (data: any) => void;
    },
    result: any,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const { usingNetwork, onProgress, onDatabase } = inputs;
    let searchResults: any[] = [];
    let images: string[] = [];

    // 如果不使用网络搜索，直接返回空结果
    if (!usingNetwork) {
      return { searchResults, images };
    }

    try {
      Logger.log(`[网络搜索] 开始搜索: ${prompt}`, 'NetSearchService');

      // 调用网络搜索服务
      const searchResponse = await this.webSearchPro(prompt, { limit: DEFAULT_WEB_SEARCH_LIMIT });
      searchResults = searchResponse.searchResults;
      images = searchResponse.images;

      Logger.log(
        `[网络搜索] 完成，获取到 ${searchResults.length} 条结果和 ${images.length} 张图片`,
        'NetSearchService',
      );

      // 更新结果对象
      result.networkSearchResult = JSON.stringify(searchResults);
      onProgress?.({
        networkSearchResult: result.networkSearchResult,
      });

      // 存储数据到数据库
      onDatabase?.({
        networkSearchResult: JSON.stringify(
          searchResults.map((item: { [x: string]: any; content: any }) => {
            const { content, ...rest } = item; // 删除 content 部分
            return rest; // 返回剩余部分
          }),
          null,
          2,
        ),
      });

      return { searchResults, images };
    } catch (error) {
      Logger.error(`[网络搜索] 失败: ${handleError(error)}`, 'NetSearchService');

      // 即时存储错误信息
      onDatabase?.({
        network_search_error: {
          error: handleError(error),
          query: prompt,
          timestamp: new Date(),
        },
      });

      return { searchResults: [], images: [] };
    }
  }

  async webSearchPro(prompt: string, options: WebSearchOptions = {}): Promise<WebSearchResult> {
    try {
      const limit = this.normalizeLimit(options.limit, DEFAULT_WEB_SEARCH_LIMIT);
      const { pluginUrl, pluginKey, searchSources, searchCenterMode, searchCenterDiagnostics } =
        await this.globalConfigService.getConfigs([
          'pluginUrl',
          'pluginKey',
          'searchSources',
          'searchCenterMode',
          'searchCenterDiagnostics',
        ]);
      const configuredSources = this.parseSearchSources(searchSources, pluginUrl, pluginKey);
      const searchCenterConfig = this.resolveSearchCenterConfig({
        searchCenterMode,
        searchCenterDiagnostics,
      });
      const scenario = options.scenario || (options.preferTrustedSources ? 'research' : 'chat');
      const depth = this.normalizeSearchDepth(options.depth);
      const intent = this.detectSearchIntent(prompt, options);
      const diagnostics: WebSearchDiagnostics = {
        mode: searchCenterConfig.mode,
        scenario,
        query: prompt,
        depth,
        intent,
        requestedLimit: limit,
        returnedResultCount: 0,
        returnedImageCount: 0,
        sources: [],
      };

      if (configuredSources.length === 0) {
        Logger.warn('搜索插件配置缺失');
        return this.withDiagnostics(
          { searchResults: [], images: [] },
          diagnostics,
          searchCenterConfig,
        );
      }

      const enabledSources = configuredSources.filter(source =>
        this.isSourceEnabledForScenario(source, scenario),
      );

      if (enabledSources.length === 0) {
        Logger.warn(`[搜索] 没有可用于 ${scenario} 场景的搜索源`);
        return this.withDiagnostics(
          { searchResults: [], images: [] },
          diagnostics,
          searchCenterConfig,
        );
      }

      if (searchCenterConfig.mode === 'aggregate') {
        return this.searchAggregateSources(
          enabledSources,
          prompt,
          limit,
          options,
          diagnostics,
          searchCenterConfig,
        );
      }

      if (searchCenterConfig.mode === 'smart') {
        return this.searchSmartSources(
          enabledSources,
          prompt,
          limit,
          options,
          diagnostics,
          searchCenterConfig,
        );
      }

      for (const source of enabledSources) {
        const response = await this.requestSearchSourceWithVariants(source, prompt, limit, options);
        diagnostics.sources.push({
          name: source.name || this.getDefaultSearchSourceName(source),
          type: String(source.type || this.detectSourceType(source.url)),
          mode: searchCenterConfig.mode,
          requestedLimit: limit,
          resultCount: response.searchResults.length,
          imageCount: response.images.length,
        });
        if (response.searchResults.length > 0 || response.images.length > 0) {
          return this.withDiagnostics(response, diagnostics, searchCenterConfig);
        }
      }

      return this.withDiagnostics(
        { searchResults: [], images: [] },
        diagnostics,
        searchCenterConfig,
      );
    } catch (fetchError) {
      Logger.error('[搜索] 调用接口出错:', fetchError);
      return {
        searchResults: [],
        images: [],
      };
    }
  }

  async getWebSearchCapabilityProfile(
    scenario: SearchScenario = 'chat',
  ): Promise<WebSearchCapabilityProfile> {
    const { pluginUrl, pluginKey, searchSources, searchCenterMode } =
      await this.globalConfigService.getConfigs([
        'pluginUrl',
        'pluginKey',
        'searchSources',
        'searchCenterMode',
      ]);
    const configuredSources = this.parseSearchSources(searchSources, pluginUrl, pluginKey);
    const enabledSources = configuredSources.filter(source =>
      this.isSourceEnabledForScenario(source, scenario),
    );
    const capabilityGroups = [
      ...new Set(enabledSources.flatMap(source => this.getSourceCapabilities(source))),
    ].sort();

    return {
      mode: this.resolveSearchCenterConfig({ searchCenterMode }).mode,
      capabilityGroups,
      enabledSources: enabledSources.map(source => ({
        type: String(source.type || this.detectSourceType(source.url)),
        name: source.name || this.getDefaultSearchSourceName(source),
        useForChat: this.isEnabled(source.useForChat),
        useForResearch: this.isEnabled(source.useForResearch),
        capabilities: this.getSourceCapabilities(source),
      })),
      guidance: {
        recommendedDepth: DEFAULT_SEARCH_DEPTH,
        supportsMultiRound: true,
      },
    };
  }

  async fetchInternalNewsItems(
    topic: string,
    limit = DEFAULT_OPENWORK_SEARCH_LIMIT,
    options: Pick<WebSearchOptions, 'depth'> = {},
  ): Promise<InternalSearchNewsItem[]> {
    return this.fetchInternalSearchItems(topic, {
      limit,
      preferTrustedSources: true,
      scenario: 'research',
      depth: options.depth,
    });
  }

  async fetchInternalSearchItems(
    topic: string,
    options: WebSearchOptions = {},
  ): Promise<InternalSearchNewsItem[]> {
    const limit = this.normalizeLimit(options.limit, DEFAULT_OPENWORK_SEARCH_LIMIT);
    const { searchResults } = await this.webSearchPro(topic, {
      limit,
      preferTrustedSources: options.preferTrustedSources ?? options.scenario === 'research',
      scenario: options.scenario || 'chat',
      depth: options.depth,
    });
    return this.normalizeSearchResultsToNewsItems(searchResults, topic).slice(0, limit);
  }

  private parseSearchSources(
    rawSearchSources: string | undefined,
    legacyPluginUrl?: string,
    legacyPluginKey?: string,
  ): SearchSourceConfig[] {
    const sources: SearchSourceConfig[] = [];

    if (rawSearchSources) {
      try {
        const parsed = JSON.parse(rawSearchSources);
        if (Array.isArray(parsed)) {
          sources.push(
            ...parsed
              .filter(item => {
                const sourceType = this.normalizeSourceType(item?.type, item?.url);
                if (this.isManagedSearchSourceType(sourceType)) {
                  return true;
                }
                return Boolean(item?.url && item?.key);
              })
              .map((item, index) => ({
                id: item.id || `source-${index + 1}`,
                name: item.name || `搜索源 ${index + 1}`,
                type: this.normalizeSourceType(item.type, item.url),
                url:
                  item.url ||
                  this.getDefaultSourceUrl(this.normalizeSourceType(item.type, item.url)),
                key: item.key || '',
                enabled: item.enabled ?? 1,
                priority: Number(item.priority ?? index + 1),
                useForChat: item.useForChat ?? 1,
                useForResearch: item.useForResearch ?? 1,
                weight: Number(item.weight ?? 1),
                maxResults: item.maxResults,
              })),
          );
        }
      } catch (error) {
        Logger.warn(`[搜索] searchSources 解析失败，将回退到旧配置: ${error}`);
      }
    }

    if (sources.length === 0 && legacyPluginUrl && legacyPluginKey) {
      sources.push({
        id: 'legacy-plugin',
        name: '默认联网搜索源',
        type: this.detectSourceType(legacyPluginUrl),
        url: legacyPluginUrl,
        key: legacyPluginKey,
        enabled: 1,
        priority: 1,
        useForChat: 1,
        useForResearch: 1,
        weight: 1,
      });
    }

    return sources
      .filter(source => this.isEnabled(source.enabled))
      .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
  }

  private isEnabled(value: SearchSourceConfig['enabled']): boolean {
    return value === true || value === 1 || value === '1' || value === undefined;
  }

  private normalizeSourceType(value?: string, url?: string): SearchSourceType | string {
    if (value && value in BUILTIN_SEARCH_SOURCE_URLS) {
      return value;
    }
    return this.detectSourceType(url);
  }

  private detectSourceType(url = ''): SearchSourceType | string {
    if (url.includes('tavily.com')) return 'tavily';
    if (url.includes('bochaai.com')) return 'bochai';
    if (url.includes('bigmodel.cn')) return 'bigmodel';
    if (url.includes('duckduckgo.com')) return 'duckduckgo';
    if (url.includes('hn.algolia.com')) return 'hackernews';
    if (url.includes('sogou.com')) return 'sogou';
    if (url.includes('bilibili.com')) return 'bilibili';
    if (url.includes('weibo.com')) return 'weibo';
    if (url.includes('bing.com')) return 'bing';
    if (url.includes('google.com')) return 'google';
    return 'custom';
  }

  private isManagedSearchSourceType(type: string): boolean {
    return MANAGED_SEARCH_SOURCE_TYPES.has(type as SearchSourceType);
  }

  private getDefaultSourceUrl(type: string): string {
    return BUILTIN_SEARCH_SOURCE_URLS[type as SearchSourceType] || '';
  }

  private getDefaultSearchSourceName(source: SearchSourceConfig): string {
    const type = String(source.type || this.detectSourceType(source.url));
    return type || source.url || '搜索源';
  }

  private getSourceCapabilities(source: SearchSourceConfig): SearchIntent[] {
    const type = String(source.type || this.detectSourceType(source.url)) as SearchSourceType;
    return SEARCH_SOURCE_CAPABILITY_MAP[type] || ['broad_web_search'];
  }

  private resolveSearchCenterConfig(raw: {
    searchCenterMode?: string;
    searchCenterDiagnostics?: string | number | boolean;
  }): SearchCenterConfig {
    const mode =
      raw.searchCenterMode === 'aggregate'
        ? 'aggregate'
        : raw.searchCenterMode === 'smart'
        ? 'smart'
        : 'fallback';
    return {
      mode,
      diagnosticsEnabled: this.isExplicitlyEnabled(raw.searchCenterDiagnostics),
    };
  }

  private isExplicitlyEnabled(value: string | number | boolean | undefined): boolean {
    return value === true || value === 1 || value === '1';
  }

  private isSourceEnabledForScenario(
    source: SearchSourceConfig,
    scenario: SearchScenario,
  ): boolean {
    if (scenario === 'research') {
      return this.isEnabled(source.useForResearch);
    }
    if (scenario === 'chat') {
      return this.isEnabled(source.useForChat);
    }
    return true;
  }

  private normalizeSearchDepth(depth?: SearchDepth): SearchDepth {
    if (depth === 'quick' || depth === 'deep') {
      return depth;
    }
    return DEFAULT_SEARCH_DEPTH;
  }

  private detectSearchIntent(prompt: string, options: WebSearchOptions = {}): SearchIntent {
    if (options.preferTrustedSources || options.scenario === 'research') {
      return 'trusted_news';
    }

    const normalized = prompt.trim().toLowerCase();
    if (/热搜|热点|舆情|热度|走势|trend|trending/.test(normalized)) {
      return /[\u4e00-\u9fff]/.test(prompt) ? 'china_trends' : 'broad_web_search';
    }
    if (/视频|采访|评测|讲解|b站|bilibili|video/.test(normalized)) {
      return 'video_platform';
    }
    if (/ai|github|release|framework|model|hn|hacker news|developer|dev/.test(normalized)) {
      return 'developer_community';
    }
    if (/[\u4e00-\u9fff]/.test(prompt)) {
      return 'china_web';
    }
    return 'broad_web_search';
  }

  private async searchAggregateSources(
    sources: SearchSourceConfig[],
    prompt: string,
    limit: number,
    options: WebSearchOptions,
    diagnostics: WebSearchDiagnostics,
    searchCenterConfig: SearchCenterConfig,
  ): Promise<WebSearchResult> {
    const collected: any[] = [];
    const images: string[] = [];

    for (const source of sources) {
      const sourceLimit = this.resolveSourceLimit(source, limit);
      const response = await this.requestSearchSourceWithVariants(
        source,
        prompt,
        sourceLimit,
        options,
      );
      diagnostics.sources.push({
        name: source.name || this.getDefaultSearchSourceName(source),
        type: String(source.type || this.detectSourceType(source.url)),
        mode: searchCenterConfig.mode,
        requestedLimit: sourceLimit,
        resultCount: response.searchResults.length,
        imageCount: response.images.length,
      });

      const weight = this.normalizeSourceWeight(source.weight);
      collected.push(
        ...response.searchResults.map((item, index) => ({
          ...item,
          __searchCenterScore: this.scoreAggregatedSearchResult(item, source, index, weight),
        })),
      );

      for (const image of response.images) {
        if (image && !images.includes(image)) {
          images.push(image);
        }
      }
    }

    const searchResults = this.dedupeRawSearchResults(collected)
      .sort(
        (a, b) =>
          Number(b.__searchCenterScore || 0) - Number(a.__searchCenterScore || 0) ||
          Number(a.resultIndex || 9999) - Number(b.resultIndex || 9999),
      )
      .slice(0, limit)
      .map(item => {
        const { __searchCenterScore, ...rest } = item;
        return rest;
      });

    Logger.log(
      `[搜索中台] 聚合完成，query="${prompt}"，sources=${sources.length}，candidates=${collected.length}，returned=${searchResults.length}`,
      'NetSearchService',
    );

    return this.withDiagnostics(
      { searchResults, images: images.slice(0, limit) },
      diagnostics,
      searchCenterConfig,
    );
  }

  private async searchSmartSources(
    sources: SearchSourceConfig[],
    prompt: string,
    limit: number,
    options: WebSearchOptions,
    diagnostics: WebSearchDiagnostics,
    searchCenterConfig: SearchCenterConfig,
  ): Promise<WebSearchResult> {
    const collected: any[] = [];
    const images: string[] = [];
    const batches = this.buildSmartSourceBatches(sources, prompt, options);
    const allowedBatches = Math.min(this.resolveMaxSmartBatches(options.depth), batches.length);

    for (let index = 0; index < allowedBatches; index += 1) {
      const batch = batches[index];
      for (const source of batch) {
        const sourceLimit = this.resolveSourceLimit(source, limit);
        const response = await this.requestSearchSourceWithVariants(
          source,
          prompt,
          sourceLimit,
          options,
        );
        diagnostics.sources.push({
          name: source.name || this.getDefaultSearchSourceName(source),
          type: String(source.type || this.detectSourceType(source.url)),
          mode: searchCenterConfig.mode,
          requestedLimit: sourceLimit,
          resultCount: response.searchResults.length,
          imageCount: response.images.length,
        });
        const weight = this.normalizeSourceWeight(source.weight);
        collected.push(
          ...response.searchResults.map((item, resultIndex) => ({
            ...item,
            __searchCenterScore: this.scoreAggregatedSearchResult(
              item,
              source,
              resultIndex,
              weight,
            ),
          })),
        );
        for (const image of response.images) {
          if (image && !images.includes(image)) {
            images.push(image);
          }
        }
      }

      const deduped = this.dedupeRawSearchResults(collected);
      if (
        !this.shouldExpandSmartSearch(deduped, prompt, limit, options, index < allowedBatches - 1)
      ) {
        return this.withDiagnostics(
          {
            searchResults: deduped
              .sort(
                (a, b) =>
                  Number(b.__searchCenterScore || 0) - Number(a.__searchCenterScore || 0) ||
                  Number(a.resultIndex || 9999) - Number(b.resultIndex || 9999),
              )
              .slice(0, limit)
              .map(item => {
                const { __searchCenterScore, ...rest } = item;
                return rest;
              }),
            images: images.slice(0, limit),
          },
          diagnostics,
          searchCenterConfig,
        );
      }
    }

    return this.withDiagnostics(
      {
        searchResults: this.dedupeRawSearchResults(collected)
          .sort(
            (a, b) =>
              Number(b.__searchCenterScore || 0) - Number(a.__searchCenterScore || 0) ||
              Number(a.resultIndex || 9999) - Number(b.resultIndex || 9999),
          )
          .slice(0, limit)
          .map(item => {
            const { __searchCenterScore, ...rest } = item;
            return rest;
          }),
        images: images.slice(0, limit),
      },
      diagnostics,
      searchCenterConfig,
    );
  }

  private buildSmartSourceBatches(
    sources: SearchSourceConfig[],
    prompt: string,
    options: WebSearchOptions,
  ): SearchSourceConfig[][] {
    const intent = this.detectSearchIntent(prompt, options);
    const ranked = [...sources].sort((left, right) => {
      const scoreDiff =
        this.scoreSourceForIntent(right, intent, options) -
        this.scoreSourceForIntent(left, intent, options);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return Number(left.priority ?? 999) - Number(right.priority ?? 999);
    });
    const unique = ranked.filter(
      (source, index, array) =>
        array.findIndex(
          item => this.getSmartSourceIdentity(item) === this.getSmartSourceIdentity(source),
        ) === index,
    );
    const batches = [unique.slice(0, 2), unique.slice(2, 4), unique.slice(4)].filter(
      batch => batch.length > 0,
    );
    return batches.length ? batches : [sources];
  }

  private getSmartSourceIdentity(source: SearchSourceConfig): string {
    return String(source.id || source.url || `${source.type}:${source.name || ''}`);
  }

  private scoreSourceForIntent(
    source: SearchSourceConfig,
    intent: SearchIntent,
    options: WebSearchOptions = {},
  ): number {
    const capabilities = this.getSourceCapabilities(source);
    const sourceType = String(source.type || this.detectSourceType(source.url));
    let score = 0;
    if (capabilities.includes(intent)) {
      score += 80;
    }
    if (options.preferTrustedSources && capabilities.includes('trusted_news')) {
      score += 40;
    }
    if (intent === 'developer_community' && sourceType === 'hackernews') {
      score += 35;
    }
    if (intent === 'china_web' && sourceType === 'sogou') {
      score += 25;
    }
    if (intent === 'china_trends' && sourceType === 'weibo') {
      score += 35;
    }
    if (intent === 'video_platform' && sourceType === 'bilibili') {
      score += 35;
    }
    if (sourceType === 'duckduckgo') {
      score += 8;
    }
    if (sourceType === 'google' || sourceType === 'bing') {
      score -= 4;
    }
    score += this.normalizeSourceWeight(source.weight) * 5;
    score -= Math.max(0, Number(source.priority ?? 1) - 1);
    return score;
  }

  private resolveMaxSmartBatches(depth?: SearchDepth): number {
    const normalizedDepth = this.normalizeSearchDepth(depth);
    if (normalizedDepth === 'quick') {
      return 1;
    }
    if (normalizedDepth === 'deep') {
      return Number.MAX_SAFE_INTEGER;
    }
    return 2;
  }

  private shouldExpandSmartSearch(
    results: Array<{ link?: string }>,
    prompt: string,
    limit: number,
    options: WebSearchOptions,
    hasMoreBatches: boolean,
  ): boolean {
    if (!hasMoreBatches) {
      return false;
    }
    const minimumNeeded = Math.min(Math.max(3, Math.ceil(limit / 2)), limit);
    if (results.length < minimumNeeded) {
      return true;
    }
    const uniqueDomains = new Set(
      results.map(item => this.extractHostname(String(item.link || ''))),
    );
    if (uniqueDomains.size < Math.min(2, results.length)) {
      return true;
    }
    if (
      (options.preferTrustedSources || options.scenario === 'research') &&
      !results.some(item => this.isTrustedNewsUrl(String(item.link || '')))
    ) {
      return true;
    }
    if (
      /[\u4e00-\u9fff]/.test(prompt) &&
      !results.some(item =>
        /[\u4e00-\u9fff]/.test(
          String((item as any).title || '') + String((item as any).content || ''),
        ),
      )
    ) {
      return true;
    }
    return false;
  }

  private resolveSourceLimit(source: SearchSourceConfig, fallbackLimit: number): number {
    const configured = Number(source.maxResults || 0);
    if (Number.isFinite(configured) && configured > 0) {
      return this.normalizeLimit(configured, fallbackLimit);
    }
    return fallbackLimit;
  }

  private normalizeSourceWeight(value: SearchSourceConfig['weight']): number {
    const weight = Number(value ?? 1);
    if (!Number.isFinite(weight)) return 1;
    return Math.max(0, weight);
  }

  private scoreAggregatedSearchResult(
    item: { title?: unknown; content?: unknown; link?: unknown; url?: unknown },
    source: SearchSourceConfig,
    index: number,
    weight: number,
  ): number {
    const link = String(item?.link || item?.url || '');
    let score = Math.max(100 - index * 5, 10) + weight * 10;
    if (this.isTrustedNewsUrl(link)) {
      score += 25;
    }
    if (source.priority) {
      score -= Math.max(0, Number(source.priority) - 1);
    }
    return score;
  }

  private dedupeRawSearchResults(results: any[]): any[] {
    const seen = new Set<string>();
    return results.filter(item => {
      const title = String(item?.title || '')
        .trim()
        .toLowerCase();
      const link = String(item?.link || item?.url || '')
        .trim()
        .toLowerCase()
        .replace(/\/$/, '')
        .replace(/^https?:\/\/www\./, 'https://');
      const key = `${title}|${link}`;
      if (!title || !link || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private withDiagnostics(
    result: { searchResults: any[]; images: string[] },
    diagnostics: WebSearchDiagnostics,
    config: SearchCenterConfig,
  ): WebSearchResult {
    diagnostics.returnedResultCount = result.searchResults.length;
    diagnostics.returnedImageCount = result.images.length;
    if (config.diagnosticsEnabled) {
      Logger.log(`[搜索中台诊断] ${JSON.stringify(diagnostics)}`, 'NetSearchService');
      return { ...result, diagnostics };
    }
    return result;
  }

  private async requestSearchSourceWithVariants(
    source: SearchSourceConfig,
    prompt: string,
    limit: number,
    options: WebSearchOptions,
  ) {
    const collected: any[] = [];
    const images: string[] = [];
    const seen = new Set<string>();

    for (const query of this.buildSearchQueries(prompt, options)) {
      const response = await this.requestSearchSource(source, query, SEARCH_SOURCE_REQUEST_LIMIT);
      for (const item of response.searchResults) {
        const title = String(item?.title || '')
          .trim()
          .toLowerCase();
        const link = String(item?.link || '')
          .trim()
          .toLowerCase();
        const key = `${title}|${link}`;
        if (!title || !link || seen.has(key) || this.isUnsafeSearchResult(item)) continue;
        seen.add(key);
        collected.push({
          ...item,
          resultIndex: collected.length + 1,
        });
        if (collected.length >= limit) {
          return { searchResults: collected, images: images.slice(0, limit) };
        }
      }
      for (const image of response.images) {
        if (image && !images.includes(image) && !this.isUnsafeUrl(image)) {
          images.push(image);
        }
      }
    }

    return { searchResults: collected.slice(0, limit), images: images.slice(0, limit) };
  }

  private buildSearchQueries(prompt: string, options: WebSearchOptions = {}): string[] {
    const trimmedPrompt = prompt.trim();
    const hasChinese = /[\u4e00-\u9fff]/.test(trimmedPrompt);
    const depth = this.normalizeSearchDepth(options.depth);
    const variants = hasChinese
      ? [
          trimmedPrompt,
          `${trimmedPrompt} 最新信息`,
          `${trimmedPrompt} 今天`,
          `${trimmedPrompt} 最新进展`,
          `${trimmedPrompt} 分析`,
        ]
      : [
          trimmedPrompt,
          `${trimmedPrompt} latest updates`,
          `${trimmedPrompt} today`,
          `${trimmedPrompt} recent developments`,
          `${trimmedPrompt} analysis`,
        ];
    const trustedVariants = options.preferTrustedSources
      ? TRUSTED_NEWS_DOMAINS.map(domain => `${trimmedPrompt} site:${domain}`)
      : [];
    const queryPool = [...new Set([...trustedVariants, ...variants].filter(Boolean))];
    if (depth === 'quick') {
      return queryPool.slice(0, Math.min(queryPool.length, options.preferTrustedSources ? 2 : 1));
    }
    if (depth === 'balanced') {
      return queryPool.slice(0, Math.min(queryPool.length, options.preferTrustedSources ? 4 : 3));
    }
    return queryPool;
  }

  private normalizeLimit(value: number | undefined, fallback: number): number {
    const limit = Number(value || fallback);
    if (!Number.isFinite(limit)) return fallback;
    return Math.max(1, Math.min(Math.floor(limit), 80));
  }

  private async requestSearchSource(source: SearchSourceConfig, prompt: string, limit: number) {
    try {
      const sourceType = String(
        source.type || this.detectSourceType(source.url),
      ) as SearchSourceType;
      if (this.isManagedSearchSourceType(sourceType)) {
        return await this.requestManagedSearchSource(source, prompt, limit);
      }

      const sourceUrl = source.url || this.getDefaultSourceUrl(sourceType);
      const selectedKey = this.pickSourceKey(source.key || '');
      if (!selectedKey || !sourceUrl) {
        Logger.warn(`[搜索] ${source.name || sourceUrl} 缺少可用 key 或 URL，已跳过`);
        return { searchResults: [], images: [] };
      }

      const isBochaiApi = sourceType === 'bochai' || sourceUrl.includes('bochaai.com');
      const isBigModelApi = sourceType === 'bigmodel' || sourceUrl.includes('bigmodel.cn');
      const isTavilyApi = sourceType === 'tavily' || sourceUrl.includes('tavily.com');

      Logger.log(
        `[搜索] API类型: ${
          isBochaiApi ? 'Bochai' : isBigModelApi ? 'BigModel' : isTavilyApi ? 'Tavily' : '未知'
        }`,
      );
      Logger.log(`[搜索] 搜索源: ${source.name || sourceUrl}`);
      Logger.log(`[搜索] 请求URL: ${sourceUrl}`);
      Logger.log(`[搜索] 搜索关键词: ${prompt}`);

      const requestBody = isBochaiApi
        ? {
            query: prompt,
            summary: true,
            count: limit,
          }
        : isTavilyApi
        ? {
            query: prompt,
            search_depth: 'basic',
            include_answer: false,
            include_images: true,
            max_results: limit,
          }
        : {
            tool: 'web-search-pro',
            stream: false,
            messages: [{ role: 'user', content: prompt }],
          };

      Logger.log(`[搜索] 请求参数: ${JSON.stringify(requestBody, null, 2)}`);

      const response = await this.fetchWithTimeout(sourceUrl, {
        method: 'POST',
        headers: {
          Authorization: this.buildAuthorizationHeader(selectedKey, isTavilyApi),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        Logger.error(`[搜索] 接口返回错误: ${response.status}，来源：${source.name || source.url}`);
        return { searchResults: [], images: [] };
      }

      const apiResult = await response.json();
      Logger.log(`[搜索] 原始返回摘要: ${this.summarizeApiResult(apiResult)}`);

      let searchResults: any[] = [];

      if (isBochaiApi) {
        if (apiResult?.code === 200 && apiResult?.data?.webPages?.value) {
          searchResults = apiResult.data.webPages.value.map((item: any) => ({
            title: item?.name || '',
            link: item?.url || '',
            content: item?.summary || '',
            icon: item?.siteIcon || '',
            media: item?.siteName || '',
          }));
        }
      } else if (isBigModelApi) {
        if (apiResult?.choices?.[0]?.message?.tool_calls?.length > 0) {
          for (const toolCall of apiResult.choices[0].message.tool_calls) {
            if (Array.isArray(toolCall.search_result)) {
              searchResults = toolCall.search_result.map((item: any) => ({
                title: item?.title || '',
                link: item?.link || '',
                content: item?.content || '',
                icon: item?.icon || '',
                media: item?.media || '',
              }));
              break;
            }
          }
        }
      } else if (isTavilyApi) {
        if (Array.isArray(apiResult?.results)) {
          searchResults = apiResult.results.map((item: any) => ({
            title: item?.title || '',
            link: item?.url || '',
            content: item?.raw_content || item?.content || '',
            icon: '',
            media: '',
          }));
        }
      }

      searchResults = searchResults.filter(item => !this.isUnsafeSearchResult(item));

      const formattedResult = searchResults.map((item, index) => ({
        resultIndex: index + 1,
        ...item,
      }));

      let images: string[] = [];
      if (isTavilyApi && Array.isArray(apiResult?.images)) {
        images = apiResult.images.filter(image => image && !this.isUnsafeUrl(String(image)));
      }

      if (isBochaiApi) {
        if (apiResult?.data?.images?.value && Array.isArray(apiResult.data.images.value)) {
          images = apiResult.data.images.value
            .filter(img => img.contentUrl)
            .map(img => img.contentUrl)
            .filter(image => !this.isUnsafeUrl(String(image)));
        }
      }

      Logger.log(`[搜索] 安全过滤后的结果数量: ${formattedResult.length}`);

      return {
        searchResults: formattedResult,
        images,
      };
    } catch (error) {
      Logger.warn(
        `[搜索] 单个搜索源执行失败，已降级为空结果: ${
          source.name || source.url || source.type
        } -> ${handleError(error)}`,
        'NetSearchService',
      );
      return {
        searchResults: [],
        images: [],
      };
    }
  }

  private async requestManagedSearchSource(
    source: SearchSourceConfig,
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const sourceType = String(source.type || this.detectSourceType(source.url)) as SearchSourceType;
    await this.waitForSourceRateLimit(sourceType);

    switch (sourceType) {
      case 'duckduckgo':
        return this.searchDuckDuckGo(prompt, limit);
      case 'hackernews':
        return this.searchHackerNews(prompt, limit);
      case 'sogou':
        return this.searchSogou(prompt, limit);
      case 'bilibili':
        return this.searchBilibili(prompt, limit);
      case 'weibo':
        return this.searchWeibo(prompt, limit);
      case 'bing':
        return this.searchBing(prompt, limit);
      case 'google':
        return this.searchGoogle(prompt, limit);
      default:
        return { searchResults: [], images: [] };
    }
  }

  private async waitForSourceRateLimit(sourceType: SearchSourceType): Promise<void> {
    const intervalMs = SEARCH_RATE_LIMITS_MS[sourceType];
    if (!intervalMs || intervalMs <= 0) {
      return;
    }

    const now = Date.now();
    const lastRequestAt = this.sourceLastRequestAt.get(sourceType) || 0;
    const elapsed = now - lastRequestAt;
    if (elapsed < intervalMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs - elapsed));
    }
    this.sourceLastRequestAt.set(sourceType, Date.now());
  }

  private getRandomUserAgent(): string {
    return SEARCH_USER_AGENTS[Math.floor(Math.random() * SEARCH_USER_AGENTS.length)];
  }

  private async fetchHtml(url: string, params: Record<string, string | number>, headers = {}) {
    const queryText = String(params.q || params.query || '');
    const response = await this.fetchWithTimeout(
      `${url}?${new URLSearchParams(
        Object.entries(params).reduce<Record<string, string>>((result, [key, value]) => {
          result[key] = String(value);
          return result;
        }, {}),
      ).toString()}`,
      {
        method: 'GET',
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': /[\u4e00-\u9fff]/.test(queryText)
            ? 'zh-CN,zh;q=0.9,en;q=0.8'
            : 'en-US,en;q=0.9',
          ...headers,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTML search failed: ${response.status}`);
    }
    return response.text();
  }

  private normalizeResultLink(rawUrl: string): string {
    if (!rawUrl) {
      return '';
    }
    if (rawUrl.startsWith('//')) {
      return `https:${rawUrl}`;
    }
    if (rawUrl.startsWith('/link?url=')) {
      return `https://www.sogou.com${rawUrl}`;
    }
    if (rawUrl.includes('uddg=')) {
      try {
        const query = rawUrl.includes('?') ? rawUrl.split('?')[1] : rawUrl;
        const params = new URLSearchParams(query);
        return decodeURIComponent(params.get('uddg') || rawUrl);
      } catch (error) {
        return rawUrl;
      }
    }
    return rawUrl;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async searchDuckDuckGo(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const html = await this.fetchHtml(BUILTIN_SEARCH_SOURCE_URLS.duckduckgo, { q: prompt });
    const $ = cheerio.load(html);
    const searchResults = $('.result')
      .map((_, element) => {
        const title = this.stripHtml($(element).find('.result__title a').text());
        const link = this.normalizeResultLink(
          $(element).find('.result__title a').attr('href') || '',
        );
        const content = this.stripHtml($(element).find('.result__snippet').text());
        return { title, link, content, media: 'DuckDuckGo' };
      })
      .get()
      .filter(item => item.title && item.link)
      .slice(0, limit);
    return { searchResults, images: [] };
  }

  private async searchHackerNews(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const oneDayAgo = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    const response = await this.fetchWithTimeout(
      `${BUILTIN_SEARCH_SOURCE_URLS.hackernews}?${new URLSearchParams({
        query: prompt,
        tags: 'story',
        hitsPerPage: String(limit),
        numericFilters: `created_at_i>${oneDayAgo}`,
      }).toString()}`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(`Hacker News search failed: ${response.status}`);
    }
    const payload = await response.json();
    const searchResults = Array.isArray(payload?.hits)
      ? payload.hits
          .map((item: any) => ({
            title: String(item?.title || '').trim(),
            link: String(
              item?.url || `https://news.ycombinator.com/item?id=${item?.objectID || ''}`,
            ).trim(),
            content: String(item?.story_text || item?.title || '').trim(),
            media: 'Hacker News',
          }))
          .filter(item => item.title && item.link)
          .slice(0, limit)
      : [];
    return { searchResults, images: [] };
  }

  private async searchSogou(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const html = await this.fetchHtml(BUILTIN_SEARCH_SOURCE_URLS.sogou, {
      query: prompt,
      ie: 'utf-8',
    });
    const $ = cheerio.load(html);
    const searchResults = $('.vrwrap, .rb')
      .map((_, element) => {
        const title = this.stripHtml(
          $(element).find('h3 a, .vr-title a, .vrTitle a').first().text(),
        );
        const link = this.normalizeResultLink(
          $(element).find('h3 a, .vr-title a, .vrTitle a').first().attr('href') || '',
        );
        const content = this.stripHtml(
          $(element).find('.space-txt, .str-text-info, .str_info, .text-layout, p').first().text(),
        );
        return { title, link, content, media: 'Sogou' };
      })
      .get()
      .filter(item => item.title && item.link && !item.title.includes('大家还在搜'))
      .slice(0, limit);
    return { searchResults, images: [] };
  }

  private async searchBilibili(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const response = await this.fetchWithTimeout(
      `${BUILTIN_SEARCH_SOURCE_URLS.bilibili}?${new URLSearchParams({
        keyword: prompt,
        search_type: 'video',
        order: 'pubdate',
        page: '1',
        pagesize: String(limit),
      }).toString()}`,
      {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          Referer: 'https://search.bilibili.com/',
          Cookie: `buvid3=${randomUUID()}infoc`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Bilibili search failed: ${response.status}`);
    }
    const payload = await response.json();
    const searchResults = Array.isArray(payload?.data?.result)
      ? payload.data.result
          .map((item: any) => ({
            title: this.stripHtml(String(item?.title || '')),
            link: `https://www.bilibili.com/video/${String(item?.bvid || '').trim()}`,
            content: String(item?.description || '').trim(),
            media: 'Bilibili',
          }))
          .filter(item => item.title && item.link)
          .slice(0, limit)
      : [];
    return { searchResults, images: [] };
  }

  private async searchWeibo(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const response = await this.fetchWithTimeout(BUILTIN_SEARCH_SOURCE_URLS.weibo, {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        Referer: 'https://weibo.com/',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`Weibo search failed: ${response.status}`);
    }
    const payload = await response.json();
    const tokens = prompt
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.trim().length > 0);
    const searchResults = Array.isArray(payload?.data?.realtime)
      ? payload.data.realtime
          .filter((item: any) => {
            const word = String(item?.word || item?.note || '').toLowerCase();
            if (!word) {
              return false;
            }
            return (
              tokens.length === 0 ||
              tokens.some(token => word.includes(token) || token.includes(word))
            );
          })
          .map((item: any) => {
            const word = String(item?.word || item?.note || '').trim();
            return {
              title: word,
              link: `https://s.weibo.com/weibo?q=${encodeURIComponent(word)}`,
              content: `微博热搜热度 ${String(item?.num || '')}`.trim(),
              media: 'Weibo',
            };
          })
          .slice(0, limit)
      : [];
    return { searchResults, images: [] };
  }

  private async searchBing(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const html = await this.fetchHtml(BUILTIN_SEARCH_SOURCE_URLS.bing, { q: prompt, count: limit });
    const $ = cheerio.load(html);
    const searchResults = $('li.b_algo')
      .map((_, element) => {
        const title = this.stripHtml($(element).find('h2 a').first().text());
        const link = this.normalizeResultLink($(element).find('h2 a').first().attr('href') || '');
        const content = this.stripHtml($(element).find('.b_caption p').first().text());
        return { title, link, content, media: 'Bing' };
      })
      .get()
      .filter(item => item.title && item.link)
      .slice(0, limit);
    return { searchResults, images: [] };
  }

  private async searchGoogle(
    prompt: string,
    limit: number,
  ): Promise<{ searchResults: any[]; images: string[] }> {
    const html = await this.fetchHtml(BUILTIN_SEARCH_SOURCE_URLS.google, {
      q: prompt,
      num: limit,
      hl: 'en',
    });
    const $ = cheerio.load(html);
    const searchResults = $('div.g')
      .map((_, element) => {
        const title = this.stripHtml($(element).find('h3').first().text());
        const link = this.normalizeResultLink($(element).find('a').first().attr('href') || '');
        const content = this.stripHtml($(element).find('.VwiC3b').first().text());
        return { title, link, content, media: 'Google' };
      })
      .get()
      .filter(item => item.title && item.link && item.link.startsWith('http'))
      .slice(0, limit);
    return { searchResults, images: [] };
  }

  private pickSourceKey(rawKey: string): string | undefined {
    const keys = rawKey.split(',').filter(key => key.trim());
    if (!keys.length) return undefined;
    return keys[Math.floor(Math.random() * keys.length)];
  }

  private buildAuthorizationHeader(key: string, isTavilyApi: boolean): string {
    const trimmedKey = key.trim();
    if (isTavilyApi && !/^Bearer\s+/i.test(trimmedKey)) {
      return `Bearer ${trimmedKey}`;
    }
    return trimmedKey;
  }

  private summarizeApiResult(apiResult: any): string {
    const tavilyCount = Array.isArray(apiResult?.results) ? apiResult.results.length : undefined;
    const bochaiCount = Array.isArray(apiResult?.data?.webPages?.value)
      ? apiResult.data.webPages.value.length
      : undefined;
    const bigModelCalls = Array.isArray(apiResult?.choices?.[0]?.message?.tool_calls)
      ? apiResult.choices[0].message.tool_calls.length
      : undefined;
    const imageCount = Array.isArray(apiResult?.images)
      ? apiResult.images.length
      : Array.isArray(apiResult?.data?.images?.value)
      ? apiResult.data.images.value.length
      : 0;

    return JSON.stringify({
      resultCount: tavilyCount ?? bochaiCount ?? 0,
      toolCallCount: bigModelCalls ?? 0,
      imageCount,
    });
  }

  private normalizeSearchResultsToNewsItems(
    searchResults: any[],
    topic: string,
  ): InternalSearchNewsItem[] {
    const seen = new Set<string>();

    return searchResults
      .map((item, index) => {
        const title = String(item?.title || '').trim();
        const link = String(item?.link || '').trim();
        const summary = String(item?.content || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 700);
        const dedupeKey = `${title.toLowerCase()}|${link.toLowerCase()}`;

        if (!title || !link || seen.has(dedupeKey)) {
          return null;
        }
        if (this.isUnsafeSearchResult({ title, link, content: summary, media: item?.media })) {
          return null;
        }
        seen.add(dedupeKey);

        return {
          id: `host-search-${index + 1}`,
          title,
          summary,
          link,
          source: this.resolveSourceLabel(item?.media, link),
          category: 'host-search',
          score: this.scoreSearchResult(title, summary, topic, index, link),
          time: '时间未知',
        };
      })
      .filter((item): item is InternalSearchNewsItem => Boolean(item))
      .sort((a, b) => b.score - a.score);
  }

  private resolveSourceLabel(media: string | undefined, link: string): string {
    if (media?.trim()) {
      return media.trim();
    }

    try {
      const host = new URL(link).hostname.replace(/^www\./, '');
      return host || 'Unknown Source';
    } catch (error) {
      return 'Unknown Source';
    }
  }

  private scoreSearchResult(
    title: string,
    summary: string,
    topic: string,
    index: number,
    link: string,
  ): number {
    const haystack = `${title} ${summary}`.toLowerCase();
    let score = Math.max(100 - index * 5, 10);

    if (this.isTrustedNewsUrl(link)) {
      score += 25;
    }

    for (const token of topic.toLowerCase().split(/\s+/)) {
      if (token.length > 1 && haystack.includes(token)) {
        score += 4;
      }
    }

    return score;
  }

  private isUnsafeSearchResult(item: {
    title?: unknown;
    link?: unknown;
    content?: unknown;
    media?: unknown;
  }): boolean {
    const link = String(item?.link || '');
    if (this.isUnsafeUrl(link)) {
      return true;
    }

    const text = [item?.title, item?.content, item?.media, link]
      .map(value => String(value || ''))
      .join(' ');
    return UNSAFE_TEXT_PATTERNS.some(pattern => pattern.test(text));
  }

  private isUnsafeUrl(value: string): boolean {
    const normalized = value.toLowerCase();
    if (UNSAFE_DOMAIN_KEYWORDS.some(keyword => normalized.includes(keyword))) {
      return true;
    }

    const hostname = this.extractHostname(value);
    return UNSAFE_DOMAIN_KEYWORDS.some(keyword => hostname.includes(keyword));
  }

  private isTrustedNewsUrl(value: string): boolean {
    const hostname = this.extractHostname(value);
    return TRUSTED_NEWS_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  }

  private extractHostname(value: string): string {
    try {
      return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    } catch (error) {
      return value.toLowerCase();
    }
  }
}

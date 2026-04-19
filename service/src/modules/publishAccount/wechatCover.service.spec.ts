import { access, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import axios from 'axios';
import { WechatCoverService } from './wechatCover.service';

declare const describe: any;
declare const expect: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const jest: any;

jest.mock('axios');

describe('WechatCoverService', () => {
  let service: WechatCoverService;
  let cacheDir: string;
  let axiosGetMock: any;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'wechat-cover-service-'));
    service = new WechatCoverService(cacheDir);
    axiosGetMock = axios.get as any;
    axiosGetMock.mockReset();
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('searches openverse once and reuses the cached manifest on later reads', async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      if (String(url).includes('api.openverse.org')) {
        return {
          data: {
            results: [
              {
                id: 'openverse-image-1',
                title: 'Autonomous driving city street',
                creator: 'Jane',
                license: 'cc-by',
                thumbnail: 'https://example.com/thumb.jpg',
                url: 'https://example.com/original.jpg',
                width: 1200,
                height: 675,
              },
            ],
          },
        };
      }

      throw new Error(`unexpected request target: ${url}`);
    });

    const first = await service.prepareCoverCandidates({
      userId: 12,
      groupId: 99,
      runId: 'run-1',
      artifactPath: '08_writer.md',
      title: '自动驾驶的真相：L4 不再是技术展示',
      markdown: '# 自动驾驶的真相：L4 不再是技术展示\n\n这里是正文。',
    });

    expect(first.fromCache).toBe(false);
    expect(first.selectedCoverPath).toBe('cover_candidates/01-openverse-openverse-image-1.jpg');
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0].thumbnailUrl).toBe('https://example.com/thumb.jpg');
    expect(first.candidates[0].relativePath).toBe(
      'cover_candidates/01-openverse-openverse-image-1.jpg',
    );

    const manifest = JSON.parse(
      await readFile(
        join(first.absoluteDirPath, 'cover_candidates', 'cover_candidates.json'),
        'utf8',
      ),
    );
    expect(manifest.selected_cover).toBe('01-openverse-openverse-image-1.jpg');

    const fetchCountAfterFirstSearch = axiosGetMock.mock.calls.length;

    const second = await service.prepareCoverCandidates({
      userId: 12,
      groupId: 99,
      runId: 'run-1',
      artifactPath: '08_writer.md',
      title: '自动驾驶的真相：L4 不再是技术展示',
      markdown: '# 自动驾驶的真相：L4 不再是技术展示\n\n这里是正文。',
    });

    expect(second.fromCache).toBe(true);
    expect(second.selectedCoverPath).toBe('cover_candidates/01-openverse-openverse-image-1.jpg');
    expect(axiosGetMock.mock.calls.length).toBe(fetchCountAfterFirstSearch);
  });

  it('uses the service default cover when openverse is unavailable', async () => {
    axiosGetMock.mockRejectedValueOnce(new Error('connect timeout'));

    const result = await service.prepareCoverCandidates({
      userId: 12,
      groupId: 99,
      runId: 'run-1',
      artifactPath: '08_writer.md',
      title: '自动驾驶的真相：L4 不再是技术展示',
      markdown: '# 自动驾驶的真相：L4 不再是技术展示\n\n这里是正文。',
      refresh: true,
    });

    expect(result.fromCache).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.selectedCoverPath).toBe('cover_candidates/default.png');
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        id: 'service-default-cover',
        provider: 'service-default',
        title: '默认公众号封面',
        relativePath: 'cover_candidates/default.png',
      }),
    );
    await access(join(result.absoluteDirPath, 'cover_candidates', 'default.png'));
  });

  it('downloads only the selected cover file when publishing needs it', async () => {
    axiosGetMock.mockImplementation(async (url: string) => {
      if (String(url).includes('api.openverse.org')) {
        return {
          data: {
            results: [
              {
                id: 'openverse-image-1',
                title: 'Autonomous driving city street',
                creator: 'Jane',
                license: 'cc-by',
                thumbnail: 'https://example.com/thumb.jpg',
                url: 'https://example.com/original.jpg',
                width: 1200,
                height: 675,
              },
            ],
          },
        };
      }

      if (String(url) === 'https://example.com/original.jpg') {
        return {
          data: new TextEncoder().encode('fake-image-binary').buffer,
        };
      }

      throw new Error(`unexpected request target: ${url}`);
    });

    const searched = await service.prepareCoverCandidates({
      userId: 12,
      groupId: 99,
      runId: 'run-1',
      artifactPath: '08_writer.md',
      title: '自动驾驶的真相：L4 不再是技术展示',
      markdown: '# 自动驾驶的真相：L4 不再是技术展示\n\n这里是正文。',
      refresh: true,
    });

    const resolved = await service.resolveSelectedCover({
      userId: 12,
      groupId: 99,
      runId: 'run-1',
      artifactPath: '08_writer.md',
      title: '自动驾驶的真相：L4 不再是技术展示',
      markdown: '# 自动驾驶的真相：L4 不再是技术展示\n\n这里是正文。',
      selectedCoverPath: searched.selectedCoverPath,
    });

    expect(resolved.cover).toBe('cover_candidates/01-openverse-openverse-image-1.jpg');
    await access(
      join(searched.absoluteDirPath, 'cover_candidates', '01-openverse-openverse-image-1.jpg'),
    );
    expect(axiosGetMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

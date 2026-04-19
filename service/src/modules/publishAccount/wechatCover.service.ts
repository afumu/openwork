import { Inject, Injectable, Optional } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';

const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/';
const USER_AGENT = 'openwork-wechat-publish/1.0';
const MAX_CANDIDATES = 6;
const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_COVER_FILE_NAME = 'default.png';
const DEFAULT_COVER_ID = 'service-default-cover';
const DEFAULT_QUERY_FALLBACK = [
  'technology industry city',
  'business analysis market',
  'modern infrastructure landscape',
];

interface PrepareCoverCandidatesInput {
  userId: number;
  groupId: number;
  runId?: string | null;
  artifactPath: string;
  title: string;
  markdown: string;
  refresh?: boolean;
}

interface CoverSearchCandidate {
  id: string;
  provider: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  creator: string;
  license: string;
  width: number;
  height: number;
}

interface OpenverseImageItem {
  id: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  thumbnail?: string;
  url?: string;
  width?: number;
  height?: number;
}

interface OpenverseSearchResponse {
  results?: OpenverseImageItem[];
}

interface CoverCandidateManifestItem {
  id: string;
  provider: string;
  title: string;
  image_url: string;
  thumbnail_url: string;
  creator: string;
  license: string;
  width: number;
  height: number;
  score: number;
  local_file: string;
}

interface CoverManifest {
  title: string;
  generated_at: string;
  provider: string;
  queries: string[];
  selected_cover: string;
  candidates: CoverCandidateManifestItem[];
}

export interface WechatCoverCandidate {
  id: string;
  provider: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  creator: string;
  license: string;
  width: number;
  height: number;
  score: number;
  localFile: string;
  relativePath: string;
}

export interface WechatCoverSelectionResult {
  fromCache: boolean;
  absoluteDirPath: string;
  generatedAt: string | null;
  provider: string;
  queries: string[];
  selectedCoverPath: string;
  candidates: WechatCoverCandidate[];
}

@Injectable()
export class WechatCoverService {
  constructor(
    @Optional()
    @Inject('WECHAT_COVER_CACHE_DIR')
    private readonly cacheRoot?: string,
  ) {}

  async prepareCoverCandidates(
    input: PrepareCoverCandidatesInput,
  ): Promise<WechatCoverSelectionResult> {
    const absoluteDirPath = this.resolveArtifactCacheDir(input);
    const manifestPath = join(absoluteDirPath, 'cover_candidates', 'cover_candidates.json');

    if (!input.refresh) {
      const cached = await this.readManifest(manifestPath, absoluteDirPath);
      if (cached) return { ...cached, fromCache: true };
    }

    const queries = this.buildQueries(input.title, input.markdown);
    const rawCandidates = await this.searchOpenverse(queries);
    const topCandidates = rawCandidates
      .map(candidate => ({
        ...candidate,
        score: this.scoreCandidate(candidate, input.title, input.markdown),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_CANDIDATES);

    const coverDir = join(absoluteDirPath, 'cover_candidates');
    await mkdir(coverDir, { recursive: true });

    const candidates: CoverCandidateManifestItem[] = [];
    for (let index = 0; index < topCandidates.length; index += 1) {
      const candidate = topCandidates[index];
      const localFile = this.buildLocalFileName(candidate, index + 1);
      candidates.push({
        id: candidate.id,
        provider: candidate.provider,
        title: candidate.title,
        image_url: candidate.imageUrl,
        thumbnail_url: candidate.thumbnailUrl,
        creator: candidate.creator,
        license: candidate.license,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
        local_file: localFile,
      });
    }
    if (!candidates.length) {
      const defaultCover = await this.prepareDefaultCoverCandidate(coverDir);
      if (defaultCover) {
        candidates.push(defaultCover);
      }
    }

    const selectedCover = candidates[0]?.local_file || '';
    const manifest: CoverManifest = {
      title: input.title,
      generated_at: new Date().toISOString(),
      provider: 'openverse',
      queries,
      selected_cover: selectedCover,
      candidates,
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
      fromCache: false,
      absoluteDirPath,
      generatedAt: manifest.generated_at,
      provider: manifest.provider,
      queries: manifest.queries,
      selectedCoverPath: selectedCover ? `cover_candidates/${selectedCover}` : '',
      candidates: manifest.candidates.map(candidate =>
        this.toCandidatePayload(candidate, absoluteDirPath),
      ),
    };
  }

  async getCachedCoverCandidates(
    input: Omit<PrepareCoverCandidatesInput, 'refresh'>,
  ): Promise<WechatCoverSelectionResult> {
    const absoluteDirPath = this.resolveArtifactCacheDir(input);
    const manifestPath = join(absoluteDirPath, 'cover_candidates', 'cover_candidates.json');
    const cached = await this.readManifest(manifestPath, absoluteDirPath);
    if (cached) {
      return {
        ...cached,
        fromCache: true,
      };
    }

    return {
      fromCache: false,
      absoluteDirPath,
      generatedAt: null,
      provider: 'openverse',
      queries: this.buildQueries(input.title, input.markdown),
      selectedCoverPath: '',
      candidates: [],
    };
  }

  async resolveSelectedCover(
    input: Omit<PrepareCoverCandidatesInput, 'refresh'> & { selectedCoverPath?: string | null },
  ) {
    let result = await this.getCachedCoverCandidates(input);
    if (!result.candidates.length) {
      result = await this.prepareCoverCandidates({
        ...input,
        refresh: true,
      });
    }
    const selectedCoverPath = (input.selectedCoverPath || result.selectedCoverPath || '').trim();
    if (!selectedCoverPath) {
      return {
        absoluteDirPath: result.absoluteDirPath,
        cover: '',
      };
    }

    const normalized = selectedCoverPath.replace(/^\/+/, '');
    const absoluteFilePath = join(result.absoluteDirPath, normalized);
    const selectedCandidate = result.candidates.find(item => item.relativePath === normalized);
    try {
      await access(absoluteFilePath);
      return {
        absoluteDirPath: result.absoluteDirPath,
        cover: normalized,
      };
    } catch {
      if (selectedCandidate) {
        const fileName = await this.downloadCandidateImage(
          {
            id: selectedCandidate.id,
            provider: selectedCandidate.provider,
            imageUrl: selectedCandidate.imageUrl,
          },
          join(result.absoluteDirPath, 'cover_candidates'),
          normalized.split('/').pop() || '',
        );

        if (fileName) {
          return {
            absoluteDirPath: result.absoluteDirPath,
            cover: `cover_candidates/${fileName}`,
          };
        }

        return {
          absoluteDirPath: undefined,
          cover: selectedCandidate.imageUrl,
        };
      }

      return {
        absoluteDirPath: undefined,
        cover: '',
      };
    }
  }

  private resolveArtifactCacheDir(input: PrepareCoverCandidatesInput) {
    const cacheRoot =
      this.cacheRoot ||
      process.env.WECHAT_COVER_CACHE_DIR ||
      join(process.cwd(), '.wechat-cover-cache');
    const baseName = (input.artifactPath.split('/').pop() || 'artifact').replace(/\.[^.]+$/u, '');
    const hash = createHash('sha1')
      .update(
        JSON.stringify({
          userId: input.userId,
          groupId: input.groupId,
          runId: input.runId || '',
          artifactPath: input.artifactPath,
        }),
      )
      .digest('hex')
      .slice(0, 12);

    return join(
      cacheRoot,
      `user-${input.userId}`,
      `group-${input.groupId}`,
      `${sanitizeSegment(baseName) || 'artifact'}-${hash}`,
    );
  }

  private async readManifest(manifestPath: string, absoluteDirPath: string) {
    try {
      const content = await readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(content) as CoverManifest;
      return {
        absoluteDirPath,
        generatedAt: manifest.generated_at || null,
        provider: manifest.provider || 'openverse',
        queries: Array.isArray(manifest.queries) ? manifest.queries : [],
        selectedCoverPath: manifest.selected_cover
          ? `cover_candidates/${manifest.selected_cover}`
          : '',
        candidates: Array.isArray(manifest.candidates)
          ? manifest.candidates.map(candidate =>
              this.toCandidatePayload(candidate, absoluteDirPath),
            )
          : [],
      };
    } catch {
      return null;
    }
  }

  private toCandidatePayload(
    candidate: CoverCandidateManifestItem,
    absoluteDirPath: string,
  ): WechatCoverCandidate {
    const relativePath = `cover_candidates/${candidate.local_file}`;
    return {
      id: candidate.id,
      provider: candidate.provider,
      title: candidate.title,
      imageUrl: candidate.image_url,
      thumbnailUrl: candidate.thumbnail_url,
      creator: candidate.creator,
      license: candidate.license,
      width: candidate.width,
      height: candidate.height,
      score: candidate.score,
      localFile: join(absoluteDirPath, relativePath),
      relativePath,
    };
  }

  private buildQueries(title: string, markdown: string) {
    const lower = `${title}\n${markdown}`.toLowerCase();
    const hints: string[] = [];
    const hintMap: Array<[string, string]> = [
      ['自动驾驶', 'autonomous driving city street'],
      ['robotaxi', 'robotaxi city'],
      ['无人出租车', 'robotaxi city'],
      ['电动车', 'electric vehicle industry'],
      ['新能源', 'clean energy industry'],
      ['芯片', 'semiconductor industry'],
      ['ai', 'artificial intelligence technology'],
      ['人工智能', 'artificial intelligence technology'],
      ['机器人', 'robotics industry'],
      ['工厂', 'factory industry'],
      ['能源', 'energy market infrastructure'],
      ['油价', 'oil market infrastructure'],
      ['制造业', 'manufacturing industry'],
      ['物流', 'logistics infrastructure'],
      ['政策', 'government policy city'],
      ['监管', 'government regulation city'],
      ['资本市场', 'capital market business'],
      ['金融', 'finance market business'],
      ['企业', 'company headquarters technology'],
    ];

    for (const [needle, query] of hintMap) {
      if (lower.includes(needle.toLowerCase()) && !hints.includes(query)) {
        hints.push(query);
      }
    }

    const normalizedTitle = title
      .replace(/[《》“”"'`]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const englishishTitle = /[A-Za-z]/.test(normalizedTitle) ? normalizedTitle : '';
    return [
      ...new Set([...hints, ...DEFAULT_QUERY_FALLBACK, englishishTitle].filter(Boolean)),
    ].slice(0, 6);
  }

  private async searchOpenverse(queries: string[]) {
    const deduped = new Map<string, CoverSearchCandidate>();
    for (const query of queries) {
      const result = await this.searchOpenverseByQueryWithRetry(query);
      for (const candidate of result) {
        if (deduped.has(candidate.imageUrl)) continue;
        deduped.set(candidate.imageUrl, candidate);
      }
      if (deduped.size > 0) break;
    }

    return [...deduped.values()];
  }

  private async searchOpenverseByQueryWithRetry(query: string): Promise<CoverSearchCandidate[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.searchOpenverseByQuery(query);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      return [];
    }

    return [];
  }

  private async searchOpenverseByQuery(query: string): Promise<CoverSearchCandidate[]> {
    const response = await axios.get<OpenverseSearchResponse>(OPENVERSE_ENDPOINT, {
      params: {
        q: query,
        page_size: 8,
        mature: 'false',
      },
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
      },
      timeout: FETCH_TIMEOUT_MS,
    });

    const data = response.data;
    return (data.results || [])
      .map(item => {
        const imageUrl = item.url?.trim();
        const thumbnailUrl = item.thumbnail?.trim() || imageUrl || '';
        if (!imageUrl || !thumbnailUrl) return null;

        return {
          id: String(item.id || createHash('sha1').update(imageUrl).digest('hex').slice(0, 12)),
          provider: 'openverse',
          title: item.title?.trim() || query,
          imageUrl,
          thumbnailUrl,
          creator: item.creator?.trim() || '',
          license: [item.license, item.license_version].filter(Boolean).join(' ').trim(),
          width: Number(item.width || 0),
          height: Number(item.height || 0),
        };
      })
      .filter(Boolean) as CoverSearchCandidate[];
  }

  private scoreCandidate(
    candidate: { title: string; width: number; height: number },
    title: string,
    markdown: string,
  ) {
    const lowerCorpus = `${title} ${markdown}`.toLowerCase();
    const lowerTitle = candidate.title.toLowerCase();
    const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : 1.6;
    const tokens = tokenize(lowerCorpus);

    let score = 0;
    for (const token of tokens.slice(0, 8)) {
      if (lowerTitle.includes(token)) score += 3;
    }

    if (candidate.width >= 1200) score += 4;
    else if (candidate.width >= 800) score += 2;

    if (ratio >= 1.4 && ratio <= 2.2) score += 5;
    else if (ratio >= 1.2) score += 2;
    else score -= 2;

    if (/portrait|headshot|logo|illustration/u.test(lowerTitle)) score -= 6;
    if (/city|market|industry|technology|business|vehicle|factory/u.test(lowerTitle)) score += 3;

    return score;
  }

  private async downloadCandidateImage(
    candidate: {
      id: string;
      provider: string;
      imageUrl: string;
    },
    coverDir: string,
    fileName: string,
  ): Promise<string> {
    const filePath = join(coverDir, fileName);

    try {
      await access(filePath);
      return fileName;
    } catch {
      // continue downloading
    }

    const response = await axios.get<ArrayBuffer>(candidate.imageUrl, {
      headers: {
        'user-agent': USER_AGENT,
      },
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_MS,
    });

    try {
      const buffer = Buffer.from(response.data);
      await writeFile(filePath, buffer);
      return fileName;
    } catch {
      return '';
    }
  }

  private async prepareDefaultCoverCandidate(
    coverDir: string,
  ): Promise<CoverCandidateManifestItem | null> {
    const sourcePath = await this.resolveDefaultCoverSourcePath();
    if (!sourcePath) return null;

    const localFile = DEFAULT_COVER_FILE_NAME;
    const targetPath = join(coverDir, localFile);
    try {
      await copyFile(sourcePath, targetPath);
    } catch {
      try {
        await access(targetPath);
      } catch {
        return null;
      }
    }

    return {
      id: DEFAULT_COVER_ID,
      provider: 'service-default',
      title: '默认公众号封面',
      image_url: '',
      thumbnail_url: '',
      creator: 'OpenWork',
      license: '',
      width: 1080,
      height: 463,
      score: 0,
      local_file: localFile,
    };
  }

  private async resolveDefaultCoverSourcePath() {
    const candidates = [
      process.env.WECHAT_DEFAULT_COVER_PATH,
      join(process.cwd(), DEFAULT_COVER_FILE_NAME),
      join(process.cwd(), 'service', DEFAULT_COVER_FILE_NAME),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // try next candidate
      }
    }

    return '';
  }

  private buildLocalFileName(
    candidate: { provider: string; id: string; imageUrl: string },
    index: number,
  ) {
    return `${String(index).padStart(2, '0')}-${sanitizeSegment(
      candidate.provider,
    )}-${sanitizeSegment(candidate.id)}${inferImageExtension(candidate.imageUrl)}`;
  }
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/u)
    .filter(word => word.length > 2)
    .slice(0, 12);
}

function sanitizeSegment(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferImageExtension(url: string) {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch {
    // ignore
  }

  return '.jpg';
}

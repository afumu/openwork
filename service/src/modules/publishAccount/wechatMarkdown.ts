const WRITER_STOP_HEADINGS = [
  '稿中使用的关键',
  '专家观点使用说明',
  '正文使用事实清单',
  '事实说明',
  '参考资料',
  '附录',
];

const WRITER_META_HEADINGS = [
  '写稿前素材准备检查',
  '采用的稿型',
  '核心写作提纲',
  '完整稿件正文',
  '正文',
  ...WRITER_STOP_HEADINGS,
];

function extractFrontmatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {} as Record<string, string>;
  return match[1].split(/\r?\n/).reduce((result, line) => {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) result[pair[1]] = pair[2];
    return result;
  }, {} as Record<string, string>);
}

export function deriveMarkdownTitle(markdown: string) {
  const frontmatter = extractFrontmatter(markdown);
  if (frontmatter.title) return frontmatter.title.trim();
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]?.trim()) return h1Match[1].trim();

  const anyHeadingMatch = markdown.match(/^#{2,6}\s+(.+)$/m);
  if (anyHeadingMatch?.[1]?.trim()) return anyHeadingMatch[1].trim();

  const boldTitleBlock =
    markdown.match(/\*\*标题[:：]\*\*\s*\r?\n\s*\*\*《?([^*》\r\n]+)》?\*\*/u) ||
    markdown.match(/\*\*标题[:：]\*\*\s*\*\*《?([^*》\r\n]+)》?\*\*/u);
  if (boldTitleBlock?.[1]?.trim()) return boldTitleBlock[1].trim();

  const standaloneBoldTitle = markdown.match(/^\s*\*\*《?([^*》\r\n]{4,})》?\*\*\s*$/mu);
  if (standaloneBoldTitle?.[1]?.trim()) return standaloneBoldTitle[1].trim();

  const degradedWriterTitle = markdown.match(/完整稿件正文[:：]\s*围绕[“"]([^”"\r\n]{4,})[”"]/u);
  return degradedWriterTitle?.[1]?.trim() || '';
}

function extractSection(markdown: string, heading: string) {
  const matcher = new RegExp(`^(#{1,6})\\s+${heading}[：:]?\\s*$`, 'm');
  const anchor = markdown.match(matcher);
  if (!anchor || anchor.index === undefined) return '';
  const anchorLevel = anchor[1]?.length || 2;
  const tail = markdown.slice(anchor.index + anchor[0].length).replace(/^\s+/, '');
  const lines = tail.split(/\r?\n/);
  const bucket: string[] = [];

  for (const line of lines) {
    const nextHeading = line.match(/^(#{1,6})\s+/);
    const hasCollectedContent = bucket.some(item => item.trim().length > 0);
    if (nextHeading && hasCollectedContent && nextHeading[1].length === anchorLevel) break;
    bucket.push(line);
  }

  return bucket.join('\n').trim();
}

function looksLikeFinishedWriterArticle(markdown: string) {
  if (!deriveMarkdownTitle(markdown)) return false;
  const hasMetaHeading = WRITER_META_HEADINGS.some(heading =>
    new RegExp(`^#{1,6}\\s+${heading}[：:]?\\s*$`, 'm').test(markdown),
  );
  return !hasMetaHeading;
}

function extractWriterBody(markdown: string) {
  const sectionBody = extractSection(markdown, '完整稿件正文') || extractSection(markdown, '正文');
  if (sectionBody.trim()) return sectionBody;
  if (looksLikeFinishedWriterArticle(markdown)) return markdown.trim();
  return '';
}

export function buildPreviewMarkdownFromArtifact(path: string, content: string) {
  const normalizedPath = path.split('/').pop() || path;

  if (/\.wechat\.md$/i.test(normalizedPath) || /^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(content)) {
    return {
      title: deriveMarkdownTitle(content),
      markdown: content.trim(),
      sourceKind: 'wechat_markdown',
    };
  }

  if (normalizedPath === '08_writer.md') {
    const body = extractWriterBody(content);
    if (!body.trim()) {
      throw new Error("无法从 08_writer.md 提取 '完整稿件正文'");
    }

    const lines = body.split(/\r?\n/);
    const kept: string[] = [];
    for (const line of lines) {
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (
        headingMatch &&
        WRITER_STOP_HEADINGS.some(heading => headingMatch[1].trim().startsWith(heading))
      ) {
        break;
      }
      kept.push(line);
    }
    const markdown = kept.join('\n').trim();
    if (!markdown) {
      throw new Error("无法从 08_writer.md 提取 '完整稿件正文'");
    }
    return {
      title: deriveMarkdownTitle(markdown),
      markdown,
      sourceKind: 'writer',
    };
  }

  if (/^99_.*正式稿\.md$/u.test(normalizedPath)) {
    const title = deriveMarkdownTitle(content);
    const report = extractSection(content, '分析报告');
    const markdown = `# ${title}\n\n${report.trim()}`.trim();
    return {
      title,
      markdown,
      sourceKind: 'formal_report',
    };
  }

  const title = deriveMarkdownTitle(content);
  return {
    title,
    markdown: content.trim(),
    sourceKind: 'raw_markdown',
  };
}

export function assertNoRelativeImages(markdown: string) {
  const relativeImagePattern = /!\[[^\]]*\]\((?!https?:\/\/|data:|\/)([^)]+)\)/giu;
  const match = markdown.match(relativeImagePattern);
  if (match?.length) {
    throw new Error('当前仅支持正文中的远程图片地址，暂不支持相对路径图片发布。');
  }
}

export function buildWechatPublishMarkdown(
  markdown: string,
  input: { title?: string; cover?: string },
) {
  const title = (input.title || deriveMarkdownTitle(markdown)).trim();
  if (!title) {
    throw new Error('发布标题不能为空');
  }

  const bodyWithoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '').trim();
  const coverLine = input.cover?.trim() ? `cover: ${input.cover.trim()}\n` : '';
  return `---\ntitle: ${title}\n${coverLine}---\n\n${bodyWithoutFrontmatter}\n`;
}

function ensureTrailingNewline(content: string) {
  return `${content.trim()}\n`;
}

function replaceSectionBody(markdown: string, headings: string[], replacementMarkdown: string) {
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (!headingMatch) continue;

    const headingName = headingMatch[2].trim().replace(/[：:]$/, '');
    if (!headings.includes(headingName)) continue;

    const anchorLevel = headingMatch[1].length;
    let stopIndex = lines.length;
    let hasCollectedContent = false;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = lines[cursor].match(/^(#{1,6})\s+(.+)$/);
      if (nextHeading && hasCollectedContent && nextHeading[1].length === anchorLevel) {
        stopIndex = cursor;
        break;
      }
      if (lines[cursor].trim()) {
        hasCollectedContent = true;
      }
    }

    const prefix = lines.slice(0, index + 1);
    const suffix = lines.slice(stopIndex);
    while (suffix.length && !suffix[0].trim()) {
      suffix.shift();
    }

    const replacementLines = replacementMarkdown.trim().split(/\r?\n/);
    const rebuiltLines = [...prefix, '', ...replacementLines];
    if (suffix.length) {
      rebuiltLines.push('', ...suffix);
    }

    return ensureTrailingNewline(rebuiltLines.join('\n'));
  }

  return '';
}

function stripLeadingTitleHeading(markdown: string) {
  return markdown
    .trim()
    .replace(/^#\s+.+?(?:\r?\n){1,2}/u, '')
    .trim();
}

export function mergeWechatDraftIntoArtifact(
  path: string,
  originalContent: string,
  draftMarkdown: string,
) {
  const normalizedPath = path.split('/').pop() || path;
  const trimmedDraft = draftMarkdown.trim();
  if (!trimmedDraft) {
    throw new Error('同步回原稿失败：发布工作副本为空');
  }

  if (/\.wechat\.md$/i.test(normalizedPath)) {
    return ensureTrailingNewline(trimmedDraft);
  }

  if (normalizedPath === '08_writer.md') {
    if (looksLikeFinishedWriterArticle(originalContent)) {
      return ensureTrailingNewline(trimmedDraft);
    }

    const replaced =
      replaceSectionBody(originalContent, ['完整稿件正文', '正文'], trimmedDraft) ||
      replaceSectionBody(originalContent, ['正文'], trimmedDraft);

    if (!replaced) {
      throw new Error("同步回原稿失败：无法定位 08_writer.md 的 '完整稿件正文' 区域");
    }

    return replaced;
  }

  if (/^99_.*正式稿\.md$/u.test(normalizedPath)) {
    const replaced = replaceSectionBody(
      originalContent,
      ['分析报告'],
      stripLeadingTitleHeading(trimmedDraft),
    );
    if (!replaced) {
      throw new Error("同步回原稿失败：无法定位正式稿中的 '分析报告' 区域");
    }
    return replaced;
  }

  return ensureTrailingNewline(trimmedDraft);
}

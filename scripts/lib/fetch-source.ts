// Source retrieval for research evidence. The agents never compute hashes
// themselves: this tool fetches a page, keeps the bytes outside the
// repository, and logs url + sha256 so the guard can check every url evidence
// record against something that was really retrieved.
import { createHash } from 'node:crypto';

export const MAX_SOURCE_BYTES = 5_000_000;
export const MAX_TEXT_CHARS = 40_000;

export interface FetchedSource {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  retrievedAt: string;
  sha256: string;
  bytes: Buffer;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from HTML: scripts and styles removed, tags dropped, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

/** Text an agent can read: HTML converted, other text passed through, binary described. */
export function readableText(source: Pick<FetchedSource, 'contentType' | 'bytes'>): string {
  const type = source.contentType.toLowerCase();
  if (!/^(text\/|application\/(json|xml|xhtml))/.test(type) && type !== '') {
    return `[${type} content, ${source.bytes.length} bytes; not shown as text]`;
  }
  const raw = source.bytes.toString('utf8');
  const text = type.includes('html') || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw) : raw;
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated at ${MAX_TEXT_CHARS} characters]` : text;
}

/** Only public http(s) URLs. Local and private addresses are refused unless allowed (tests). */
export function checkUrl(raw: string, allowLocal = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https URLs can be fetched.');
  if (url.username || url.password) throw new Error('URLs with credentials are refused.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    (host.includes(':') && /^f[cde]/i.test(host)) ||
    !host.includes('.') && !host.includes(':');
  if (local && !allowLocal) throw new Error('Local and private network addresses are refused.');
  return url;
}

export async function fetchSource(raw: string, opts: { allowLocal?: boolean; timeoutMs?: number; now?: () => Date } = {}): Promise<FetchedSource> {
  const url = checkUrl(raw, opts.allowLocal);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: { 'user-agent': 'ai-factory-research/1.0 (evidence retrieval)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  });
  checkUrl(res.url || url.href, opts.allowLocal);
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SOURCE_BYTES) {
        await reader.cancel();
        throw new Error(`Source is larger than ${MAX_SOURCE_BYTES} bytes.`);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks);
  return {
    url: url.href,
    finalUrl: res.url || url.href,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    retrievedAt: (opts.now?.() ?? new Date()).toISOString(),
    sha256: sha256Hex(bytes),
    bytes,
  };
}

/** One line of the fetch log (index.jsonl) the guard reads. */
export interface FetchLogEntry {
  url: string;
  finalUrl: string;
  sha256: string;
  retrievedAt: string;
  status: number;
}

export function parseFetchLog(text: string): FetchLogEntry[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const e = JSON.parse(line) as FetchLogEntry;
        return typeof e.url === 'string' && typeof e.sha256 === 'string' ? [e] : [];
      } catch {
        return [];
      }
    });
}

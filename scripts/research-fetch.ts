// Fetches one source for a research agent.
// Usage: node scripts/research-fetch.ts <url>
// Needs RESEARCH_SNAPSHOTS: a directory outside the repository. The raw bytes are
// saved there as <sha256>.bin and the retrieval is appended to index.jsonl.
// Prints JSON: the fields to copy into an evidence record, plus the page text.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchSource, readableText, type FetchLogEntry } from './lib/fetch-source.ts';

const target = process.argv[2];
const dir = process.env.RESEARCH_SNAPSHOTS;
if (!target || !dir) {
  console.error('Usage: RESEARCH_SNAPSHOTS=<dir> node scripts/research-fetch.ts <url>');
  process.exit(2);
}

try {
  const source = await fetchSource(target, { allowLocal: process.env.RESEARCH_ALLOW_LOCAL === '1' });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${source.sha256}.bin`), source.bytes);
  const entry: FetchLogEntry = { url: source.url, finalUrl: source.finalUrl, sha256: source.sha256, retrievedAt: source.retrievedAt, status: source.status };
  appendFileSync(join(dir, 'index.jsonl'), `${JSON.stringify(entry)}\n`);
  console.log(
    JSON.stringify(
      {
        evidenceFields: { source: { type: 'url', ref: source.url }, retrievedAt: source.retrievedAt, sha256: source.sha256 },
        httpStatus: source.status,
        finalUrl: source.finalUrl,
        contentType: source.contentType,
        text: readableText(source),
      },
      null,
      2,
    ),
  );
  if (source.status >= 400) process.exitCode = 1;
} catch (err) {
  console.error(`Fetch failed: ${(err as Error).message}`);
  process.exit(1);
}

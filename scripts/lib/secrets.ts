import type { Finding } from './types.ts';

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
];

/** S001: content that looks like a credential. The value itself is never echoed. */
export function checkSecretsInText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ rule: 'S001', file, line: i + 1, message: `Possible ${name} committed to the repository.` });
      }
    }
  });
  return findings;
}

/** S002: files that should never be committed, whatever they contain. */
export function checkSecretFileName(file: string): Finding[] {
  const base = file.split('/').pop() ?? file;
  const isEnv = /^\.env(\..+)?$/.test(base) && base !== '.env.example';
  const isKey = /\.(pem|p12|pfx|key)$/.test(base);
  if (isEnv || isKey) {
    return [{ rule: 'S002', file, message: 'Credential-bearing file type must not be committed.' }];
  }
  return [];
}

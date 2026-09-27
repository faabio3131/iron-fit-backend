import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const excluded = new Set(['package-lock.json', 'scripts/secret-scan.mjs']);
const patterns = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['Mercado Pago credential', /\bAPP_USR-[A-Za-z0-9_-]{20,}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const findings = [];
for (const path of files) {
  if (excluded.has(path) || path.startsWith('dist/')) continue;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(label + ': ' + path);
  }
}
if (findings.length > 0) {
  console.error('Potential committed secrets detected:');
  for (const finding of findings) console.error('- ' + finding);
  process.exit(1);
}
console.log('Secret scanning gate: PASS');

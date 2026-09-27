import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const patterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['AWS_ACCESS_KEY', /AKIA[0-9A-Z]{16}/g],
  ['GITHUB_TOKEN', /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ['GOOGLE_API_KEY', /AIza[0-9A-Za-z_-]{35}/g],
  ['STRIPE_LIVE_SECRET', /sk_live_[0-9A-Za-z]{20,}/g],
  ['MERCADO_PAGO_ACCESS_TOKEN', /APP_USR-[0-9A-Za-z-]{20,}/g],
];

const forbiddenTrackedEnv = files.filter(
  (path) => /(^|\/)\.env(?:\.|$)/.test(path) && !/\.env\.example$/.test(path),
);

const findings = forbiddenTrackedEnv.map((path) => ({
  path,
  kind: 'TRACKED_ENV_FILE',
}));

for (const path of files) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 1_000_000) continue;
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|pdf)$/i.test(path)) continue;

  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }

  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push({ path, kind });
  }
}

if (findings.length) {
  console.error('SECRET_SCAN_FAILED');
  for (const finding of findings) {
    console.error(finding.kind + ': ' + finding.path);
  }
  process.exit(1);
}

console.log('SECRET_SCAN_PASS tracked_files=' + files.length);

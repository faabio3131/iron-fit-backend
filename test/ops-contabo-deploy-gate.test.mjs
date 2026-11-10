import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(resolve(root, 'ops/contabo/deploy.sh'), 'utf8');
const bash = (code) => spawnSync('bash', ['-c', code], { encoding: 'utf8', timeout: 4000 });

test('deploy script passes Bash parser, fails closed via pipefail and validates images plus SHA', () => {
  const lint = spawnSync('bash', ['-n', resolve(root, 'ops/contabo/deploy.sh')], { encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(script, /^set -o pipefail$/m);
  assert.match(script, /\|\| rollback "docker compose up falhou"/);
  assert.match(script, /docker inspect "ironfit-\$\{service\}-1"/);
  assert.match(script, /docker image inspect "ironfit-\$\{service\}:ensaio"/);
  assert.match(script, /buildSha/);
  assert.ok(script.indexOf('imagem ativa $service divergiu') < script.lastIndexOf('> "$STATE"'));
  assert.ok(script.indexOf('buildSha nao corresponde') < script.lastIndexOf('> "$STATE"'));
});

test('Docker Compose failure cannot be masked by a successful tail or pre-existing HTTP 200 service', () => {
  const up = script.split('\n').find(line => line.includes('log "subindo"; docker compose up -d api web'));
  assert.ok(up);
  const run = bash(`set -o pipefail; log(){ :; }; rollback(){ exit 73; }; docker(){ echo Docker conflict; return 49; }; ${up}; echo INVALID_DEPLOY_OK`);
  assert.equal(run.status, 73, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /INVALID_DEPLOY_OK/);
});

test('API and Web build failures trigger rollback even while tail succeeds', () => {
  for (const service of ['api', 'web']) {
    const cmd = script.split('\n').find(line => line.includes('docker compose build ' + service));
    assert.ok(cmd);
    const run = bash(`set -o pipefail; CHB=1; CHA=1; log(){ :; }; rollback(){ exit 74; }; docker(){ echo Build error; return 42; }; ${cmd}; echo INVALID_DEPLOY_OK`);
    assert.equal(run.status, 74, run.stdout + run.stderr);
  }
});

test('stale running image versus built image prevents success despite all health endpoints returning 200', () => {
  const start = script.indexOf('for service in api web; do');
  const end = script.indexOf('\ndone', start);
  assert.ok(start > 0 && end > start);
  const imageGate = script.slice(start, end + 5);
  const run = bash(`rollback(){ exit 75; }; docker(){ if [ "$1" = inspect ]; then echo running-old-image; else echo built-new-image; fi; }; ${imageGate}; echo INVALID_DEPLOY_OK`);
  assert.equal(run.status, 75, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /INVALID_DEPLOY_OK/);
});

test('production Docker image includes ONLY the governed canonical plan publisher and its reviewed manifest', () => {
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --chown=node:node scripts\/stage-ai-monthly-plan-versions\.mjs \.\/scripts\/stage-ai-monthly-plan-versions\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node config\/commercial\/iron-four-tiers-2026\.candidate\.json \.\/config\/commercial\/iron-four-tiers-2026\.candidate\.json/);
  assert.doesNotMatch(dockerfile, /COPY (?:\.\/)?scripts(?:\s|\/\s)/);
  assert.doesNotMatch(dockerfile, /COPY (?:\.\/)?\.env(?:\s|$)/m);
  const stage = readFileSync(resolve(root, 'scripts/stage-ai-monthly-plan-versions.mjs'), 'utf8');
  assert.match(stage, /IRON_AI_QUOTA_ROLLOUT_APPROVED/);
  assert.match(stage, /AI_QUOTA_SUPER_ADMIN_REQUIRED/);
  assert.match(stage, /historicalPlanVersionsChanged:0/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('B V1 manifest materializes the approved commercial decisions as data', async () => {
  const manifest = JSON.parse(
    await read('config/commercial/iron-v1-launch.json'),
  );

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.matrix.version, 1);

  const items = new Map(
    manifest.launchItems.map((item) => [item.itemKey, item]),
  );
  for (const key of [
    'surface.core',
    'surface.web',
    'service.email',
    'service.billing',
    'content.external_youtube',
    'mobile.android',
    'mobile.ios',
    'ai.workout_generation',
    'ai.content_recommendation',
    'channel.meta',
    'channel.google',
  ]) {
    assert.equal(items.get(key)?.decision, 'LAUNCH', key);
  }

  assert.equal(items.get('creator.iron_managed')?.decision, 'OUT');
  assert.equal(items.get('creator.tenant_private')?.decision, 'OUT');
  assert.equal(items.get('provider.wellhub')?.decision, 'EXTERNAL_BLOCKER');
  assert.equal(items.get('provider.totalpass')?.decision, 'EXTERNAL_BLOCKER');

  const metaRationale = items.get('channel.meta')?.rationale ?? '';
  assert.match(metaRationale, /Facebook/);
  assert.match(metaRationale, /Instagram/);
  assert.match(metaRationale, /WhatsApp/);

  assert.equal(manifest.policy.trialEnabled, true);
  assert.equal(manifest.policy.trialDays, 30);
  assert.equal(manifest.policy.invoiceDueDays, 0);
  assert.equal(manifest.policy.dunningGraceDays, 7);
  assert.equal(manifest.policy.fiscalMode, 'PROVIDER_NFSE');

  const paid = manifest.plans.find((plan) => plan.code === 'IRON_V1');
  const trial = manifest.plans.find((plan) => plan.code === 'IRON_V1_TRIAL');
  assert.ok(paid && trial);

  assert.deepEqual(
    paid.prices.map((price) => [
      price.priceCode,
      price.amountMinor,
      price.interval,
    ]),
    [
      ['IRON_V1_MONTHLY_BRL', 26900, 'MONTHLY'],
      ['IRON_V1_YEARLY_BRL', 269000, 'YEARLY'],
    ],
  );

  const trialLimit = trial.entitlements.find(
    (entry) => entry.featureKey === 'commercial.trial_students_max',
  );
  assert.equal(trialLimit?.limitValue, 15);
  assert.equal(
    paid.entitlements.some(
      (entry) => entry.featureKey === 'commercial.trial_students_max',
    ),
    false,
  );
});

test('B V1 materializer can only create a validated DRAFT and never self-approve', async () => {
  const source = await read('scripts/materialize-launch-v1.mjs');

  assert.match(source, /IRON_LAUNCH_ACTOR_EMAIL/);
  assert.match(source, /SUPER_ADMIN global ativo/);
  assert.match(source, /launch\.validateDraft\(matrix\.id\)/);
  assert.match(source, /approvalPerformed: false/);
  assert.doesNotMatch(source, /launch\.approve\(/);
  assert.doesNotMatch(source, /status:\s*['"]APPROVED['"]/);
});

test('B trial student cap is a persisted LIMIT and enforced at student creation', async () => {
  const migration = await read(
    'prisma/migrations/20260928022000_trial_student_limit_capability/migration.sql',
  );
  const students = await read('src/modules/students/students.service.ts');

  assert.match(migration, /commercial\.trial_students_max/);
  assert.match(migration, /'LIMIT'/);
  assert.match(students, /commercial\.trial_students_max/);
  assert.match(students, /student\.count/);
  assert.match(students, /TransactionIsolationLevel\.Serializable/);
  assert.match(students, /Trial limitado a \$\{trialStudentLimit\} alunos/);
});

test('B Launch Matrix exposes non-mutating draft validation before approval', async () => {
  const service = await read(
    'src/modules/commercial-launch/commercial-launch.service.ts',
  );
  const controller = await read(
    'src/modules/commercial-launch/commercial-launch.controller.ts',
  );

  assert.match(service, /async validateDraft\(matrixId: string\)/);
  assert.match(service, /candidateSnapshotHash/);
  assert.match(controller, /matrices\/:id\/validate/);
});

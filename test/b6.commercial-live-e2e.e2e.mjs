import { fixtureCnpj } from './fixture-cnpj.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { login, request } from '../scripts/b6-e2e-lib.mjs';

test('B6 live commercial trial, login and ordered onboarding', async () => {
  const suffix = randomUUID().slice(0, 8);
  const password = process.env.B6_OWNER_PASSWORD;
  assert.ok(password);

  const email = `b6-owner-${suffix}@example.com`;
  const cnpj = fixtureCnpj();
  const trial = (await request('/commercial/trial/start', {
    method: 'POST',
    expected: 201,
    body: {
      requestId: randomUUID(),
      email,
      password,
      name: 'B6 Owner',
      cnpj, gymName: `B6 Academy ${suffix}`,
      timezone: 'America/Sao_Paulo',
    },
  })).payload;

  const otherRequest = {
    requestId: randomUUID(), email: 'another-' + email, password, name: 'B6 Another Owner',
    gymName: 'B6 Another Gym', timezone: 'America/Sao_Paulo',
  };
  for (const body of [otherRequest, { ...otherRequest, cnpj: '00000000000000' }]) {
    await request('/commercial/trial/start', { method: 'POST', expected: 400, body });
  }
  await request('/commercial/trial/start', {
    method: 'POST', expected: 409, body: { ...otherRequest, cnpj },
  });

  const owner = await login(email, password);
  assert.equal(owner.user.activeGymId, trial.gymId);

  for (const [step, data] of [
    ['ACADEMY_PROFILE', { name: 'B6 Academy Canonical', timezone: 'America/Sao_Paulo' }],
    ['EQUIPMENT_INVENTORY', null],
    ['TEAM_REVIEW', null],
    ['FINISH', null],
  ]) {
    await request('/commercial/onboarding', {
      method: 'PATCH',
      token: owner.access_token,
      expected: 200,
      body: { step, ...(data ? { data } : {}) },
    });
  }

  const state = (await request('/commercial/onboarding', {
    token: owner.access_token,
    expected: 200,
  })).payload;
  assert.equal(state.status, 'COMPLETED');
}, { timeout: 30000 });

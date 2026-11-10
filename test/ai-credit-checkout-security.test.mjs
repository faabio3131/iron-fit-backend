import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AI credit purchase is OWNER/SUPER_ADMIN only and requires actual session step-up',async()=>{
  const source=await readFile('src/modules/ai/ai-credit-checkout.controller.ts','utf8');
  assert.match(source, /@Roles\('OWNER', 'SUPER_ADMIN'\)/);
  assert.match(source, /@UseGuards\(JwtAuthGuard, RolesGuard, StepUpGuard\)/);
  assert.match(source, /import \{ StepUpGuard \} from '\.\.\/auth\/guards\/step-up.guard'/);
  assert.match(source, /resolveTenantOperationGymId/);
  assert.doesNotMatch(source, /@Roles\('RECEPTION'|'MANAGER'|'TRAINER'|'STUDENT'\)/);
});

test('AI credit S2S adapter fails closed except for fixed official FM Command host',async()=>{
  const source=await readFile('src/modules/ai/ai-credit-checkout.controller.ts','utf8');
  assert.match(source, /url\.hostname !== 'app\.fmcommand\.com\.br'/);
  assert.match(source, /url\.pathname !== '\/api\/internal\/iron\/ai-credits\/checkout'/);
  assert.match(source, /url\.protocol !== 'https:'/);
  assert.match(source, /!endpoint \|\| !token \|\| token\.length < 32/);
  assert.match(source, /redirect: 'error'/);
  assert.match(source, /'idempotency-key': dto\.requestId/);
  assert.match(source, /checkoutUrl\.hostname !== 'pay\.cakto\.com\.br'/);
});

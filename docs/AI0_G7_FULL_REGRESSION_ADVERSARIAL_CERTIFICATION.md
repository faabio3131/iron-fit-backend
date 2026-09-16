# AI0 G7 — Full Regression & AI Adversarial Certification

## Objective

Certify the complete IRON Intelligence foundation (G1-G7) against adversarial, tenant-isolation, provider-failure and authority-boundary regressions without introducing a real provider, a second business-rule engine or new schema.

## Constitutional boundary

AI remains advisory/governed. It may not authorize physical access, payment, fiscal operations, rights, entitlements, or activate workouts. Workout generation may create only a governed candidate requiring human review.

The backend remains the source of truth. EQ, PE, CN, Workout and the deterministic Core remain canonical and are reused rather than duplicated.

## Permanent adversarial matrix

The G7 permanent test covers:

1. cross-tenant isolation and authenticated tenant authority;
2. prompt injection boundary: untrusted client instructions remain sanitized provider input, separate from versioned prompt metadata and unable to become domain authority;
3. context exfiltration and secret injection protection, including tokens, passwords, API keys, financial and fiscal material;
4. entitlement-off and unauthorized-role fail-closed behavior before provider execution;
5. provider down, Null Provider, timeout, budget/configuration unavailable normalization;
6. malformed provider output rejection;
7. model attempts to mutate approval/status/payment/access/entitlement/rights/publishing authority;
8. invalid equipment references delegated to canonical EQ compatibility;
9. invalid content references delegated to canonical Creator Network eligibility;
10. mandatory human review and physical/logical prohibition of AI auto-activation;
11. provenance by hashes/requestId and sanitized metadata rather than raw secret/provider payload;
12. deterministic workouts/assessments remaining independent of AI availability;
13. mobile advisory endpoints remaining optional and safely unavailable for certified app fallback;
14. full repository regression through the canonical CI pipeline.

## Prompt-injection interpretation

G7 does not pretend that arbitrary natural-language input can be made harmless by keyword filtering. Instead, authority is structurally separated: provider prompt metadata is versioned server-side, client instructions are untrusted input, provider context is allowlisted/sanitized, and model output passes a validator that rejects authority-bearing fields and invented URLs before any workout mutation.

## Expected failure behavior

- Entitlement/RBAC/tenant violation: fail closed before provider execution.
- Provider/configuration/budget/timeout failure: normalized unavailable result/HTTP error; deterministic Core remains usable.
- Malformed or authority-bearing output: reject before domain mutation and record governed provenance where applicable.
- Incompatible equipment/content: reject using the canonical EQ/CN resolvers.
- AI workout generation failure: no workout candidate is persisted.
- Successful generation: only PENDING_REVIEW, createdByAI=true, approvedById=null; a human-authenticated canonical workout transition is required for APPROVED/ACTIVE.

## Migration

No migration is required for G7. This gate is certification/regression work over the schema and boundaries already delivered by G1-G6.

## Provider status

G7 remains provider-neutral. A real production provider, credential and secret backend are not prerequisites for certifying the foundation; their live homologation belongs to the external-provider production track.

## Exit criteria

- canonical dependency audit, Prisma generate, lint/typecheck and build green;
- complete `node --test test/*.test.mjs` regression green with no critical skips;
- G7 permanent adversarial matrix green;
- branch CI green;
- PR CI green;
- mergeable=true and mergeable_state=clean;
- squash merge;
- post-merge CI green;
- Drive governance reconciled and read back.

Only after those conditions are satisfied may AI0 be declared G1-G7 certified and M1 Web Parity Inventory begin.

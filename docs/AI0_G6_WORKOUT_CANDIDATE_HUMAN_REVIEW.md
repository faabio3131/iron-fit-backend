# IRON-AI0 G6 — Workout Candidate Human-in-the-loop

## Scope

G6 adds one governed professional endpoint for AI workout candidate generation. It does not add a new workout engine and does not change the canonical human status transition endpoint.

## Invariants

- `POST /ai/workout-candidates` is restricted to `SUPER_ADMIN`, `OWNER`, `MANAGER`, and `TRAINER`.
- Tenant scope is resolved from authenticated identity through the canonical tenant-operation resolver; non-super-admin callers cannot override their authenticated tenant.
- `WORKOUT_GENERATION` is gated by `ai.workout_generation` through the existing AI Policy Guard and fails closed when entitlement is unavailable.
- Context is rebuilt server-side from the target student and tenant. Health/restriction context is included only when requested by the governed generation flow and `consentHealth=true`.
- Provider input is sanitized. Provider output is validated by the G3 Output Validator and by the canonical `WorkoutsService` exercise/equipment validation.
- Provider failure, timeout, malformed output, invalid equipment, or missing configuration creates no workout candidate.
- Successful AI generation creates only `PENDING_REVIEW`, always with `createdByAI=true` and `approvedById=null`.
- The AI service has no path that calls `updateStatus`, sets `APPROVED`, or sets `ACTIVE`.
- Human approval/activation remains exclusively in the pre-existing authenticated workout status flow.
- AI execution provenance is persisted in `AiExecutionTrace`; the candidate audit trail stores the provenance request id and an explicit audit link stores the execution trace id plus workout id.
- No provider credential, endpoint secret, raw provider context, or sensitive payload is written to AuditLog.

## Idempotency and provenance

The request may carry a UUID `requestId`. `AiPersistenceService.recordExecution` keeps the canonical request-id idempotency invariant. A replay with the same execution fact resolves to the same trace. Candidate creation occurs only after a successful, validated execution.

## Schema

No migration is required for G6. Existing `Workout.createdByAI`, `Workout.status`, `Workout.approvedById`, `AiExecutionTrace`, and `AuditLog` are sufficient for the governed candidate plus provenance linkage without adding a redundant schema pointer.

## Certification boundary

G6 does not certify the entire AI0 layer. G7 remains responsible for full regression and adversarial certification across G1–G7.

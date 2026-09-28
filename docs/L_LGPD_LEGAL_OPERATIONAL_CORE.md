# IRON — Macro L — LGPD / Legal Operational Core

Status: **CANDIDATE — internal operational controls implemented. Final legal content/approval remains HUMAN/LEGAL APPROVAL REQUIRED.**

This work package implements the operational mechanisms required by the Commercial Readiness schedule without inventing legal conclusions.

## L1 — Data retention

The canonical `DataRetentionPolicy` registry stores:

- data class;
- purpose code;
- legal-basis code;
- retention period when approved;
- terminal action: DELETE, ANONYMIZE or REVIEW;
- governance status DRAFT / APPROVED / RETIRED;
- approval timestamp.

No retention period or legal basis is hard-coded by engineering. Empty or DRAFT registries do not satisfy the legal gate.

A destructive purge worker is intentionally **not enabled** before approved retention rules exist. This prevents engineering from deleting records based on an invented legal period.

## L2 — Data Subject Requests (DSR)

Authenticated users can create and list requests for:

- ACCESS;
- CORRECTION;
- DELETION;
- PORTABILITY;
- RESTRICTION;
- OBJECTION.

Duplicate active requests of the same type are rejected.

The data subject can cancel only an OPEN request. SUPER_ADMIN can move a non-terminal request to:

- IN_REVIEW;
- FULFILLED;
- REJECTED.

A rejection requires an operational resolution code. Every transition is audited.

The platform does **not** hard-code a statutory deadline. `operationalDueAt` exists for an approved operational SLA once legal review defines it.

## L3 — Privacy Policy

`LegalDocument` is versioned and immutable by kind/version.

Only documents with:

- status APPROVED;
- approvedAt present;
- effectiveAt absent or already effective

are exposed for acceptance.

Engineering does not author or auto-approve legal text. The actual Privacy Policy must be reviewed and approved by the appropriate legal/business authority.

## L4 — Terms of Service

Terms use the same versioned LegalDocument authority.

`LegalAcceptance` records the exact:

- user;
- legal-document version;
- content hash;
- acceptance timestamp.

Acceptance cannot be recorded against a DRAFT or future/non-effective document.

## L5 — Legal bases and subprocessors

The governance registry includes:

- `DataRetentionPolicy.legalBasisCode`;
- `SubprocessorRecord` with provider code, purpose, data categories, processing region, privacy/DPA references and approval state.

No subprocessor is fabricated from application dependencies. A provider appears in the approved registry only after actual business/legal review.

## Gate behavior

The SUPER_ADMIN governance snapshot reports independent readiness signals:

- retentionApproved;
- subprocessorsReviewed;
- privacyPolicyApproved;
- termsApproved;
- open DSR count.

The Macro L gate cannot PASS merely because the code or CI is green.

Final closure requires approved legal content, approved retention/legal-basis matrix, reviewed subprocessors and an operational DSR process.

## Security / minimization

- DSR records do not accept free-text sensitive payloads.
- legal acceptance stores document identity/hash, not a duplicate document body.
- audit records contain workflow metadata, not exported personal datasets.
- destructive data operations remain disabled until approved policy exists.

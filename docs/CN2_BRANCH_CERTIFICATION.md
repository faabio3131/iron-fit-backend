# IRON-CN2 — Branch Certification Evidence

Date: 05/09/2026

- Baseline: `main @ b7a82bcecc10eccd3c5e23102d71e39a3ea51706`
- Candidate before PR: `168c24907353335f12e92f2619855e5a4e618539`
- Branch quality gate: `33983701039` — SUCCESS
- Regression: `242/242 pass`, `0 fail`, `0 skipped`
- Dependency audit: `0 vulnerabilities`
- Prisma generate: SUCCESS
- lint/typecheck: SUCCESS
- build: SUCCESS

The first exploratory branch gate exposed two static regression assertions that were too broad for the additive CN2 schema. They were corrected before certification: the CN2 assertion was narrowed to `CreatorIdentity`, and the historical CN1 regression was narrowed to the CN1 identity models so it continues proving that Creator/CreatorIdentity remain global without forbidding the separate tenant-scoped Rights Vault introduced by CN2. No CN1 runtime behavior was changed.

This evidence file is part of CN2 documentation and does not promote the block by itself. PR and post-merge gates remain mandatory.

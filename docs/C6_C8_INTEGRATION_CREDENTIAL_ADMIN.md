# IRON — C6/C7/C8 Integration Credential Administration

Status: **CANDIDATE — backend/API only; UX and physical OCI homologation still pending**

This increment implements the backend half of the Cronograma Mestre C6/C7/C8.

## Authority boundaries

Tenant routes derive tenant exclusively from the authenticated active gym and are restricted to OWNER.

Global FM routes are separate and restricted to SUPER_ADMIN.

No credential endpoint accepts gymId/tenantId in the body.

## Write-only behavior

The API accepts a secret only on create/rotate request payloads. Responses expose:

- credentialConfigured;
- secretVersion;
- rotation/expiry/last-use/revocation timestamps;
- provider/environment/status;
- non-secret publicConfiguration.

Responses never expose:

- secret value;
- secretReference;
- Vault path/OCID;
- OCI credential.

There is no GET-secret route.

## C7 step-up

Every mutation that can create, rotate, verify or revoke a credential calls the existing B4 AuthSecurityService.assertStepUp before Vault access.

This requires current password and, when MFA is enabled for the account, MFA/recovery verification.

## C8 lifecycle

Create:
1. create canonical PENDING connection;
2. write to physical Vault;
3. promote the connection to ACTIVE with version/rotation metadata;
4. audit without secret material;
5. compensate with physical revoke/delete of the pending DB row if canonical promotion fails.

Rotate:
1. step-up;
2. require canonical tenant/environment;
3. rotate physical secret with expectedVersion;
4. conditional DB update on the previous canonical version;
5. divergence remains fail-closed.

Verify:
- retrieves physical secret only inside backend boundary;
- compares physical/canonical version;
- returns no secret;
- updates lastVerifiedAt.

Revoke:
- DB is marked DISCONNECTED/revoked first;
- resolver therefore fails closed immediately;
- physical Vault revocation is scheduled second;
- if physical revocation fails, API reports retry required while canonical use remains blocked.

## Remaining C6 work

The Cronograma Mestre requires **UX/API**. This PR is only the API/backend half.

C6 is not DONE until the Web/app administration screen is implemented and certified with:
- masked state only;
- create/replace/test/revoke interactions;
- no secret echo after submit;
- no secret stored in browser/localStorage;
- tenant isolation;
- step-up UX.

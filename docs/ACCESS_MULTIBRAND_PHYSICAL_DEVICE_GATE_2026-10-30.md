# IRON FIT CORE — Access Center multimarcas
Status: IMPLEMENTED / EXTERNAL BLOCKER — NOT PRODUCTION HOMOLOGATED
Branch: feat/access-multibrand-device-fabric

## Implemented on the real product
- Canonical AccessService remains authoritative for device key, QR credential,
  membership identity, replay prevention, tenant and access decision.
- PhysicalAccessCoordinator checks gym active and active/trialing canonical
  academy subscription before issuing a physical authorization.
- PhysicalAccessAttempt is a separate, additive, persisted lifecycle with
  DENIED, AUTHORIZED, RELEASE_IN_FLIGHT, COMMAND_ACCEPTED, PASSAGE_CONFIRMED,
  PASSAGE_NOT_CONFIRMED, RELEASE_UNCERTAIN and EXPIRED. AccessEvent is only the
  credential *decision*, never proof of physical presence.
- PhysicalGatewayService authenticates an active, provisioned, externally
  certified device and offers reverse-poll APIs without exposing LAN ports:
    POST /access/hardware/identify
    POST /access/hardware/claim
    POST /access/hardware/ack
    POST /access/hardware/passage
- Every gateway action authenticates its device token, scope, nonce and
  timestamp. Claimed commands use PostgreSQL compare-and-swap. A lost ACK
  never causes an automatic second unlock. Physical confirmation requires
  an HMAC-signed event bound to gym, device, manufacturer, authorization,
  event ID, timestamp and outcome.
- PhysicalAccessRecoveryService quarantines stale in-flight releases, expires
  unused authorizations and exposes a tenant-scoped physical timeline.
  GET /access/hardware/attempts requires existing authorized IRON roles.
- Web Access Center lists manufacturer, model and certification state, enrolls
  inactive hardware through owner/admin step-up, provisions one-time secrets,
  and distinguishes decisions from physical passage.

## Installed vendor boundaries

| Manufacturer | IRON native connector boundary | Third-party prerequisite |
| --- | --- | --- |
| Control iD iDBlock | Online QR event/decision codec, physical driver registry | Exact firmware/protocol, authenticated device callback and hardware |
| Topdata Fit 4 / Revolution 4 / Box 4 | TopdataEasyInnerBridge + Windows HTTPS gateway | Official EasyInner.dll, compatible firmware, authorized SDK implementation and equipment |
| Henry Pedestal/Lumen | HenrySdkBridge + Windows HTTPS gateway | Henry SDK protocol and licensed driver for the chosen model/firmware |
| DIMEP Catrax/controller | DimepSdkBridge + Windows HTTPS gateway | DIMEP SDK/protocol for the chosen controller and official bindings |

A generic native SDK bridge is **not** a native DLL integration. It does not
invent vendor symbols or commands and must never be classified as homologated.

References:
- Topdata SDK: https://integrador.topdata.com.br/suporte/download-sdk-inner-acesso/
- Topdata SDK behavior: https://integrador.topdata.com.br/suporte/funcionamento-sdk-easyinner/
- Topdata facial architecture: https://integrador.topdata.com.br/suporte/como-funciona-o-fluxo-de-comunicacao-entre-leitor-facial-catraca-linha-inner/
- Henry vendor listing: https://henry.com.br/produtos_categoria/catraca-de-acesso/
- Henry SDK integration declared: https://henry.com.br/wp-content/uploads/2025/05/Henry-Prospecto-Catraca-Pedestal-Facil.pdf

## Installation contract — on-premise SDK agent

Run the genuine `scripts/physical-gateway-agent.mjs` in the academy's
authorized Windows LAN workstation. Node.js runtime required. For Topdata
Inner SDK, the official manufacturer documents Windows and .NET Framework 3.5
plus an installed/registered DLL; Topdata Easy/facial devices require the
different Facial SDK/WebSocket contract.

Required protected environment variables:
- IRON_GATEWAY_URL: absolute HTTPS backend origin only, no URL credentials
- IRON_GATEWAY_DEVICE_ID: UUID provisioned in Access Center
- IRON_GATEWAY_DEVICE_TOKEN: one-time provisioned device secret
- IRON_GATEWAY_SDK_BINDING: absolute file URL to the **official** installed
  vendor SDK adapter module on that authorized machine

Local SDK binding must export `createIronSdkBinding()` returning:
`manufacturer`, `model`, `firmware`, `readIdentification()`,
`release(command)` and `waitForPassage(command)`. The mapping to official
native SDK calls must come from the actual vendor SDK, not guessed names.
The physical gateway refuses to start without this binding. Never commit
the token, DLL or vendor credential to Git. Rotate token if compromised.
Use outbound HTTPS with firewall egress restrictions; never expose raw
TCP/IP/serial catraca ports publicly.

### SDK lifecycle
1. Read QR identification from *real device SDK*.
2. Submit canonical IRON device-authenticated identity decision.
3. If and only if authorized, atomically claim the one-time command.
4. Execute the **actual official SDK** command, preserving auth ID and direction.
5. Submit positive/negative/unknown ACK. Unknown is quarantined, never resent.
6. Wait for real SDK passage sensor event; send signed proof. An ACK alone
   is never presence.
7. Expiration/recovery reconciles safe states; it never opens hardware.

## Certification — external gates
No provider may be promoted by selecting a brand in the UI. New devices
start inactive with certificationStatus NOT_HOMOLOGATED and no reference.
PRODUCTION_HOMOLOGATED and certificationRef require external evidence and
controlled change before activation.

For each exact model/firmware:
- Licensed SDK/API signature, connection mode and correct direction mapped
- Real device identity and gateway local deployment
- Approved TLS, key storage, device rotation and physical port controls
- Authorize and deny, disabled gym, suspended subscription, repeated events
- Genuine giro sensor evidence, no-giro, sensor failure and power loss
- Loss of cloud connectivity, SDK crash, stale credential and reconnect
- Concurrent turnstiles, repeated callback and lost ACK without double opening
- Tenant isolation, audit, migration, CI and production deployment verification

## Wellhub / TotalPass
Their eligibility remains a separate provider authorization. No aggregator
may directly open hardware without approved provider contract and official
external homologation. Both remain EXTERNAL_BLOCKER under current launch matrix.

## Current stop-ship status
The internal integration fabric, API and local agent source exist. Official
Topdata/Henry/DIMEP native SDK bindings/binaries, exact model tests,
partner credentials and physical E2E evidence are external prerequisites.
No real brand is declared production homologated or enabled.

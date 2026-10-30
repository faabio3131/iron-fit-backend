# IRON FIT CORE — Physical Device Integration Fabric
Status: CANDIDATE — NOT HOMOLOGATED
Branch: feat/access-multibrand-device-fabric

## Architectural boundary
The existing AccessService is the only canonical authority for device token,
tenant binding, nonce/replay validation and QR credential decisions.
The new PhysicalAccessAttempt tracks a separate physical passage lifecycle.
A positive AccessEvent is an access *decision*, not evidence of attendance.

Devices are enrolled inactive. Owner/Super Admin + active step-up must enroll
or activate hardware. Hardware token provisioning must precede activation.
If no verified vendor driver is installed, activation fails closed.

## Manufacturer implementation matrix

| Brand | Local integration requirement | Implemented | Still blocked |
| --- | --- | --- | --- |
| Control iD iDBlock | Online Pro/Enterprise REST events, Monitor confirmation, correct turnstile orientation | Official online QR event/decision codec + canonical driver boundary | Authenticated event gateway, actual monitor and device/firmware contract |
| Topdata Fit/Revolution/Box 4 | Windows EasyInner.dll, .NET Framework 3.5, TCP/IP; facial reader uses separate WebSocket SDK | Typed isolated LOCAL_SDK bridge | Vendor DLL/SDK runtime and physical tests |
| Henry | Model-specific SDK/protocol and firmware | Typed isolated PROPRIETARY bridge | Official protocol/binaries/model selection and tests |
| DIMEP/Catrax | Model-specific SDK or controller protocol | Typed isolated PROPRIETARY bridge | Official protocol/binaries/model selection and tests |

References:
- https://www.controlid.com.br/docs/access-api-pt/modos-de-operacao/eventos-de-identificacao-online/
- https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
- https://integrador.topdata.com.br/suporte/funcionamento-sdk-easyinner/
- https://integrador.topdata.com.br/suporte/como-funciona-o-fluxo-de-comunicacao-entre-leitor-facial-catraca-linha-inner/

## Required physical E2E gate before enabling any manufacturer
1. Bind device model, firmware, manufacturer and tenant to verified device identity.
2. No direct LAN catraca ports exposed to public Internet.
3. Authorize only via canonical IRON backend; provider eligibility/plan/entry
   restrictions must be reconciled with authoritative business rules.
4. Confirm explicit command authorization ID, expiry and device direction.
5. Verify actual turnstile passage using authenticated manufacturer event.
   Reject fabricated, duplicated, stale and cross-device events.
6. Separate command accepted from user physically passed; timeout is NOT present.
7. Test offline/online recovery and exactly-once reconciliation under retries.
8. Maintain secure tenant-specific key references, rotation and revocation.
9. Execute tests with real hardware or certified vendor integration environment.
10. Mark PRODUCTION HOMOLOGATED only after physical evidence, CI, audit and signoff.

## Special case: TotalPass / Wellhub
Never route external provider eligibility directly to physical unlock.
External aggregators remain fail-closed and EXTERNAL_BLOCKER until official
partner credentials and certification. The physical driver never creates
aggregator entitlements or bypasses canonical visit authorization.

## Explicit non-goals for current commit
This candidate does not ship Control iD remote command transport, a licensed
Topdata/Henry/DIMEP SDK, an embedded local executable, or production activation.
A typed integration boundary is not proof of manufacturer API interoperability.

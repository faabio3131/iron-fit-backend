"""Disposable IRON/NFCore cross-repository certification fixture, never a deployment."""
from __future__ import annotations

import os
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID, ObjectIdentifier

from kordena_fiscal.application.service import FiscalApplicationService
from kordena_fiscal.control_plane import (
    AdminPrincipal, ControlPlanePermission, DurableControlPlaneService, FiscalUnitRegistration,
)
from kordena_fiscal.domain import (
    BrazilianJurisdiction, CnaeCode, Cnpj, ExecutionScope, FiscalAccountBinding,
    FiscalAccountId, FiscalAddress, FiscalEnvironment, FiscalProfile, FiscalUnitId,
    HostNamespace, HostScope, MunicipalRegistration, StateRegistration, TaxRegimeCode,
)
from kordena_fiscal.persistence.postgres import PostgresFiscalDatabase
from kordena_fiscal.runtime.fiscal_runtime import (
    CanonicalBridgeSecurityBoundary, CanonicalFiscalOperationPath,
)
from kordena_fiscal.security.s2s import (
    CallerIdentity, FiscalCapability, HostScopeGrant, InMemorySecurityAuditSink,
    S2SAuthorizer, WorkloadAuthenticator, WorkloadCredentialRecord,
)
from kordena_fiscal.vault.encrypted_a1 import EncryptedA1Vault
from kordena_fiscal.web import create_app

ORIGIN = "https://app.ironfitcore.com.br"
ENV = FiscalEnvironment.HOMOLOGATION
NOW = datetime.now(UTC)
DSN = os.environ["IRON_NFCORE_TEST_DSN"]
directory = Path(os.environ["IRON_NFCORE_FIXTURE_DIR"])
if os.environ.get("CI") != "true" or urlsplit(DSN).hostname != "127.0.0.1" or urlsplit(DSN).path != "/iron_nfcore_ci":
    raise RuntimeError("Refusing non-disposable certification database")
if not directory.is_dir() or not directory.name.startswith("iron-nfcore-"):
    raise RuntimeError("Refusing non-disposable certificate directory")
token = os.environ["IRON_NFCORE_WORKLOAD_TOKEN"]
password = os.environ["IRON_NFCORE_PFX_PASSWORD"].encode("ascii")
db = PostgresFiscalDatabase(DSN, min_pool_size=1, max_pool_size=8)
db.initialize()
admin = AdminPrincipal(
    actor_id="synthetic-admin",
    permissions=frozenset({
        ControlPlanePermission.ORGANIZATION_WRITE,
        ControlPlanePermission.UNIT_WRITE,
        ControlPlanePermission.PROFILE_WRITE,
    }),
    global_scope=True,
)
control = DurableControlPlaneService(db)
application = FiscalApplicationService(db)

def make_pfx(cnpj: str, path: Path) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic CI only")])
    encoded = cnpj.encode("ascii")
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(NOW - timedelta(days=1)).not_valid_after(NOW + timedelta(days=7))
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=False,
            crl_sign=False, encipher_only=False, decipher_only=False,
        ), critical=True)
        .add_extension(x509.SubjectAlternativeName([
            x509.OtherName(ObjectIdentifier("2.16.76.1.3.3"), bytes([4, len(encoded)]) + encoded),
        ]), critical=False).sign(key, hashes.SHA256())
    )
    path.write_bytes(pkcs12.serialize_key_and_certificates(
        b"ci-synthetic", key, cert, None, serialization.BestAvailableEncryption(password),
    ))
    path.chmod(0o600)

for suffix, cnpj in (("a", "11222333000181"), ("b", "12345678000195")):
    tenant, unit = "fiscal-tenant-" + suffix, "fiscal-unit-" + suffix
    control.onboard_organization(actor=admin, tenant_id=tenant, legal_name="Synthetic CI " + suffix,
                                 correlation_id="ci-org-" + suffix)
    control.onboard_unit(actor=admin, registration=FiscalUnitRegistration(
        tenant_id=tenant, unit_id=unit, display_name="Synthetic CI unit",
        enabled_environments=frozenset({ENV}),
    ), correlation_id="ci-unit-" + suffix)
    control.add_fiscal_profile(actor=admin, profile=FiscalProfile(
        profile_id="ci-profile-" + suffix, version=1,
        scope=ExecutionScope(host_namespace="fm.iron", tenant_id=tenant, unit_id=unit,
                             environment=ENV, correlation_id="ci-profile-" + suffix),
        cnpj=Cnpj(cnpj), legal_name="Synthetic CI " + suffix, trade_name="Synthetic CI",
        tax_regime=TaxRegimeCode.SIMPLES_NACIONAL,
        state_registration=StateRegistration(state_code="SP", number="110042490114"),
        municipal_registration=MunicipalRegistration("12345678"),
        primary_cnae=CnaeCode("6202300"),
        address=FiscalAddress(street="Praca da Se", number="100", district="Se",
                              municipality_name="Sao Paulo", jurisdiction=BrazilianJurisdiction(
                                  state_code="SP", municipality_ibge_code="3550308"),
                              postal_code="01001000"),
        effective_from=NOW - timedelta(days=1), effective_to=None,
    ))
    application.register_binding(FiscalAccountBinding(
        binding_id="ci-binding-" + suffix,
        host_scope=HostScope(namespace=HostNamespace("fm.iron"),
                             tenant_id="gym-" + suffix, unit_id="gym-unit-" + suffix),
        fiscal_account_id=FiscalAccountId(tenant), fiscal_unit_id=FiscalUnitId(unit),
    ))
    make_pfx(cnpj, directory / (suffix + ".p12"))

def credential(suffix: str, withdrawal: bool) -> WorkloadCredentialRecord:
    capabilities = {FiscalCapability.CERTIFICATE_DELEGATE, FiscalCapability.CERTIFICATE_STATUS_READ}
    if withdrawal:
        capabilities.add(FiscalCapability.CERTIFICATE_WITHDRAW)
    name = "ci-" + suffix + ("-full" if withdrawal else "-read")
    return WorkloadCredentialRecord.from_secret(
        credential_id=name, secret=token, caller=CallerIdentity(
            caller_id=name, host_namespace=HostNamespace("fm.iron"),
            capabilities=frozenset(capabilities),
            scope_grants=(HostScopeGrant(tenant_id="gym-" + suffix, unit_id="gym-unit-" + suffix),),
            environments=frozenset({ENV}),
        ), valid_from=NOW - timedelta(minutes=1), expires_at=NOW + timedelta(hours=1),
    )

path = CanonicalFiscalOperationPath(application)
security = CanonicalBridgeSecurityBoundary(
    authenticator=WorkloadAuthenticator((credential("a", True), credential("a", False), credential("b", True))),
    authorizer=S2SAuthorizer(bindings=path, audit_sink=InMemorySecurityAuditSink()),
)
vault = EncryptedA1Vault(directory=directory / "vault", master_key=secrets.token_bytes(32))
app = create_app(security=security, certificate_vault=vault, iron_a1_database=db,
                 iron_a1_allowed_origin=ORIGIN)
try:
    uvicorn.run(app, host="127.0.0.1", port=18443, access_log=False,
                ssl_keyfile=str(directory / "tls.key"), ssl_certfile=str(directory / "tls.crt"))
finally:
    db.close()

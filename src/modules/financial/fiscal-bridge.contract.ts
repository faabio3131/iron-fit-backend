import {
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationEnvironment,
} from '@prisma/client';
import { IntegrationSecretValue } from '../integrations/secrets/integration-secret-vault.port';

export const FM_FISCAL_PROVIDER_CODE = 'fm-fiscal-core' as const;
export const FM_FISCAL_CAPABILITY = 'fiscal.bridge' as const;
export const FM_FISCAL_SCHEMA_VERSION = '1.0.0' as const;

const FISCAL_HTTP_TIMEOUT_MS = 20_000;
const FISCAL_MAX_RESPONSE_BYTES = 128 * 1024;

export interface FiscalBridgePublicConfiguration {
  baseUrl: string;
  workloadId: string;
}

export interface FiscalBridgeScope {
  tenantId: string;
  unitId: string;
}

export interface FiscalBridgeRequestContext {
  environment: IntegrationEnvironment;
  scope: FiscalBridgeScope;
  configuration: FiscalBridgePublicConfiguration;
  credential: IntegrationSecretValue;
}

export interface FiscalCapabilityResponse {
  readiness: 'CONTRACT_ONLY' | 'HOMOLOGATION_READY' | 'PRODUCTION_APPROVED';
  capabilityVersion: string;
  capabilities: string[];
  correlationId: string;
}

export interface FiscalIssuanceResponse {
  requestId: string;
  status: 'accepted' | 'pending' | 'authorized' | 'rejected';
  replay: boolean;
  correlationId: string;
  documentId: string | null;
  accessKey: string | null;
  protocolReference: string | null;
}

export interface FiscalReconciliationResponse {
  status: 'matched' | 'pending' | 'divergent';
  operationReference: {
    type: string;
    id: string;
  };
  fingerprint: string;
  issues: Array<{
    code: string;
    message: string;
    documentId: string | null;
  }>;
  selectedDocumentId: string | null;
  correlationId: string;
}

export interface FiscalQueryResponse {
  status: 'authorized' | 'cancelled' | 'not_found' | 'pending';
  accessKey: string;
  protocolReference: string | null;
  correlationId: string;
}

export interface FiscalCancellationResponse {
  status: 'accepted' | 'rejected' | 'pending';
  requestId: string;
  accessKey: string;
  correlationId: string;
  eventProtocolReference: string | null;
  rejectionCode: string | null;
  rejectionMessage: string | null;
}

export class FiscalBridgeTransportError extends Error {
  constructor(
    readonly code: string,
    readonly outcomeUnknown: boolean,
  ) {
    super(code);
    this.name = 'FiscalBridgeTransportError';
  }
}

function boundedString(
  raw: unknown,
  field: string,
  max: number,
): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > max) {
    throw new ServiceUnavailableException(field + ' invalido');
  }
  return value;
}

export function parseFiscalBridgePublicConfiguration(
  raw: unknown,
): FiscalBridgePublicConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ServiceUnavailableException(
      'FM Fiscal Core sem publicConfiguration',
    );
  }
  const config = raw as Record<string, unknown>;
  const baseUrlRaw = boundedString(
    config.baseUrl,
    'FM Fiscal baseUrl',
    2048,
  );
  let base: URL;
  try {
    base = new URL(baseUrlRaw);
  } catch {
    throw new ServiceUnavailableException('FM Fiscal baseUrl invalida');
  }
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new ServiceUnavailableException(
      'FM Fiscal baseUrl deve ser HTTPS sem credenciais/query/hash',
    );
  }
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }

  return {
    baseUrl: base.toString(),
    workloadId: boundedString(
      config.workloadId,
      'FM Fiscal workloadId',
      256,
    ),
  };
}

export function fiscalBridgeEnvironment(
  environment: IntegrationEnvironment,
): 'homologation' | 'production' {
  if (environment === IntegrationEnvironment.HOMOLOG) {
    return 'homologation';
  }
  if (environment === IntegrationEnvironment.PROD) {
    return 'production';
  }
  throw new ServiceUnavailableException(
    'FM Fiscal Bridge externo permitido somente em HOMOLOG/PROD',
  );
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), baseUrl).toString();
}

function parseJsonObject(
  text: string,
): Record<string, unknown> {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FiscalBridgeTransportError(
      'FISCAL_RESPONSE_INVALID_JSON',
      true,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FiscalBridgeTransportError(
      'FISCAL_RESPONSE_INVALID_SHAPE',
      true,
    );
  }
  return parsed as Record<string, unknown>;
}

function stringArray(raw: unknown, field: string): string[] {
  if (
    !Array.isArray(raw) ||
    raw.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new FiscalBridgeTransportError(field + '_INVALID', true);
  }
  return [...new Set(raw.map((item) => String(item).trim()))];
}

function nullableString(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > max) {
    throw new FiscalBridgeTransportError(
      'FISCAL_RESPONSE_FIELD_INVALID',
      true,
    );
  }
  return raw;
}

function nullableAccessKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || !/^[0-9]{44}$/.test(raw)) {
    throw new FiscalBridgeTransportError(
      'FISCAL_ACCESS_KEY_INVALID',
      true,
    );
  }
  return raw;
}

export class FiscalBridgeHttpTransport {
  async post(
    path: string,
    body: unknown,
    context: FiscalBridgeRequestContext,
    correlationId: string,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      FISCAL_HTTP_TIMEOUT_MS,
    );
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Bearer ' + context.credential.reveal(),
      'x-fm-workload-credential-id':
        context.configuration.workloadId,
      'x-fm-host-namespace': 'fm.iron',
      'x-fm-tenant-id': context.scope.tenantId,
      'x-fm-unit-id': context.scope.unitId,
      'x-fm-environment': fiscalBridgeEnvironment(
        context.environment,
      ),
      'x-correlation-id': correlationId,
    };
    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }

    try {
      const response = await fetch(
        endpoint(context.configuration.baseUrl, path),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          redirect: 'error',
          signal: controller.signal,
        },
      );
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > FISCAL_MAX_RESPONSE_BYTES) {
        throw new FiscalBridgeTransportError(
          'FISCAL_RESPONSE_TOO_LARGE',
          true,
        );
      }
      const payload = parseJsonObject(text);
      if (!response.ok) {
        throw new FiscalBridgeTransportError(
          'FISCAL_HTTP_' + response.status,
          path === '/v1/issuances',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof FiscalBridgeTransportError) throw error;
      throw new FiscalBridgeTransportError(
        'FISCAL_UNAVAILABLE_OR_TIMEOUT',
        path === '/v1/issuances',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  parseCapability(
    payload: Record<string, unknown>,
  ): FiscalCapabilityResponse {
    const readiness = boundedString(
      payload.readiness,
      'readiness',
      64,
    );
    if (
      readiness !== 'CONTRACT_ONLY' &&
      readiness !== 'HOMOLOGATION_READY' &&
      readiness !== 'PRODUCTION_APPROVED'
    ) {
      throw new FiscalBridgeTransportError(
        'FISCAL_READINESS_INVALID',
        true,
      );
    }
    return {
      readiness,
      capabilityVersion: boundedString(
        payload.capability_version,
        'capability_version',
        64,
      ),
      capabilities: stringArray(
        payload.capabilities,
        'FISCAL_CAPABILITIES',
      ),
      correlationId: boundedString(
        payload.correlation_id,
        'correlation_id',
        256,
      ),
    };
  }


  parseReconciliation(
    payload: Record<string, unknown>,
  ): FiscalReconciliationResponse {
    const status = boundedString(payload.status, 'status', 32);
    if (
      status !== 'matched' &&
      status !== 'pending' &&
      status !== 'divergent'
    ) {
      throw new FiscalBridgeTransportError(
        'FISCAL_RECONCILIATION_STATUS_INVALID',
        false,
      );
    }

    const reference = payload.operation_reference;
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw new FiscalBridgeTransportError(
        'FISCAL_RECONCILIATION_REFERENCE_INVALID',
        false,
      );
    }
    const ref = reference as Record<string, unknown>;

    const fingerprint = boundedString(
      payload.fingerprint,
      'fingerprint',
      64,
    );
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new FiscalBridgeTransportError(
        'FISCAL_RECONCILIATION_FINGERPRINT_INVALID',
        false,
      );
    }

    if (!Array.isArray(payload.issues)) {
      throw new FiscalBridgeTransportError(
        'FISCAL_RECONCILIATION_ISSUES_INVALID',
        false,
      );
    }
    const issues = payload.issues.map((issue) => {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
        throw new FiscalBridgeTransportError(
          'FISCAL_RECONCILIATION_ISSUE_INVALID',
          false,
        );
      }
      const item = issue as Record<string, unknown>;
      return {
        code: boundedString(item.code, 'issue.code', 128),
        message: boundedString(item.message, 'issue.message', 500),
        documentId: nullableString(item.document_id, 128),
      };
    });

    return {
      status,
      operationReference: {
        type: boundedString(ref.type, 'operation_reference.type', 64),
        id: boundedString(ref.id, 'operation_reference.id', 256),
      },
      fingerprint,
      issues,
      selectedDocumentId: nullableString(
        payload.selected_document_id,
        128,
      ),
      correlationId: boundedString(
        payload.correlation_id,
        'correlation_id',
        256,
      ),
    };
  }

  parseQuery(
    payload: Record<string, unknown>,
  ): FiscalQueryResponse {
    const status = boundedString(payload.status, 'status', 32);
    if (
      status !== 'authorized' &&
      status !== 'cancelled' &&
      status !== 'not_found' &&
      status !== 'pending'
    ) {
      throw new FiscalBridgeTransportError(
        'FISCAL_QUERY_STATUS_INVALID',
        false,
      );
    }
    const accessKey = nullableAccessKey(payload.access_key);
    if (!accessKey) {
      throw new FiscalBridgeTransportError(
        'FISCAL_QUERY_ACCESS_KEY_MISSING',
        false,
      );
    }
    return {
      status,
      accessKey,
      protocolReference: nullableString(
        payload.protocol_reference,
        512,
      ),
      correlationId: boundedString(
        payload.correlation_id,
        'correlation_id',
        256,
      ),
    };
  }

  parseCancellation(
    payload: Record<string, unknown>,
  ): FiscalCancellationResponse {
    const status = boundedString(payload.status, 'status', 32);
    if (
      status !== 'accepted' &&
      status !== 'rejected' &&
      status !== 'pending'
    ) {
      throw new FiscalBridgeTransportError(
        'FISCAL_CANCELLATION_STATUS_INVALID',
        true,
      );
    }
    const accessKey = nullableAccessKey(payload.access_key);
    if (!accessKey) {
      throw new FiscalBridgeTransportError(
        'FISCAL_CANCELLATION_ACCESS_KEY_MISSING',
        true,
      );
    }
    return {
      status,
      requestId: boundedString(
        payload.request_id,
        'request_id',
        256,
      ),
      accessKey,
      correlationId: boundedString(
        payload.correlation_id,
        'correlation_id',
        256,
      ),
      eventProtocolReference: nullableString(
        payload.event_protocol_reference,
        512,
      ),
      rejectionCode: nullableString(
        payload.rejection_code,
        128,
      ),
      rejectionMessage: nullableString(
        payload.rejection_message,
        512,
      ),
    };
  }

  parseIssuance(
    payload: Record<string, unknown>,
  ): FiscalIssuanceResponse {
    const status = boundedString(payload.status, 'status', 32);
    if (
      status !== 'accepted' &&
      status !== 'pending' &&
      status !== 'authorized' &&
      status !== 'rejected'
    ) {
      throw new FiscalBridgeTransportError(
        'FISCAL_ISSUANCE_STATUS_INVALID',
        true,
      );
    }
    return {
      requestId: boundedString(
        payload.request_id,
        'request_id',
        256,
      ),
      status,
      replay: payload.replay === true,
      correlationId: boundedString(
        payload.correlation_id,
        'correlation_id',
        256,
      ),
      documentId: nullableString(payload.document_id, 128),
      accessKey: nullableAccessKey(payload.access_key),
      protocolReference: nullableString(
        payload.protocol_reference,
        512,
      ),
    };
  }
}

import { randomBytes } from 'node:crypto';

export const INTEGRATION_SCOPES = ['GLOBAL', 'TENANT'] as const;
export type IntegrationScopeContract = (typeof INTEGRATION_SCOPES)[number];

export const INTEGRATION_ENVIRONMENTS = ['DEV', 'HOMOLOG', 'PROD'] as const;
export type IntegrationEnvironmentContract = (typeof INTEGRATION_ENVIRONMENTS)[number];

export const INTEGRATION_AUTH_MODELS = [
  'API_KEY',
  'ACCESS_TOKEN',
  'OAUTH2',
  'BASIC',
  'CERTIFICATE',
  'WEBHOOK_SECRET',
  'CUSTOM',
] as const;
export type IntegrationAuthModel = (typeof INTEGRATION_AUTH_MODELS)[number];

export interface IntegrationProviderDescriptor {
  providerCode: string;
  capabilities: readonly string[];
  authModels: readonly IntegrationAuthModel[];
  environments: readonly IntegrationEnvironmentContract[];
  supportsWebhook: boolean;
  supportsOAuth: boolean;
}

export interface IntegrationConnectionScope {
  scope: IntegrationScopeContract;
  gymId?: string;
}

export interface CreateIntegrationConnectionCommand extends IntegrationConnectionScope {
  providerCode: string;
  environment: IntegrationEnvironmentContract;
  authModel: IntegrationAuthModel;
  capabilities: readonly string[];
  publicConfiguration?: Readonly<Record<string, unknown>>;
  createdByUserId?: string;
}

const PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._:-]{1,127}$/;
const SECRET_REFERENCE_PATTERN = /^isv_[A-Za-z0-9_-]{43}$/;
const FORBIDDEN_PUBLIC_KEY = /(secret|token|password|passwd|api[_-]?key|client[_-]?secret|private[_-]?key|credential|authorization|cvv|cvc|card[_-]?number|pan)/i;

export function assertProviderCode(providerCode: string): string {
  const normalized = providerCode.trim().toLowerCase();
  if (!PROVIDER_CODE_PATTERN.test(normalized)) throw new Error('providerCode invalido');
  return normalized;
}

export function assertCapability(capability: string): string {
  const normalized = capability.trim().toLowerCase();
  if (!CAPABILITY_PATTERN.test(normalized)) throw new Error('capability de integracao invalida');
  return normalized;
}

export function assertIntegrationScope(scope: IntegrationConnectionScope): void {
  if (scope.scope === 'TENANT' && !scope.gymId?.trim()) throw new Error('conexao TENANT exige gymId');
  if (scope.scope === 'GLOBAL' && scope.gymId) throw new Error('conexao GLOBAL nao aceita gymId');
}

export function newIntegrationSecretReference(): string {
  return 'isv_' + randomBytes(32).toString('base64url');
}

export function assertIntegrationSecretReference(reference: string): string {
  if (!SECRET_REFERENCE_PATTERN.test(reference)) throw new Error('secretReference de integracao invalida');
  return reference;
}

function assertPublicValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicValue(item, path + '[' + index + ']'));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PUBLIC_KEY.test(key)) {
      throw new Error('publicConfiguration contem campo sensivel: ' + path + key);
    }
    assertPublicValue(nested, path + key + '.');
  }
}

export function assertPublicIntegrationConfiguration(
  configuration?: Readonly<Record<string, unknown>>,
): void {
  if (!configuration) return;
  assertPublicValue(configuration, '');
}

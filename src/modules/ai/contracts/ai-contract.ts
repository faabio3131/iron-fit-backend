export const AI_CAPABILITIES = [
  'WORKOUT_INSIGHTS',
  'ADVISORY_CHAT',
  'WORKOUT_GENERATION',
  'CONTENT_RECOMMENDATION',
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_EXECUTION_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNAVAILABLE',
  'REJECTED',
] as const;

export type AiExecutionStatus = (typeof AI_EXECUTION_STATUSES)[number];

export const AI_FAILURE_CATEGORIES = [
  'TIMEOUT',
  'OFFLINE',
  'RATE_LIMIT',
  'BAD_CREDENTIALS',
  'UNAVAILABLE',
  'INVALID_RESPONSE',
  'POLICY_DENIED',
  'ENTITLEMENT_DENIED',
  'CONFIGURATION_UNAVAILABLE',
  'PROVIDER_INTERNAL_ERROR',
] as const;

export type AiFailureCategory = (typeof AI_FAILURE_CATEGORIES)[number];

export const AI_CONFIGURATION_SCOPES = ['GLOBAL', 'TENANT'] as const;
export type AiConfigurationScope = (typeof AI_CONFIGURATION_SCOPES)[number];

export const AI_CONFIGURATION_STATUSES = ['ACTIVE', 'DISABLED', 'UNAVAILABLE'] as const;
export type AiConfigurationStatus = (typeof AI_CONFIGURATION_STATUSES)[number];

export const AI_FALLBACK_BEHAVIORS = ['FAIL_CLOSED', 'ADVISORY_FALLBACK'] as const;
export type AiFallbackBehavior = (typeof AI_FALLBACK_BEHAVIORS)[number];

export interface AiPromptIdentity {
  promptKey: string;
  promptVersion: number;
}

export interface AiProviderIdentity {
  providerCode: string;
  modelCode: string;
}

export interface AiContextMetadata {
  tenantId: string;
  actorId?: string;
  studentId?: string;
  purpose: string;
  requestId: string;
}

export interface AiNormalizedRequest<TInput = unknown> {
  capability: AiCapability;
  prompt: AiPromptIdentity;
  context: AiContextMetadata;
  input: TInput;
}

export interface AiNormalizedResponse<TOutput = unknown> {
  status: AiExecutionStatus;
  output?: TOutput;
  confidence?: number;
  flags: readonly string[];
  failureCategory?: AiFailureCategory;
}

export interface AiValidationResult<TOutput = unknown> {
  valid: boolean;
  output?: TOutput;
  flags: readonly string[];
  failureCategory?: 'INVALID_RESPONSE' | 'POLICY_DENIED';
}

export interface AiExecutionProvenance {
  tenantId: string;
  actorId?: string;
  studentId?: string;
  capability: AiCapability;
  providerCode: string;
  modelCode: string;
  promptKey: string;
  promptVersion: number;
  configurationScope: AiConfigurationScope;
  configurationVersion: number;
  inputHash: string;
  outputHash?: string;
  confidence?: number;
  flags: readonly string[];
  status: AiExecutionStatus;
  failureCategory?: AiFailureCategory;
  latencyMs: number;
  requestId: string;
}

export interface AiExternalConfigurationContract {
  scope: AiConfigurationScope;
  tenantId?: string;
  capability: AiCapability;
  providerCode: string;
  modelCode: string;
  endpoint?: string;
  region?: string;
  timeoutMs: number;
  budgetUnits?: number;
  enabled: boolean;
  fallbackBehavior: AiFallbackBehavior;
  secretReference?: string;
  status: AiConfigurationStatus;
  version: number;
}

export interface AiProviderAdapter {
  readonly providerCode: string;
  execute<TInput = unknown, TOutput = unknown>(
    request: AiNormalizedRequest<TInput>,
    configuration: Readonly<AiExternalConfigurationContract>,
  ): Promise<AiNormalizedResponse<TOutput>>;
}

const PROVIDER_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const MODEL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PROMPT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/;
const SECRET_REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_:.-]{2,255}$/;

export function assertSecretReference(secretReference: string): string {
  if (!SECRET_REFERENCE_PATTERN.test(secretReference)) {
    throw new Error('secretReference invalida');
  }
  if (/\s/.test(secretReference) || secretReference.includes('=')) {
    throw new Error('secretReference deve ser uma referencia, nunca um segredo inline');
  }
  return secretReference;
}

export function defineAiExternalConfiguration(
  configuration: AiExternalConfigurationContract,
): Readonly<AiExternalConfigurationContract> {
  if (!AI_CAPABILITIES.includes(configuration.capability)) {
    throw new Error('capability de IA invalida');
  }
  if (!PROVIDER_CODE_PATTERN.test(configuration.providerCode)) {
    throw new Error('providerCode invalido');
  }
  if (!MODEL_CODE_PATTERN.test(configuration.modelCode)) {
    throw new Error('modelCode invalido');
  }
  if (!Number.isInteger(configuration.version) || configuration.version < 1) {
    throw new Error('version deve ser inteiro positivo');
  }
  if (!Number.isInteger(configuration.timeoutMs) || configuration.timeoutMs < 100) {
    throw new Error('timeoutMs invalido');
  }
  if (
    configuration.budgetUnits !== undefined &&
    (!Number.isFinite(configuration.budgetUnits) || configuration.budgetUnits < 0)
  ) {
    throw new Error('budgetUnits invalido');
  }
  if (configuration.scope === 'TENANT' && !configuration.tenantId) {
    throw new Error('configuracao TENANT exige tenantId');
  }
  if (configuration.scope === 'GLOBAL' && configuration.tenantId) {
    throw new Error('configuracao GLOBAL nao aceita tenantId');
  }
  if (configuration.endpoint && !configuration.endpoint.startsWith('https://')) {
    throw new Error('endpoint externo deve usar HTTPS');
  }
  if (configuration.secretReference) {
    assertSecretReference(configuration.secretReference);
  }

  return Object.freeze({ ...configuration });
}

export function defineAiPromptIdentity(
  prompt: AiPromptIdentity,
): Readonly<AiPromptIdentity> {
  if (!PROMPT_KEY_PATTERN.test(prompt.promptKey)) {
    throw new Error('promptKey invalido');
  }
  if (!Number.isInteger(prompt.promptVersion) || prompt.promptVersion < 1) {
    throw new Error('promptVersion deve ser inteiro positivo');
  }
  return Object.freeze({ ...prompt });
}

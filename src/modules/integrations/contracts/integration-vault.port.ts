export const INTEGRATION_VAULT = Symbol('INTEGRATION_VAULT');

export type IntegrationSecretPayload = Readonly<Record<string, string>>;

export interface IntegrationVaultWriteResult {
  version: number;
}

export interface IntegrationVaultPort {
  put(
    referencePath: string,
    payload: IntegrationSecretPayload,
  ): Promise<IntegrationVaultWriteResult>;

  get(referencePath: string): Promise<IntegrationSecretPayload>;

  destroy(referencePath: string): Promise<void>;
}

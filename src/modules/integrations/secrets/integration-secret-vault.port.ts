export const INTEGRATION_SECRET_VAULT = Symbol('INTEGRATION_SECRET_VAULT');

export interface VaultSecretSnapshot {
  value: string;
  version: number;
  expiresAt?: Date | null;
}

export interface IntegrationSecretVaultPort {
  putSecret(input: {
    reference: string;
    value: string;
    expectedVersion?: number;
  }): Promise<{ version: number; expiresAt?: Date | null }>;

  getSecret(reference: string): Promise<VaultSecretSnapshot>;

  revokeSecret(reference: string): Promise<void>;
}

export class IntegrationSecretValue {
  readonly #value: string;

  constructor(value: string) {
    if (!value) throw new Error('SecretValue vazio');
    this.#value = value;
    Object.freeze(this);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED]';
  }
}

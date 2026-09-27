export const IRON_RUNTIME_ENVIRONMENTS = [
  'DEV',
  'HOMOLOG',
  'PROD',
] as const;

export type IronRuntimeEnvironment =
  (typeof IRON_RUNTIME_ENVIRONMENTS)[number];

export function parseIronRuntimeEnvironment(
  value: string | undefined | null,
): IronRuntimeEnvironment | null {
  const normalized = value?.trim().toUpperCase();
  if (
    !normalized ||
    !IRON_RUNTIME_ENVIRONMENTS.includes(
      normalized as IronRuntimeEnvironment,
    )
  ) {
    return null;
  }
  return normalized as IronRuntimeEnvironment;
}

export function requireIronRuntimeEnvironment(
  value: string | undefined | null = process.env.IRON_RUNTIME_ENV,
): IronRuntimeEnvironment {
  const runtime = parseIronRuntimeEnvironment(value);
  if (!runtime) {
    throw new Error('IRON_RUNTIME_ENV deve ser DEV, HOMOLOG ou PROD');
  }
  return runtime;
}

export function assertRuntimeBootstrapContract(
  env: NodeJS.ProcessEnv = process.env,
): IronRuntimeEnvironment {
  const runtime = parseIronRuntimeEnvironment(env.IRON_RUNTIME_ENV);
  if (!runtime) {
    throw new Error('IRON_RUNTIME_ENV deve ser DEV, HOMOLOG ou PROD');
  }

  if (!env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL obrigatoria no runtime');
  }

  if (runtime === 'PROD' && env.NODE_ENV !== 'production') {
    throw new Error(
      'IRON_RUNTIME_ENV=PROD exige NODE_ENV=production',
    );
  }

  return runtime;
}

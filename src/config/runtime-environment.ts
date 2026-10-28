export const IRON_RUNTIME_ENVIRONMENTS = ['DEV', 'HOMOLOG', 'PROD'] as const;

export type IronRuntimeEnvironment =
  (typeof IRON_RUNTIME_ENVIRONMENTS)[number];

export type RuntimeIdentity = {
  service: 'gym-saas-backend';
  runtimeEnvironment: IronRuntimeEnvironment;
  nodeEnvironment: string;
  buildSha: string;
  releaseVersion: string;
};

function required(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(key + ' obrigatorio no runtime');
  return value;
}

function httpsUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(key + ' deve ser URL absoluta valida');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(key + ' deve usar HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function resolveIronRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): IronRuntimeEnvironment {
  const value = env.IRON_RUNTIME_ENV?.trim().toUpperCase();
  if (!value || !IRON_RUNTIME_ENVIRONMENTS.includes(value as IronRuntimeEnvironment)) {
    throw new Error('IRON_RUNTIME_ENV deve ser DEV, HOMOLOG ou PROD');
  }
  return value as IronRuntimeEnvironment;
}

export function runtimeIdentity(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeIdentity {
  const runtimeEnvironment = resolveIronRuntimeEnvironment(env);
  return {
    service: 'gym-saas-backend',
    runtimeEnvironment,
    nodeEnvironment: env.NODE_ENV?.trim() || 'development',
    buildSha: env.IRON_BUILD_SHA?.trim() || 'unknown',
    releaseVersion: env.IRON_RELEASE_VERSION?.trim() || 'unreleased',
  };
}

export function assertRuntimeStartupConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeIdentity {
  const identity = runtimeIdentity(env);

  required(env, 'DATABASE_URL');

  if (
    identity.runtimeEnvironment === 'PROD'
    && identity.nodeEnvironment !== 'production'
  ) {
    throw new Error('PROD exige NODE_ENV=production');
  }

  const productionShaped =
    identity.nodeEnvironment === 'production'
    && (
      identity.runtimeEnvironment === 'HOMOLOG'
      || identity.runtimeEnvironment === 'PROD'
    );

  if (productionShaped) {
    const buildSha = required(env, 'IRON_BUILD_SHA');
    if (!/^[A-Za-z0-9._-]{7,128}$/.test(buildSha)) {
      throw new Error('IRON_BUILD_SHA possui formato invalido');
    }

    httpsUrl(required(env, 'WEB_APP_URL'), 'WEB_APP_URL');

    const origins = required(env, 'CORS_ORIGINS')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      throw new Error('CORS_ORIGINS exige ao menos uma origem');
    }
    for (const origin of origins) httpsUrl(origin, 'CORS_ORIGINS');

    const metricsToken = required(env, 'OBSERVABILITY_METRICS_TOKEN');
    if (metricsToken.length < 32) {
      throw new Error(
        'OBSERVABILITY_METRICS_TOKEN deve ter ao menos 32 caracteres',
      );
    }
  }

  if (identity.runtimeEnvironment === 'PROD') {
    if (
      !['OCI', 'LOCAL_ENCRYPTED'].includes(
        env.INTEGRATION_SECRET_VAULT_BACKEND?.trim().toUpperCase() ?? '',
      )
    ) {
      throw new Error(
        'PROD exige INTEGRATION_SECRET_VAULT_BACKEND=OCI ou LOCAL_ENCRYPTED',
      );
    }

    if (
      env.SAAS_BILLING_PROVIDER?.trim().toUpperCase()
      === 'INTERNAL_SANDBOX'
    ) {
      throw new Error(
        'INTERNAL_SANDBOX de billing e proibido em PROD',
      );
    }

    if (
      env.SAAS_BILLING_SANDBOX_ENABLED?.trim().toLowerCase() === 'true'
    ) {
      throw new Error(
        'SAAS_BILLING_SANDBOX_ENABLED=true e proibido em PROD',
      );
    }
  }

  return identity;
}

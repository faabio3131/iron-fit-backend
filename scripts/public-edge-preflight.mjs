import { lookup } from 'node:dns/promises';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' obrigatorio');
  return value;
};

const parseHttps = (value, name) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + ' deve ser URL absoluta valida');
  }
  if (url.protocol !== 'https:') {
    throw new Error(name + ' deve usar HTTPS');
  }
  return url;
};

const timeoutMs = Number(process.env.IRON_EDGE_PREFLIGHT_TIMEOUT_MS ?? '10000');
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
  throw new Error('IRON_EDGE_PREFLIGHT_TIMEOUT_MS deve ser inteiro entre 1000 e 60000');
}

const api = parseHttps(required('IRON_PUBLIC_API_URL'), 'IRON_PUBLIC_API_URL');
const web = parseHttps(required('IRON_PUBLIC_WEB_URL'), 'IRON_PUBLIC_WEB_URL');
const expectedBuildSha = required('IRON_EXPECTED_BUILD_SHA');
const expectedRuntime = required('IRON_EXPECTED_RUNTIME_ENV').toUpperCase();

if (!['HOMOLOG', 'PROD'].includes(expectedRuntime)) {
  throw new Error('IRON_EXPECTED_RUNTIME_ENV deve ser HOMOLOG ou PROD');
}
if (!/^[A-Za-z0-9._-]{7,128}$/.test(expectedBuildSha)) {
  throw new Error('IRON_EXPECTED_BUILD_SHA possui formato invalido');
}

const fetchWithTimeout = async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'manual',
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const assert2xx = async (url, label) => {
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'iron-readiness-preflight/1.0' },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(label + ' retornou HTTP ' + response.status);
  }
  return response;
};

const assertProbe = async (path, probeName) => {
  const url = new URL(path, api);
  const response = await assert2xx(url, probeName);
  const body = await response.json();
  if (body?.status !== 'ok') {
    throw new Error(probeName + ' status inesperado');
  }
  if (body?.runtimeEnvironment !== expectedRuntime) {
    throw new Error(
      probeName +
        ' runtimeEnvironment divergente: esperado ' +
        expectedRuntime +
        ', recebido ' +
        String(body?.runtimeEnvironment),
    );
  }
  if (body?.buildSha !== expectedBuildSha) {
    throw new Error(
      probeName +
        ' buildSha divergente: esperado ' +
        expectedBuildSha +
        ', recebido ' +
        String(body?.buildSha),
    );
  }
  return body;
};

const resolveHost = async (url, label) => {
  const records = await lookup(url.hostname, { all: true });
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(label + ' DNS sem endereco resolvido');
  }
  return records.map((record) => record.address);
};

const checkCors = async () => {
  const origin = web.origin;
  const target = new URL('/api/v1/health/live', api);
  const response = await fetchWithTimeout(target, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'content-type,x-request-id',
      'User-Agent': 'iron-readiness-preflight/1.0',
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('CORS preflight retornou HTTP ' + response.status);
  }
  const allowOrigin = response.headers.get('access-control-allow-origin');
  const allowCredentials = response.headers.get('access-control-allow-credentials');
  if (allowOrigin !== origin) {
    throw new Error(
      'CORS allow-origin divergente: esperado ' + origin + ', recebido ' + String(allowOrigin),
    );
  }
  if (allowCredentials?.toLowerCase() !== 'true') {
    throw new Error('CORS credentials nao habilitado para origem oficial');
  }
  return {
    origin,
    allowOrigin,
    allowCredentials,
  };
};

const main = async () => {
  const [apiDns, webDns] = await Promise.all([
    resolveHost(api, 'API'),
    resolveHost(web, 'WEB'),
  ]);

  const [live, ready, webResponse, cors] = await Promise.all([
    assertProbe('/api/v1/health/live', 'liveness'),
    assertProbe('/api/v1/health/ready', 'readiness'),
    assert2xx(web, 'Web'),
    checkCors(),
  ]);

  const webContentType = webResponse.headers.get('content-type') ?? '';
  if (
    !webContentType.toLowerCase().includes('text/html') &&
    !webContentType.toLowerCase().includes('application/xhtml+xml')
  ) {
    throw new Error(
      'Web oficial retornou content-type inesperado: ' + webContentType,
    );
  }

  process.stdout.write(
    JSON.stringify({
      event: 'iron_public_edge_preflight_pass',
      apiUrl: api.toString().replace(/\/$/, ''),
      webUrl: web.toString().replace(/\/$/, ''),
      runtimeEnvironment: expectedRuntime,
      buildSha: expectedBuildSha,
      dns: {
        api: apiDns,
        web: webDns,
      },
      probes: {
        liveness: live.probe ?? 'liveness',
        readiness: ready.probe ?? 'readiness',
        postgres: ready.dependencies?.postgres ?? null,
      },
      cors,
      webContentType,
      tlsVerifiedByHttpsFetch: true,
    }) + '\n',
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

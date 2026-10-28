import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as http from 'node:http';
const require = createRequire(import.meta.url);
const https = require('node:https');
const dns = require('node:dns');
const { AiHttpTransport } = require('../dist/src/modules/ai/providers/ai-http-transport.js');

// A real loopback HTTP server under the test's control exercises streaming/cancellation.
// Only the TLS socket factory is redirected in-process; production allowlists are never relaxed.
async function boundary(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const captures = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    captures.push({ url, options });
    const { lookup, agent, ...safe } = options;
    return http.request(`http://127.0.0.1:${server.address().port}/`, safe, callback);
  });
  return { captures, transport: new AiHttpTransport() };
}

test('AI-MP HTTP reads a real bounded response and does not follow redirects or consume error payloads', async t => {
  let requests = 0;
  const { transport, captures } = await boundary(t, (req, res) => {
    requests++;
    if (requests === 1) { res.writeHead(302, { Location: 'http://169.254.169.254/latest' }); res.end('private-error'); }
    else { res.writeHead(200); res.end('{"ok":true}'); }
  });
  const url = new URL('https://api.openai.com/v1/chat/completions');
  assert.deepEqual(await transport.post(url, {}, '{}'), { status: 302, body: '' });
  assert.equal(requests, 1);
  assert.deepEqual(await transport.post(url, {}, '{}'), { status: 200, body: '{"ok":true}' });
  assert.equal(captures[0].options.agent, false);
  t.mock.method(dns, 'lookup', (_host, _opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]));
  const lookupResult = await new Promise(resolve => captures[0].options.lookup('api.openai.com', {}, error => resolve(error)));
  assert.match(lookupResult.message, /EGRESS_DENIED/);
});

test('AI-MP HTTP bounds chunked response bytes before buffering an oversized stream', async t => {
  const { transport } = await boundary(t, (_req, res) => { res.writeHead(200); res.write('x'.repeat(64000)); res.end('x'.repeat(64001)); });
  await assert.rejects(() => transport.post(new URL('https://api.openai.com/v1/chat/completions'), {}, '{}'), /AI_RESPONSE_INVALID/);
});

test('AI-MP HTTP abort closes a stalled real request without leaking errors', async t => {
  const { transport } = await boundary(t, () => {});
  await assert.rejects(() => transport.post(new URL('https://api.openai.com/v1/chat/completions'), {}, '{}', AbortSignal.timeout(50)), /AI_REQUEST_ABORTED/);
});

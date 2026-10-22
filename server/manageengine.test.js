import assert from 'node:assert/strict';
import test from 'node:test';
import { getManageEngineStatus, testManageEngineConnection } from './manageengine.js';

const credentials = {
  MANAGEENGINE_CLIENT_ID: 'client-id',
  MANAGEENGINE_CLIENT_SECRET: 'client-secret',
  MANAGEENGINE_REFRESH_TOKEN: 'refresh-token',
};

test('reports integration readiness without exposing OAuth credentials', () => {
  const status = getManageEngineStatus(credentials);

  assert.equal(status.configured, true);
  assert.equal(status.apiBaseUrl, 'https://endpointcentral.manageengine.in');
  assert.equal(status.assetWarrantyWriteBackAvailable, false);
  assert.ok(status.requiredScopes.includes('DesktopCentralCloud.Inventory.READ'));
  assert.equal(JSON.stringify(status).includes('client-secret'), false);
});

test('recognizes the Endpoint Central and Zoho environment names', () => {
  const status = getManageEngineStatus({
    ENDPOINT_CENTRAL_CLIENT_ID: 'client-id',
    ENDPOINT_CENTRAL_CLIENT_SECRET: 'client-secret',
    ENDPOINT_CENTRAL_REFRESH_TOKEN: 'refresh-token',
    ENDPOINT_CENTRAL_API_URL: 'https://endpointcentral.example.com',
    ZOHO_OAUTH_URL: 'https://accounts.zoho.com/oauth/v2/token',
  });

  assert.equal(status.configured, true);
  assert.equal(status.apiBaseUrl, 'https://endpointcentral.example.com');
  assert.equal(status.oauthUrl, 'https://accounts.zoho.com/oauth/v2/token');
});

test('requires OAuth credentials before attempting a connection', async () => {
  await assert.rejects(
    testManageEngineConnection({ env: {}, fetchImpl: async () => assert.fail('Must not call fetch without credentials.') }),
    { status: 400, message: /MANAGEENGINE_CLIENT_ID/ },
  );
});

test('refreshes OAuth token and verifies computer and user read access', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://accounts.zoho.in/oauth/v2/token') {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const result = await testManageEngineConnection({ env: credentials, fetchImpl });

  assert.deepEqual(result, { connected: true, checked: ['computer inventory', 'user directory'] });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].options.body.toString(), /grant_type=refresh_token/);
  assert.equal(calls[1].options.headers.Authorization, 'Zoho-oauthtoken test-access-token');
  assert.match(calls[1].url, /\/dcapi\/som\/computersInfo\?page=1&size=1/);
  assert.match(calls[2].url, /\/emsapi\/users\/info\?/);
});

test('reports when ManageEngine rejects the OAuth scopes', async () => {
  const fetchImpl = async (url) => url === 'https://accounts.zoho.in/oauth/v2/token'
    ? new Response('{}', { status: 401 })
    : new Response('{}', { status: 200 });

  await assert.rejects(
    testManageEngineConnection({ env: credentials, fetchImpl }),
    { status: 502, message: /OAuth authorization failed \(HTTP 401\)/ },
  );
});

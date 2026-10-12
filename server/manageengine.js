const DEFAULT_API_BASE_URL = 'https://endpointcentral.manageengine.in';
const DEFAULT_OAUTH_URL = 'https://accounts.zoho.in/oauth/v2/token';

function integrationError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const MANAGEENGINE_SCOPES = [
  'DesktopCentralCloud.SOM.READ',
  'DesktopCentralCloud.Inventory.READ',
  'DesktopCentralCloud.Admin.READ',
];

export function getManageEngineStatus(env = process.env) {
  return {
    configured: Boolean(env.MANAGEENGINE_CLIENT_ID && env.MANAGEENGINE_CLIENT_SECRET && env.MANAGEENGINE_REFRESH_TOKEN),
    apiBaseUrl: env.MANAGEENGINE_API_BASE_URL || DEFAULT_API_BASE_URL,
    oauthUrl: env.MANAGEENGINE_OAUTH_URL || DEFAULT_OAUTH_URL,
    requiredScopes: MANAGEENGINE_SCOPES,
    assetWarrantyWriteBackAvailable: false,
  };
}

async function getAccessToken(env, fetchImpl) {
  const response = await fetchImpl(env.MANAGEENGINE_OAUTH_URL || DEFAULT_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.MANAGEENGINE_CLIENT_ID,
      client_secret: env.MANAGEENGINE_CLIENT_SECRET,
      refresh_token: env.MANAGEENGINE_REFRESH_TOKEN,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw integrationError(`ManageEngine OAuth authorization failed (HTTP ${response.status}). Check the server-side OAuth credentials and granted scopes.`);
  }

  const tokenResult = await response.json();
  if (typeof tokenResult.access_token !== 'string' || !tokenResult.access_token) {
    throw integrationError('ManageEngine OAuth response did not contain an access token.');
  }
  return tokenResult.access_token;
}

export async function testManageEngineConnection({ env = process.env, fetchImpl = fetch } = {}) {
  const status = getManageEngineStatus(env);
  if (!status.configured) {
    throw integrationError('Configure MANAGEENGINE_CLIENT_ID, MANAGEENGINE_CLIENT_SECRET, and MANAGEENGINE_REFRESH_TOKEN on the API server first.', 400);
  }

  try {
    const token = await getAccessToken(env, fetchImpl);
    const headers = { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json' };
    const apiBaseUrl = status.apiBaseUrl.replace(/\/+$/, '');
    const checks = [
      ['computer inventory', '/dcapi/som/computersInfo?page=1&size=1'],
      ['user directory', '/emsapi/users/info?page=1&pageLimit=1'],
    ];
    for (const [name, path] of checks) {
      const response = await fetchImpl(`${apiBaseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw integrationError(`ManageEngine ${name} check failed (HTTP ${response.status}). Verify the API URL and OAuth scopes.`);
      }
    }
    return { connected: true, checked: ['computer inventory', 'user directory'] };
  } catch (error) {
    if (error.status) throw error;
    throw integrationError('Could not reach ManageEngine. Check the API server network access and configured endpoint URLs.');
  }
}

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

// Accept both the documented MANAGEENGINE_* names and the Endpoint Central /
// Zoho names already used by existing deployments.
function getCredentials(env) {
  return {
    clientId: env.MANAGEENGINE_CLIENT_ID || env.ENDPOINT_CENTRAL_CLIENT_ID,
    clientSecret: env.MANAGEENGINE_CLIENT_SECRET || env.ENDPOINT_CENTRAL_CLIENT_SECRET,
    refreshToken: env.MANAGEENGINE_REFRESH_TOKEN || env.ENDPOINT_CENTRAL_REFRESH_TOKEN,
  };
}

function getApiBaseUrl(env) {
  return env.MANAGEENGINE_API_BASE_URL || env.ENDPOINT_CENTRAL_API_URL || DEFAULT_API_BASE_URL;
}

function getOAuthUrl(env) {
  const configuredUrl = env.MANAGEENGINE_OAUTH_URL || env.ZOHO_OAUTH_URL || DEFAULT_OAUTH_URL;
  // Zoho console settings are often copied as the Accounts host only. The
  // refresh-token endpoint is /oauth/v2/token on that host.
  const url = new URL(configuredUrl);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/oauth/v2/token';
  return url.toString().replace(/\/$/, '');
}

export function getManageEngineStatus(env = process.env) {
  const credentials = getCredentials(env);
  return {
    configured: Boolean(credentials.clientId && credentials.clientSecret && credentials.refreshToken),
    apiBaseUrl: getApiBaseUrl(env),
    oauthUrl: getOAuthUrl(env),
    requiredScopes: MANAGEENGINE_SCOPES,
    assetWarrantyWriteBackAvailable: false,
  };
}

async function getAccessToken(env, fetchImpl) {
  const credentials = getCredentials(env);
  const response = await fetchImpl(getOAuthUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let reason = '';
    try {
      const errorResult = await response.json();
      if (typeof errorResult.error === 'string') reason = ` Zoho error: ${errorResult.error}.`;
    } catch {
      // Do not include raw response content: it may contain sensitive data.
    }
    throw integrationError(`ManageEngine OAuth authorization failed (HTTP ${response.status}).${reason} Verify the client credentials, refresh token, and Zoho data center.`);
  }

  const tokenResult = await response.json();
  if (typeof tokenResult.access_token !== 'string' || !tokenResult.access_token) {
    const reason = typeof tokenResult.error === 'string' ? ` Zoho error: ${tokenResult.error}.` : '';
    throw integrationError(`ManageEngine OAuth response did not contain an access token.${reason} Confirm the refresh token is valid for this Zoho client and data center.`);
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

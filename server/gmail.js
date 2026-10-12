import { OAuth2Client } from 'google-auth-library';

const requiredScopes = ['https://www.googleapis.com/auth/gmail.send'];

export function getGmailStatus(env = process.env) {
  const senderEmail = String(env.GMAIL_SENDER_EMAIL || '').trim();
  const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER_EMAIL']
    .filter((key) => !String(env[key] || '').trim());
  if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail) && !missing.includes('GMAIL_SENDER_EMAIL')) {
    missing.push('GMAIL_SENDER_EMAIL (must be a valid email address)');
  }
  return { configured: missing.length === 0, senderEmail, missing, requiredScopes };
}

async function gmailAccessToken(env = process.env) {
  const status = getGmailStatus(env);
  if (!status.configured) {
    throw Object.assign(new Error(`Gmail is not configured. Set ${status.missing.join(', ')} in the API server environment.`), { status: 400 });
  }
  const oauth = new OAuth2Client(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error('Google did not return a Gmail access token. Check the refresh token and OAuth client.');
  return { token, senderEmail: status.senderEmail };
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value).replace(/[\r\n]+/g, ' '), 'utf8').toString('base64')}?=`;
}

export async function sendGmailMessage(to, subject, body, { env = process.env, fetchImpl = fetch } = {}) {
  const recipient = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('Recipient email address is invalid.');
  const { token, senderEmail } = await gmailAccessToken(env);
  const rawMessage = [
    `From: ${senderEmail}`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(body), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '',
  ].join('\r\n');
  const raw = Buffer.from(rawMessage, 'utf8').toString('base64url');
  const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const message = detail?.error?.message || `Gmail API rejected the message (HTTP ${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status === 401 || response.status === 403 ? 400 : 502 });
  }
  return response.json();
}

export async function sendGmailTest({ env = process.env, fetchImpl = fetch } = {}) {
  const status = getGmailStatus(env);
  if (!status.configured) {
    throw Object.assign(new Error(`Gmail is not configured. Set ${status.missing.join(', ')} in the API server environment.`), { status: 400 });
  }
  await sendGmailMessage(status.senderEmail, 'Bigbasket ITAM Gmail integration test', 'Gmail is connected to your Bigbasket IT asset management workspace.', { env, fetchImpl });
  return { sent: true, recipient: status.senderEmail };
}

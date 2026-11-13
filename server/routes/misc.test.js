import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'itam-notification-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { ensureSchema, getDb, newId } = await import('../db.js');
const { signToken } = await import('../auth.js');
const { miscRouter } = await import('./misc.js');

ensureSchema();
const db = getDb();

function insertUser(email) {
  const user = {
    id: newId(),
    email,
    full_name: 'Notification Test',
    role: 'admin',
    department: 'IT',
    active: 1,
  };
  db.prepare(
    'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(user.id, user.email, user.full_name, 'test-hash', user.role, user.department, user.active);
  return user;
}

const recipient = insertUser('notification-recipient@example.com');
const otherUser = insertUser('other-notification-user@example.com');
const app = express();
app.use('/api', miscRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/notifications`;

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function authHeaders(user) {
  return { Authorization: `Bearer ${signToken(user, '127.0.0.1')}` };
}

function insertNotification(user) {
  const id = newId();
  db.prepare(
    `INSERT INTO app_notifications
      (id, recipient_id, event_type, title, body, entity_type, entity_id, dedupe_key)
     VALUES (?, ?, 'ASSET_ASSIGNED', 'Asset assigned', 'A new asset was assigned.', 'asset', ?, ?)`,
  ).run(id, user.id, newId(), `notification:${id}`);
  return id;
}

test('allows recipients to read and delete their notifications only', async () => {
  const notificationId = insertNotification(recipient);
  const path = `${endpoint}/${encodeURIComponent(notificationId)}`;

  const markReadResponse = await fetch(`${path}/read`, {
    method: 'PUT',
    headers: authHeaders(recipient),
  });
  assert.equal(markReadResponse.status, 200);
  assert.ok(db.prepare('SELECT read_at FROM app_notifications WHERE id = ?').get(notificationId).read_at);

  const otherUserResponse = await fetch(`${path}/read`, {
    method: 'PUT',
    headers: authHeaders(otherUser),
  });
  assert.equal(otherUserResponse.status, 404);

  const deniedDeleteResponse = await fetch(path, {
    method: 'DELETE',
    headers: authHeaders(otherUser),
  });
  assert.equal(deniedDeleteResponse.status, 404);
  assert.ok(db.prepare('SELECT id FROM app_notifications WHERE id = ?').get(notificationId));

  const deleteResponse = await fetch(path, {
    method: 'DELETE',
    headers: authHeaders(recipient),
  });
  assert.equal(deleteResponse.status, 204);
  assert.equal(db.prepare('SELECT id FROM app_notifications WHERE id = ?').get(notificationId), undefined);
});

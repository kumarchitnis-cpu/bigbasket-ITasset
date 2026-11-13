import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'itam-assets-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { ensureSchema, getDb, newId, nowIso } = await import('../db.js');
const { signToken } = await import('../auth.js');
const { assetsRouter } = await import('./assets.js');

ensureSchema();
const db = getDb();
const user = {
  id: newId(),
  email: 'asset-test@example.com',
  full_name: 'Asset Test',
  role: 'admin',
  department: 'IT',
  active: 1,
};
db.prepare(
  'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(user.id, user.email, user.full_name, 'test-hash', user.role, user.department, user.active);

function insertAvailableAsset(assetTag, barcodeValue, barcodeCreatedAt) {
  const id = newId();
  db.prepare(
    `INSERT INTO it_assets
      (id, asset_tag, category, manufacturer, model, serial_number, status, custodian, location, department, barcode_value, barcode_created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?, ?, ?, ?)`,
  ).run(id, assetTag, 'Laptop', 'Test', 'Model', `SERIAL-${id}`, 'Test User', 'HQ', 'IT', barcodeValue, barcodeCreatedAt);
  return id;
}

test('bulk barcode creation returns labels for all selected available assets', async (t) => {
  const existingCreatedAt = '2026-01-01T00:00:00.000Z';
  const existingId = insertAvailableAsset('TAG-001', 'TAG-001', existingCreatedAt);
  const missingId = insertAvailableAsset('', null, null);
  const app = express();
  app.use(express.json());
  app.use('/api/assets', assetsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/assets/barcodes/bulk`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signToken(user, '127.0.0.1')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ asset_ids: [existingId, missingId] }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.assets.map((asset) => asset.id).sort(), [existingId, missingId].sort());

  const existing = result.assets.find((asset) => asset.id === existingId);
  assert.equal(existing.barcode_created_at, existingCreatedAt);
  assert.equal(existing.barcode_value, 'TAG-001');

  const created = result.assets.find((asset) => asset.id === missingId);
  assert.equal(created.asset_tag, 'BBIT-000001');
  assert.equal(created.barcode_value, 'BBIT-000001');
  assert.ok(created.barcode_created_at);
});

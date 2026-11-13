import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'itam-google-sheets-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { ensureSchema, getDb, newId } = await import('../db.js');
const { signToken } = await import('../auth.js');
const { assetsRouter } = await import('./assets.js');

ensureSchema();
const db = getDb();
const user = {
  id: newId(),
  email: 'sheets-test@example.com',
  full_name: 'Sheets Test',
  role: 'admin',
  department: 'IT',
  active: 1,
};
db.prepare(
  'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(user.id, user.email, user.full_name, 'test-hash', user.role, user.department, user.active);

const app = express();
app.use(express.json({ limit: '16mb' }));
app.use('/api/assets', assetsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/assets/import/google-sheets`;
const analyzeEndpoint = `http://127.0.0.1:${address.port}/api/assets/import/google-sheets/analyze`;

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function importValues(values) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signToken(user, '127.0.0.1')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
}

async function analyzeValues(values) {
  return fetch(analyzeEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signToken(user, '127.0.0.1')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
}

test('imports Google Sheets rows with the same asset validation and audit trail', async () => {
  const values = [
    ['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Custodian', 'Location', 'Department', 'Purchase Cost', 'Warranty Start', 'Warranty End', 'Purchase Order'],
    ['SHEET-001', 'Laptop', 'Dell', 'Latitude', 'SN-001', 'Test User', 'HQ', 'IT', 1200, '2026-01-01', '2027-01-01', 'PO-001'],
  ];

  const response = await importValues(values);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { imported: 1, skipped: 0, duplicates: [] });
  assert.equal(db.prepare('SELECT status FROM it_assets WHERE asset_tag = ?').get('SHEET-001').status, 'AVAILABLE');
  assert.equal(
    db.prepare('SELECT notes FROM it_asset_events WHERE asset_id = (SELECT id FROM it_assets WHERE asset_tag = ?)').get('SHEET-001').notes,
    'Asset registered by Google Sheets import',
  );
});

test('rejects Google Sheets with missing required columns without importing rows', async () => {
  const response = await importValues([
    ['Asset Tag', 'Category'],
    ['SHEET-002', 'Laptop'],
  ]);
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /Missing required columns/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM it_assets').get().count, 1);
});

test('analyzes asset tag and serial number duplicates within the sheet and against registered assets', async () => {
  const response = await analyzeValues([
    ['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Custodian', 'Location', 'Department', 'Purchase Cost', 'Warranty Start', 'Warranty End', 'Purchase Order'],
    ['SHEET-001', 'Laptop', 'Dell', 'Latitude', 'SN-NEW-001', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-002', 'Laptop', 'Dell', 'Latitude', 'SN-001', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-003', 'Laptop', 'Dell', 'Latitude', 'SN-003', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-003', 'Laptop', 'Dell', 'Latitude', 'SN-004', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-005', 'Laptop', 'Dell', 'Latitude', 'SN-003', 'Test User', 'HQ', 'IT', 0, '', '', ''],
  ]);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.total, 5);
  assert.equal(result.duplicateCount, 4);
  assert.equal(result.importable, 1);
  assert.deepEqual(result.duplicates.map(({ rowNumber }) => rowNumber), [2, 3, 5, 6]);
  assert.match(result.duplicates[0].reasons[0], /Asset Tag already exists/);
  assert.match(result.duplicates[1].reasons[0], /Serial Number already exists/);
  assert.match(result.duplicates[2].reasons[0], /duplicates row 4/);
  assert.match(result.duplicates[3].reasons[0], /duplicates row 4/);
});

test('imports non-duplicate Google Sheets rows and skips duplicate rows', async () => {
  const values = [
    ['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial Number', 'Custodian', 'Location', 'Department', 'Purchase Cost', 'Warranty Start', 'Warranty End', 'Purchase Order'],
    ['SHEET-001', 'Laptop', 'Dell', 'Latitude', 'SN-NEW-001', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-002', 'Laptop', 'Dell', 'Latitude', 'SN-001', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-003', 'Laptop', 'Dell', 'Latitude', 'SN-003', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-003', 'Laptop', 'Dell', 'Latitude', 'SN-004', 'Test User', 'HQ', 'IT', 0, '', '', ''],
    ['SHEET-005', 'Laptop', 'Dell', 'Latitude', 'SN-003', 'Test User', 'HQ', 'IT', 0, '', '', ''],
  ];

  const response = await importValues(values);
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 4);
  assert.deepEqual(result.duplicates.map(({ rowNumber }) => rowNumber), [2, 3, 5, 6]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM it_assets').get().count, 2);
  assert.ok(db.prepare('SELECT 1 FROM it_assets WHERE asset_tag = ?').get('SHEET-003'));
  assert.equal(db.prepare('SELECT 1 FROM it_assets WHERE asset_tag = ?').get('SHEET-005'), undefined);
});

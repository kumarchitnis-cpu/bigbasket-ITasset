import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

const dataDir = mkdtempSync(path.join(tmpdir(), 'itam-writeoff-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-secret';

const { ensureSchema, getDb, newId } = await import('../db.js');
const { signToken } = await import('../auth.js');
const { assetWorkflowsRouter } = await import('./asset-workflows.js');

ensureSchema();
const db = getDb();
const user = {
  id: newId(),
  email: 'writeoff-test@example.com',
  full_name: 'Write-off Test',
  role: 'admin',
  department: 'IT',
  active: 1,
};
db.prepare(
  'INSERT INTO users (id, email, full_name, password_hash, role, department, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(user.id, user.email, user.full_name, 'test-hash', user.role, user.department, user.active);

function insertAsset(assetTag) {
  const id = newId();
  db.prepare(
    `INSERT INTO it_assets
      (id, asset_tag, category, manufacturer, model, serial_number, status, custodian, location, department)
     VALUES (?, ?, 'Laptop', 'Test', 'Model', ?, 'AVAILABLE', 'Test User', 'HQ', 'IT')`,
  ).run(id, assetTag, `SERIAL-${id}`);
  return id;
}

const app = express();
app.use(express.json());
app.use('/api/workflows', assetWorkflowsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const endpoint = `http://127.0.0.1:${address.port}/api/workflows/write-offs`;
const employee = {
  employee_name: 'Buyback Employee',
  employee_id: 'EMP-001',
  designation: 'Engineer',
  department: 'IT',
};
db.prepare(
  `INSERT INTO it_employee_asset_assignments
    (id, employee_name, employee_id, designation, department, asset_model, serial_number, doj, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(newId(), employee.employee_name, employee.employee_id, employee.designation, employee.department, 'Model', 'EMP-SERIAL-001', '2020-01-01', user.id);

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function submitWriteOff(assetId, reason, buybackEmployeeId) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signToken(user, '127.0.0.1')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ asset_id: assetId, reason, buyback_employee_id: buybackEmployeeId }),
  });
}

test('requires a valid directory employee for Buyback requests', async () => {
  const response = await submitWriteOff(insertAsset('WRITEOFF-BUYBACK-INVALID'), 'Buyback', 'UNKNOWN');
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /Select an employee from Employee Asset Management/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM it_write_off_requests').get().count, 0);
});

test('stores the selected employee snapshot on a Buyback write-off request', async () => {
  const response = await submitWriteOff(insertAsset('WRITEOFF-BUYBACK-001'), 'Buyback', employee.employee_id);
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.reason, 'Buyback');
  assert.equal(result.buyback_employee_name, employee.employee_name);
  assert.equal(result.buyback_employee_id, employee.employee_id);
  assert.equal(result.buyback_employee_designation, employee.designation);
  assert.equal(result.buyback_employee_department, employee.department);

  const listResponse = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${signToken(user, '127.0.0.1')}` },
  });
  const requests = await listResponse.json();
  const listedRequest = requests.find((request) => request.id === result.id);
  assert.equal(listedRequest.buyback_employee_name, employee.employee_name);
  assert.equal(listedRequest.buyback_employee_id, employee.employee_id);
  assert.equal(listedRequest.buyback_employee_designation, employee.designation);
  assert.equal(listedRequest.buyback_employee_department, employee.department);
});

test('backfills a legacy Buyback snapshot from the uniquely assigned asset employee', () => {
  const assetId = insertAsset('WRITEOFF-BUYBACK-LEGACY');
  const serialNumber = db.prepare('SELECT serial_number FROM it_assets WHERE id = ?').get(assetId).serial_number;
  const legacyEmployee = {
    employee_name: 'Legacy Buyback Employee',
    employee_id: 'EMP-LEGACY-001',
    designation: 'Analyst',
    department: 'IT',
  };
  db.prepare(
    `INSERT INTO it_employee_asset_assignments
      (id, employee_name, employee_id, designation, department, asset_model, serial_number, doj, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId(), legacyEmployee.employee_name, legacyEmployee.employee_id, legacyEmployee.designation, legacyEmployee.department, 'Model', serialNumber, '2021-01-01', user.id);
  const requestId = newId();
  db.prepare(
    `INSERT INTO it_write_off_requests (id, asset_id, requester_id, reason)
     VALUES (?, ?, ?, 'Buyback')`,
  ).run(requestId, assetId, user.id);

  ensureSchema();
  const request = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(requestId);
  assert.equal(request.buyback_employee_name, legacyEmployee.employee_name);
  assert.equal(request.buyback_employee_id, legacyEmployee.employee_id);
  assert.equal(request.buyback_employee_designation, legacyEmployee.designation);
  assert.equal(request.buyback_employee_department, legacyEmployee.department);
});

test('accepts a standard write-off reason without Buyback employee details', async () => {
  const response = await submitWriteOff(insertAsset('WRITEOFF-DAMAGE-001'), 'Damage');
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.reason, 'Damage');
  assert.equal(result.buyback_employee_name, null);
});

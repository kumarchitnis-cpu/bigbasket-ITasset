import { Router } from 'express';
import XlsxPopulate from 'xlsx-populate';
import { audit, auditDelete, getDb, newId, nextVal, nowIso, notify } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const assignmentFields = [
  ['employee_name', 'Employee Name', 120],
  ['employee_id', 'Employee ID', 60],
  ['designation', 'Designation', 120],
  ['department', 'Department', 120],
  ['asset_model', 'Asset Model', 160],
  ['serial_number', 'Serial Number', 100],
  ['doj', 'DoJ', 10],
  ['remarks', 'Remarks', 1000],
];
const assignmentRoles = ['admin', 'it_asset_manager'];
const assignmentSelect = 'id, employee_name, employee_id, designation, department, asset_model, serial_number, doj, remarks, created_by, created_at, updated_at';

function parseAssignment(body, db, existingId = null) {
  const assignment = {};
  for (const [field, label, maxLength] of assignmentFields) {
    const value = typeof body?.[field] === 'string' ? body[field].trim() : '';
    if (['employee_name', 'employee_id', 'serial_number'].includes(field) && !value) {
      return { error: `${label} is required.` };
    }
    if (value.length > maxLength) return { error: `${label} must be ${maxLength} characters or fewer.` };
    assignment[field] = value;
  }
  if (assignment.doj && (!/^\d{4}-\d{2}-\d{2}$/.test(assignment.doj) || Number.isNaN(Date.parse(`${assignment.doj}T00:00:00Z`)) || new Date(`${assignment.doj}T00:00:00Z`).toISOString().slice(0, 10) !== assignment.doj)) {
    return { error: 'Enter a valid date of joining.' };
  }
  const asset = db.prepare('SELECT model, status FROM it_assets WHERE serial_number = ?').get(assignment.serial_number);
  if (!asset) return { error: 'Choose a serial number from the available assets.' };
  const current = existingId
    ? db.prepare('SELECT serial_number FROM it_employee_asset_assignments WHERE id = ?').get(existingId)
    : null;
  if (asset.status !== 'AVAILABLE' && current?.serial_number !== assignment.serial_number) {
    return { error: 'Only available assets can be assigned.' };
  }
  const duplicate = db.prepare('SELECT id FROM it_employee_asset_assignments WHERE serial_number = ? AND id != ?').get(assignment.serial_number, existingId || '');
  assignment.asset_model = asset.model;
  return { assignment, duplicate };
}

router.get('/employee-assignments', (req, res, next) => {
  try {
    const db = getDb();
    const assignments = assignmentRoles.includes(req.user.role)
      ? db.prepare(`SELECT ${assignmentSelect} FROM it_employee_asset_assignments ORDER BY employee_name COLLATE NOCASE, created_at DESC`).all()
      : db.prepare(`SELECT ${assignmentSelect} FROM it_employee_asset_assignments WHERE employee_name = ? COLLATE NOCASE ORDER BY created_at DESC`).all(req.user.full_name);
    res.json(assignments);
  } catch (error) {
    next(error);
  }
});

router.get('/employee-assignments/export', requireRole(...assignmentRoles), async (req, res, next) => {
  try {
    const assignments = getDb()
      .prepare('SELECT employee_name, employee_id, designation, department, asset_model, serial_number, doj, remarks FROM it_employee_asset_assignments ORDER BY employee_name COLLATE NOCASE, created_at DESC')
      .all();
    const headers = assignmentFields.map(([, label]) => label);
    const keys = assignmentFields.map(([field]) => field);
    const workbook = await XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0).name('Employee Assets');
    const lastColumn = String.fromCharCode(64 + headers.length);
    sheet.range(`A1:${lastColumn}1`).value([headers]);
    sheet.range(`A1:${lastColumn}1`).style({ bold: true, fill: '1F5874', fontColor: 'FFFFFF' });
    sheet.autoFilter(sheet.range(`A1:${lastColumn}${Math.max(assignments.length + 1, 1)}`));
    sheet.freezePanes(0, 1);
    headers.forEach((header, index) => {
      sheet.column(String.fromCharCode(65 + index)).width(Math.min(Math.max(header.length + 4, 16), 32));
    });
    for (const column of ['B', 'F']) sheet.column(column).style('numberFormat', '@');
    if (assignments.length) {
      sheet.range(`A2:${lastColumn}${assignments.length + 1}`).value(
        assignments.map((assignment) => keys.map((key) => assignment[key] ?? '')),
      );
    }
    const buffer = await workbook.outputAsync();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employee-asset-assignments.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.post('/employee-assignments', requireRole(...assignmentRoles), (req, res, next) => {
  try {
    const db = getDb();
    const parsed = parseAssignment(req.body, db);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const columns = assignmentFields.map(([field]) => field);
    if (parsed.duplicate) {
      db.prepare(
        `UPDATE it_employee_asset_assignments
         SET ${columns.map((field) => `${field} = ?`).join(', ')}, updated_at = ?
         WHERE id = ?`,
      ).run(...columns.map((field) => parsed.assignment[field]), nowIso(), parsed.duplicate.id);
      audit(req.user.id, 'UPDATE', 'employee_asset_assignment', parsed.duplicate.id, 'SUCCESS', 'Reassigned available asset');
      return res.json(db.prepare(`SELECT ${assignmentSelect} FROM it_employee_asset_assignments WHERE id = ?`).get(parsed.duplicate.id));
    }
    const id = newId();
    db.prepare(
      `INSERT INTO it_employee_asset_assignments (id, ${columns.join(', ')}, created_by)
       VALUES (?, ${columns.map(() => '?').join(', ')}, ?)`,
    ).run(id, ...columns.map((field) => parsed.assignment[field]), req.user.id);
    audit(req.user.id, 'CREATE', 'employee_asset_assignment', id, 'SUCCESS');
    res.status(201).json(db.prepare(`SELECT ${assignmentSelect} FROM it_employee_asset_assignments WHERE id = ?`).get(id));
  } catch (error) {
    next(error);
  }
});

router.put('/employee-assignments/:id', requireRole(...assignmentRoles), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM it_employee_asset_assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Employee asset assignment not found.' });
    const parsed = parseAssignment(req.body, db, existing.id);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.duplicate) return res.status(409).json({ error: 'This serial number is already assigned to another employee.' });
    const columns = assignmentFields.map(([field]) => field);
    db.prepare(
      `UPDATE it_employee_asset_assignments
       SET ${columns.map((field) => `${field} = ?`).join(', ')}, updated_at = ?
       WHERE id = ?`,
    ).run(...columns.map((field) => parsed.assignment[field]), nowIso(), existing.id);
    audit(req.user.id, 'UPDATE', 'employee_asset_assignment', existing.id, 'SUCCESS');
    res.json(db.prepare(`SELECT ${assignmentSelect} FROM it_employee_asset_assignments WHERE id = ?`).get(existing.id));
  } catch (error) {
    next(error);
  }
});

router.delete('/employee-assignments/:id', requireRole(...assignmentRoles), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM it_employee_asset_assignments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Employee asset assignment not found.' });
    db.prepare('DELETE FROM it_employee_asset_assignments WHERE id = ?').run(existing.id);
    auditDelete(req.user.id, 'employee_asset_assignment', existing.id, existing, {
      employee_name: existing.employee_name,
      serial_number: existing.serial_number,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/employee-requests', (req, res, next) => {
  try {
    const db = getDb();
    const rows = ['admin', 'it_asset_manager'].includes(req.user.role)
      ? db.prepare(
          `SELECT r.*, u.full_name AS requester_name, u.department
           FROM it_employee_asset_requests r JOIN users u ON u.id = r.requester_id
           ORDER BY r.created_at DESC`,
        ).all()
      : db.prepare(
          `SELECT r.*, u.full_name AS requester_name, u.department
           FROM it_employee_asset_requests r JOIN users u ON u.id = r.requester_id
           WHERE r.requester_id = ? ORDER BY r.created_at DESC`,
        ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/employee-requests', requireRole('admin', 'it_asset_manager', 'employee'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    const neededBy = typeof body.needed_by === 'string' ? body.needed_by.trim() : '';
    if (!category || !justification || !neededBy) {
      return res.status(400).json({ error: 'Category, justification, and needed-by date are required.' });
    }
    if (!Number.isFinite(Date.parse(neededBy))) return res.status(400).json({ error: 'Enter a valid needed-by date.' });
    const db = getDb();
    const id = newId();
    const requestNumber = `EAR-${String(nextVal('employee_asset_request')).padStart(6, '0')}`;
    db.prepare(
      `INSERT INTO it_employee_asset_requests
       (id, request_number, requester_id, category, justification, needed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, requestNumber, req.user.id, category, justification, neededBy, nowIso(), nowIso());
    for (const manager of db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('admin', 'it_asset_manager')").all()) {
      notify(manager.id, 'EMPLOYEE_ASSET_REQUEST', 'Asset request needs review', `${req.user.full_name} requested a ${category}.`, 'employee_asset_request', id);
    }
    audit(req.user.id, 'CREATE', 'employee_asset_request', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/employee-requests/:id/review', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Employee asset request not found.' });
    if (existing.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This request has already been reviewed.' });
    const decision = req.body?.status;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Review status must be APPROVED or REJECTED.' });
    }
    const note = typeof req.body?.review_note === 'string' ? req.body.review_note.trim() : null;
    const now = nowIso();
    const result = db.prepare(
      `UPDATE it_employee_asset_requests
       SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
    ).run(decision, req.user.id, note, now, now, existing.id);
    if (result.changes !== 1) return res.status(409).json({ error: 'This request has already been reviewed.' });
    notify(existing.requester_id, 'EMPLOYEE_ASSET_REQUEST_REVIEWED', `Asset request ${decision.toLowerCase()}`, `Your request ${existing.request_number} was ${decision.toLowerCase()}.${note ? ` ${note}` : ''}`, 'employee_asset_request', existing.id, `employee-asset-reviewed:${existing.id}`);
    audit(req.user.id, 'REVIEW', 'employee_asset_request', existing.id, 'SUCCESS', note, { status: decision });
    res.json(db.prepare('SELECT * FROM it_employee_asset_requests WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.get('/write-offs', (req, res, next) => {
  try {
    const db = getDb();
    const rows = ['admin', 'it_asset_manager'].includes(req.user.role)
      ? db.prepare(
          `SELECT w.*, a.asset_tag, a.manufacturer, a.model, a.status AS asset_status,
                  u.full_name AS requester_name, reviewer.full_name AS reviewer_name
           FROM it_write_off_requests w
           JOIN it_assets a ON a.id = w.asset_id
           JOIN users u ON u.id = w.requester_id
           LEFT JOIN users reviewer ON reviewer.id = w.reviewer_id
           ORDER BY w.created_at DESC`,
        ).all()
      : db.prepare(
          `SELECT w.*, a.asset_tag, a.manufacturer, a.model, a.status AS asset_status,
                  u.full_name AS requester_name, reviewer.full_name AS reviewer_name
           FROM it_write_off_requests w
           JOIN it_assets a ON a.id = w.asset_id
           JOIN users u ON u.id = w.requester_id
           LEFT JOIN users reviewer ON reviewer.id = w.reviewer_id
           WHERE w.requester_id = ? ORDER BY w.created_at DESC`,
        ).all(req.user.id);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/write-offs', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const assetId = typeof req.body?.asset_id === 'string' ? req.body.asset_id : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!assetId || !reason) return res.status(400).json({ error: 'An asset and write-off reason are required.' });
    const writeOffDate = typeof req.body?.write_off_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.write_off_date)
      ? req.body.write_off_date
      : null;
    const approvedBy = typeof req.body?.approved_by === 'string' && req.body.approved_by.trim()
      ? req.body.approved_by.trim()
      : null;
    const db = getDb();
    const asset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (asset.status === 'RETIRED') return res.status(409).json({ error: 'This asset is already retired.' });
    if (db.prepare("SELECT id FROM it_write_off_requests WHERE asset_id = ? AND status = 'PENDING_APPROVAL'").get(assetId)) {
      return res.status(409).json({ error: 'This asset already has a write-off request awaiting review.' });
    }
    const id = newId();
    try {
      db.prepare(
      `INSERT INTO it_write_off_requests (id, asset_id, requester_id, reason, write_off_date, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, assetId, req.user.id, reason, writeOffDate, approvedBy, nowIso(), nowIso());
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'This asset already has a write-off request awaiting review.' });
      }
      throw e;
    }
    for (const admin of db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin'").all()) {
      notify(admin.id, 'ASSET_WRITE_OFF_REQUEST', 'Write-off approval required', `Asset ${asset.asset_tag}: ${reason}`, 'write_off_request', id);
    }
    audit(req.user.id, 'CREATE', 'write_off_request', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(id));
  } catch (e) {
    next(e);
  }
});

router.put('/write-offs/:id', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Write-off request not found.' });
    const body = req.body ?? {};
    const updates = {};
    if ('reason' in body) {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) return res.status(400).json({ error: 'A write-off reason is required.' });
      updates.reason = reason;
    }
    if ('write_off_date' in body) {
      const value = body.write_off_date;
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return res.status(400).json({ error: 'Enter a valid write-off date.' });
      }
      updates.write_off_date = value || null;
    }
    if ('approved_by' in body) {
      updates.approved_by = typeof body.approved_by === 'string' && body.approved_by.trim() ? body.approved_by.trim() : null;
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE it_write_off_requests SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((key) => updates[key]), nowIso(), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'write_off_request', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/write-offs/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Write-off request not found.' });
    db.prepare('DELETE FROM it_write_off_requests WHERE id = ?').run(existing.id);
    auditDelete(req.user.id, 'write_off_request', existing.id, existing, { reason: existing.reason });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.put('/write-offs/:id/review', requireRole('admin'), (req, res, next) => {
  const db = getDb();
  let transactionStarted = false;
  try {
    const existing = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Write-off request not found.' });
    if (existing.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'This request has already been reviewed.' });
    const decision = req.body?.status;
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Review status must be APPROVED or REJECTED.' });
    }
    const note = typeof req.body?.review_note === 'string' ? req.body.review_note.trim() : null;
    const now = nowIso();
    const asset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.asset_id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (decision === 'APPROVED' && asset.status === 'RETIRED') {
      return res.status(409).json({ error: 'This asset has already been retired.' });
    }
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    const lockedRequest = db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(req.params.id);
    if (!lockedRequest || lockedRequest.status !== 'PENDING_APPROVAL') {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }
    const lockedAsset = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(lockedRequest.asset_id);
    if (!lockedAsset || (decision === 'APPROVED' && lockedAsset.status === 'RETIRED')) {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'The asset can no longer be written off.' });
    }
    const reviewer = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
    const result = db.prepare(
      `UPDATE it_write_off_requests
       SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?, updated_at = ?,
           approved_by = COALESCE(approved_by, ?)
       WHERE id = ? AND status = 'PENDING_APPROVAL'`,
    ).run(decision, req.user.id, note, now, now, reviewer?.full_name ?? null, lockedRequest.id);
    if (result.changes !== 1) {
      db.exec('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }
    if (decision === 'APPROVED') {
      db.prepare("UPDATE it_assets SET status = 'RETIRED', updated_at = ? WHERE id = ?").run(now, lockedAsset.id);
      db.prepare(
        `INSERT INTO it_asset_events
         (id, asset_id, event_type, from_status, to_status, from_custodian, to_custodian, location, notes, actor_id, created_at)
         VALUES (?, ?, 'RETIRED', ?, 'RETIRED', ?, ?, ?, ?, ?, ?)`,
      ).run(newId(), lockedAsset.id, lockedAsset.status, lockedAsset.custodian, lockedAsset.custodian, lockedAsset.location, `Write-off approved: ${lockedRequest.reason}${note ? `. ${note}` : ''}`, req.user.id, now);
      db.prepare(
        `UPDATE it_maintenance_records SET status = 'CANCELLED', completed_at = ?
         WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')`,
      ).run(now, lockedAsset.id);
    }
    notify(lockedRequest.requester_id, `ASSET_WRITE_OFF_${decision}`, `Asset write-off ${decision.toLowerCase()}`, `The write-off request for ${lockedAsset.asset_tag} was ${decision.toLowerCase()}.${note ? ` ${note}` : ''}`, 'write_off_request', lockedRequest.id, `write-off-reviewed:${lockedRequest.id}`);
    audit(req.user.id, 'REVIEW', 'write_off_request', lockedRequest.id, 'SUCCESS', note, { status: decision });
    db.exec('COMMIT');
    transactionStarted = false;
    res.json(db.prepare('SELECT * FROM it_write_off_requests WHERE id = ?').get(lockedRequest.id));
  } catch (e) {
    if (transactionStarted) db.exec('ROLLBACK');
    next(e);
  }
});

export const assetWorkflowsRouter = router;

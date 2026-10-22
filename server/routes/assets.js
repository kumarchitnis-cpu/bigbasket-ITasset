import { Router } from 'express';
import multer from 'multer';
import XlsxPopulate from 'xlsx-populate';
import { audit, auditDelete, getDb, newId, nowIso } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['ASSIGNED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'QUARANTINED', 'RETIRED'];
const CONDITIONS = ['NEW', 'GOOD', 'DAMAGED'];
const WRITABLE = ['asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'status', 'condition', 'custodian', 'location', 'department', 'purchase_cost', 'warranty_start', 'warranty_end', 'purchase_order'];
const WARRANTY_STATUSES = ['ACTIVE', 'EXPIRING', 'EXPIRED', 'UNKNOWN'];
const ASSET_IMPORT_COLUMNS = [
  { key: 'asset_tag', header: 'Asset Tag', required: true },
  { key: 'category', header: 'Category', required: true },
  { key: 'manufacturer', header: 'Manufacturer', required: true },
  { key: 'model', header: 'Model', required: true },
  { key: 'serial_number', header: 'Serial Number', required: true },
  { key: 'custodian', header: 'Custodian', required: true },
  { key: 'location', header: 'Location', required: true },
  { key: 'department', header: 'Department', required: true },
  { key: 'purchase_cost', header: 'Purchase Cost' },
  { key: 'warranty_start', header: 'Warranty Start' },
  { key: 'warranty_end', header: 'Warranty End' },
  { key: 'purchase_order', header: 'Purchase Order' },
];
const assetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_IMPORT_ROWS = 1000;

function parseWarrantyDate(value, label) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${label} must be a valid date.` };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: `${label} must be a valid date.` };
  }
  return { value };
}

function warrantyStatus(warrantyEnd, today = new Date().toISOString().slice(0, 10)) {
  if (!warrantyEnd) return 'UNKNOWN';
  if (warrantyEnd < today) return 'EXPIRED';
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 30);
  return warrantyEnd <= horizon.toISOString().slice(0, 10) ? 'EXPIRING' : 'ACTIVE';
}

async function templateWorkbook() {
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0).name('Assets');
  const lastColumn = String.fromCharCode(64 + ASSET_IMPORT_COLUMNS.length);
  sheet.range(`A1:${lastColumn}1`).value([ASSET_IMPORT_COLUMNS.map(({ header }) => header)]);
  sheet.range(`A1:${lastColumn}1`).style({ bold: true, fill: '1F5874', fontColor: 'FFFFFF' });
  sheet.autoFilter(sheet.range(`A1:${lastColumn}1`));
  ASSET_IMPORT_COLUMNS.forEach(({ header }, index) => {
    const column = String.fromCharCode(65 + index);
    sheet.column(column).width(Math.max(header.length + 4, 18));
  });
  for (const key of ['warranty_start', 'warranty_end']) {
    const index = ASSET_IMPORT_COLUMNS.findIndex((column) => column.key === key);
    sheet.column(String.fromCharCode(65 + index)).style('numberFormat', 'yyyy-mm-dd');
  }
  return workbook;
}

function cellString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') throw new Error('Rich-text cells are not supported.');
  return String(value).trim();
}

function cellDate(value, rowNumber, label, errors) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1) {
      errors.push(`Row ${rowNumber}: ${label} must be a valid date (YYYY-MM-DD).`);
      return null;
    }
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    errors.push(`Row ${rowNumber}: ${label} must be a valid date (YYYY-MM-DD).`);
    return null;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    errors.push(`Row ${rowNumber}: ${label} must be a valid date (YYYY-MM-DD).`);
    return null;
  }
  const normalized = date.toISOString().slice(0, 10);
  if (text && normalized !== text) {
    errors.push(`Row ${rowNumber}: ${label} must be a valid date (YYYY-MM-DD).`);
    return null;
  }
  return normalized;
}

router.get('/template', requireRole('admin', 'it_asset_manager'), async (req, res, next) => {
  try {
    const workbook = await templateWorkbook();
    const buffer = await workbook.outputAsync();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="asset-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

router.post('/import', requireRole('admin', 'it_asset_manager'), assetUpload.single('file'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Select an .xlsx file to upload.' });
  if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) {
    return res.status(400).json({ error: 'Only Excel .xlsx files are supported.' });
  }

  try {
    const workbook = await XlsxPopulate.fromDataAsync(req.file.buffer);
    const sheet = workbook.sheet(0);
    const usedRange = sheet.usedRange();
    if (!usedRange) return res.status(400).json({ error: 'The workbook does not contain an asset worksheet.' });
    const values = usedRange.value();
    if (!values.length) return res.status(400).json({ error: 'The workbook does not contain an asset worksheet.' });
    const headerValues = values[0];
    const headerMap = new Map();
    for (let column = 0; column < headerValues.length; column += 1) {
      const header = cellString(headerValues[column]).toLowerCase();
      if (header) headerMap.set(header, column);
    }
    const missing = ASSET_IMPORT_COLUMNS.filter(({ header, required }) => required && !headerMap.has(header.toLowerCase()));
    if (missing.length) {
      return res.status(400).json({ error: `Missing required columns: ${missing.map(({ header }) => header).join(', ')}.` });
    }
    const unknown = [...headerMap.keys()].filter((header) => !ASSET_IMPORT_COLUMNS.some(({ header: known }) => known.toLowerCase() === header));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown columns: ${unknown.join(', ')}. Download the template and use its column names.` });
    }

    const rows = [];
    const errors = [];
    const seenTags = new Set();
    let assetRowCount = 0;
    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      const rowNumber = rowIndex + 1;
      if (row.every((value) => value === null || value === undefined || value === '')) continue;
      assetRowCount += 1;
      if (assetRowCount > MAX_IMPORT_ROWS) {
        errors.push(`The file exceeds the ${MAX_IMPORT_ROWS}-asset upload limit.`);
        break;
      }

      const data = {};
      for (const { key, header } of ASSET_IMPORT_COLUMNS) {
        const column = headerMap.get(header.toLowerCase());
        const value = column !== undefined ? row[column] : null;
        try {
          if (column !== undefined && sheet.cell(rowNumber, column + 1).formula()) {
            throw new Error('formula cells are not supported.');
          }
          data[key] = key === 'warranty_start' || key === 'warranty_end'
            ? cellDate(value, rowNumber, header, errors)
            : cellString(value);
        } catch (error) {
          errors.push(`Row ${rowNumber}: ${header} ${error.message}`);
        }
      }
      for (const { key, header } of ASSET_IMPORT_COLUMNS.filter((column) => column.required)) {
        if (!data[key]) errors.push(`Row ${rowNumber}: ${header} is required.`);
      }
      const costValue = data.purchase_cost;
      data.purchase_cost = costValue === '' ? 0 : Number(costValue);
      if (!Number.isFinite(data.purchase_cost) || data.purchase_cost < 0) {
        errors.push(`Row ${rowNumber}: Purchase Cost must be a number greater than or equal to zero.`);
      }
      if (data.warranty_start && data.warranty_end && data.warranty_end < data.warranty_start) {
        errors.push(`Row ${rowNumber}: Warranty End must be on or after Warranty Start.`);
      }
      const normalizedTag = data.asset_tag.toLowerCase();
      if (normalizedTag && seenTags.has(normalizedTag)) errors.push(`Row ${rowNumber}: Asset Tag duplicates another row in this file.`);
      if (normalizedTag) seenTags.add(normalizedTag);
      rows.push({ rowNumber, data });
    }
    if (!rows.length && !errors.length) errors.push('The worksheet has no asset rows.');
    if (errors.length) return res.status(400).json({ error: errors.slice(0, 20).join('\n') });

    const db = getDb();
    const existingTags = db.prepare('SELECT lower(asset_tag) AS asset_tag FROM it_assets').all();
    const existingTagSet = new Set(existingTags.map(({ asset_tag }) => asset_tag));
    for (const { rowNumber, data } of rows) {
      if (existingTagSet.has(data.asset_tag.toLowerCase())) {
        errors.push(`Row ${rowNumber}: Asset Tag "${data.asset_tag}" already exists.`);
      }
    }
    if (errors.length) return res.status(409).json({ error: errors.slice(0, 20).join('\n') });

    const now = nowIso();
    const insertAsset = db.prepare(
      `INSERT INTO it_assets (id, asset_tag, category, manufacturer, model, serial_number, status, condition, custodian, location, purchase_cost, warranty_start, warranty_end, purchase_order, department, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO it_asset_events (id, asset_id, event_type, to_status, location, notes, actor_id, created_at)
       VALUES (?, ?, 'REGISTERED', 'AVAILABLE', ?, 'Asset registered by spreadsheet import', ?, ?)`,
    );
    db.exec('BEGIN');
    try {
      for (const { data } of rows) {
        const id = newId();
        insertAsset.run(
          id, data.asset_tag, data.category, data.manufacturer, data.model, data.serial_number,
          data.custodian, data.location, data.purchase_cost, data.warranty_start, data.warranty_end,
          data.purchase_order || null, data.department, now, now,
        );
        insertEvent.run(newId(), id, data.location, req.user.id, now);
        audit(req.user.id, 'CREATE', 'asset', id, 'SUCCESS', 'Imported from asset spreadsheet');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ imported: rows.length });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Corrupted zip') || error.message.includes('End of data reached') || error.message.includes('Invalid ZIP'))) {
      return res.status(400).json({ error: 'Could not read the Excel workbook. Upload a valid .xlsx file.' });
    }
    next(error);
  }
});

router.get('/', (req, res, next) => {
  try {
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;
    const rows = q
      ? getDb().prepare(
          `SELECT * FROM it_assets WHERE lower(asset_tag) LIKE ? OR lower(category) LIKE ? OR lower(model) LIKE ? OR lower(custodian) LIKE ? OR lower(department) LIKE ? ORDER BY created_at DESC`,
        ).all(q, q, q, q, q)
      : getDb().prepare('SELECT * FROM it_assets ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/warranty-report/export', async (req, res, next) => {
  try {
    const manufacturer = typeof req.query.manufacturer === 'string' ? req.query.manufacturer : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !WARRANTY_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Select a valid warranty status.' });
    }
    const rows = getDb().prepare(
      `SELECT asset_tag, manufacturer, model, serial_number, category, custodian, department,
              warranty_start, warranty_end, status
       FROM it_assets
       WHERE status != 'RETIRED'
       ORDER BY warranty_end IS NULL, warranty_end, asset_tag COLLATE NOCASE`,
    ).all()
      .filter((asset) => (!manufacturer || asset.manufacturer === manufacturer)
        && (!status || warrantyStatus(asset.warranty_end) === status))
      .map((asset) => ({ ...asset, warranty_status: warrantyStatus(asset.warranty_end) }));
    const workbook = await XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0).name('Warranty Report');
    const headers = ['Asset Tag', 'Manufacturer', 'Model', 'Serial Number', 'Category', 'Custodian', 'Department', 'Warranty Start', 'Warranty End', 'Asset Status', 'Warranty Status'];
    const keys = ['asset_tag', 'manufacturer', 'model', 'serial_number', 'category', 'custodian', 'department', 'warranty_start', 'warranty_end', 'status', 'warranty_status'];
    const lastColumn = String.fromCharCode(64 + headers.length);
    sheet.range(`A1:${lastColumn}1`).value([headers]);
    sheet.range(`A1:${lastColumn}1`).style({ bold: true, fill: '1F5874', fontColor: 'FFFFFF' });
    sheet.autoFilter(sheet.range(`A1:${lastColumn}${Math.max(rows.length + 1, 1)}`));
    sheet.freezePanes(0, 1);
    headers.forEach((header, index) => {
      sheet.column(String.fromCharCode(65 + index)).width(Math.min(Math.max(header.length + 4, 16), 32));
    });
    if (rows.length) {
      sheet.range(`A2:${lastColumn}${rows.length + 1}`).value(rows.map((asset) => keys.map((key) => asset[key] ?? '')));
    }
    const buffer = await workbook.outputAsync();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="warranty-report.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/events', (req, res, next) => {
  try {
    const db = getDb();
    if (!db.prepare('SELECT id FROM it_assets WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const events = db.prepare(
      `SELECT e.*, u.full_name AS actor_name
       FROM it_asset_events e
       JOIN users u ON u.id = e.actor_id
       WHERE e.asset_id = ?
       ORDER BY e.created_at DESC`,
    ).all(req.params.id);
    res.json(events);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/events', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  const db = getDb();
  let transactionStarted = false;
  try {
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });

    const body = req.body ?? {};
    const eventType = String(body.event_type || '');
    const now = nowIso();
    const updates = { status: existing.status, custodian: existing.custodian, location: existing.location, condition: existing.condition };
    let eventNotes = body.notes ? String(body.notes).trim() : null;
    let maintenance = null;

    const requireText = (value, name) => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) throw Object.assign(new Error(`${name} is required.`), { status: 400 });
      return text;
    };
    const requireCurrentStatus = (...statuses) => {
      if (!statuses.includes(existing.status)) {
        throw Object.assign(new Error(`This action is not available while the asset is ${existing.status.toLowerCase().replace(/_/g, ' ')}.`), { status: 409 });
      }
    };

    switch (eventType) {
      case 'ASSIGNED':
        requireCurrentStatus('AVAILABLE');
        updates.status = 'ASSIGNED';
        updates.custodian = requireText(body.custodian, 'custodian');
        eventNotes ||= 'Asset assigned';
        break;
      case 'RETURNED':
        requireCurrentStatus('ASSIGNED');
        updates.status = 'AVAILABLE';
        updates.custodian = requireText(body.custodian, 'receiving custodian');
        eventNotes ||= 'Asset returned to inventory';
        break;
      case 'TRANSFERRED':
        requireCurrentStatus('ASSIGNED');
        updates.custodian = requireText(body.custodian, 'new custodian');
        if (body.location !== undefined) updates.location = requireText(body.location, 'location');
        eventNotes ||= 'Asset transferred';
        break;
      case 'MAINTENANCE_STARTED': {
        requireCurrentStatus('AVAILABLE', 'ASSIGNED');
        const priority = body.priority === undefined || body.priority === '' ? 'MEDIUM' : body.priority;
        if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) {
          throw Object.assign(new Error('priority must be LOW, MEDIUM, HIGH, or URGENT.'), { status: 400 });
        }
        maintenance = {
          issue: requireText(body.issue, 'issue'),
          provider: typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'In-house',
          priority,
        };
        updates.status = 'UNDER_MAINTENANCE';
        eventNotes = maintenance.issue;
        break;
      }
      case 'MAINTENANCE_COMPLETED':
        requireCurrentStatus('UNDER_MAINTENANCE');
        maintenance = db.prepare(
          `SELECT id FROM it_maintenance_records
           WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')
           ORDER BY created_at DESC LIMIT 1`,
        ).get(existing.id);
        if (!maintenance) {
          throw Object.assign(new Error('No open maintenance record exists for this asset.'), { status: 409 });
        }
        updates.status = 'AVAILABLE';
        eventNotes ||= 'Maintenance completed; asset returned to available inventory';
        break;
      case 'QUARANTINED':
        requireCurrentStatus('AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE');
        updates.status = 'QUARANTINED';
        eventNotes = requireText(eventNotes, 'reason');
        break;
      case 'RETIRED':
        requireCurrentStatus('AVAILABLE', 'ASSIGNED', 'UNDER_MAINTENANCE', 'QUARANTINED');
        updates.status = 'RETIRED';
        eventNotes = requireText(eventNotes, 'reason');
        break;
      case 'AUDITED':
        updates.condition = body.condition === undefined ? existing.condition : body.condition;
        if (!CONDITIONS.includes(updates.condition)) {
          throw Object.assign(new Error(`condition must be one of: ${CONDITIONS.join(', ')}`), { status: 400 });
        }
        eventNotes = requireText(eventNotes, 'audit notes');
        break;
      default:
        return res.status(400).json({ error: 'event_type must be a supported asset lifecycle action.' });
    }

    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    db.prepare(
      `UPDATE it_assets
       SET status = ?, custodian = ?, location = ?, condition = ?,
           last_audited_at = CASE WHEN ? = 'AUDITED' THEN ? ELSE last_audited_at END,
           updated_at = ?
       WHERE id = ?`,
    ).run(updates.status, updates.custodian, updates.location, updates.condition, eventType, now, now, existing.id);

    if (eventType === 'MAINTENANCE_STARTED') {
      db.prepare(
        `INSERT INTO it_maintenance_records
         (id, asset_id, issue, provider, status, priority, created_by, created_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      ).run(newId(), existing.id, maintenance.issue, maintenance.provider, maintenance.priority, req.user.id, now);
    } else if (eventType === 'MAINTENANCE_COMPLETED') {
      db.prepare(
        `UPDATE it_maintenance_records
         SET status = 'COMPLETED', completed_at = ?
         WHERE id = ?`,
      ).run(now, maintenance.id);
    } else if (eventType === 'QUARANTINED' || eventType === 'RETIRED') {
      db.prepare(
        `UPDATE it_maintenance_records
         SET status = 'CANCELLED', completed_at = ?
         WHERE asset_id = ? AND status IN ('OPEN', 'IN_PROGRESS')`,
      ).run(now, existing.id);
    }

    db.prepare(
      `INSERT INTO it_asset_events
       (id, asset_id, event_type, from_status, to_status, from_custodian, to_custodian, location, notes, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(), existing.id, eventType, existing.status, updates.status, existing.custodian,
      updates.custodian, updates.location, eventNotes, req.user.id, now,
    );
    audit(req.user.id, eventType, 'asset', existing.id, 'SUCCESS', eventNotes);
    db.exec('COMMIT');
    transactionStarted = false;
    res.json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.id));
  } catch (e) {
    if (transactionStarted)     db.exec('ROLLBACK');
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'An asset tag was registered during this upload. No assets were imported; please retry.' });
    }
    next(e);
  }
});

router.post('/', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    for (const field of ['asset_tag', 'category', 'manufacturer', 'model', 'serial_number', 'custodian', 'location', 'department']) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${field.replace(/_/g, ' ')} is required.` });
      }
    }
    const warrantyStart = parseWarrantyDate(body.warranty_start, 'Warranty start');
    const warrantyEnd = parseWarrantyDate(body.warranty_end, 'Warranty end');
    if (warrantyStart.error) return res.status(400).json({ error: warrantyStart.error });
    if (warrantyEnd.error) return res.status(400).json({ error: warrantyEnd.error });
    if (warrantyStart.value && warrantyEnd.value && warrantyEnd.value < warrantyStart.value) {
      return res.status(400).json({ error: 'Warranty end must be on or after warranty start.' });
    }
    const db = getDb();
    const id = newId();
    const now = nowIso();
    db.prepare(
      `INSERT INTO it_assets (id, asset_tag, category, manufacturer, model, serial_number, status, condition, custodian, location, purchase_cost, warranty_start, warranty_end, purchase_order, department, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AVAILABLE', 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, body.asset_tag, body.category, body.manufacturer, body.model, body.serial_number,
      body.custodian, body.location, Number(body.purchase_cost) || 0,
      warrantyStart.value ?? null, warrantyEnd.value ?? null, body.purchase_order || null,
      body.department, now, now,
    );
    db.prepare(
      `INSERT INTO it_asset_events (id, asset_id, event_type, to_status, location, notes, actor_id)
       VALUES (?, ?, 'REGISTERED', 'AVAILABLE', ?, 'Asset registered', ?)`,
    ).run(newId(), id, body.location, req.user.id);
    audit(req.user.id, 'CREATE', 'asset', id, 'SUCCESS');
    res.status(201).json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(id));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An asset with this tag already exists. Use a unique asset tag.' });
    }
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'it_asset_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    for (const [field, label] of [['warranty_start', 'Warranty start'], ['warranty_end', 'Warranty end']]) {
      if (field in updates) {
        const parsed = parseWarrantyDate(updates[field], label);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        updates[field] = parsed.value;
      }
    }
    const warrantyStart = updates.warranty_start === undefined ? existing.warranty_start : updates.warranty_start;
    const warrantyEnd = updates.warranty_end === undefined ? existing.warranty_end : updates.warranty_end;
    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      return res.status(400).json({ error: 'Warranty end must be on or after warranty start.' });
    }
    if (updates.status && updates.status !== existing.status) {
      return res.status(400).json({ error: 'Use an asset lifecycle action to change status so the change is recorded.' });
    }
    if (updates.custodian && updates.custodian !== existing.custodian) {
      return res.status(400).json({ error: 'Use an asset lifecycle action to change custodian so the change is recorded.' });
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    if (updates.condition && !CONDITIONS.includes(updates.condition)) {
      return res.status(400).json({ error: `condition must be one of: ${CONDITIONS.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      keys.push('updated_at');
      db.prepare(`UPDATE it_assets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (k === 'updated_at' ? nowIso() : updates[k])), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'asset', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_assets WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_assets WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });
    db.prepare('DELETE FROM it_maintenance_records WHERE asset_id = ?').run(existing.id);
    db.prepare('DELETE FROM it_asset_events WHERE asset_id = ?').run(existing.id);
    db.prepare('DELETE FROM it_assets WHERE id = ?').run(existing.id);
    auditDelete(req.user.id, 'asset', existing.id, existing, { asset_tag: existing.asset_tag });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export const assetsRouter = router;

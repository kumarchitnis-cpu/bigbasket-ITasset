import { Router } from 'express';
import { audit, getDb, newId } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';
import { extractInvoice } from '../openai.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['PENDING', 'UNDER_REVIEW', 'PROCESSED', 'ON_HOLD', 'REJECTED'];
const WRITABLE = ['invoice_number', 'vendor', 'purchase_order', 'total', 'status', 'confidence', 'issue', 'invoice_date', 'currency_code', 'extracted_fields'];

function serializeInvoice(row, user) {
  let extractedFields = {};
  try {
    extractedFields = JSON.parse(row.extracted_fields || '{}');
  } catch {
    extractedFields = {};
  }
  const canReadDocument = row.document_owner === user.id || ['admin', 'finance_officer', 'auditor'].includes(user.role);
  if (!['admin', 'finance_officer'].includes(user.role)) {
    extractedFields = { ...extractedFields, bank_details: null };
  }
  return {
    ...row,
    extracted_fields: extractedFields,
    file_visible: !!row.document_id && canReadDocument,
    file_name: canReadDocument ? row.file_name : null,
    document_owner: undefined,
  };
}

router.get('/', (req, res, next) => {
  try {
    const rows = getDb().prepare(
      `SELECT i.*, d.original_name AS file_name, d.uploaded_by AS document_owner
       FROM it_invoices i
       LEFT JOIN app_documents d ON d.id = i.document_id
       ORDER BY i.created_at DESC`,
    ).all();
    res.json(rows.map((row) => serializeInvoice(row, req.user)));
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('admin', 'finance_officer'), (req, res, next) => {
  try {
    const body = req.body ?? {};
    for (const field of ['invoice_number', 'vendor', 'total']) {
      if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
        return res.status(400).json({ error: `${field.replace(/_/g, ' ')} is required.` });
      }
    }
    const total = Number(body.total);
    if (!Number.isFinite(total) || total < 0) return res.status(400).json({ error: 'Total must be a non-negative amount.' });
    const status = body.status || 'PENDING';
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    const confidence = Math.max(0, Math.min(100, Number(body.confidence) || 0));
    const db = getDb();
    const extractedFields = body.extracted_fields && typeof body.extracted_fields === 'object' && !Array.isArray(body.extracted_fields)
      ? JSON.stringify(body.extracted_fields)
      : '{}';
    if (body.document_id) {
      const document = db.prepare('SELECT id, document_type, uploaded_by FROM app_documents WHERE id = ?').get(body.document_id);
      if (!document || document.document_type !== 'INVOICE') {
        return res.status(400).json({ error: 'The linked invoice document could not be found.' });
      }
      if (document.uploaded_by !== req.user.id && !['admin', 'finance_officer'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You cannot link another user’s invoice document.' });
      }
    }
    const id = newId();
    db.prepare(
      `INSERT INTO it_invoices (id, invoice_number, vendor, purchase_order, total, currency_code, status, confidence, issue, invoice_date, extracted_fields, document_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      id, String(body.invoice_number).trim(), String(body.vendor).trim(), String(body.purchase_order).trim(), total,
      body.currency_code || 'INR', status, confidence, body.issue || null,
      body.invoice_date || new Date().toISOString().slice(0, 10), extractedFields, body.document_id || null,
    );
    audit(req.user.id, 'CREATE', 'invoice', id, 'SUCCESS');
    const created = db.prepare(
      `SELECT i.*, d.original_name AS file_name, d.uploaded_by AS document_owner
       FROM it_invoices i LEFT JOIN app_documents d ON d.id = i.document_id WHERE i.id = ?`,
    ).get(id);
    res.status(201).json(serializeInvoice(created, req.user));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An invoice with this number already exists.' });
    }
    next(e);
  }
});

router.put('/:id', requireRole('admin', 'finance_officer'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found.' });
    const body = req.body ?? {};
    const updates = {};
    for (const field of WRITABLE) {
      if (field in body) updates[field] = body[field];
    }
    if ('total' in updates && (!Number.isFinite(Number(updates.total)) || Number(updates.total) < 0)) {
      return res.status(400).json({ error: 'Total must be a non-negative amount.' });
    }
    if ('confidence' in updates) updates.confidence = Math.max(0, Math.min(100, Number(updates.confidence) || 0));
    if ('extracted_fields' in updates) {
      if (!updates.extracted_fields || typeof updates.extracted_fields !== 'object' || Array.isArray(updates.extracted_fields)) {
        return res.status(400).json({ error: 'extracted_fields must be an object.' });
      }
      updates.extracted_fields = JSON.stringify(updates.extracted_fields);
    }
    if (updates.status && !STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const keys = Object.keys(updates);
    if (updates.status === 'PROCESSED' && existing.status !== 'PROCESSED') {
      keys.push('approved_at');
    }
    if (keys.length > 0) {
      db.prepare(`UPDATE it_invoices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (k === 'approved_at' ? new Date().toISOString() : updates[k])), existing.id);
    }
    audit(req.user.id, 'UPDATE', 'invoice', existing.id, 'SUCCESS');
    res.json(db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(existing.id));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM it_invoices WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found.' });
    db.prepare('DELETE FROM it_invoices WHERE id = ?').run(existing.id);
    audit(req.user.id, 'DELETE', 'invoice', existing.id, 'SUCCESS');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.post('/process', requireRole('admin', 'finance_officer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const fileDataUrl = body.fileDataUrl ?? body.imageDataUrl;
    const { filename, document_id } = body;
    if (typeof fileDataUrl !== 'string' || !/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,/.test(fileDataUrl)) {
      return res.status(400).json({ error: 'Upload a PDF, PNG, JPG, or WebP invoice document.' });
    }
    if (fileDataUrl.length > 15000000) {
      return res.status(413).json({ error: 'The invoice document is too large to review.' });
    }
    const extraction = await extractInvoice(fileDataUrl, filename);
    if (document_id) {
      const doc = getDb().prepare('SELECT * FROM app_documents WHERE id = ?').get(document_id);
      const canEdit = doc && (doc.uploaded_by === req.user.id || ['admin', 'finance_officer'].includes(req.user.role));
      if (canEdit) {
        const confidence = Math.max(0, Math.min(100, Number(extraction.confidence) || 0));
        const reviewReason = extraction.review_reason || null;
        getDb()
          .prepare(
            `UPDATE app_documents SET extraction_status = ?, extracted_fields = ?, confidence = ?, review_reason = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(
            confidence >= 85 && !reviewReason ? 'VALIDATED' : 'NEEDS_REVIEW',
            JSON.stringify(extraction),
            confidence,
            reviewReason,
            document_id,
          );
      }
    }
    res.json({ extraction });
  } catch (e) {
    next(e);
  }
});

export const invoicesRouter = router;

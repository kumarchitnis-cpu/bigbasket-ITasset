import { Router } from 'express';
import { audit, auditDelete, getDb, newId } from '../db.js';
import { requireAuth, requireRole } from '../rbac.js';
import { extractRawText } from '../extractor.js';


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
    auditDelete(req.user.id, 'invoice', existing.id, existing, { invoice_number: existing.invoice_number });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.post('/process', requireRole('admin', 'finance_officer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const fileDataUrl = body.fileDataUrl ?? body.imageDataUrl;
    const { document_id } = body;
    if (typeof fileDataUrl !== 'string' || !/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,/.test(fileDataUrl)) {
      return res.status(400).json({ error: 'Upload a PDF, PNG, JPG, or WebP invoice document.' });
    }
    if (fileDataUrl.length > 15000000) {
      return res.status(413).json({ error: 'The invoice document is too large to review.' });
    }
    const db = getDb();
    if (document_id) {
      const document = db.prepare('SELECT id, document_type, uploaded_by FROM app_documents WHERE id = ?').get(document_id);
      if (!document || document.document_type !== 'INVOICE') {
        return res.status(400).json({ error: 'The linked invoice document could not be found.' });
      }
      if (document.uploaded_by !== req.user.id && !['admin', 'finance_officer'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You cannot process another user’s invoice document.' });
      }
      db.prepare("UPDATE app_documents SET extraction_status = 'EXTRACTING', updated_at = datetime('now') WHERE id = ?").run(document_id);
    }

    const text = await extractRawText(fileDataUrl);
    if (!text?.trim()) {
      const error = new Error('No readable text was found in this invoice. Try a clearer scan.');
      error.status = 422;
      throw error;
    }

    const findText = (patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim().replace(/\s{2,}/g, ' ');
      }
      return null;
    };
    const findAmount = (patterns) => {
      const value = findText(patterns);
      if (!value) return null;
      const amount = Number(value.replace(/[₹$,\s]/g, '').replace(/,/g, ''));
      return Number.isFinite(amount) ? amount : null;
    };
    const extraction = {
      invoice_number: findText([/(?:invoice\s*(?:no|number|#)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i]),
      vendor: null,
      purchase_order: findText([/(?:purchase\s*order|\bP\.?O\.?)\s*(?:no|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i]),
      invoice_date: findText([/(?:invoice\s*date|date)\s*[:#-]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})/i]),
      due_date: findText([/(?:due\s*date)\s*[:#-]?\s*(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})/i]),
      currency: /₹|\bINR\b/i.test(text) ? 'INR' : /\$|\bUSD\b/i.test(text) ? 'USD' : null,
      subtotal: findAmount([/(?:sub\s*total|taxable\s*amount)\s*[:₹$ -]*([\d,]+(?:\.\d{1,2})?)/i]),
      tax: findAmount([/(?:tax|GST|VAT)\s*[:₹$ -]*([\d,]+(?:\.\d{1,2})?)/i]),
      total: findAmount([/(?:grand\s*total|invoice\s*total|total\s*due|total)\s*[:₹$ -]*([\d,]+(?:\.\d{1,2})?)/i]),
      confidence: 0,
      review_reason: 'OCR results need review before saving.',
      line_items: [],
      bank_details: null,
      asset_details: [],
    };
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    extraction.vendor = lines.find((line) => line.length > 2 && line.length < 100 && !/invoice|tax invoice|bill to|ship to/i.test(line)) || null;
    const detected = [extraction.invoice_number, extraction.vendor, extraction.total].filter(Boolean).length;
    extraction.confidence = Math.round((detected / 3) * 70);
    const extractedFields = JSON.stringify(extraction);
    if (document_id) {
      db.prepare("UPDATE app_documents SET extraction_status = 'NEEDS_REVIEW', extracted_fields = ?, confidence = ?, review_reason = ?, updated_at = datetime('now') WHERE id = ?")
        .run(extractedFields, extraction.confidence, extraction.review_reason, document_id);
    }
    audit(req.user.id, 'PROCESS', 'invoice', document_id || newId(), 'SUCCESS');
    res.json({ extraction });
  } catch (e) {
    next(e);
  }
});

export { router as invoicesRouter };

import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../rbac.js';
import { answerAssistant } from '../openai.js';

const router = Router();
router.use(requireAuth);

router.get('/status', (req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: 'gpt-4o-mini' });
});

router.post('/chat', async (req, res, next) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) return res.status(400).json({ error: 'Enter a question for the AI Assistant.' });
    if (question.length > 2000) return res.status(400).json({ error: 'Questions must be 2,000 characters or fewer.' });

    const db = getDb();
    const workspaceSummary = {
      assets: db.prepare(
        `SELECT status, COUNT(*) AS count FROM it_assets GROUP BY status ORDER BY status`,
      ).all(),
      warrantiesExpiringIn90Days: db.prepare(
        `SELECT COUNT(*) AS count FROM it_assets
         WHERE warranty_end >= date('now') AND warranty_end <= date('now', '+90 days')
           AND status != 'RETIRED'`,
      ).get().count,
      invoices: db.prepare(
        `SELECT status, COUNT(*) AS count FROM it_invoices GROUP BY status ORDER BY status`,
      ).all(),
      pendingPurchaseRequests: db.prepare("SELECT COUNT(*) AS count FROM it_purchase_requests WHERE status = 'PENDING_APPROVAL'").get().count,
      pendingEmployeeAssetRequests: db.prepare("SELECT COUNT(*) AS count FROM it_employee_asset_requests WHERE status = 'PENDING_APPROVAL'").get().count,
      pendingWriteOffApprovals: db.prepare("SELECT COUNT(*) AS count FROM it_write_off_requests WHERE status = 'PENDING_APPROVAL'").get().count,
    };
    const answer = await answerAssistant(question, workspaceSummary);
    res.json({ answer });
  } catch (e) {
    next(e);
  }
});

export const assistantRouter = router;

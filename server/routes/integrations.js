import { Router } from 'express';
import { requireAuth, requireRole } from '../rbac.js';
import { getManageEngineStatus, testManageEngineConnection } from '../manageengine.js';
import { getGmailStatus, sendGmailTest } from '../gmail.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/manageengine', (req, res) => {
  res.json(getManageEngineStatus());
});

router.post('/manageengine/test-connection', async (req, res, next) => {
  try {
    res.json(await testManageEngineConnection());
  } catch (error) {
    next(error);
  }
});

router.get('/gmail', (req, res) => {
  res.json(getGmailStatus());
});

router.post('/gmail/test', async (req, res, next) => {
  try {
    res.json(await sendGmailTest());
  } catch (error) {
    next(error);
  }
});

export const integrationsRouter = router;

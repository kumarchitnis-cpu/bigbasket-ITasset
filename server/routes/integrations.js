import { Router } from 'express';
import { requireAuth, requireRole } from '../rbac.js';
import { getManageEngineStatus, testManageEngineConnection } from '../manageengine.js';

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

export const integrationsRouter = router;

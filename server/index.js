import './env.js';
import express from 'express';
import cors from 'cors';
import { ensureSchema } from './db.js';
import { authRouter } from './routes/auth.js';
import { assetsRouter } from './routes/assets.js';
import { invoicesRouter } from './routes/invoices.js';
import { purchaseRequestsRouter } from './routes/purchase-requests.js';
import { miscRouter } from './routes/misc.js';
import { assetWorkflowsRouter } from './routes/asset-workflows.js';
import { assistantRouter } from './routes/assistant.js';
import { usersRouter } from './routes/users.js';
import { settingsRouter } from './routes/settings.js';
import { vendorsRouter } from './routes/vendors.js';
import { integrationsRouter } from './routes/integrations.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '16mb' }));

ensureSchema();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'itam-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/purchase-requests', purchaseRequestsRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/workflows', assetWorkflowsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api', miscRouter);

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The uploaded file exceeds the 10 MB limit.' });
  }
  const status = err && err.status ? err.status : 500;
  const message = status === 500 ? 'Internal server error.' : err.message;
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`ITAM API listening on http://localhost:${PORT}`);
});

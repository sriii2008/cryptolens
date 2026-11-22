import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApiRouter } from './server/routes.ts';
import { createEcdatStore } from './server/store.ts';
import { DataSourceSyncService } from './server/sync-service.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const store = createEcdatStore();
  const syncService = new DataSourceSyncService(store);
  syncService.startBackgroundWorkerIfEnabled();

  const app = express();
  app.disable('x-powered-by');

  app.use('/api', createApiRouter(store, { syncService }));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[ECDAT] listening on http://localhost:${PORT} (mode=${isProduction ? 'production' : 'development'}, storage=${store.mode})`
    );
  });

  const shutdown = () => {
    syncService.stopBackgroundWorker();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[ECDAT] fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

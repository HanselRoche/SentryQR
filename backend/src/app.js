import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { studentRoutes } from './routes/students.routes.js';
import { challengeRoutes } from './routes/challenge.routes.js';
import { verifyRoutes } from './routes/verify.routes.js';
import { overrideRoutes } from './routes/overrides.routes.js';
import { adminRoutes } from './routes/admin.routes.js';

export function createApp() {
  const app = express();

  // Needed for correct req.ip once a reverse proxy terminates TLS (Phase 6).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Payloads are a QR string at most; a low cap keeps oversized bodies from
  // reaching any handler.
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(attachUser);

  app.get('/api/health', (req, res) => res.json({ ok: true, env: config.env, time: Date.now() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/students', studentRoutes);
  app.use('/api/challenge', challengeRoutes);
  app.use('/api/verify', verifyRoutes);
  app.use('/api/overrides', overrideRoutes);
  app.use('/api/admin', adminRoutes);

  app.use('/api', notFoundHandler);

  // In production the built SPA is served from here with a history fallback.
  // In development Vite serves it and proxies /api back to this process.
  if (fs.existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir));
    app.get('*', (req, res) => res.sendFile(path.join(config.staticDir, 'index.html')));
  }

  app.use(errorHandler);

  return app;
}

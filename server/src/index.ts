import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRouter from './routes/auth.js';

// Server configuration
const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:4321',
  'http://localhost:3000',
];

// Initialize Hono app
const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'tricho-auth-service',
  });
});

// API info endpoint
app.get('/api', (c) => {
  return c.json({
    message: 'TrichoApp Auth Service API',
    version: '0.0.1',
    endpoints: {
      health: 'GET /health',
      authConfig: 'GET /api/auth/config',
      authStatus: 'GET /api/auth/status?username=...',
      registerBegin: 'POST /api/auth/register/begin',
      registerFinish: 'POST /api/auth/register/finish',
      authenticateBegin: 'POST /api/auth/authenticate/begin (TODO)',
      authenticateFinish: 'POST /api/auth/authenticate/finish (TODO)',
    },
  });
});

// Mount auth routes
app.route('/api/auth', authRouter);

// Start server
serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.info(`TrichoApp Auth Service running on http://localhost:${info.port}`);
  }
);

export default app;

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

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

// API routes placeholder - will be implemented in subtask-2-2
app.get('/api', (c) => {
  return c.json({
    message: 'TrichoApp Auth Service API',
    version: '0.0.1',
    endpoints: {
      health: 'GET /health',
      registerBegin: 'POST /api/auth/register/begin',
      registerFinish: 'POST /api/auth/register/finish',
      authenticateBegin: 'POST /api/auth/authenticate/begin',
      authenticateFinish: 'POST /api/auth/authenticate/finish',
    },
  });
});

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

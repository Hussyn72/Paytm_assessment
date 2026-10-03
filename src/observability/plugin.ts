import type { FastifyInstance } from 'fastify';
import { pool } from '../db/client.js';
import { httpRequestDurationSeconds, httpRequestsTotal, metricsRegistry } from './metrics.js';

const startedAt = Symbol('requestStartedAt');
declare module 'fastify' { interface FastifyRequest { [startedAt]?: bigint; } }

function routeLabel(request: { routeOptions: { url: string | undefined }; url: string }) {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

export type ReadinessCheck = () => Promise<unknown>;

export function observabilityPlugin(app: FastifyInstance, readinessCheck: ReadinessCheck = () => pool.query('SELECT 1')) {
  app.addHook('onRequest', async (request) => { request[startedAt] = process.hrtime.bigint(); });

  app.addHook('onResponse', async (request, reply) => {
    const start = request[startedAt];
    const durationSeconds = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    const labels = { method: request.method, route: routeLabel(request), status_code: String(reply.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
    request.log.info({
      request_id: request.id, method: request.method, route: labels.route,
      status_code: reply.statusCode, duration_ms: Math.round(durationSeconds * 100000) / 100,
    }, 'request completed');
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await readinessCheck();
      return { status: 'ready', database: 'up' };
    } catch {
      return reply.status(503).send({ status: 'not_ready', database: 'down' });
    }
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });
}

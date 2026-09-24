import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

// Fastify's own schema-validation failure (thrown by validatorCompiler before the route
// handler ever runs) — a plain Error carrying `.validation`, not a ZodError instance.
function isFastifyValidationError(err: unknown): err is Error & { validation: Array<{ instancePath: string; message?: string }> } {
  return typeof err === 'object' && err !== null && Array.isArray((err as { validation?: unknown }).validation);
}

// architecture.md §6.1 — the one error envelope shape every route returns.
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, request, reply) => {
    if (isFastifyValidationError(err)) {
      const first = err.validation[0];
      reply.status(422).send({
        error: {
          code: 'validation_failed',
          message: first?.message ?? 'One or more fields are invalid.',
          field: first?.instancePath.replace(/^\//, '').replace(/\//g, '.') || undefined,
          details: err.validation,
        },
      });
      return;
    }

    if (err instanceof AppError) {
      reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          field: err.field,
          nextAction: err.nextAction,
          details: err.details,
        },
      });
      return;
    }

    if (err instanceof ZodError) {
      reply.status(422).send({
        error: {
          code: 'validation_failed',
          message: 'One or more fields are invalid.',
          details: err.flatten(),
        },
      });
      return;
    }

    // Postgres rejected a value's text form (e.g. `/claims/not-a-uuid` reaching a uuid column).
    // Routes don't schema-check path params, so this is the client's input, not our fault.
    if ((err as { code?: unknown }).code === '22P02') {
      reply.status(422).send({
        error: { code: 'validation_failed', message: 'One or more values are not in the expected format.' },
      });
      return;
    }

    // Fastify's own client errors (malformed JSON, empty JSON body, unsupported content-type,
    // body too large) carry a 4xx statusCode — pass it through instead of reporting a 500.
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : status === 429 ? 'rate_limited' : 'bad_request';
      reply.status(status).send({ error: { code, message: (err as Error).message } });
      return;
    }

    request.log.error({ err }, 'unhandled error');
    reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'route_not_found', message: `No route for ${request.method} ${request.url.split('?')[0]}.` },
    });
  });
}

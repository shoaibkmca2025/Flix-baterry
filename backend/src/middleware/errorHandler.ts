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

    request.log.error({ err }, 'unhandled error');
    reply.status(500).send({
      error: { code: 'internal_error', message: 'Something went wrong on our side.' },
    });
  });
}

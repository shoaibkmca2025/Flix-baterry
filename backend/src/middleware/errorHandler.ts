import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

// architecture.md §6.1 — the one error envelope shape every route returns.
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, request, reply) => {
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

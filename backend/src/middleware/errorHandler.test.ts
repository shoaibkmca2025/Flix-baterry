import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerErrorHandler } from './errorHandler';

const app = Fastify();

beforeAll(async () => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  app.post('/echo', { schema: { body: z.object({ name: z.string() }) } }, async (req) => req.body);
  app.get('/pg-bad-uuid', async () => {
    throw Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: '22P02' });
  });
  app.get('/boom', async () => {
    throw new Error('kaboom');
  });
  await app.ready();
});

afterAll(() => app.close());

describe('registerErrorHandler', () => {
  it('passes malformed JSON through as 400, not 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('passes an unsupported content-type through as 415', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'text/xml' }, payload: '<a/>' });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('unsupported_media_type');
  });

  it('maps a Postgres invalid-text-representation error (22P02) to 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/pg-bad-uuid' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('still reports schema validation failures as 422 with the field', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 1 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'validation_failed', field: 'name' });
  });

  it('returns unknown routes in the standard envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toEqual({ code: 'route_not_found', message: 'No route for GET /nope.' });
  });

  it('keeps genuine failures as an opaque 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal_error');
  });
});

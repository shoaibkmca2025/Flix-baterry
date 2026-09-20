import { buildApp } from './app';

// Neon Functions entry (root neon.ts → functions.api). The same Fastify app as server.ts,
// but instead of listening on a port it answers web-standard Requests: each one is turned
// into a Fastify `inject` call and the reply back into a Response. Built once per isolate.
const ready = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

// Hop-by-hop / framing headers that don't survive the Request → inject translation.
const DROP = new Set(['content-length', 'transfer-encoding', 'connection', 'host']);

export default {
  async fetch(request: Request): Promise<Response> {
    const app = await ready;
    const url = new URL(request.url);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (!DROP.has(key)) headers[key] = value;
    });
    const payload = request.method === 'GET' || request.method === 'HEAD' ? undefined : Buffer.from(await request.arrayBuffer());

    const reply = await app.inject({ method: request.method as never, url: url.pathname + url.search, headers, payload });

    const out = new Headers();
    for (const [key, value] of Object.entries(reply.headers)) {
      if (value == null || DROP.has(key)) continue;
      if (Array.isArray(value)) value.forEach((v) => out.append(key, String(v)));
      else out.set(key, String(value));
    }
    return new Response(reply.statusCode === 204 || reply.statusCode === 304 ? null : reply.rawPayload, { status: reply.statusCode, headers: out });
  },
};

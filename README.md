# Felix Batteries

Three products in one repository, sharing one backend and one set of business rules.

```
backend/   Fastify + Drizzle + Neon Postgres. Deployed as a Neon Function (see neon.ts).
shared/    Used by both apps: domain rules, backend client, local store, UI kit.
dealer/    The dealer app — phones (Expo / Android).
admin/     The head office console — desktop (Expo web).
legacy/    First prototype screens. Not built, kept for reference only.
```

`dealer/` and `admin/` are separate Expo apps with their own `app.json`, dependencies and
builds. They import the common half by package name, e.g. `@felix/shared/api/entries`;
npm workspaces links `shared/` into `node_modules/@felix/shared`, so an edit there reaches
both apps with no copying and no publish step.

## Running it

Install once at the repo root — that covers all three packages:

```bash
npm install
```

| What | Command | Notes |
|---|---|---|
| Backend | `npm run backend` | Needs `backend/.env`; serves `http://localhost:4000/api/v1` |
| Dealer app | `npm run dealer` | Expo; open in Expo Go, or `--android` with a phone on USB |
| Head office console | `npm run admin` | Opens in the browser |
| Tests | `npm test` | Domain rules. Backend has its own: `npm test --prefix backend` |
| Type-check both apps | `npm run typecheck` | |

Each app reads `EXPO_PUBLIC_API_BASE_URL` from its own `.env` (gitignored) to decide which
backend to talk to. Without it, an app in development looks for a backend on the same host,
port 4000 (`shared/api/config.ts`).

## Building for release

```bash
npm run build:admin    # static site in admin/dist — upload to any web host
npm run build:dealer   # Android APK via EAS (dealer/eas.json, profile "preview")
```

## Where things live

- Backend plan and decisions: `backend/architecture.md`, `modules.md`, `rules.md`, `memory.md`, `logs.md`
- Screen ids (d01…d37 dealer, console pages) are the ones used throughout the code comments.

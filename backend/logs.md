# Felix BMS — Backend Work Log

Newest entry first. One entry per working session (or per meaningful milestone). This is the chronological record; durable facts go to `memory.md`, progress ticks go to `phases.md`. Part B at the end defines the **runtime** logging and audit standard the code must follow.

---

## Part A — Implementation log

### Entry template (copy this)

```
### YYYY-MM-DD · <phase> · <who>
**Worked on:** P?-?? <item> …
**Done:** what is finished and verified (tests, staging demo)
**Decisions:** any decision taken (also add to memory.md §9 if durable)
**Blockers / decisions needed:** what stops the next item, with a proposed default
**Next:** the next item id(s)
```

---

### 2026-09-15 · P0 · foundation scaffold (Claude Code)
**Worked on:** P0-04 (backend skeleton, partial), P0-05 (drizzle + first migration, partial), P0-09 (local setup runbook).
**Done:**
- `backend/package.json` + `tsconfig.json`: standalone Node/TypeScript project (Fastify 5, Zod, Drizzle ORM + drizzle-kit, pg, pino). Deliberately **not** yet wired into a pnpm workspace with the Expo app (P0-03/P0-08 — moving `src/domain.ts` into `packages/domain`) to avoid touching the app's already-working, already-demoed setup in the same pass. That move is the next foundation step, done separately with the app's tests as the safety net.
- `backend/src/config/env.ts`: Zod-validated env, fails fast on a missing/invalid var.
- `backend/src/lib/logger.ts` (pino + redaction list per `rules.md §7`/`logs.md Part B.1`), `backend/src/lib/errors.ts` (`AppError`, the only throwable error type per `rules.md §5`).
- `backend/src/app.ts` (`buildApp()`), `backend/src/server.ts`, `backend/src/plugins/errorHandler.ts` (maps `AppError`/`ZodError`/unknown → the `architecture.md §6.1` envelope), `backend/src/modules/health/routes.ts` (`GET /api/v1/health`, `GET /api/v1/ready`).
- `backend/src/db/client.ts` (pg Pool + drizzle + `withTransaction`), `backend/src/db/schema/governance.ts` (`counters`, `settings`, `audit_events` per `architecture.md §8.3`), `backend/src/db/migrate.ts` (migration runner).
- First migration generated (`drizzle-kit generate`) and hand-edited to add the three Postgres extensions (`pgcrypto`, `pg_trgm`, `citext`) and the `forbid_change()` trigger function + trigger on `audit_events`, per `architecture.md §8.4`. **Not yet applied to a real database** — see blocker below.
- `backend/docker-compose.yml` (Postgres 16 + Redis 7 — MinIO dropped from the original plan since evidence storage will be Cloudinary, not self-hosted S3; see `memory.md §9 D-10` follow-up needed), `.env.example`, `runbooks/local-setup.md`.
- Verified locally: `tsc --noEmit` clean, `npm run dev` boots, `GET /health` → 200, `GET /ready` → 503 with `{database:false}` (correct — no DB running yet).
**Decisions:** Evidence/object storage will be Cloudinary (signed direct upload, `type:authenticated` delivery), not the originally planned S3-compatible bucket — updates the still-open D-10 in `memory.md`, partially. SMS/email/hosting provider parts of D-10 remain open. Local dev + first shared-schema handoff to the other developer will be via committed migration files + each person running their own `docker compose up`, not a shared hosted database (matches the "developer only needs to see table structure, not data" requirement).
**Blockers / decisions needed:**
- Neither Docker nor a local Postgres is installed on this machine. Docker Desktop needs WSL2, which also isn't installed — both require admin rights + a restart, so this is a manual step for the developer (exact commands in `runbooks/local-setup.md`). Until then, `npm run db:migrate` is written but unverified against a live database, and `/ready` will keep reporting `database:false`.
- `memory.md §9 D-10` needs updating once Cloudinary is confirmed as final (currently only decided in conversation, not yet written back into `memory.md`).
**Next:** once Docker is confirmed running — `docker compose up -d` + `npm run db:migrate`, verify `/ready` goes green and the `forbid_change()` trigger actually rejects an `UPDATE`/`DELETE` on `audit_events`. Then P0-03/P0-08 (pnpm workspace, move `src/domain.ts` → `packages/domain`), then P1-01/P1-02 schema (masters + identity tables).

---

### 2026-09-16 · Folder restructure + identity schema (Claude Code)
**Worked on:** module folder convention (team preference), P1-02 schema (dealers, users, roles, user_permissions, sessions, otp_challenges, login_attempts) + a minimal `cities` master.
**Done:**
- Restructured `backend/src`: `db/schema` → `models/` (Drizzle table defs, `<group>.model.ts`), `db/{client,migrate,migrations}` → `database/`, `plugins/` → `middleware/`, `lib/` → `utils/`. `modules.md §2` and `architecture.md §4` updated to match.
- Module file convention finalized: `<name>.routes.ts` → `<name>.controller.ts` → `<name>.service.ts` → `<name>.repository.ts` → `<name>.validation.ts`, one folder per module under `modules/`. Documented in `modules.md §2`.
- Confirmed with the team: full permission system (`roles` + `user_permissions`, grantor-bounded), not a simplified role enum — built as originally documented in `architecture.md §7.3`/`§8.3`, not trimmed for V1.
- `src/models/masters.model.ts` (`cities` only — the rest of masters lands with the batteries/entries modules) and `src/models/identity.model.ts` (`dealers`, `users`, `roles`, `user_permissions`, `sessions`, `otp_challenges`, `login_attempts`) — 11 tables total now, migration `0001_identity.sql` generated and hand-verified.
- Fixed a real drizzle-kit limitation: its CLI can't resolve cross-file relative imports written with an explicit `.js` extension (Node's ESM/NodeNext convention) — it uses a plain CJS `require()` internally that only understands extensionless or bundler-style resolution. Switched `tsconfig.json` to `module: ESNext` / `moduleResolution: Bundler` and stripped `.js` from every relative import project-wide. tsx and Vitest are unaffected (both resolve extensionless TS imports natively); this only matters again once a real `tsc` production build is set up (Phase 4), not before.
- Caught and fixed two schema authoring mistakes before they reached a real database: the `users` CHECK constraint (`scope='dealer' = (dealer_id is not null)`) was written with the wrong Drizzle API shape and silently generated nothing — fixed with the real `check()` helper; `user_permissions`'s `uq(user_id, permission)` was built with `index()` instead of `uniqueIndex()`, which would have allowed duplicate grants — fixed. Migration regenerated clean (safe to do — nothing had been applied to a real database yet, so no forward-only concern).
- All 12 domain tests still green, full typecheck clean, server still boots and responds correctly after every change in this session.
**Next:** build the `auth` module itself (OTP request/verify with a console SMS adapter for now, JWT access + rotating refresh sessions, admin email+password+2FA) — the first module with actual business logic, once Docker is available to test against a real database.

---

### 2026-09-16 · V1 scope + first domain logic (Claude Code)
**Worked on:** V1 scope confirmation with the team (battery-replacement-only), `memory.md` update (D-03 flagged open, new "V1 scope" section), first pure domain functions (`deriveCode`, `checkWarranty`).
**Done:**
- Confirmed with the team: V1 is the replacement→claim→credit flow only. Full module list and the exact status flow written into `memory.md §1a`.
- `memory.md` D-03 (warranty anchor) marked **open**: V1 uses a stateless "battery's own manufacture month + 24 months" rule instead of the documented sale-date-anchored, chain-inherited rule. Team has not yet confirmed which is the permanent design — flagged for a decision before any V2 work that needs warranty to survive multiple replacements.
- `backend/src/domain/serials.ts` (`normalise`, `deriveCode`) and `backend/src/domain/warranty.ts` (`expiryFrom`, `checkWarranty`) — pure functions, no DB, ported from `src/domain.ts`'s existing `deriveCode`/`expiryFrom`/`warranty` so the app's demo logic and the backend agree. `checkWarranty` isolates the V1 rule in one function specifically so switching to chain-based inheritance later doesn't ripple into callers.
- 12 Vitest tests, all passing, including the exact `expiryFrom` edge cases already proven for the frontend (10 Jan 2026 +24mo, 29 Feb 2024 +12mo, 31 Jan 2026 +1mo) and the team's own example (`26041212` → mfg `2026-04`, serial `1212`).
- These files live at `backend/src/domain/` for now, not `packages/domain/`, since the pnpm workspace move (P0-03/P0-08) is still deferred — they'll relocate there without changing behaviour once that move happens.
**Blockers / decisions needed:** same as previous entry (Docker/WSL install still pending on the dev machine); D-03 warranty-anchor decision still open.
**Next:** once Docker is confirmed working, apply the P0-05 migration for real; then build the V1 module set in order — `auth` → `dealers`/`users` → `masters` (models + serial rules) → `batteries` → `entries` → `stock` → `claims`/`returns` → `credits`.

---

### 2026-09-14 · P0 · planning (Claude Code with Vaibhav)
**Worked on:** backend plan — `architecture.md`, `modules.md`, `phases.md`, `rules.md`, `memory.md`, `logs.md`.
**Done:**
- Read PRD v3.0 in full (`tmp/prd.txt`) and mapped every section to a backend module, table or job. Acceptance criteria AC-01…AC-12 mapped to named tests (`rules.md §9`, `phases.md` cross-phase table).
- Chose the stack: Node 22 + TypeScript, Fastify 5 + Zod, PostgreSQL 16 + Drizzle, Redis 7 + BullMQ, S3-compatible storage, Argon2id/JWT/OTP auth. Rationale recorded in `architecture.md §3`; the deciding factor is sharing `src/domain.ts` rules between app and server.
- Designed the schema (35 tables, append-only triggers, numbering counters, indexes for the 500k-record search target), the validation pipeline, the approval transaction, the warranty engine, the offline sync protocol, evidence storage, notifications (outbox), exports (text-cell XLSX, provenance), import/migration and the full endpoint catalogue.
- Cut delivery into P0–P5 with item ids and exit gates aligned to PRD §30; baseline estimate 56–71 developer-days for P0–P4.
- Wrote `modules.md`: 24 modules in 4 layers with a dependency diagram and a no-cycle rule, a single-writer table ownership matrix, and for each module its files, endpoints, service functions, events, errors, tests and phase items, plus a screen→module matrix for both apps. Added `credits` as its own module, put the exception queue in `approvals` and analytics in `reports`; added `stock_alerts` and `push_tokens` tables and a few endpoints (`/entries/validate`, `/batteries/lookup`, `/returns/{claimId}/stage`, `/approvals/queue`, `/claims/summary`) to `architecture.md` to match.
**Decisions:** D-01, D-02, D-03, D-04, D-05, D-09 recorded as *assumed* with defaults; D-06, D-07, D-08, D-10 *open* (client input needed). See `memory.md §9`.
**Blockers / decisions needed:**
- Client to confirm D-07 (Sales Return type), D-08 (credit rates), D-10 (providers; start DLT registration now — 2–3 weeks lead time).
- Project is not a git repository; initialise before any backend code (`memory.md §2`).
**Next:** P0-01 (decisions), P0-02 (accounts), P0-03 (workspace + move domain code).

---

### 2026-09-14 · Frontend state at hand-over (context for backend work)
**Done (earlier the same day):**
- Dealer app rebuilt to match the client-approved HTML (`Felix-Dealer-App-Only.html`) screen for screen: sign-in with OTP, registration, home, replacement capture (old battery → new battery → warranty carry-over → photos/GPS/signature → review → sent), decision view, old-battery dispatch with generated challan (downloadable), dispatch history, credit notes, entries list/detail, search, battery detail, profile. Files in `src/dealer/`.
- Head-office console rebuilt in the same design language with every earlier function kept (`src/admin/`). Desktop sidebar + phone tabs. Decisions require a reason; common reasons one tap.
- Shared rules and 8 tests in `src/domain.ts` / `tests/domain.test.ts`; `today()` fixed to use local time.
- Fonts installed: `@expo-google-fonts/barlow`, `barlow-semi-condensed`, `ibm-plex-mono`.
- Verified in headless Chrome only (desktop 1366 px and phone 390 px); no physical-device test yet.
**Known differences to reconcile with the backend:** the admin UI approves the entry and the claim in one action (backend default is two-step, D-05); credit amounts are demo values (D-08); "Sales Return" type (D-07).

---

## Part B — Runtime logging and audit standard (quick reference)

The full design is in `architecture.md §17` and the rules in `rules.md §2, §6, §7`. This is the checklist a developer needs while writing code.

### B.1 Application logs (pino, JSON, stdout)

| Field | Always | Notes |
|---|---|---|
| `time`, `level`, `msg` | yes | levels: `error` (needs a human), `warn` (degraded, retried), `info` (one line per request and per job), `debug` (local only) |
| `requestId` | on requests | from `X-Request-Id` or generated; echoed in the response header |
| `userId`, `scope`, `dealerId`, `role` | when authenticated | ids only — never names, mobiles, emails |
| `route`, `method`, `status`, `durationMs` | on request completion | one line per request, no per-step chatter |
| `jobId`, `queue`, `attempt` | in workers | one line at start and end, plus errors |
| `err` | on errors | serialised with stack; `AppError` logs `code` too |

Redacted (replaced by `[redacted]`): `password`, `otp`, `code` (in auth bodies), `accessToken`, `refreshToken`, `authorization`, `mobile`, `email`, `customer.*`, `gps`, `signature`, `body.items[*].remarks` is kept (operational, no PII). The redaction list is a unit-tested array in `lib/logger.ts`.

Never log request bodies at `info`. At `debug`, bodies pass through the redaction list.

### B.2 Audit events (database, append-only)

Write one audit row, in the same transaction, for every: sign-in/out and auth failure; dealer registration and status change; user/admin create/edit/status/permission change; entry submit/review/approve/reject/void; exception override/reject; correction request/apply/decline; battery create/import; replacement link; chain create/inherit; override request/decision; claim accept/check/decide; challan dispatch/receive; credit note issue/settle/reverse; stock movement; customer create/edit/merge; evidence confirm; export run; saved report create/run; announcement send; template change; setting/policy/master change; import stage/commit; **and every denied attempt** (`outcome = denied`).

Each row: `actor_id, actor_role, actor_scope, actor_dealer_id, action, entity_type, entity_id, entity_ref, before, after, reason, outcome, request_id, ip, device_id, user_agent, at`. `before/after` hold only the mutable business fields; customer mobiles are masked to the last 4 digits; tokens/passwords never appear.

### B.3 Metrics and alerts

Emit: request duration histogram by route; 5xx count; queue depth/failed per queue; sync outcomes by type; export duration; OTP send/verify counts; login failures. Alert thresholds in `architecture.md §17`.

### B.4 Retention

| Data | Retention |
|---|---|
| Application logs | 30 days (host log store) |
| Audit events | forever (partition monthly after ~20 M rows; archive in P5-09) |
| `login_attempts` | 90 days |
| `otp_challenges` | 1 day |
| `idempotency_keys` | 30 days |
| Export files | per `EXPORT_LINK_TTL` (default 24 h), then the object is expired; the `export_jobs` row stays |
| Backups | 30 days nightly; monthly kept 12 months |

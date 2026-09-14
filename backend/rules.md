# Felix BMS — Backend Engineering Rules

Version 1.0 · 14 September 2026

These rules are binding for every commit in `backend/` and `packages/domain/`. They exist so that the guarantees in `architecture.md §1` survive many hands and many sessions. When a rule and a deadline collide, the rule wins; raise it in `logs.md` instead of bending it.

---

## 1. Session protocol (humans and AI assistants)

**At the start of every working session**

1. Read `memory.md` fully (10 minutes; it is the source of truth for decisions, ids, enums, credentials).
2. Read the last five entries of `logs.md`.
3. Open `phases.md`, find the current phase, pick the next unchecked item — do not skip ahead unless the log says why.
4. Skim the section of `architecture.md` that covers the item, and the module's block in `modules.md` (owner tables, dependencies, endpoints).

**During the session**

* One item at a time. An item is done only when its Definition of Done (§12) is met.
* If you discover that the design is wrong or a decision is missing, stop, write it in `logs.md` under "Blockers / decisions needed", propose a default, continue only if the default is safe to change later.

**At the end of every session**

1. Append a `logs.md` entry (template in that file).
2. Tick the completed items in `phases.md`.
3. If any decision, id format, enum, endpoint or credential changed, update `memory.md` in the same commit.
4. Commit with the message format in §11.

---

## 2. The ten things you must never do

1. Never write, accept or import a warranty expiry date from a client, a form, a CSV or a migration script. Expiry is computed by `packages/domain/warranty.ts` or moved by an approved override — nothing else.
2. Never `DELETE` rows from lifecycle tables or bypass the append-only triggers (no `ALTER TABLE … DISABLE TRIGGER`, no superuser DML in production).
3. Never read `dealerId` from a request body or query for a dealer principal. It comes from the token via `ctx.dealerId`.
4. Never store or compare serials/codes as numbers. `TEXT` everywhere; `parseInt` on a serial is a bug.
5. Never call an SMS/email/push provider from a request handler or a service. Write to `outbox`; the worker sends.
6. Never perform a state change outside `withTransaction()`, and never without `audit()` in the same transaction.
7. Never log tokens, OTPs, passwords, mobile numbers, emails, customer names, GPS or signature paths. The pino redaction list is not optional.
8. Never trust client time for business facts. `entryDate` is validated against the server's Kolkata date; `capturedAt` is stored but labelled as client-reported.
9. Never make a breaking change to `/api/v1` (removing a field, changing a type, tightening validation on existing clients). Add, deprecate, then remove in `/api/v2`.
10. Never merge without the mandatory scenario tests (§9) passing on a real Postgres.

---

## 3. Code organisation

* `packages/domain` is pure: no React, no Node APIs, no database, no `Date.now()` without an injected clock (`now: string` parameter). It compiles for both the app (Metro) and the server.
* `backend/src/modules/<name>/` holds `routes.ts` (thin: parse → call service → map response), `service.ts` (use-cases), `repo.ts` (SQL), `schemas.ts` (Zod). Routes never import `db`; repos never import Fastify.
* Cross-module calls go through the other module's `service.ts`, never its `repo.ts`.
* Shared helpers live in `lib/`; if a helper is used by one module only, keep it inside that module.
* File size soft limit 400 lines; split by use-case, not by "utils".

---

## 4. Naming

| Thing | Convention | Example |
|---|---|---|
| DB tables/columns | `snake_case`, plural tables | `entry_items.old_battery_code` |
| Enums (DB and API) | `snake_case` values | `under_review`, `expiring_soon` |
| JSON fields | `camelCase` | `oldBatteryCode` |
| API paths | plural nouns, kebab-case, verbs only for actions on a resource | `POST /entries/{id}/approve` |
| Permissions | `domain.action` | `entries.approve` |
| Audit actions | `entity.verb_past` | `entry.approved`, `dealer.suspended`, `override.rejected` |
| Outbox events | same as audit actions | `claim.approved` |
| Error codes | `snake_case` nouns | `duplicate_serial`, `dealer_suspended` |
| Migrations | `NNNN_short_description.sql` | `0007_warranty_chains.sql` |
| Jobs | `camelCase` queue names | `notificationsDispatch` |
| Env vars | `UPPER_SNAKE` | `EXPORT_LINK_TTL` |

Human references are fixed formats (`memory.md §Identifiers`); never invent a new format without adding it there.

---

## 5. Validation and errors

* Every route declares Zod schemas for `params`, `query`, `body` and `response`. Unknown body keys are rejected (`.strict()`), unknown query keys ignored.
* Business rules are functions in `packages/domain` that return `{ errors, warnings, exceptions }` with `code`, `field` (dot path matching the request body), `message` (plain English, tells the user what to do), `nextAction`.
* Services throw `AppError(code, httpStatus, message, { field, nextAction, details })`; the error handler maps it to the envelope in `architecture.md §6.1`. Never throw strings; never return `{ok:false}` from a service.
* 404 for anything outside the caller's scope. 403 only for "you exist and are not allowed" on your own scope (e.g. read_only attempting a write) — and audit it with `outcome: denied`.
* Messages are written for the person who will read them: dealers get plain words ("This old battery has already been replaced. Use the current battery in the chain."), admins get the same plus the reference.

---

## 6. Transactions, audit, outbox

```ts
await withTransaction(async (tx) => {
  const before = await repo.lockEntry(tx, id);           // SELECT … FOR UPDATE
  // …rules, writes…
  await audit(tx, { actor: ctx, action: 'entry.approved', entity: 'entry', id, ref, before, after, reason, request: ctx.request });
  await outbox(tx, 'entry.approved', 'entry', id, { dealerId, ref });
});
```

* One use-case = one transaction. No nested business transactions; pass `tx` down.
* Lock the rows you will change (`FOR UPDATE`) in a fixed order: entries → entry_items → batteries (by code ascending) → warranty_chains → claims. Fixed order prevents deadlocks.
* `audit()` is the only writer of `audit_events`; it snapshots `before`/`after` as JSON of the mutable fields only (no blobs, no PII beyond what the record already holds; customer mobile is masked to last 4 digits).
* Reason is mandatory for every decision endpoint (`reason.trim().length >= 5`), validated in the schema.
* Denied attempts are audited **outside** the failed transaction (the rbac plugin writes them directly).

---

## 7. Security rules

* Access tokens 15 min, refresh 30 days, rotate on every refresh, revoke family on reuse. Store only hashes of refresh tokens and OTPs.
* Rate limits (Redis) — auth/OTP: 5 per 15 min per target, 20 per hour per IP; search: 60/min per user; exports: 10/hour per user, 2 concurrent; sync batches: 30/hour per device. Return 429 with `Retry-After`.
* Passwords: Argon2id, ≥ 8 chars, not equal to identifiers, breached-list check. Reset invalidates all sessions.
* Account status check on every request via `accountStatus` plugin (cache ≤ 30 s, invalidated on status change).
* All object storage is private; links expire (PUT 10 min, GET 5 min, exports per setting). No object is ever public.
* CORS allow-list from env; helmet defaults; HSTS in production; JSON body limit 1 MB (uploads never go through the API).
* Secrets only from env / secret manager; `.env.example` lists every key with a fake value; CI fails if a new key is used without being listed.
* Dependencies: lockfile committed, `npm audit --audit-level=high` in CI, Dependabot weekly.
* Separate DB roles: `felix_app` (DML only, no DDL, no `DISABLE TRIGGER`), `felix_migrate` (DDL), `felix_readonly` (analytics/backups).

---

## 8. Database rules

* Migrations are forward-only SQL files generated by drizzle-kit and **reviewed by hand**. No destructive migration (`DROP COLUMN`, type narrowing) on tables holding lifecycle data; add a new column and backfill instead.
* Every new table gets `created_at`; mutable tables get `updated_at` (trigger); append-only tables get the `forbid_change` trigger in the same migration.
* Every foreign key gets an index unless the table is tiny master data.
* Every new list/search query ships with `EXPLAIN (ANALYZE, BUFFERS)` output in the PR description at ≥ 100k rows (use the volume factory).
* Money is `integer` rupees; months are `char(7)`; business dates are `date`; timestamps are `timestamptz`.
* Seeds are idempotent (`ON CONFLICT DO NOTHING/UPDATE`) and split into `seed/masters.ts` (all envs) and `seed/demo.ts` (never production).
* Never use `SELECT *` in repos; name columns so schema drift is caught by the type checker.

---

## 9. Testing rules

Test pyramid: domain unit tests (fast, many) → service/integration tests on a real Postgres (Testcontainers) → API tests via `app.inject` → scenario tests mapped to the PRD acceptance criteria.

**Mandatory scenario tests** (a PR that touches the relevant module must keep them green; they are named exactly like this):

| Test | Asserts |
|---|---|
| `AC-01 dealer onboarding` | register → pending → approve with code → OTP login → first entry |
| `AC-02 single replacement` | old + new serial, evidence, months, unique ref returned |
| `AC-03 multi-item entry` | one header, item-level serials, each item searchable |
| `AC-04 chain search` | searching any serial returns the full chain, custodian, warranty position |
| `AC-05 duplicate serial` | blocked online; with `exception_queue` policy lands in the queue; override audited |
| `AC-06 warranty computed` | expiry from policy + anchor; API rejects any client-supplied expiry (400) |
| `AC-07 sync exactly once` | replayed batch → identical result, one entry; conflict surfaced not merged |
| `AC-08 correction audited` | linked entry created; original readable; audit has actor, before/after |
| `AC-09 export matches screen` | same filters → same rows/count; XLSX cell `0047` is text |
| `AC-10 search performance` | 500k batteries: `/search` p95 < 3 s (run nightly, not on every PR) |
| `AC-11 dealer isolation` | dealer B cannot see dealer A via list, detail, search, export, sync, evidence URL, notification |
| `AC-12 import reconciles` | staged counts = committed counts + exceptions; no invented dates |
| `INV-immutable` | `UPDATE`/`DELETE` on append-only tables raises; soft delete works |
| `INV-warranty-never-restarts` | second and third replacement keep the original expiry |
| `INV-permissions` | co_admin cannot open admins; grantor-bounded grants; self-role change refused; denied attempts audited |
| `INV-status-every-request` | suspend dealer → next sync batch 403 |
| `INV-leading-zeros` | code `00450047` survives create → search → export |

* Unit tests do not touch the network or the database. Integration tests never mock SQL.
* Fixtures come from `test/factories.ts`; no hand-written JSON blobs in tests.
* Clock is injectable (`now`) in domain and services; tests never sleep.
* Coverage gate: `packages/domain` 95 % lines; services 80 %.

---

## 10. API rules

* Additive changes only inside a major version; deprecated fields carry `deprecated: true` in OpenAPI and are removed no sooner than 90 days after the app version that stopped using them is mandatory.
* Every list endpoint: cursor pagination, `limit ≤ 200`, deterministic sort with a tiebreaker on `id`.
* Every POST that creates a business record accepts `Idempotency-Key` (or `clientKey` for dealer submissions); replays return the stored response.
* Every decision endpoint requires `reason` and returns the updated record and its new audit event id.
* Responses never include another dealer's identifiers, even in error messages ("already active with a customer" — never "with dealer GLB-021").
* OpenAPI must build without warnings in CI; the app's client types are generated from it (`openapi-typescript`).

---

## 11. Git and delivery

* Branches: `main` (deployable), `develop` (integration), `feat/<phase>-<item>`, `fix/<issue>`.
* Commit message: `type(scope): summary` — types `feat fix chore test docs refactor perf ops`; scope = module. Body explains why. Reference the `phases.md` item id (e.g. `P2-07`).
* PR checklist (template in `.github/PULL_REQUEST_TEMPLATE.md`): tests added/updated · migration reviewed · `EXPLAIN` attached for new queries · audit/outbox present for state changes · no secrets · OpenAPI updated · `memory.md`/`logs.md` updated if applicable.
* CI on every PR: typecheck, lint, unit, integration (Postgres service), OpenAPI build, `npm audit`. Nightly: AC-10 volume test, restore drill.
* Deploy: tag `vX.Y.Z` → build image → migrate (`drizzle-kit migrate`) → rolling restart API → restart worker → smoke (`/ready`, one login, one search). Rollback = previous image; migrations are forward-only, so code must tolerate the newer schema.

---

## 12. Definition of Done (per `phases.md` item)

- [ ] Schema migration merged (if any) with immutability triggers and indexes
- [ ] Domain rule in `packages/domain` with unit tests
- [ ] Service with transaction + audit + outbox
- [ ] Route with Zod schemas, permission, OpenAPI description, example
- [ ] Integration tests, plus the mandatory scenario tests still green
- [ ] Error messages reviewed for plain language and `nextAction`
- [ ] Logged with request id; no PII in logs (checked by the redaction test)
- [ ] `memory.md` updated if an id, enum, endpoint or decision changed; `logs.md` entry written
- [ ] Demonstrated on staging against the Expo app screen it serves (screenshot or short video in the PR)

---

## 13. Style

* TypeScript `strict`, `noUncheckedIndexedAccess`, ESLint (`@typescript-eslint/recommended`, `import/order`), Prettier defaults (2 spaces, single quotes, trailing commas). Formatting is not discussed in reviews.
* Prefer plain functions over classes; prefer explicit parameters over ambient context; prefer early returns.
* Comments explain **why**, not what. A rule quoted from the PRD gets its id in the comment (`// WAR-03`).
* No `any` outside `lib/` adapters; no `@ts-ignore` without a linked issue.
* English identifiers; user-facing strings live in `i18n/en.ts` and `i18n/mr.ts` (Marathi labels are a Phase 5 item, but the structure exists from Phase 1).

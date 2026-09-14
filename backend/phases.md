# Felix BMS — Backend Delivery Phases

Version 1.0 · 14 September 2026

The phases follow the PRD roadmap (§30: P0–P5) but are cut for the **backend** and for one developer implementing by hand, in dependency order. Each item has an id (`P2-07`), a checkbox, what it delivers, and how you know it is done. Tick items here; narrate in `logs.md`. Estimates assume one experienced TypeScript/Postgres developer working full time and are for planning only.

Legend: **DB** migration · **DOM** shared domain code · **API** endpoints · **JOB** worker · **TEST** tests · **APP** change in the Expo app · **OPS** infrastructure.

Current phase: **P0** (see `logs.md` for the latest state).

---

## Phase 0 — Decisions, repo, local environment (3–5 days)

Goal: nothing is built on sand. Every blocking decision has a written answer (or an explicit, safe default), the repository skeleton compiles, and a developer can run the stack with one command.

| Id | Item | Done when |
|---|---|---|
| P0-01 | [ ] Close decisions D-01…D-09 with the client (or record the default from `memory.md §Decisions` as "assumed, reversible until P2") | `memory.md` shows each decision as `closed` or `assumed` with a date and owner |
| P0-02 | [ ] Choose hosting (VPS vs managed), SMS provider (MSG91 + DLT registration started), email provider, object storage (R2/S3), Sentry project | accounts exist; keys in the password manager; `memory.md §Environment` filled |
| P0-03 | [ ] **OPS** pnpm workspace: `packages/domain`, `backend/`; move pure code out of `src/domain.ts` into `packages/domain/src/*.ts`; app imports `@felix/domain`; existing 8 tests move and pass | `pnpm -r test` green; Expo app still builds (`expo export --platform web`) |
| P0-04 | [ ] **OPS** `backend/` skeleton: Fastify app, `config/env.ts`, pino, error handler, `/health`, `/ready`, OpenAPI at `/api/docs`, Dockerfile, docker-compose (postgres, redis, minio, mailpit), `.env.example` | `docker compose up` + `pnpm dev` serves `/ready` = 200 with all checks |
| P0-05 | [ ] **OPS** drizzle configured; migration `0001_init` with extensions (`pgcrypto`, `pg_trgm`, `citext`), `forbid_change()` function, `counters`, `settings`, `audit_events` | `pnpm db:migrate` works from empty; `audit_events` refuses `UPDATE` (test) |
| P0-06 | [ ] **OPS** CI (GitHub Actions): typecheck, lint, unit, integration with Postgres service, OpenAPI build, `npm audit` | PR shows green checks |
| P0-07 | [ ] **TEST** test harness: Testcontainers Postgres, `buildApp()` for `inject`, `factories.ts` for dealers/users/batteries/entries, injectable clock | one sample integration test passes in CI |
| P0-08 | [ ] **DOM** `ids.ts` (formats + regex), `serials.ts` (`normalise`, `deriveCode`, rule check), `warranty.ts` (`expiryFrom`, `status`, `remaining`), `status.ts` (state machines) — extracted, not rewritten | unit tests including the three `expiryFrom` cases and leading-zero cases |
| P0-09 | [ ] Write `backend/runbooks/local-setup.md` | a new developer follows it and runs the stack in < 30 minutes |

**Exit gate:** decisions recorded; `pnpm -r test` green; stack runs locally; first log entry in `logs.md`.

---

## Phase 1 — Foundation: identity, dealers, masters, audit (10–12 days)

Goal: PRD flow **F-01** end to end on the API: a dealer registers, an admin approves with a dealer code, the dealer signs in with OTP, and every action is audited. Corresponds to PRD P1.

### Schema
| Id | Item | Done when |
|---|---|---|
| P1-01 | [ ] **DB** `cities`, `battery_models`, `serial_rules`, `entry_types`, `reason_codes`, `inventory_locations`, `credit_rates` + seeds from the current app (`src/seed.ts` models/cities/entry types; PRD §9.1 stock/warranty effects; fault codes from the dealer app) | `GET /masters` returns what the app needs; seeds idempotent |
| P1-02 | [ ] **DB** `dealers`, `users`, `roles`, `user_permissions`, `sessions`, `otp_challenges`, `login_attempts` + triggers (no delete on dealers/users) | migration reviewed; first Main Admin seeded from env (`SEED_MAIN_ADMIN_EMAIL`) |

### Auth
| Id | Item | Done when |
|---|---|---|
| P1-03 | [ ] **API** OTP request/verify (SMS + email adapters with `console` provider), rate limits, hashing, attempts, resend timer | AC-01 login step passes; 6th attempt → 429; demo code only when `OTP_DEMO_CODE` set and `NODE_ENV≠production` |
| P1-04 | [ ] **API** JWT access + rotating refresh sessions, `/auth/refresh`, `/auth/logout`, `/auth/sessions`, reuse detection | test: reuse of a rotated refresh token revokes the family |
| P1-05 | [ ] **API** admin login with password + email OTP (2FA), password forgot/reset/change, Argon2id, breached-list check | audited sign-ins (`auth.signed_in`, `auth.otp_failed`, `auth.locked`) |
| P1-06 | [ ] plugins `auth`, `accountStatus` (Redis cache 30 s + invalidation), `rbac` (route `permission`), `dealerScope` | INV-status-every-request passes; denied attempts audited with `outcome=denied` |

### Dealers & users
| Id | Item | Done when |
|---|---|---|
| P1-07 | [ ] **API** `POST /dealers/register` (verified mobile challenge, duplicate mobile/email → 409, documents optional) → `pending_approval`, outbox `dealer.registered` | AC-01 register step; duplicate flags in the admin payload |
| P1-08 | [ ] **API** dealer lifecycle: list/detail/edit (locked fields audited), approve (assign code, validate `^[A-Z]{2,4}-\d{3}$`, unique, immutable), reject, suspend, activate — reason required; notifications via outbox | AC-01 approve step; suspended dealer's next request 403 |
| P1-09 | [ ] **API** `GET/PATCH /dealers/me`, `/dealers/me/documents` (uses evidence presign from P2-10 — stub returns 501 until then) | dealer profile screen wired |
| P1-10 | [ ] **API** dealer staff: list/invite/edit/status for `dealer_manager` (own dealer) and admins; permission grants bounded by grantor | INV-permissions partial (dealer part) |
| P1-11 | [ ] **API** admin management (`/admins`, `/roles`), statuses (active, temporarily_blocked, inactive, soft_deleted), reset access, activity | INV-permissions passes; co_admin gets 403 + audit on `/admins` |
| P1-12 | [ ] **API** masters CRUD (retire never delete), `GET /masters` with ETag, `/settings` | model retire hides from dealer list, still resolvable in history |
| P1-13 | [ ] **API** audit log read (`/audit` filters, redaction of protected fields for non-main-admin), `/me` | audit screen wired |
| P1-14 | [ ] **JOB** worker skeleton: BullMQ connection, `notificationsDispatch` (outbox → in-app notifications + SMS/email jobs with `console` adapters), templates table + seed for dealer status events | registering creates an admin in-app notification; approving creates a dealer one |
| P1-15 | [ ] **APP** `src/api/client.ts` (auth, refresh, device id), sign-in/register/pending screens on real endpoints, admin sign-in, `Root` chooses surface from `/me.scope`; demo switcher behind `DEMO_MODE` | F-01 demonstrated on staging with the real app |
| P1-16 | [ ] **OPS** staging environment up (Caddy TLS, compose, Sentry), deploy pipeline, `runbooks/deploy.md` | `https://staging-api…/ready` green; first deploy tagged `v0.1.0` |

**Exit gate (PRD P1):** F-01 demonstrated on staging on real dealer data with the Expo app; INV-permissions, INV-status-every-request green; `memory.md §Environment` complete.

---

## Phase 2 — Core register: entries, batteries, chains, evidence, corrections (15–18 days)

Goal: PRD flows **F-02, F-03, F-06** pass on the API; duplicate serials provably blocked (AC-05); every submission returns a unique reference and lands in the admin queue; approval builds the chain. Corresponds to PRD P2.

### Schema & domain
| Id | Item | Done when |
|---|---|---|
| P2-01 | [ ] **DB** `batteries`, `entries`, `entry_items`, `exceptions`, `corrections`, `replacement_links`, `battery_events`, `idempotency_keys`, `warranty_chains` (structure only; engine in P3), `stock_movements` (structure + triggers) | migrations + immutability tests (`INV-immutable`) |
| P2-02 | [ ] **DOM** `entryRules.ts`: full validation pipeline (`architecture.md §9.3`) returning errors/warnings/exceptions with field paths; modes `submit`, `sync`, `approval` | unit tests for every rule row; parity test against the app's `validateEntry` cases |
| P2-03 | [ ] **DOM** `stock.ts`: states, transitions, `effectOf(entryType)`; `status.ts`: entry state machine with role-based transitions | unit tests |

### Entries
| Id | Item | Done when |
|---|---|---|
| P2-04 | [ ] **API** `POST /entries` (dealer + admin; idempotency via `clientKey`/`Idempotency-Key`; ref numbering; 422 with field paths; exception routing to status `exception`) | AC-02, AC-03 create steps; replay returns same ref |
| P2-05 | [ ] **API** `GET /entries` (filter model §13.1, cursor pagination, dealer scope), `GET /entries/{idOrRef}` (items, evidence, corrections, audit, claim summary) | register + detail screens wired |
| P2-06 | [ ] **API** decisions: `review`, `reject`, `void` with reason; `approve` **without** warranty engine yet (creates batteries, links, movements, events; chain left null with exception flag until P3) | approvals screen wired; AC-08 partial |
| P2-07 | [ ] **API** exceptions queue: list, override (reason, re-validate with override), reject, request correction | AC-05 passes with both policies |
| P2-08 | [ ] **API** corrections: request (dealer/admin), list, apply (linked `-C<n>` entry; original → `corrected`; compensating movements if approved), decline | AC-08 full |
| P2-09 | [ ] **API** admin drafts: `PATCH /entries/{id}` (draft only), `/submit`; `handover`, `cover-told`; acknowledgement PDF | admin "Record an entry" wired |

### Evidence
| Id | Item | Done when |
|---|---|---|
| P2-10 | [ ] **DB/API** `evidence_assets`; presign PUT, confirm (HEAD + size/sha), signed GET, kinds, entry-type evidence rules (warning at submit) | photo upload from the app end to end on staging (MinIO locally) |
| P2-11 | [ ] **JOB** `evidenceScan`: EXIF strip, thumbnail, optional ClamAV, status `scanned` | thumbnails appear in admin detail |
| P2-12 | [ ] **API** signatures as assets (SVG path JSON + PNG render), GPS on entry, `signerRole/signerName` | detail shows signature + location |

### Batteries & search
| Id | Item | Done when |
|---|---|---|
| P2-13 | [ ] **API** `GET /batteries`, `/batteries/{code}` (detail with events, related entries, movements; chain when present), `/batteries/{code}/chain` | AC-04 (chain part) once P3 sets chains; structure now |
| P2-14 | [ ] **API** `GET /search` with `matchedOn`, indexes from `architecture.md §8.5` | AC-04 search part; `EXPLAIN` in PR |
| P2-15 | [ ] **API** customers CRUD, duplicate warning, merge (keeps both), consent flag; dealer scoped | customers screens wired |

### App
| Id | Item | Done when |
|---|---|---|
| P2-16 | [ ] **APP** dealer capture flow (d10–d17) submits online via `POST /entries` with `clientKey`; server 422 field paths mapped to the app's field keys; "My requests", entry detail, search, battery detail read from API | F-02, F-03 demonstrated on a phone against staging |
| P2-17 | [ ] **APP** admin: approvals, entries, corrections, exceptions, record-an-entry, customers, search on API | F-06 demonstrated |

**Exit gate (PRD P2):** F-02, F-03, F-06 pass UAT on staging; AC-02, AC-03, AC-05, AC-08 green; duplicate serial provably blocked in front of the client.

---

## Phase 3 — Warranty, claims & returns, offline sync, notifications, reports (18–22 days)

Goal: PRD flows **F-04, F-05, F-07**; warranty continuity provable; offline capture syncs exactly once; Excel export matches the screen. Corresponds to PRD P3.

### Warranty engine
| Id | Item | Done when |
|---|---|---|
| P3-01 | [ ] **DB/DOM/API** `warranty_policies` (v1 seeded: 24 months, sale_date anchor, overrides off, expiring 30 d), publish new version (`main_admin`), `policyEffective(date)` | INV-warranty-never-restarts; AC-06 |
| P3-02 | [ ] **API** approval completes: `createChain` for warranty-starting types, inherit for replacements, `replacement_count`, repeat flag; chain fields exposed on battery/entry/claim payloads | AC-04 full |
| P3-03 | [ ] **API** overrides: request (dealer/admin), approve/reject (policy checks, max days, `expiry_before_override`, audit before/after), `/warranty/continuity` | F-04 |
| P3-04 | [ ] **JOB** `warrantyExpiring` nightly digest + dealer alerts; `expiring_soon` uses policy threshold | notifications visible in both apps |

### Claims, returns, challans, credits
| Id | Item | Done when |
|---|---|---|
| P3-05 | [ ] **DB/API** `warranty_claims` created at replacement approval; accept / refuse-upfront / check / decide; `credit_rates` lookup; `credit_notes` numbering; `settings.claim_decision_mode` | admin decision screens wired; dealer "Head office decision" screen wired |
| P3-06 | [ ] **DB/API** challans: dealer dispatch (`FBI-RT-` numbering, lines, movements to transit), document PDF as asset, admin receive with scans and shortages, dealer dispatch history | dealer "Send back / Dispatches / Challan" + admin "Old battery returns" wired |
| P3-07 | [ ] **API** returns processing: testing / repaired / scrapped / closed as movements + claim status; `/returns/pending` ageing | flow from dispatch to closed demonstrated |
| P3-08 | [ ] **API** credit notes list/detail/statement PDF (dealer), settle/reverse (admin) | dealer "Credit notes" wired |

### Stock
| Id | Item | Done when |
|---|---|---|
| P3-09 | [ ] **API** positions (derived), ledger list, post movement (transition table, reason codes), thresholds, `lowStock` job + alerts with acknowledgement | admin Stock + dealer stock views wired |

### Offline sync
| Id | Item | Done when |
|---|---|---|
| P3-10 | [ ] **API** `GET /sync/bootstrap` (ETag), `GET /sync/changes?since` | app cold start uses bootstrap; delta on foreground |
| P3-11 | [ ] **API** `POST /sync/batch`: advisory lock per dealer, batch replay, per-op idempotency, outcomes accepted/duplicate/failed/conflict, `observed` conflict detection, dependency failures, `sync_jobs` result | AC-07 |
| P3-12 | [ ] **APP** local queue (SQLite), netinfo trigger, "Send now", per-op states, media retry + attach, conflict display | F-05 demonstrated with airplane mode on a phone |
| P3-13 | [ ] **API/JOB** `/sync/jobs` for admins, `syncReconcile` daily | failed syncs visible on admin settings/system screen |

### Notifications
| Id | Item | Done when |
|---|---|---|
| P3-14 | [ ] **JOB** real providers: MSG91 (DLT templates), email (SES/Resend), Expo push; DLR webhook; retries; `system.job_failed` | SMS received on a real number in staging |
| P3-15 | [ ] **API** inbox endpoints, read state, push token registration, announcements (audience, schedule, resend failed), templates CRUD | notification centre wired for both apps |

### Reports & analytics
| Id | Item | Done when |
|---|---|---|
| P3-16 | [ ] **API** `parseReportFilters`, `/reports/preview`, column catalogue, inline export ≤ 5k rows (XLSX text cells, CSV, PDF), provenance sheet, export history + audit | AC-09; INV-leading-zeros |
| P3-17 | [ ] **JOB** async exports (streaming), signed download links with expiry, `export.ready` notification | 100k-row export completes async |
| P3-18 | [ ] **API/JOB** saved reports + cron schedule + delivery links | scheduled report arrives in the inbox |
| P3-19 | [ ] **API** analytics endpoints with 60 s cache (overview, replacements, dealers, warranty exposure, returns) | admin dashboard wired |

**Exit gate (PRD P3):** F-04, F-05, F-07 pass UAT; AC-06, AC-07, AC-09 green; performance target met at volume (P4-02 may run early).

---

## Phase 4 — Migration, hardening, go-live (10–14 days)

Goal: the historical Excel register is in the system and reconciled; the platform is secure, observable, backed up and fast; acceptance criteria AC-01…AC-12 signed. Corresponds to PRD P4.

| Id | Item | Done when |
|---|---|---|
| P4-01 | [ ] **DB/API/JOB** import pipeline: upload, staging, mapping, validation, decisions UI endpoints, commit in batches, reconciliation XLSX; migration of the live register on staging with the client's file | AC-12 on the real file; reconciliation report signed |
| P4-02 | [ ] **TEST** volume factory (500k batteries, 300k entries, 5 M audit rows); AC-10 nightly; tune indexes; `statement_timeout` | AC-10 green three nights running |
| P4-03 | [ ] **DB** row-level security policies on dealer-owned tables + `SET LOCAL app.dealer_id` in `withTransaction` | AC-11 also passes with the application scope check disabled (RLS alone) |
| P4-04 | [ ] **OPS** production environment, secrets, DB roles (`felix_app`, `felix_migrate`, `felix_readonly`), Caddy TLS + HSTS, CORS allow-list, Sentry releases, uptime monitor, alerts from `architecture.md §17` | alert fires in a drill |
| P4-05 | [ ] **JOB/OPS** backups: nightly dump to object storage, 30-day retention, weekly restore drill job, `runbooks/restore.md` tested | restore drill report in the log |
| P4-06 | [ ] **OPS** `/metrics`, dashboards, log shipping with redaction test, `healthDigest` job | dashboard screenshot in the log |
| P4-07 | [ ] Security review against `architecture.md §18`: dependency audit, rate-limit drill, token reuse drill, presigned URL expiry, RLS, denied-attempt audit; fix findings | checklist signed in `logs.md` |
| P4-08 | [ ] `retention` job (idempotency keys, OTPs, login attempts, export links, customer data per D-06) | job runs nightly without errors |
| P4-09 | [ ] **APP** release builds (Android AAB, iOS TestFlight, web PWA manifest + service worker), device matrix run (Android 9+, iOS 15+), Marathi labels where already present | store builds installable by UAT dealers |
| P4-10 | [ ] Runbooks: deploy, rollback, restore, rotate secrets, suspend abusive account, replay outbox, re-send failed SMS; on-call contact | `backend/runbooks/` complete |
| P4-11 | [ ] UAT: pilot dealer group, parallel run with Excel for one cycle, defect log, AC-01…AC-12 demonstrated and signed | sign-off recorded in `logs.md` |
| P4-12 | [ ] Go-live: production import of the signed reconciliation, first admin accounts, dealer invitations, Excel maintenance stop date agreed | `v1.0.0` tagged; `memory.md` status = live |

**Exit gate (PRD P4):** reconciliation accepted; AC-01…AC-12 signed; production live with backups and alerts proven.

---

## Phase 5 — Expanded modules (each estimated and scheduled on client approval)

Per-module gates, same discipline. Order is a suggestion; the client picks.

| Id | Module | Scope on the backend | Est. |
|---|---|---|---|
| P5-01 | [ ] Dealer inventory depth | dealer stock in/out entries, reconciliation differences, adjustment reason flows, low-stock acknowledgement/escalation, transfers between dealers with approval | 6–8 d |
| P5-02 | [ ] Customer module release | retention/consent enforcement per D-06, customer service history endpoints, consent audit, analyst aggregate-only views | 4–6 d |
| P5-03 | [ ] Advanced analytics | failure-rate with sales denominator, model/batch analysis, city trends, drill-downs, materialised views refreshed nightly | 6–8 d |
| P5-04 | [ ] Notification centre depth | per-event preferences, scheduled announcements, delivery analytics, template versioning UI, WhatsApp channel (if the client approves the provider) | 5–7 d |
| P5-05 | [ ] OCR-assisted capture | `/ocr/labels` endpoint (Google Vision/Textract adapter), confidence scores, `entry_items.ocr` retained, never auto-submits | 4–5 d |
| P5-06 | [ ] Multi-language | `label_mr`/`label_hi` on masters and templates, `Accept-Language`, notification language per user | 3–4 d |
| P5-07 | [ ] Territory mapping | `territories` master, dealer↔area assignment, unassigned-area report | 3–4 d |
| P5-08 | [ ] Admin TOTP 2FA + SSO readiness | TOTP enrolment, recovery codes, optional OIDC | 3–4 d |
| P5-09 | [ ] Audit partitioning & archive | monthly partitions, cold archive to object storage, retrieval endpoint | 3–4 d |
| P5-10 | [ ] Public status page & SLA reports | uptime, sync success rate, export SLA | 2–3 d |

---

## Cross-phase tracking

| Acceptance criterion | Phase | Test name | Status |
|---|---|---|---|
| AC-01 | P1 | `AC-01 dealer onboarding` | [ ] |
| AC-02 | P2 | `AC-02 single replacement` | [ ] |
| AC-03 | P2 | `AC-03 multi-item entry` | [ ] |
| AC-04 | P3 | `AC-04 chain search` | [ ] |
| AC-05 | P2 | `AC-05 duplicate serial` | [ ] |
| AC-06 | P3 | `AC-06 warranty computed` | [ ] |
| AC-07 | P3 | `AC-07 sync exactly once` | [ ] |
| AC-08 | P2 | `AC-08 correction audited` | [ ] |
| AC-09 | P3 | `AC-09 export matches screen` | [ ] |
| AC-10 | P4 | `AC-10 search performance` | [ ] |
| AC-11 | P1→P4 | `AC-11 dealer isolation` | [ ] |
| AC-12 | P4 | `AC-12 import reconciles` | [ ] |

Total baseline estimate (P0–P4): **56–71 working days** for one backend developer, plus app integration items (`APP`) which can run in parallel by the app developer. Expanded modules add per the table above.

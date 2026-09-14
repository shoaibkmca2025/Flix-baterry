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

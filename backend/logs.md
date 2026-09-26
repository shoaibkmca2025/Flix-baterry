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

### 2026-09-26 · client settled the 400 range and the date format; seed became the source of truth (Claude Code)
**Worked on:** applying the client's answers of 25 Sep, and pulling the colleague's entries/stock work.
**Done:**
- **D-12 closed.** The client settled the one row I could not derive: `I 400` is the **18-month** variant and the **24-month 400 is withdrawn**. Catalogue is now 37 products; `H 400` retired.
- **The seed is now the source of truth.** It was insert-only (`onConflictDoNothing`), so correcting `I400` from 24 to 18 months had no effect on the database — the stale row simply stayed. Catalogue rows now upsert (term, plate, model, brand, active) and anything outside the grid is deactivated, so a term the client corrects or a product he withdraws actually takes effect on the next seed. Legacy rows still insert-only.
- **D-14 closed.** `2609` is year 26, month 09 of manufacturing — not a date — and the 26th-of-month serial restart is an internal practice printed nowhere on the battery. Anchoring cover at the 1st of the stamped month is therefore right, as built.
- **D-15 raised.** That answer creates a question the client has not been asked yet: the serial restarts on the 26th while the stamp is the calendar month, so one month's production spans two serial cycles — an `M 1000` made 10 Sep and one made 28 Sep are both stamped `2609` and could both be `0001`. That is two batteries with the same printed identity, and the app would reject the second as a duplicate. Sent to the client with the DIN question.
- Pulled the colleague's `eb93760` (entries validation, stock, shared api). Fast-forward, nothing of ours rewritten; **195 backend tests**, 8 shared, both apps typecheck.
**Blockers / decisions needed:** D-15 (serial overlap across the 26th) and the DIN sizes — his two sheets say Din 44/55 and Din 50/60, the catalogue PDF says Din 44/55/88; seeded as the newest sheet (DIN 50/60/66/75).
**Next:** the admin console's "Record an entry" still uses a single model dropdown (`admin/src/Entries.tsx`) — it should use the same model+plates pair as the dealer app.

---

### 2026-09-25 · the real catalogue, and a battery's identity is its whole label (Claude Code)
**Worked on:** the client sent the warranty grid keyed by the code printed on the label (39 rows) and answered the serial-uniqueness question. Both land here: D-12 closed, D-13 closed, D-14 raised.
**Done:**
- **Decoded the label code.** The letter before the model number is the plate count as its position in the alphabet — G=7, I=9, M=13, O=15, S=19, W=23. Joined the two client sheets on (model, warranty) to test it: **26 of 27 rows match**; the only exception is the 400 at 18 months, which is also the row the first sheet listed twice. Tubular uses series codes (SE, S5, ME, SG, BE, MG, SS), all 30 months; `GP` = the Gold Power red case, always 12 months. All five of the client's sample labels now resolve.
- **Real catalogue seeded** (`seed/masters.ts`): 20 plate/series codes carrying their plate count, 38 products, `battery_models.brand` ('felix' | 'gold_power'). The D-11 placeholder grid and the pre-22-Sep rows are deactivated but still resolvable for the batteries that reference them; the unused placeholder `I700` is deleted because `I 700` is a real product.
- **Battery identity changed (D-13).** The serial restarts on the 26th of each month, per product — so the 8 digits are not unique. `batteries.battery_code` now holds the **full printed label** (`M100026090676`), which keeps one unique column and matches what is physically on the battery. Migration `0010` rewrites every existing battery and entry_item from its own `model_id`, so nothing was re-keyed by hand. Every lookup now needs the product (label prefix, or the dealer's pick); a miss returns `otherProductsWithTheseDigits` so picking the wrong model is caught instead of silently creating a twin.
- **Parser rewritten data-driven** (`domain/serials.splitLabel`): matches against the ids the catalogue holds, longest first, because `K60L` and `IDIN75` cannot be cut by shape. Handles every printed form seen: `M1000…`, `GP M 1000…`, `SS2500…`, `IT2200SG…`, `K 60L…`, `I Din 75…`, and bare digits.
- **Apps**: the dealer's picker is now model-first, then the plates that exist for that model, each showing its own months and marking the Gold Power variant; a label that names a product pre-fills both. Shared `fullCode`/`digitsOf`/`splitLabel` mirror the backend.
- **Tests: 189 backend + 8 shared**, all green. **Verified live on Neon**: all five sample labels priced correctly (M 1000 → 12+2 months, SS 2500 → 30+2); two entries with the **same 4 digits** under M1000 and S1500 both approved and both readable as separate batteries; a lookup of the digits under the wrong product reports both real owners; a discontinued model is refused.
**Decisions:** identity = full label rather than a composite key — one unique column, every existing call site keeps working, and it is what the dealer reads off the battery. `H 400 = 18 months` seeded on the alphabet rule (D-12, one row assumed).
**Blockers / decisions needed:** D-14 (what the YYMM means given the 26th-of-month cutover); the `H 400`/`I 400` row; and the DIN sizes — the two client sheets say Din 44/55 and Din 50/60, the catalogue PDF says Din 44/55/88. Seeded as the newest sheet (DIN 50/60/66/75).
**Next:** the admin console's "Record an entry" still uses a single model dropdown (`admin/src/Entries.tsx`) — it should use the same model+plates pair.

---

### 2026-09-22 · warranty rule rewritten: plate × model term, counted from manufacture + grace (Claude Code)
**Worked on:** the client's insight relayed by the team — warranty depends on the **plates** (letter) and **model number** on the label (`M2200`), each combination has its own term, and 2 months are added because a battery may be sold up to two months after manufacture. Three questions confirmed with the team before building: anchor = manufacture month + grace (supersedes D-03's sale date); term per (plate, model) combination, not plate alone; the label carries the prefix in front of the 8 digits.
**Done:**
- `domain/warranty.ts`: `coverFromMfg(mfgMonth, term, grace)` — start = first day of the manufacture month, expiry = start + (term + grace) months − 1 day; `checkWarranty` returns `startDate/termMonths/graceMonths` so the app can explain the number. `domain/serials.ts`: `deriveCode` accepts `M2200-26041212` / `M2200 26041212` / `M220026041212`, returns `plate/modelNo/modelId`, and the 8 digits stay the battery's identity. `utils/settings.ts`: read-only `graceMonths()` from `settings.warranty.grace_months` (default 2).
- Schema (migration `0008_plate_types`, applied to Neon): `plate_types` table; `battery_models` gains `plate` + `model_no` — **the model id IS the combination** (`M2200`), so every existing `modelId` reference keeps working; legacy rows `M5`… set inactive in SQL. `entry_items.old_model_id`. Seed: 6 plate types, 30 combinations with example months (D-12 open), grace setting.
- `entries.create`: every `modelId`/`oldModelId` must be a known combination (`model_unknown`) and active (`model_inactive`); the old battery's model = dealer's choice → label prefix → like-for-like. `entries.approve` regular_sales: chain anchored on the manufacture month with term + grace. **Replacement of an old battery not on record is now allowed**: `putOldBatteryOnRecord` creates it (`notOnRecord`, sold/customer, creation movement in the stock ledger) with a chain from its manufacture month and the named (plate, model), then the normal rule judges it — the client's legacy stock, previously refused with `old_not_on_record`.
- `batteries.lookup`: `?modelId=` hint decides the term for a not-on-record code (else the label prefix, else default 24); response gains `labelModelId`, `model.plate/modelNo`, `cover.startDate/termMonths/graceMonths`. `GET /masters` gains `plateTypes` and `warrantyGraceMonths`.
- App: `PlateModelPicker` (two dropdowns — plates, then the model numbers that exist for that plate — showing the months) replaces the single model field on d13 and appears on d11 for an old battery not on record; a scanned/typed prefixed label pre-fills both and the 8 digits; d11's card now prints "Plates · model", "Cover rule: 30 + 2 months from manufacture" and the meter from the manufacture month; a label-vs-dropdown mismatch is called out. `buildEntryBody` sends `oldModelId`. `newItem()` no longer defaults to `M5`.
- **Tests: 162 backend** (+ app domain 8). **Verified live on Neon**: masters serve 6 plates / 29 active combos / grace 2 / M5 inactive; lookup of an unseen `M2200-2501xxxx` → cover 2025-01-01 → 2027-08-31 (30 + 2); hint `N2200` → 2027-02-28; entry with `M5` → `model_inactive`; replacement of the unseen battery approved → old battery on record (`notOnRecord`, replaced, chain count 1), new battery inherits 2025-01-01 → 2027-08-31; an unseen `N2200` made Jan 2022 → `warranty_expired` (ended 2024-02-29). `expo export` builds.
**Decisions:** memory.md D-03 superseded by **D-11** (closed); **D-12** open — the seeded letters/numbers/months are examples, the client must supply the real grid and confirm the grace. A lookup with an unknown `modelId` hint falls back to the default term (entry creation refuses it); an old battery on record shows its own model and the picker is hidden.
**Blockers / decisions needed:** D-12 grid from the client. Existing chains on Neon created under the sale-date rule keep their old dates (correct per "chains never restart"; re-anchoring history is a P4-01 migration question).
**Next:** client's grid → replace the seed; then the remaining app items (d37 real credit notes, evidence upload).

---

### 2026-09-20 · app connected to the backend — store hydration bridge + every V1 write action (Claude Code)
**Worked on:** "connect this backend with frontend" — both surfaces now read the server's records after sign-in and the V1 write actions call the API. Sign-in itself was already real (collaborator's 17 Sep commit).
**Done:**
- **Hydration bridge** (`src/api/mapping.ts` pure, `src/api/sync.ts` hooks): rather than rewriting ~3,700 lines of screens that read `useStore().state`, the store is filled FROM the API — on sign-in (`App.tsx`), on every return to the foreground, after every write, and on "Sync now". `fetchHydrated` pulls masters (now with models), dealers (admin), entries (+items, one query), batteries (+chain dates, +replaced code), claims, stock movements, audit (admin, tolerates `audit.read` missing), admins (main admin) in parallel and maps snake_case → the Title-Case labels the screens print. Key mapping rules: a replacement entry's status is driven by its **claim** (`Under Review` between entry approval and claim decision — D-05 two-step made visible), `returnState` from the claim (`raised`→At dealer, `awaiting_return`→In transit, `received`→Received, `checked`→Testing/Repaired/Scrapped by disposition, decided→Closed); a dealer (who cannot read `/audit`) gets head-office decisions synthesised as audits so `decisionOf`/credit screens keep working; `Entry.id` stays the human ref, `apiId` carries the uuid. Verified against the live Neon data (vitest smoke through the real HTTP client with expo/AsyncStorage stubbed): 19 entries, 18 batteries, 4 dealers, 167 audits mapped; `ENT-26-09-0019` → Under Review / claim checked / Repaired; dealer session sees only its own.
- **New API clients**: `claims.ts`, `stock.ts`, `audit.ts`, `users.ts`, `credits.ts`; `entries.ts` (list, approve, reject, admin `dealerId`), `dealers.ts` (list + lifecycle), `batteries.ts` (list), `client.ts` (`apiPatch`, `errorMessage`).
- **Write actions wired** (each: API call → toast → `sync(true)`; local demo data keeps the old in-memory path so the preview still works without a server): admin **approve/reject** (`useDecisions` — Submitted → `entries.approve/reject`; Under Review with claim `received`/`checked` → `claims.check`(hold)+`decide`; earlier claim stages get a plain-words toast saying the battery must arrive first); admin **dealer approve/reject/suspend/activate**; admin **Record an entry** for a real dealer (backend: `entries.create` now accepts `dealerId` from an admin and requires that dealer to be active — 2 new tests); admin **Returns** stages (Received → `claims.receive`; Testing/Repaired/Scrapped → `claims.check` by disposition, or a manual `stock.postMovement` once already checked; Closed → told to decide the claim from Requests to approve); admin **manual stock movement** → `POST /stock/movements`; admin **accounts** (create admin with initial password, change role, block/restore via `users`; dealer profile Staff tab loads `GET /dealers/:id/staff` and invites by mobile); dealer **dispatch** (d33 challan) → `claims.dispatch` per approved claim, unapproved requests stay on the list with a toast; dealer **Sync now** sends any "Pending sync" drafts via `POST /entries` then re-hydrates; dealer **d19 history** shows the server's `GET /entries/:id/audit` trail; admin **Settings → Sync now** re-hydrates.
- **Honest guards** for what V1's backend does not have: corrections (admin + dealer), review/void, warranty overrides, policy publishing, catalogue edits, serial import → toast "Not available in this version" when signed in for real (otherwise the next sync would silently undo them).
- Dealer codes: real dealers use the uuid as `id` and carry `code`; the console and dealer home now print `dealerCode(d)` instead of the uuid.
- Backend additions: `GET /masters` includes `models`; `GET /entries` returns items and takes `dealerId` (admin); `GET /batteries` joins chain dates and `replacedFromCode`; `POST /entries` admin `dealerId`. **155 tests.** App `tsc` clean; `expo export --platform web` builds.
**Decisions:** bridge-over-rewrite — one mapping file instead of touching every screen; screens are unchanged except at their write points. Photos/evidence still local-only (D-10 open). Credit-note amounts on d37 are still derived from the demo map (equal to the server's D-08 demo rates); `/credit-notes` is wired as a client but not yet displayed.
**Blockers / decisions needed:** no browser automation — the mapping was verified in Node against the live data, the screens were not clicked through. Recommend a manual pass: admin approves `ENT-26-09-0017`-style submitted entries, then Stock → Old battery returns → Received → Repaired, then approve again from Requests → credit note toast.
**Next:** show real credit notes on d37 (`/credit-notes` + `/summary`); evidence upload (D-10); P4 hardening.

---

### 2026-09-19 · audit, stock, users — the last three V1 modules, verified live (Claude Code)
**Worked on:** the three modules still missing from the V1 set (memory.md §1a): `audit` read side (P1-13), `stock` ledger (P3-09), `users` + the V1 slice of `admins` (P1-10/P1-11).
**Done:**
- **`audit`** (`modules/audit/`) — `GET /audit` (filters actor/action incl. `prefix.*`/entityType/entityId/outcome/business-date range on Asia/Kolkata boundaries; keyset cursor), `GET /audit/:entityType/:entityId` (one entity's trail), `GET /entries/:id/audit` (dealers see their own entry's history with every head-office actor reduced to "Head office", no request ids). Redaction by viewer: `main_admin` sees all; other admins get mobiles/emails masked recursively inside before/after and lose ip/deviceId; `read_only` additionally loses customer names. Actor names resolved per page (rows keep ids only). Read-only — `utils/audit.ts` stays the sole writer. 12 tests.
- **`stock`** (`modules/stock/`, `models/stock.model.ts`, `domain/stock.ts`) — `stock_movements` append-only ledger (migration `0007`, `forbid_change` trigger, applied to Neon). `domain/stock.ts` carries the §9.6 transition table (exhaustively tested); a same-state custody move is allowed except out of `scrap`. `postMovementInTx` is now **the single writer of battery state**: it validates the transition against the current row, appends the ledger row and applies it via `batteries.repository.applyMovement` (the old `updateBatteryAfterReplacement`/`updateBatteryToReturned` are gone — `updateBatteryReplacedBy` only sets the pointer). Wired in: `entries.approve` (creation movements for new batteries, old → returned/dealer), `claims.dispatch` (→ transit), `claims.receive` (→ company, dealer cleared — the V1 step 4 custody change that was previously **not happening at all**), `claims.check` (disposition repair/scrap → movement; hold → none). Endpoints: `GET /stock/positions?by=state|model|dealer` (derived from `batteries`, never a maintained count), `GET /stock/movements` (dealer sees either side of their moves), `POST /stock/movements` (admin manual post/correction, `scrap_is_terminal`, `movement_not_found` for a correction on another battery). Thresholds/low-stock alerts deferred. 17 tests + 4 domain.
- **`users`** (`modules/users/`, `domain/status.ts`) — `GET/PATCH /me` (user + dealer + sorted effective permissions), dealer staff `GET/POST /dealers/:id/staff`, `PATCH /:userId` (name/role/extra grants), `POST /:userId/status`; admin accounts `GET/POST /admins`, `PATCH /:id`, `POST /:id/status`, `POST /:id/reset-access`, `GET /roles`. Guards: `identifier_taken`, `grant_exceeds_grantor` (extra grants bounded by the grantor's effective set), `cannot_change_own_role`/`cannot_change_own_status`, `escalation_denied` (only a main admin makes a main admin), `role_invalid` (admin-scope role only), `last_main_admin` (cannot demote/deactivate the last active one), `USER_TRANSITIONS` state machine (`soft_deleted` terminal); any non-active status revokes all sessions. Dealer staff are OTP-only (no password, D-09); admins get an initial password (Argon2id) + email 2FA. **`requireAuth` now enforces account status on every request** (`assertAccountActive`: user status + dealer status in one query, 30 s in-process cache, invalidated on every status change here and in `dealers.service`) — INV-status-every-request, which was previously only checked at sign-in. 13 tests.
- Totals: **154 tests passing** (was 111). `tsc` clean. **Verified live over HTTP against Neon** (`buildApp` + inject, real admin + dealer logins): staff invite → grant-beyond-grantor 403 → block → cross-dealer 404 → soft-delete; a full `regular_sales` → `replacement` → dispatch → receive → check(repair) cycle produced the ledger `∅→sold/customer, sold→returned/dealer, returned→returned/transit, returned→returned/company, returned→repair/company`, then a manual `repair→scrap` and a refused `scrap→repair` (409) and dealer manual post (403); audit log listed it all with names, `action=stock.*` prefix filter worked, the dealer's entry trail showed "Head office", and the dealer's refused `/audit` call appeared as `audit.read.denied`.
**Decisions:** `audit` and `users` register at `/api/v1` (they span several path roots). `admins` is not a separate module for V1 — its endpoints live in `users` (`admins.manage`, effectively main_admin via `*`); roles are read-only. The staff-invite SMS and `user.status_changed` notifications wait for the notifications module (no outbox yet).
**Blockers / decisions needed:** none for the backend V1 set — all 12 modules now exist (9 own modules + `warranty`/`returns` folded in). Left on Neon from the live run: two demo entries (`ENT-26-09-0018/19`), one scrapped battery, one soft-deleted staff row — harmless demo data.
**Next:** app wiring — admin console (still demo-store-driven: approvals, claims, stock, audit, admins) and dealer d37 (`/credit-notes`). Then P4 hardening (CORS allow-list, rate limits, RLS).

---

### 2026-09-19 · old-battery screen (d11) shows the full picture after the serial is entered (Claude Code)
**Worked on:** the team's ask — once a dealer types/scans the old battery's 8-digit code, d11 must show everything known about it: manufacture month (from the `YYMM` prefix), model/type/capacity, when it was bought (if on record), when it was itself installed as a replacement, chain depth, current state and cover — before moving on.
**Done:**
- Backend `GET /batteries/lookup` enriched (`batteries.service.lookup`): top-level `mfgMonth`/`serialNo` always present (found responses previously returned `cover.mfgMonth: null` for chained batteries — the mfg month was being dropped exactly when D-03 made it *not* the cover anchor); `battery` gains `mfgMonth`, `notOnRecord`, `alreadyReplaced` (`replacedById` set), `isReplacement` (`replacedFromId` set); `model` gains `family`; new `chain` block `{ purchaseDate (= chain.warrantyStart), warrantyExpiry, termMonths, replacementCount, isOriginal, installedOn }` — `installedOn` comes from the new `batteries.repository.findReplacementLinkByNewBatteryId`, only queried when the battery is itself a replacement. Dealer-scope rules unchanged (`custody: 'other'` still never names the dealer). 4 new lookup tests — **111 passing**.
- App: `src/api/batteries.ts` types updated; `src/dealer/Capture.tsx` d11's three ad-hoc result cards replaced by one `OldBatteryInfo` component covering every case — preview mode (no token: still shows serial + manufacture month, derived locally), checking, not on record (manufacture month + label-estimated cover, "no purchase date will be guessed"), held by another shop, and found (serial, manufactured, model, type/series/term, bought on, cover span, cover left, status, replacements on chain, and "installed on" for a replacement battery). Every card leads with a **"Warranty left"** headline and meter (e.g. "1 year, 3 months left" / "Expired 40 days ago") — counted from the **manufacture month on the label** when nothing else is on record (the team's V1 reality for most old batteries), and from the recorded purchase date once the battery is on a chain (D-03); the card says which anchor it used. Two hard stops surface here now instead of at submit: **already replaced** and **cover ended**. A replacement battery gets a one-line reminder that its cover runs from the first sale, not its own manufacture month. `tsc --noEmit` clean; `expo export --platform web` bundle built and contains the new screen text.
**Blockers / decisions needed:** still no browser automation here — recommend a manual pass on d11 signed in as the seeded dealer with `26060303`-style codes from the 17 Sep verification story (original sale, replacement, returned).
**Next:** the team said "then we will go to next module" — remaining V1 backend gaps are `stock`, `users`, `audit` read; on the app side d37 → `/credit-notes`, and the admin console is still demo-store-driven.

---

### 2026-09-19 · credits module — credit notes readable, settleable, single-owner (Claude Code)
**Worked on:** P3-08 — `credits` (M-18), the last V1 module in the "dealer eventually gets credited" flow. Until now `claims.decide` inserted `credit_notes` rows directly and nothing could read them back — the dealer's "Credit notes" screens (d32 card, d37) had no endpoint.
**Done:**
- `credit_notes` moved to its own `models/credits.model.ts` (owned by `credits`, modules.md §4) with settle/reverse columns (`settledRef/settledAt`, `reversedReason/reversedAt`, `adjustedBy`, `updatedAt`) and two dealer indexes. Migration `0006_credit_notes` applied to Neon; it also grants `credits.read` to `dealer_user`/`dealer_manager` in SQL, because the role seed is `ON CONFLICT DO NOTHING` and would never have updated the live rows (seed updated too for fresh databases).
- `modules/credits/`: `issueInTx(tx, ctx, {claim})` — picks the amount (D-08 demo map moved here from claims), numbers `CN-YY-MM-NNNN`, writes its own `credit_note.issued` audit row; `claims.decide` now calls it inside its transaction instead of `claims.repository.insertCreditNote` (removed). Read side: `GET /credit-notes` (cursor on `issued_at,id`; dealer scope forced, admins may filter `dealerId`/`status`), `GET /credit-notes/summary` (`monthTotal` on the **Asia/Kolkata** month boundary, `totalCredited`, `creditedCount`, `checkingCount`, `refusedCount` — the four d37 KPIs; claim counts via a new read-only `claims.repository.countClaimsByStatus`), `GET /credit-notes/{no|id}` (404 for another dealer's note, I-3). Admin side (`credits.adjust`): `POST /{no}/settle {ref}` and `POST /{no}/reverse {reason}` — only an `issued` note can change; `already_settled` (409) on a settled one, `invalid_transition` on a reversed one. Registered at `/api/v1/credit-notes`.
- 17 new unit tests (`credits.service.test.ts`), claims' decide tests re-pointed at the credits seam — **108 passing** (was 91). `tsc --noEmit` clean.
- **Verified live on Neon** with the real service functions: walked `CLM-26-09-0004` raised→…→approved, `CN-26-09-0002` (₹4,250, M5) issued through credits; dealer list/summary/detail correct; another dealer → `credit_note_not_found`; settle ok, second settle and reverse → `already_settled`; audit trail `credit_note.issued`, `credit_note.settled`. Fastify inject confirms all five routes are mounted and 401 without a token.
**Decisions:** no `POST /credit-notes` — a note only ever exists because a claim was approved. `GET /credit-notes/statement.pdf` deferred until there's a PDF/evidence module (the app prints its own statement for now). `summary` reads `claims.repository` directly — same cross-module read pattern as `entries` → `claims`.
**Blockers / decisions needed:** D-08 (real credit rates) still open — amounts are the demo map.
**Next:** remaining V1 backend gaps are `stock` (movement ledger — P3-09), `users` (staff/permissions — P1-10/11) and the `audit` read endpoint (P1-13). On the app side the admin console is still entirely demo-store-driven (see 2026-09-17 entry); the dealer d37 screen can now be wired to `/credit-notes` + `/credit-notes/summary`.

---

### 2026-09-17 · dealer app wired to the real entries/batteries endpoints (Claude Code)
**Worked on:** wiring `src/dealer/Capture.tsx` (screens d10–d17, the replacement/sales-return capture flow) to the backend built this same day, closing the loop the entries module was built for.
**Done:**
- `src/api/entries.ts` (`createEntry`, `getEntry`) and `src/api/batteries.ts` (`lookupBattery`) — new API client modules matching the existing `src/api/{auth,dealers,masters}.ts` pattern. `src/api/session.ts` gained `useAccessToken()`, a small hook wrapping the existing `getAccessToken()`.
- d11 (old battery) and d13 (new/returned battery) now show live custody/warranty data from `GET /batteries/lookup` instead of the local demo store's `findBattery`/`coverOf` — including the duplicate-code and expired-cover feedback the server will actually enforce at submit time. d31 (carry-over) and d16 (review) show the real chain dates for the battery actually being replaced (memory.md D-03), computed from the same live lookup.
- d16's "Send entry" calls `POST /entries` for a real signed-in dealer session, bridging the server's response (real `ENT-…` ref, status, dates) back into the local demo store so d17 displays the authoritative result under the same id the rest of the flow expects. The original local-only path is kept as a fallback whenever there's no real access token (the "preview approved app" demo path in d05 never calls the backend) or the device is marked offline — unchanged behaviour there, not a regression.
- Verified: frontend `tsc --noEmit` clean, the Metro/web bundle compiles successfully with all new modules included (fetched and inspected directly), backend's 91 tests still green (untouched this pass).
**Known gaps, called out rather than silently dropped:** photo evidence captured in the flow still has nowhere to go server-side — no Cloudinary integration yet (D-10 still open) — so photos stay local-only, same as before. A real dealer's entry submitted while `state.offline` is set still just saves a local "Pending sync" draft; there is no outbox that later replays it against the server (a genuine offline-sync design is a separate piece of work, not attempted here).
**Blockers / decisions needed:** could not click through the actual UI — no browser-automation tool available in this environment. Recommend a manual pass in the browser signed in as the real seeded dealer (mobile `9876543210`, shop FPP-014, already active) submitting a Replacement end to end.
**Next:** admin console (`src/admin/Entries.tsx` etc.) is still entirely demo-store-driven — approving/rejecting a real dealer-submitted entry from the real admin UI isn't wired yet, only the `POST /entries/{id}/approve` API endpoint itself (already live-tested via curl). That is the natural next piece if the client wants to review real submissions from the console rather than curl.

---

### 2026-09-17 · entries module — the real submission-and-approval module, three stand-ins retired (Claude Code)
**Worked on:** P3-06/P3-07 — `entries`, the permanent replacement for the three temporary endpoints (`POST /batteries/sell`, `POST /batteries/replace`, `POST /claims`) that stood in for it since the batteries and claims modules were first built.
**Done:**
- `entries` + `entry_items` tables (`models/entries.model.ts`). `entryType` is a 3-value enum — `replacement`, `sales_return` (the two a dealer actually submits, per D-02), plus `regular_sales` added specifically because *something* has to open a battery's very first warranty chain now that `/batteries/sell` is gone.
- Hit a real migration-ordering mistake mid-build: generated and applied a 2-value version of the `entryType` enum to live Neon before realising `regular_sales` was needed. Had to manually drop the tables/enum types and the migration's tracking row, then regenerate and reapply cleanly — a good reminder to fully settle an enum's value set before it ever touches a shared database.
- `entries.service.ts`: `create()` validates every item's code format and rejects in-entry duplicate codes before opening a transaction (same "errors first" shape as the rest of the codebase), then inserts the entry and all its items in one transaction. `approve()` is now the **single writer** for what used to be three separate write paths — it dispatches each item to `approveReplacementItem` / `approveRegularSaleItem` / `approveSalesReturnItem` based on `entryType`, all inside one transaction:
  - *replacement* — re-runs the full D-03 chain check (old battery on record, right dealer, not already replaced, chain not expired as of the entry date), creates the new battery on the **same chain**, links old→new, and raises a claim directly (`claimsRepo.insertClaim`) — no more separate `POST /claims` call needed.
  - *regular_sales* — creates the battery and a **brand-new** chain anchored to the entry date (this is now the only way a chain gets created).
  - *sales_return* — marks the battery `returned`/`custodian: dealer`. Caught and fixed a real bug here before it shipped: an early version reused `updateBatteryAfterReplacement(tx, id, id)`, which sets `replacedById` — passing a battery's own id as "the battery that replaced it" is nonsense. Added a dedicated `updateBatteryToReturned()` that only touches state/custodian.
- Removed `POST /batteries/sell`, `POST /batteries/replace` (routes/controller/service/validation in the `batteries` module) and `POST /claims` (`createFromReplacement` in the `claims` module, plus the now-unused `claims.repository.findClaimByNewBatteryId`). Cleaned up both modules' test files to match — 91 tests total now (down from more, since the removed endpoints' tests went with them, but +20 new `entries.service.test.ts` tests more than cover the same ground plus the three-way dispatch logic).
- Registered `registerEntryRoutes` in `app.ts` under `/api/v1/entries` (previously built but not wired in).
- **Verified live end to end against Neon**, all three entry types in one continuous story: submitted+approved a `regular_sales` entry for a fresh battery (Jan 15 2026, new chain, expiry Jan 14 2028) → submitted+approved a `replacement` entry against it two months later (new battery landed on the *same* chain id, claim `CLM-26-09-0002` raised referencing both battery ids, `batteries.lookup` on the new battery correctly showed the January dates, not March) → submitted+approved a `sales_return` on that same replacement battery (state → `returned`, `replacedById` correctly left untouched).
**Decisions:** `entries.service.ts` reads/writes `batteries.repository` and `claims.repository` directly rather than through their service layers — the same pragmatic cross-module pattern already used elsewhere (e.g. `dealers.service` reading `masters.repository`), since those modules don't expose service-level functions shaped for this internal orchestration use.
**Next:** wire the actual dealer app UI (`src/dealer/Capture.tsx`, screens d10–d17) to these endpoints — this was the original ask that led to building `entries` in the first place ("build entries now, wire the full UI once"). After that: `reports`/`dashboards` modules, or whichever the client prioritises next.

---

### 2026-09-17 · claims module — the full decision-and-credit workflow (Claude Code)
**Worked on:** P3-05 (trimmed) — `claims`, completing the flow the team described at the very start of V1 scoping: old battery goes back → engineer checks it → someone decides → dealer gets credited.
**Done:**
- `warranty_claims` + `credit_notes` tables (trimmed for V1: no `entry_id`/`entry_item_id` — a claim is raised directly off a replacement instead of through an approval transaction, since `entries` doesn't exist yet; no `credit_rates` table — amounts come from a hardcoded demo map matching `memory.md` D-08, still open).
- `utils/ids.ts` — `nextRef`/`nextFormattedRef`, the atomic reference-number generator (`CLM-26-09-0001`, `CN-26-09-0001`) architecture.md always specified, built now since claims is the first module that actually numbers things.
- Scoping call: folded the physical-transport-tracking step (architecture's separate `returns`/challan module — vehicle number, driver, multi-battery dispatch) into the claim's own status instead of building a full challan system for V1. `raised → awaiting_return → received → checked → approved/refused`, all on the claim itself. A real multi-item challan module is still the documented design if that level of tracking is ever needed.
- `POST /claims/{id}/check` implements the exact rule the client described: the engineer can refuse a claim themselves right there if the fault disqualifies it (no second person needed), or move it to `checked` to wait for one. `POST /claims/{id}/decide` is that second person's call — approving issues a credit note automatically, refusing doesn't touch credits at all.
- `POST /claims` is another explicit, documented stand-in (matching the pattern from `/batteries/sell`/`/replace`) for what `entries`/`approvals` will eventually create automatically.
- 12 new tests (81 total), including the two-path check behavior (disqualify-now vs. defer-to-second-person) and confirming a refusal never touches `insertCreditNote`.
- **Verified live end to end against Neon**, continuing the exact chain from the previous session's example: raised a claim on battery C's replacement → dispatched → received → checked (passed) → approved → a real credit note (`CN-26-09-0001`, ₹4250 — the seeded M5 rate) came back in the response. Then confirmed both guard rails live: a dealer trying to `check` a claim gets `permission_denied`; dispatching an already-approved claim gets `invalid_transition`.
**Next:** `entries` — the real replacement-submission module. At this point `/batteries/sell`, `/batteries/replace`, and `/claims` (create) are the three temporary stand-ins `entries`/`approvals` will eventually absorb into one proper multi-item, evidence-backed submission with a formal approval step; the data model underneath (chains, links, claims) doesn't change when that happens.

---

### 2026-09-17 · warranty-chain inheritance — D-03 closed, built, verified live (Claude Code)
**Worked on:** P3-01/P3-02 (pulled forward) — the client confirmed the real warranty rule, superseding the V1 stateless placeholder from the day before.
**Decision closed:** memory.md D-03 — a replacement battery keeps the *original* battery's warranty date, traced back through however many replacements happened, never its own manufacture date. In the client's own words: check the OLD battery's warranty, not the replacement's.
**Done:**
- `warranty_chains` (warrantyStart/warrantyExpiry fixed at the chain's creation, termMonths, replacementCount) and `replacement_links` (append-only — old→new battery id pairs, the "table named replaced battery" the client asked for) — both live in `models/warranty.model.ts` together, specifically to avoid a circular import with `batteries.model.ts` (chains need a real FK to batteries; batteries' `chainId`/`replacedFromId`/`replacedById` are plain uuid columns instead, enforced at the application layer — documented inline).
- `batteries.lookup` now prefers chain-based cover over the mfg-month rule whenever a battery has a `chainId` — the mfg-month shortcut only still applies to a battery that's never been sold/replaced through the system.
- Two temporary endpoints, `POST /batteries/sell` and `POST /batteries/replace` — explicitly labeled stand-ins for what `entries.create`'s regular-sale and replacement effects will eventually do, gated by the `entries.create` permission it will actually require. The chain data model itself is the real, permanent one; only the "how a sale/replacement gets recorded" path is a placeholder that `entries` will replace outright.
- 8 new tests, including the exact scenario end to end: sell → replace once → replace again, asserting the chain's dates never change; plus already-replaced, custody-conflict, and expired-chain rejections. 69 tests total.
- **Verified live against Neon with real dates**: sold 2026-01-15 → chain expires 2028-01-14. Replaced in March, then replaced *that* battery again in June — both times the chain's dates stayed exactly 2026-01-15/2028-01-14, confirmed via the actual API response, not just the test suite. Attempting a third replacement in 2029 was correctly blocked with `warranty_expired`, citing the *original* January dates even though the battery being checked was manufactured in June.
- **Found and fixed a real, separate bug along the way**: `database/client.ts`'s Postgres pool had no `.on('error', ...)` handler. Neon aggressively drops idle connections, and node-postgres emits that as an unhandled error event on the Pool — with nothing listening, Node treated it as an uncaught exception and killed the *entire server process*, not just the one affected request. This would have caused random full outages in any long-running deployment, not just against Neon. Fixed per node-postgres's own documented pattern; confirmed the server no longer crashes.
**Next:** `entries` — the real replacement-submission module, which is what will eventually replace `/batteries/sell` and `/batteries/replace` with the full validation pipeline, evidence capture, and approval workflow.

---

### 2026-09-17 · batteries module — the actual scan-and-check-warranty step (Claude Code)
**Worked on:** P2-01/P2-13 (trimmed) — `batteries` module, the first module that wires the already-built pure domain logic (`domain/serials.ts`, `domain/warranty.ts`) into a real endpoint.
**Done:**
- `masters` extended with `battery_models` (M3/M5/M7/B5/S5/I700, matching the demo credit-rate names in `memory.md` D-08) — needed as a FK target before `batteries` could exist.
- `batteries` table — trimmed for V1 per the plan: no `location_id`/`customer_id` (their modules don't exist yet), no `chain_id`/`replaced_from_id`/`replaced_by_id` (V1's warranty rule is stateless per D-03, computed live off the battery's own serial rather than tracked through a chain).
- `GET /batteries/lookup?code=` — the actual "dealer scans a battery" step: parses the code, checks if it's already in the system, and returns a live warranty check either way (a not-yet-seen code still gets a real warranty preview, computed off its own manufacture-date prefix). Never reveals *which* other dealer holds a battery to a dealer caller (I-3) — an admin caller additionally gets the real `dealerId`.
- `GET /batteries` — dealer-scoped list (cursor-paginated, same shape as `dealers`' list).
- 10 new tests (own-dealer vs other-dealer masking, admin visibility, expired vs in-warranty, malformed code rejected before the database is touched), 61 total passing.
- **Verified against the live Neon database with the team's own example**: `26041212` → `mfgMonth: "2026-04"`, in warranty, 561 days remaining. An old code (`21040097`) correctly came back expired (`daysRemaining: -1266`). Both exactly matched the manual calculation from when this rule was first specified.
**Known gap, flagged not hidden:** there's still no way to actually *create* a battery record — by design, batteries get created when an entry is approved (architecture.md §9.4), and `entries` doesn't exist yet. `GET /batteries` is correctly empty right now, not broken.
**Next:** `entries` — the actual replacement submission (old battery + new battery + customer → one entry), which is what will finally populate the `batteries` table for real.

---

### 2026-09-17 · first live database — Neon connected, real end-to-end verification (Claude Code)
**Worked on:** unblocking the "no Docker" limitation that every prior session's testing was constrained by.
**Done:**
- Team connected a Neon Postgres instance (shared dev/staging, not local Docker) — `DATABASE_URL` updated in `backend/.env` (gitignored, not committed).
- Found and fixed a real bug while running the seed script for the first time: `database/seed/demo.ts`'s "am I the entry point" check (`import.meta.url === file://${process.argv[1]}`) silently never matched on Windows, because `process.argv[1]` is a native path (backslashes) and `import.meta.url` is a proper `file://` URL — the script ran, did nothing, and exited 0 with no error. Fixed with `pathToFileURL()`.
- **First real, live, end-to-end verification of everything built so far — not mocks, not a booted-but-DB-less server:**
  - `npm run db:migrate` applied both migrations cleanly to Neon.
  - `npm run db:seed` populated real data: 4 cities, 7 roles, the demo admin/dealers.
  - `GET /ready` → `{"ready":true,"checks":{"database":true}}` — the first time this has ever been true.
  - `GET /masters` returned the real seeded cities with real UUIDs.
  - Full OTP login for the seeded active dealer (FPP-014) worked end-to-end: request → real code in the console → verify → real JWT + refresh token + dealer record.
  - `GET /dealers/me` with that real access token returned the real dealer.
  - The seeded suspended dealer (NBH-007) was correctly blocked with `dealer_not_active`, the real reason (`"Demo suspended dealer"`) surfaced in the response — proving the lifecycle work from two sessions ago is actually correct against a real database, not just against mocks.
  - Admin login (`admin@example.com` / `Password123`) correctly kicked off the 2FA challenge.
**Next:** wire the admin app's "New dealers" screen to the real approve/reject endpoints (flagged as a gap yesterday), or push into `batteries`/`entries` for the core replacement flow. Backend test server left running against Neon for continued Thunder Client testing.

---

### 2026-09-16 · masters module (cities) + closes the city id/name gap (Claude Code)
**Worked on:** P1-01 (partial — cities only; models/entry-types/reason-codes land with batteries/entries), frontend integration for the city picker and dealer bridging.
**Done:**
- `masters` module: `GET /masters` (public bundle — a not-yet-registered dealer needs the city list before they have any token, for d04's picker) and admin-managed `GET/POST/PATCH /masters/cities` (`masters.manage` permission; retire via `active:false`, never delete, per architecture.md convention).
- Fixed a real ownership bug introduced in the dealers session: `findCityByName` existed in both `dealers.repository.ts` and the new `masters.repository.ts` — removed the duplicate from `dealers`, which now calls into `masters` (matches modules.md's single-writer rule: masters owns `cities`, dealers only reads it).
- Fixed `co_admin`'s seeded permissions — `masters.*` was missing even though architecture.md says co_admin gets everything except `admins.manage`/`warranty.policy.manage`/`settings.manage`.
- **Frontend**: `src/api/masters.ts` + a `useCities()` hook in `Access.tsx`. `d04`'s city picker now calls the real backend instead of the hardcoded local list. Closed the exact gap flagged at the end of the previous session: `d02`'s sign-in bridge now resolves the dealer's `cityId` to a real name via the fetched city list, instead of dropping the raw uuid into the local store's `city` field.
- 6 new tests, 50 total passing. Verified against a booted server (bundle reachable, admin routes correctly 401 without a token) and confirmed the Expo web bundle still compiles with the new frontend code included.
**Next:** `batteries`/`entries` — the actual replacement flow the team described (scan → warranty check → submit). This is the natural point to also add `battery_models`/`serial_rules` to the masters module, since entries needs them.

---

### 2026-09-16 · RBAC + dealers lifecycle (approve/reject/suspend/activate) (Claude Code)
**Worked on:** P1-06 (rbac plugin, minimal), P1-08 (dealer lifecycle) — closing the gap flagged at the end of the previous session: dealers could register but nothing could approve them.
**Done:**
- `middleware/rbac.ts`: `getEffectivePermissions(userId, role)` (role's `templatePermissions` ∪ individual `user_permissions` grants — temporary home, moves to `users.service` once that module exists, same pattern as other cross-module gaps this project has hit) and `requirePermission(permission)`, a route preHandler. Supports exact match, `'*'` (main_admin), `'domain.*'`, and `'*.verb'` (read_only) — 5 pure unit tests.
- `database/seed/masters.ts` now also seeds the 7 role templates from `architecture.md §7.3` (dealer_user, dealer_manager, main_admin, co_admin, operations, inventory_manager, read_only) — not yet a 100% exhaustive match to every permission string in that section, filled in as each module that owns those permissions gets built.
- `dealers` module finished: `PATCH /dealers/me` (contact/email/address/place — the fields architecture.md marks editable, name/city/code stay locked), `GET /dealers` (cursor-paginated, admin), `GET /dealers/{id}` (admin), and the full lifecycle — `approve` (assigns the dealer code, checked for format and uniqueness, only from `pending_approval`/`rejected`), `reject` (`pending_approval` only), `suspend` (`active` only), `activate` (`suspended` only) — each enforcing the exact transition table in `architecture.md §9.9` and requiring its own permission (`dealers.approve` or `dealers.suspend`).
- Closed part of the I-8 gap ("account status checked on every request") for the one case that matters most right now: `suspend` immediately revokes every session belonging to the dealer's users, so a suspended dealer's existing token stops working right away instead of silently working until it expires. The general per-request account-status check (the documented `accountStatus` plugin) still doesn't exist — noted, not hidden.
- 21 new tests (16 dealers + 5 rbac), 44 total passing. Verified against a booted server: every lifecycle route correctly returns 401 with no/garbage token, and 422 on a malformed body — including confirming the auth guard itself fires (not just validation) by sending a garbage token with an otherwise-valid body.
**Known gap, flagged not hidden:** role/permission seeding covers the 7 templates but isn't a byte-for-byte match to every permission string architecture.md lists per role — it'll need topping up as `entries`, `claims`, `stock`, etc. get built and start actually checking their own permissions.
**Next:** `masters` module (closes the `city` id-vs-name gap flagged last session) or push into `batteries`/`entries` for the core replacement flow.

---

### 2026-09-16 · dealers module (register + me) + frontend integration (Claude Code)
**Worked on:** P1-07 (partial) — `dealers` module scoped to registration and profile; first real wiring of `src/dealer/Access.tsx` to the live backend instead of the local demo store.
**Done:**
- `POST /dealers/register` (consumes `auth`'s `verifiedToken`, checked against the submitted mobile so a token can't be replayed for a different number; resolves city name → `cityId`; creates the dealer + its first `dealer_manager` user in one transaction) and `GET /dealers/me` (first protected route — needed `middleware/auth.ts`, a JWT-verification guard, built now since it's genuinely foundational, not dealers-specific).
- Improved `auth.service.verifyOtp`: a pending/suspended/rejected dealer used to get one generic `dealer_suspended` error; now throws `dealer_not_active` with the real status in `details`, so the app can route a pending dealer straight to the "waiting for approval" screen instead of showing a dead end.
- `database/seed/masters.ts` (the 4 demo cities, matching `src/seed.ts` exactly) and `database/seed/demo.ts` (Main Admin, Co-Admin, and the demo dealers FPP-014/NBH-007/Vidyut Power Centre from `memory.md §10`, fixed demo password `Password123` since a real backend needs one real hash, not "any password"). Guarded to refuse running in production.
- 6 new unit tests (repository/token-verification mocked): rejects a `verifiedToken` issued for a different mobile, rejects an already-registered mobile, rejects an unknown city, creates the dealer correctly on a valid submission, and `/me` correctly requires a signed-in dealer.
- **Frontend**: `src/api/{config,client,auth,dealers,session}.ts` — a fetch wrapper matching the backend's error envelope exactly, typed calls for every auth/dealers endpoint built so far, and a bridge layer (`dealerStatusLabel`) converting the backend's snake_case enums to the app's existing Title Case labels. Rewired `d02` (sign-in) and `d04` (registration) in `Access.tsx` to call these for real; `d03` (reset password) deliberately left on local-only logic for now (flagged with a comment) since it wasn't in this pass's scope.
- Found and fixed a real, unrelated bug while typechecking the frontend: the root `tsconfig.json` had no `backend` exclusion, so it was silently trying to typecheck the backend's own independent TypeScript project (different module settings, different vitest globals) every time anyone ran the frontend's typecheck. Fixed by excluding `backend/`.
- Verified against a booted server (not just typecheck): missing fields → 422 with details, a token signed for the wrong mobile → 401 before touching the database, `/dealers/me` with no/garbage bearer token → 401. Verified the Expo web bundle still compiles with the new `src/api/` code included. 29 backend tests + frontend typecheck all green throughout.
**Known gap, flagged not hidden:** the bridged dealer object stores `cityId` (a uuid) in the local store's `city` field, which the rest of the app expects to be a city *name* — there's no way yet to resolve one from the other client-side, since `GET /masters` (which would hand the app the id→name bundle) doesn't exist yet. Harmless for now (nothing currently renders that field from a freshly-registered/signed-in dealer), but worth remembering before it causes a confusing display bug later.
**Next:** `masters` module (would also resolve the city-name gap above) or continue deeper into `entries`/`batteries` for the core replacement flow — whichever the team prioritizes. Docker/Postgres still not available on the dev machine, so still no live end-to-end run; everything above is proven via unit tests + a booted server correctly failing at the DB boundary.

---

### 2026-09-16 · auth module — OTP, admin login, password reset (Claude Code)
**Worked on:** P1-03/P1-05 (partial) — the `auth` module, scoped to exactly what `src/dealer/Access.tsx` (d02 sign-in, d03 reset, d04 register's verify-mobile step) and the admin `SignIn` component need.
**Done:**
- `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/login`, `POST /auth/password/forgot`, `POST /auth/password/reset` — all public, all Zod-validated.
- `utils/crypto.ts` (Argon2id via `@node-rs/argon2`, sha256, random tokens, numeric OTP codes), `modules/auth/auth.tokens.ts` (JWT access tokens via `jose`, opaque rotating refresh tokens, and a short-lived "verifiedToken" that lets `register`/`reset`/`verify_mobile` OTP checks hand off to a later step without re-entering the code).
- `utils/context.ts` (the shared `Ctx` type every module will use) and `utils/audit.ts` (the sole writer of `audit_events`, per rules.md §6) — both foundational, not auth-specific, built now because auth is the first module that needed them.
- Same-response-regardless-of-existence for OTP requests (architecture.md §7.2 — no phone-number/email enumeration); a DB-backed stand-in for the Redis rate limit (5 requests/15 min per target) and admin lockout (10 bad passwords/15 min), both clearly commented as temporary until `ratelimit.ts`/Redis are wired.
- 10 new unit tests (repository and audit layers mocked — no real DB touched), covering: wrong OTP increments attempts, expired/exhausted challenges are rejected, a suspended dealer is blocked even with the right code, register-purpose challenges return a `verifiedToken` not tokens, and admin login never reveals whether the email exists.
- Fixed two real bugs found while testing against a booted server (not just typecheck): `package.json`'s `db:migrate` script still pointed at the pre-rename `src/db/migrate.ts` path; the error handler didn't recognize Fastify's own schema-validation failures (a plain `Error` with a `.validation` array, not a `ZodError` instance) and was reporting them as 500s instead of 422s with field paths. Both fixed and verified against a live-booted server.
**Decisions:** Dealer registration itself (creating the `dealers` row) is deliberately left to the next module (`dealers`) — `auth` only proves mobile ownership and hands back a `verifiedToken`. `/auth/refresh`, `/auth/logout`, `/auth/sessions`, `/auth/password/change` deferred — none of the two referenced screens need them yet; natural next increment within this same module.
**Next:** `dealers` module (registration using the `verifiedToken` from `auth`, approval lifecycle, profile) — once Docker is available, this is also the point to actually apply the migrations and test the whole flow against a real Postgres instead of unit-test mocks.

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

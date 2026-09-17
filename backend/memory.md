# Felix BMS — Project Memory

Last updated: 16 September 2026 · Owner: 4AM Global Media (Vaibhav Pasi, Co-Founder) · Client: Felix Batteries Industries, Nashik

This file is the **long-term memory** of the project: the facts, decisions, identifiers and credentials that every developer and every AI assistant must have in mind before touching code. It is short on purpose. Read it fully at the start of each session (`rules.md §1`). If something here is wrong, fix it here first — the code follows this file, not the other way round.

---

## 1. What we are building

A battery lifecycle and dealer management platform that replaces Felix Batteries' Excel replacement register. Dealers record battery replacements (and returns) from a phone; head office approves claims, tracks the old battery back to the company, keeps one continuous warranty per replacement chain, credits dealers, and exports the same Excel sheet management already reads. Source requirements: `tmp/prd.txt` (PRD v3.0, 41 pages, 33 sections, decisions D-01–D-06, acceptance criteria AC-01–AC-12). The PRD text has spaced-out letters in places (PDF extraction artefact) — the content is intact.

Two surfaces, one Expo (React Native) codebase, one backend:

* **Dealer app** — phone-first, also installable on the web. Design approved by the client as `C:\Users\shoai\Downloads\Felix-Dealer-App-Only.html` (screens d01–d37). The app matches it screen for screen.
* **Head-office console** — desktop sidebar layout, phone bottom tabs. Rebuilt on 14 Sep 2026 in the same design language; every function of the earlier admin workspace kept.
* **Backend** — Node/TypeScript API + worker, PostgreSQL, Redis, Cloudinary (evidence/PDF storage — see D-10 update below, superseding the original S3-compatible plan). Design: `backend/architecture.md`. Skeleton scaffolded 15 Sep 2026 (see `logs.md`); business modules not yet built.

## 1a. V1 scope — battery replacement only (decided with the team, 16 Sep 2026)

The client's team has scoped the first shippable version down to **one flow**: a dealer replaces a battery under warranty, sends the old one back, and eventually gets credited. Everything else in `modules.md`'s 24-module plan (customers, corrections, sync, search, reports, imports, notification channels beyond in-app, admin governance beyond basic roles) is explicitly **deferred past V1** unless it blocks this flow. V1 module set: `auth`, `dealers`, `users`, `masters` (models + serial rules only), `batteries`, `warranty` (simplified — see D-03), `entries`, `stock`, `claims`, `returns` (challans), `credits`, `audit` (kept from day one — it's cheap and every invariant test depends on it).

V1 flow (statuses are existing enum values from `architecture.md §8.3`, not new ones):

1. Dealer scans the old battery's code at the counter (camera) → app extracts `mfgMonth` (first 4 digits, `YYMM`) and `serialNo` (last 4 digits) → server checks warranty (see D-03) → blocks the flow if expired.
2. Dealer submits the replacement: old battery code + new battery code + customer → `entries` (status `submitted`); new battery → `sold`/`replacement`; old battery → `returned`, custody `dealer`; a `warranty_claims` row is created (`raised`).
3. Dealer raises a pickup request for the old battery → `challans` created, status `in_transit`.
4. Company vehicle collects it; on arrival, head office marks the challan `received` → old battery custody → `company`; claim status → `received`.
5. An engineer inspects the battery (`POST /claims/{id}/check`): records the finding and disposition. If the fault disqualifies the claim, status → `refused` ("rejected" in the team's words). Otherwise status stays `checked` ("in review"/"verification") awaiting a second person's sign-off.
6. A second person decides (`POST /claims/{id}/decide`): `approved` issues a `credit_notes` row (the "claim refund") the dealer can see; `refused` records a reason. (Whether "engineer" and "decider" must be different people, or can be the same role for V1, is a permissions-config choice, not a schema one — default for now: same `claims.decide` permission can do both steps.)

## 2. Current state (16 Sep 2026)

| Area | State |
|---|---|
| Dealer app UI | Complete against the client HTML; works in a browser; camera/GPS/signature untested on real phones |
| Admin UI | Complete; desktop + phone layouts; tested in a browser |
| Shared rules | `src/domain.ts` (validation, warranty maths, chain resolution, approval effects) with 8 passing tests in `tests/domain.test.ts`; not yet moved into a shared `packages/domain` package (planned P0-03/P0-08, deliberately deferred so the working demo app isn't touched mid-refactor) |
| Data | Local demo store (`src/store.tsx` + `src/seed.ts` in AsyncStorage); no server |
| Backend | `backend/` scaffolded (Fastify skeleton, env config, error handling, health/ready routes, Drizzle + first migration for `counters`/`settings`/`audit_events`) but unverified end-to-end — local Postgres/Docker not yet installed on the dev machine. No business modules (auth, entries, claims, etc.) built yet. |
| Repo | Git-initialized, remote at `github.com/shoaibkmca2025/Flix-baterry`. |
| Old admin code | Kept unrendered in `src/legacy/Workspace.tsx` and the older `src/*.tsx` screens; delete only after client sign-off of the new admin |

## 3. Where things are

```
App.tsx                      picks DealerApp (role Dealer) or AdminApp (admin roles) from the demo store role
src/domain.ts                shared business rules (to move into packages/domain in P0-03)
src/seed.ts                  demo data: dealers FPP-014/GLB-021/SAE-033/NBH-007/VPC-045, batteries, entries, policy POL-01
src/store.tsx                local state + audit() helper (replaced by the API in P1–P3)
src/reports.ts               Excel/CSV/PDF export helpers (column order source of truth until the backend takes over)
src/dealer/                  dealer app: theme.ts (colour tokens, fonts), kit.tsx (components), shell.tsx (screen chrome, navigation),
                             data.ts (dates, cover maths, credit notes, challan HTML), media.tsx (camera, GPS, signature),
                             Access.tsx (d01–d06), Home.tsx (d07, d09), Capture.tsx (d10–d17, d31), Claims.tsx (d32–d37), Records.tsx (d18, d19, d23, d24), DealerApp.tsx (router)
src/admin/                   admin console: ui.tsx (Page, Table, Dialog, ReasonDialog, filters), AdminApp.tsx (nav, sidebar, tabs, switcher),
                             Home.tsx, Entries.tsx (approvals, register, corrections, detail, record-an-entry), Dealers.tsx (registrations, directory, profile, customers),
                             Batteries.tsx (search, detail/chain, warranty, catalogue/import), Stock.tsx (stock, returns), Reports.tsx, Governance.tsx (audit, admins, notifications, settings, sign-in)
backend/                     this plan: architecture.md · modules.md · phases.md · rules.md · memory.md · logs.md
tmp/prd.txt                  PRD v3.0 text
C:\Users\shoai\Downloads\Felix-Dealer-App-Only.html          client-approved dealer design (also contains head-office panel designs A.* and admin phone app M.*)
C:\Users\shoai\Downloads\Felix-Batteries-Platform-Prototype.html   earlier full prototype
```

## 4. Glossary

| Term | Meaning |
|---|---|
| Battery code | The full printed code, 8 digits by default (`21030047`). Unique identity of a physical battery. Stored as text. |
| Serial (short serial) | Last 4 digits of the code (`0047`), derived per serial rule. Not unique on its own. |
| Mfg month | Derived from the `YYMM` prefix of the code (`2021-03`); editable, never later than the entry date. |
| Entry | One transaction header submitted by a dealer or admin (`ENT-26-09-0414`). Has a type, a date, a place, an optional customer, remarks, and 1..n items. |
| Item | One battery line inside an entry; the export grain (one row per item). |
| Entry type | Master data: Replacement, Regular Sales, Goods Return, Repaired & Returned (Non-Chargeable / Chargeable), Received for Repairs, Material Sent for Repair, Standby, On Approval, Demo, Returned/Unrepaired, For Charging, Other. Dealers see only Replacement and Sales Return (see D-07). |
| Old battery / new battery | In a replacement, the battery that came back (old) and the one handed to the customer (new). |
| Chain | Root battery (first sale) → every replacement, linked by `replacement_links`. |
| Cover / warranty | The chain's warranty start and expiry. Belongs to the chain; every replacement inherits it. Never restarts. |
| Policy version | Effective-dated warranty configuration (term months, anchor, override rules). Chains keep the version that created them. |
| Override | An approved, reasoned extension of a chain's expiry within the policy maximum. The original working is kept. |
| Exception | An entry that cannot be approved as it stands (duplicate serial, custody conflict, expired cover without override, server state changed after an offline draft). Shown to dealers as "Serial exception". |
| Correction | A linked follow-up entry (`ENT-…-C1`) created by an admin; the original is marked corrected and stays readable. |
| Claim | The commercial warranty decision for a replacement item (`CLM-26-09-0212`). Accepted on paperwork; decided after the old battery is checked (default) or on entry approval (setting). |
| Challan | Material Return Challan (`FBI-RT-2609-01`): the list of old batteries a dealer hands to the company van. |
| Credit note | `CN-26-09-0188`: credit to the dealer for an approved claim; amount from `credit_rates` per model. |
| Custody | Who physically holds a battery: company (location), dealer, customer, transit. |
| Stock state | available, allocated, sold, returned, replacement, repair, damaged, scrap. Only ledger movements change it. |
| Dealer code | Admin-assigned identity like `FPP-014`; immutable once approved. |
| Head office | Felix Batteries staff using the admin console. |

## 5. Non-negotiable invariants

See `architecture.md §1` (I-1…I-10). The two that get broken most easily by well-meaning code: **warranty never restarts** and **dealer id comes from the token**.

## 6. Identifiers and formats

| Kind | Format | Example | Sequence |
|---|---|---|---|
| Primary keys | UUIDv7 (app-generated) | — | — |
| Entry | `ENT-YY-MM-NNNN` | `ENT-26-09-0414` | per month, gap-free within a transaction |
| Correction | `<entry>-C<n>` | `ENT-26-09-0409-C1` | per entry |
| Claim | `CLM-YY-MM-NNNN` | `CLM-26-09-0212` | per month |
| Challan | `FBI-RT-YYMM-NN` | `FBI-RT-2609-01` | per month |
| Credit note | `CN-YY-MM-NNNN` | `CN-26-09-0188` | per month |
| Dealer code | `AAA-NNN` (2–4 letters) | `FPP-014` | suggested from name, admin may edit |
| Battery code | per serial rule, default `^\d{8}$` | `21030047` | printed on the label |
| Client key (offline) | `e_<uuidv7>` / `c_…` / `r_…` | `e_01J9K…` | generated on the device |
| Batch key | `b_<uuidv7>` | | generated on the device |

## 7. Status enums and app labels

| Entity | API value (snake_case) | App label | Notes |
|---|---|---|---|
| entry | `draft` | Draft | dealer drafts live on the device only; admin drafts are server rows visible to the creator |
| entry | (client-only) | Pending sync | app queue state, not a server status |
| entry | `submitted` | Submitted | waiting for a decision |
| entry | `under_review` | Under Review | |
| entry | `exception` | Serial exception (app's old `Conflict`) | see glossary |
| entry | `approved` / `rejected` / `corrected` / `cancelled` | Approved / Refused / Corrected / Voided | "rejected" is shown to dealers as "refused" |
| dealer | `pending_approval` / `active` / `rejected` / `suspended` | Pending Approval / Active / Rejected / Suspended | |
| user | `active` / `temporarily_blocked` / `inactive` / `soft_deleted` | Active / Temporarily blocked / Inactive / Soft deleted | |
| warranty | computed: `not_on_record` / `active` / `expiring_soon` / `expired` + flags `claimed`, `overridden`, `exception` | Not on record / Cover active / Cover ending soon / Cover ended | never stored on the battery |
| claim | `raised` / `accepted` / `refused_upfront` / `awaiting_return` / `received` / `checked` / `approved` / `refused` / `closed` | Waiting / Accepted for checking / … / Approved / Refused | |
| challan | `in_transit` / `received` / `partially_received` / `closed` | In transit / Received / … | |
| stock | see glossary | dealer app shows "With customer" for sold/replacement | |
| sync op outcome | `accepted` / `duplicate` / `failed` / `conflict` | Sent / Sent / Needs a fix / Serial exception | |

## 8. Roles

`dealer_user`, `dealer_manager`, `main_admin`, `co_admin`, `operations`, `inventory_manager`, `read_only`. Permission keys and templates: `architecture.md §7.3`. Only `main_admin` manages admins and warranty policy; nobody edits their own role; grants are bounded by the grantor.

## 9. Decisions register

Status: **closed** (agreed with the client in writing) · **assumed** (our default; build proceeds; reversible until the phase noted) · **open** (blocks the phase noted).

| Id | Decision | Default / recommendation | Status | Reversible until |
|---|---|---|---|---|
| D-01 | Submission grain | One entry, many items; single item is the default state; export one row per item | assumed (PRD §9 already specifies this) | — |
| D-02 | Entry-type catalogue and required fields | PRD §9.1 table as seeded master data; dealers see Replacement + Sales Return; admins see all | assumed | P2 |
| D-03 | Warranty anchor and term | Original **sale date**, 24 months, expiry = anniversary − 1 day, **inherited unchanged across replacements** (chain never restarts) | assumed (matches the PRD worked example and the client HTML) — **but for V1 scope (2026-09-16) the team asked to build the simpler stateless rule instead: each battery's own warranty = its own serial's manufacture date (`YYMM` prefix) + 24 months, recalculated fresh on every replacement, no chain table.** Team has not yet confirmed which is the real long-term rule — **open**, needs a decision before V2 (multi-replacement chains) is built, since retrofitting chain-based inheritance after batteries already carry independent warranty dates is a real migration, not a toggle. | P3-01 (V1: `warranty.expiryFrom()` isolated as a pure function so the anchor can change later without touching callers) |
| D-04 | Serial format per family; duplicate override | Default `^\d{8}$` for all families, short serial = last 4, mfg from `YYMM`; duplicates **blocked** (no exception queue) unless the client asks | assumed | P2-07 |
| D-05 | Approval workflow | Dealer entries enter `submitted`; admins approve; the customer already has the battery. Claim decided after inspection (`claim_decision_mode = after_inspection`); the current admin UI approves in one step — a settings toggle keeps both possible | assumed | P3-05 |
| D-06 | Customer data policy | Customer module ships in P5-02; until then: name + mobile captured with dealer consent flag, retention 5 years after the last entry, contact fields hidden from `read_only` and from dealer exports | **open** — client must confirm before P5-02 | P5-02 |
| D-07 | "Sales Return" entry type | The dealer app offers "Sales Return" (client HTML). Map it to the PRD's `goods_return` with dealer label "Sales Return", or add it as its own type | **open** — ask the client; default: alias of `goods_return` | P2-01 |
| D-08 | Credit note amounts | Demo values in the app (M3 3800, M5 4250, M7 4900, B5 3600, S5 1400, I700 5200). Real rates go into `credit_rates` | **open** — client to supply | P3-05 |
| D-09 | Dealer sign-in method | Mobile + OTP is primary (client HTML). Password kept for email login and admin | assumed | P1-03 |
| D-10 | Hosting, SMS, email, storage providers | VPS (Hetzner/DigitalOcean) + Caddy; MSG91 with DLT; SES or Resend; Cloudflare R2 | **open** — needs client accounts and DLT registration (2–3 weeks lead time) | P1-16 |

## 10. Demo credentials and test data (never valid in production)

| What | Value |
|---|---|
| Dealer sign-in | mobile `9876543210` (Felix Power Point, `FPP-014`), OTP `123456` |
| Admin sign-in | `admin@example.com`, any password ≥ 8 chars, code `123456`; Co-Admin `operations@example.com` |
| Suspended dealer | Nashik Battery House `NBH-007` (mobile `9876543213`) |
| Pending dealer | Vidyut Power Centre (mobile `9876543214`) |
| Old battery with cover | `26050195` (M5, chain root `21030047`, cover 10 Jan 2026 → 09 Jan 2028) |
| Expired cover | `21040097` (M7, cover ended 08 Feb 2026) |
| Available stock (FPP-014) | `26080311`, `26080312`, `26080313` (M5), `26080501` (B5), `26080502` (S5), `26080512` (I700), plus `26090601`–`26090607` (M5, M5, B5, S5, M7, I700, M3) |
| Battery held by another dealer | `26070400`, `26070402` (GLB-021) — custody conflict case |

**Old batteries for testing a replacement** (added 17 Sep 2026; all FPP-014 unless stated). Each one exercises one branch of the validation pipeline, so a tester can reach every state without editing data:

| Old battery | Model · customer | Cover | What it tests |
|---|---|---|---|
| `21020140` | M5 · Nashik Roadlines | active to 14 Jun 2027 | the ordinary happy path |
| `21030017` | B5 · Patil Travels | active to 29 Feb 2028 | leap-year expiry date |
| `21040211` | M7 · Shree Transport | active to 19 May 2028 | happy path, second model |
| `26050195` | M5 · Suresh Transport | active to 09 Jan 2028 | chain that already has one replacement |
| `21040104` | B5 · Kisan Agro | ending 09 Oct 2026 | "cover ending soon" warning |
| `21040385` | B5 · Patil Farm | ending 01 Oct 2026 | ending soon + already on an open request |
| `21050512` | I700 · Deshmukh Farms | ended 31 Jul 2025 | blocked — needs an override |
| `20120066` | M5 · Sai Travels | ended 14 Jan 2026 | blocked — needs an override |
| `21040097` | M7 · Deshmukh Auto | ended 08 Feb 2026 | blocked; also the seeded serial-exception entry |
| `19070123` | M3 · Sunrise Hotel | none on record | allowed, flagged "not on record" |
| `20110044` → `21030029` → `26060210` | M5 · Jain Logistics | active to 04 Jan 2027 | 3-link chain: the first two are blocked as "already replaced", the last is allowed and raises the replaced-twice flag |
| `21010188` → `21040367` | S5 · Om Sai Motors | active to 11 Mar 2027 | "already replaced" block; matches seeded entry ENT-26-09-0413 |
| `26070402` | S5 · GLB-021 | active | blocked — custody belongs to another dealer |
| Serial exception entry | `ENT-26-09-0409` (old `21040097`, expired) |

The backend seed (`backend/src/db/seed/demo.ts`) must reproduce exactly this data so the app's demo mode and the staging database tell the same story.

## 11. Environment (fill in during P0/P1)

| Item | Value |
|---|---|
| Node / pnpm | 22.x / 9.x |
| Postgres / Redis | 16 / 7 |
| Repo remote | — |
| Staging API / app URLs | — |
| Production API / app URLs | — |
| Object storage | — (bucket names: `felix-evidence`, `felix-exports`, `felix-backups`) |
| SMS provider / DLT entity id | — |
| Email provider / sender | — |
| Sentry projects | — |
| Uptime monitor | — |
| Secret manager location | — |
| On-call contact | — |

## 12. Known gaps and risks

* OCR is not implemented; the dealer app photographs the label and the number is scanned or typed (Phase 5).
* SMS in India requires DLT template registration before any OTP or alert can be sent; start this in P0 (D-10).
* The app computed "today" in UTC until 14 Sep 2026 (fixed); the server must always use `Asia/Kolkata` for business dates.
* Camera, GPS and signature capture are untested on physical devices; test early in P2-16.
* The admin UI approves entry and claim in one step; the backend default is two-step (D-05). The UI needs a small change when the setting is `after_inspection`.
* Historical register quality is unknown; migration (P4-01) may surface many "not on record" chains — that is expected and must not be "fixed" by inventing dates.

## 13. How to update this file

* Change a fact → edit in place and bump "Last updated". Do not keep history here; history lives in `logs.md`.
* New decision → add a row to §9 with status and reversibility; mention the log entry date.
* New id format, enum value, role or permission → add here **and** in `architecture.md` in the same commit.
* Never put secrets here. Demo credentials are the only exception.

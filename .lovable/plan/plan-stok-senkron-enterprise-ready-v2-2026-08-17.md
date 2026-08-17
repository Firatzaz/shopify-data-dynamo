# Plan: Stok Senkron — Enterprise-Ready V2

## Goal
Move the app from a functional-but-basic inventory sync tool to a sellable product for mid-to-large Shopify merchants by adding rollback safety, human-in-the-loop controls, conflict resolution, tiered plan limits, and a more convincing dashboard + onboarding experience.

## What we will build

### 1. Snapshot restore (Geri Alma)
- The `snapshots` and `snapshot_archives` tables already exist but have no restore path.
- Add a server function that, given a `snapshot_id`, replays the captured inventory state back to the relevant store(s).
- Restore is logged as a new `event_log` row with `source: 'restore'`.
- UI: list snapshots on a new "Yedekler & Geri Alma" card/page, one-click restore with confirmation.

### 2. Manual approval queue (İnsan Onayı)
- Any `event_log` row with `status = 'needs_review'` becomes an approval item.
- Add server functions to:
  - list pending approvals,
  - approve (apply the proposed change to the destination store),
  - reject (log the decision, no write).
- Update the sync engine so that `needs_review` events do not write to Shopify automatically.
- UI: new "Onay Bekleyenler" section on Dashboard and a dedicated badge in Logs.

### 3. Conflict resolution rules (Çakışma Çözümü)
- Extend `sync_rules` with `conflict_resolution` enum: `source_wins`, `destination_wins`, `max`, `min`, `manual`.
- When the destination store's current value differs from what we expect (i.e. someone/something changed it since our last sync), the rule's conflict strategy decides the outcome.
- `manual` creates a `needs_review` event; the others apply automatically and are logged.

### 4. Tiered plan / limits (Katmanlı Fiyatlandırma)
- New `subscriptions` table: `user_id`, `plan` enum (`free`, `starter`, `pro`, `enterprise`), `store_limit`, `rule_limit`, `sync_events_monthly_limit`, `features` jsonb, `valid_until`.
- Seed default `free` row for every user via the existing `handle_new_user()` trigger.
- Enforce limits at server-function level with clear error messages ("Pro plan required for more than 2 stores").
- UI: show current plan, usage, and upgrade CTA in the protected layout.

### 5. Dashboard charts & health
- Use `recharts` (already in dependencies) to add:
  - 24h event trend line (applied / failed / dry-run per hour),
  - store health score (webhook success rate per store),
  - plan usage bars (stores, rules, events).
- Keep the existing stat cards; charts sit below them.

### 6. Onboarding flow
- Detect first-login state (0 stores, 0 rules).
- Show a dismissible stepper on Dashboard: 1) Connect source store → 2) Connect destination store → 3) Create first rule → 4) Run dry-run preview.
- Add a "Yardım" tooltip on each page explaining the page's purpose.

## Technical approach
- All schema changes via a single Supabase migration.
- Server functions added to `src/lib/app.functions.ts`; heavy logic lives in `src/lib/app.server.ts`.
- Sync-engine changes in `src/lib/sync-engine.server.ts` (conflict check + approval path).
- New UI sections added to existing authenticated routes; no new top-level routes required except the approval/restore actions can live inside Dashboard/Logs modals.

## Database changes (one migration)
1. Add columns to `sync_rules`: `conflict_resolution text NOT NULL DEFAULT 'source_wins'`.
2. Create `subscriptions` table with GRANTs, RLS, policies, and insert a `free` row in `handle_new_user()`.
3. Add `status = 'needs_review'` handling stays in application code; no schema change needed for approvals.
4. Optional index on `event_log(user_id, status, created_at)` for fast approval queries.

## Server functions to add
- `listSnapshots`, `createSnapshot`, `restoreSnapshot`
- `listPendingApprovals`, `approveEvent`, `rejectEvent`
- `getSubscription`, `checkLimits`
- Updated `upsertRule` accepts `conflict_resolution`

## UI changes
- Dashboard: charts, onboarding stepper, pending approvals card, plan usage card.
- Rules: conflict resolution selector per rule.
- Logs: "Onayla / Reddet" buttons for `needs_review` rows.
- Layout: plan badge + upgrade CTA.

## Acceptance criteria
- A user can create a snapshot, view it, and restore inventory values from it.
- A `needs_review` event can be approved or rejected from the UI and is never auto-applied.
- A rule with `manual` conflict resolution always creates a `needs_review` event when both sides differ.
- Free-plan users cannot exceed 2 stores / 3 rules; clear messaging is shown.
- Dashboard renders charts without errors and onboarding stepper disappears once a rule exists.
- Build passes (`tsgo --noEmit`) and security linter is clean.

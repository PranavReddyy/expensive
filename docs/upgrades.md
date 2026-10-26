> The [Supabase-only auth cutover](supabase-auth.md) is live. Firebase references below describe the historical installation order, not the current runtime. See [Trips and profile deletion](trips.md) for the latest features.

# Expense upgrades

## Before deploying

Back up the database. These scripts define new operations; installing them does **not** change current balances or delete user data. No live migration is run by the app/build.

For an existing Firebase-enabled installation, run in this order:

1. `ios/Database/activity-history.sql` (if not installed).
2. `ios/Database/on-me.sql` (if not installed).
3. `supabase-expense-upgrades.sql`.
4. `supabase-data-deletion.sql`.

The installation must already have the existing native operations and Firebase ownership migration. Do not rerun the old Firebase migration after these scripts: if rebuilding everything, follow the same order and finish with the new migrations. Deploy the updated web app (including `/api/account/delete-data`) before distributing the iOS build. Existing Firebase/Resend credentials and shared usernames stay unchanged.

## What changed

- **Editing:** open an expense and choose Edit. Reason, amount, notes, category and date are editable. The server atomically adjusts the balance difference. Version checks reject stale edits; request receipts prevent duplicate charges. Generated tab-payment expenses must be undone in Tabs History before changing them.
- **Recurring:** account settings → recurring expenses. Choose a profile, amount, category and weekly/monthly/yearly cadence. Record or skip each due occurrence; pause to stop reviewing it. Month-end schedules retain their original day (January 31 → February's last day → March 31). Missed occurrences are reviewed individually, not charged in bulk. Pause and create a replacement schedule to change its amount/cadence. No background auto-charge, push/email reminder or currency conversion.
- **Offline drafts:** a new expense is durably queued before it is sent. iOS uses owner-scoped, file-protected Application Support files excluded from backups; web uses owner-scoped IndexedDB. Pending totals are separate from confirmed balances. The original request ID survives retries/relaunches. Definitively rejected drafts can be discarded; uncertain network outcomes must first be retried. Drafts remain on this device after sign-out and are only sent after that same account signs in again. Clearing app/browser storage can erase unsynced drafts. Initial sign-in/session verification still requires connectivity; this is not a fully offline app.
- **Data controls:** account settings provides category add/rename/reorder/archive/restore and expenses, tabs and activity CSV exports across profiles. Archived categories remain in historical reports. A schedule using an archived category requires restoring it before recording. CSV text is escaped and formula-like user text is neutralized. Exports may reflect changes made while exporting; they are not transactional backups.
- **Delete Expensive data:** requires a currently verified, non-revoked Firebase identity, sign-in within five minutes, and the exact phrase `DELETE EXPENSIVE DATA`. The server derives ownership, never trusts a client-supplied user ID, and invokes a service-role-only transaction. Profiles, balances, expenses, tabs, transfers, categories, activity and schedules are removed. Firebase identity/username and other applications are untouched. An opaque identity link and request-ID tombstones remain to prevent late retries; financial request payloads are removed. Provider backups follow your Supabase retention policy. Other devices may retain cached copies until they reconnect or sign out. No live deletion has been performed during implementation.
- **Parity:** web now includes On me, custom split remainder, horizontal toggleable category buttons and expense amount sorting. Both platforms support editing, schedules, categories/exports, deletion and new-expense outboxes.

## Startup and sync

Firebase remains the shared identity provider. Authentication checks, current email verification, revocation checks and owner isolation were not removed to make loading look faster.

Cached screens remain visible during refresh. iOS now subscribes to Supabase Postgres changes while active, batches events for 250 ms, refreshes tokens and reconnects with backoff. It retains a 60-second foreground fallback and pull-to-refresh. Web batches realtime events for 150 ms and retains its reconnect/foreground/fallback checks. Realtime follows the [Supabase protocol](https://supabase.com/docs/guides/realtime/protocol); RLS still controls data access.

For actual production timing, inspect `POST /api/auth/bootstrap`'s `Server-Timing` header (`auth`, `identity`, `database`) and the browser's **Expensive authentication bootstrap** performance measure. iOS logs bootstrap and ledger durations under the `performance` category in debug logs, without tokens or personal data. These local tests do not establish production latency. Cold-start authentication and network sync cannot be guaranteed instant.

## Verification

```sh
node --test tests/*.test.mjs ios/Database/native-operations.test.mjs
npm run build
```

Use Product → Test in Xcode. Before release, test two real accounts and two devices: interrupted save/relaunch/retry, cross-device edits, stale-edit rejection, settlement undo, On me without double debit, monthly/leap-year schedules, dark/light keyboard controls, exports and deletion against a disposable account. Keep production data out of deletion tests.

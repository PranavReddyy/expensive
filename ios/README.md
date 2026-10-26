# Expens\*\*\* for iOS

A native SwiftUI app with the web app's monochrome styling, IBM Plex Mono, and original icon. Liquid Glass is used for navigation and controls; balances and charts stay clear and readable.

[Apple Watch companion and testing](WATCH.md): quick expense logging, your balance, and recent expenses on your wrist.

Home, Expenses, Analytics, and Tabs use the same Supabase email/password account and Expensive username as the web app. Includes profile transfers, historical periods, categories, inline person search, equal/custom-amount splits, and partial settlements. Follow the [Supabase cutover guide](../docs/supabase-auth.md) before deploying this release.

Switch accounts with the scrolling name strip on any tab; the selected account stays visible, with a menu for accessibility text sizes. Analytics includes touch-to-inspect spending/cumulative charts, daily averages, category shares, the three largest expenses, completed no-spend days, and a pace-based estimate for ongoing periods. Historical periods show actual totals, and comparisons are explicitly against the previous full period. Use “back to this month” (or the selected period) to return to the present.

Home keeps the same boxed balance as Tabs, with a compact spending summary. Tap the account icon at the top left for your details, sign-out, and preferred currency. Currency is a display-symbol preference saved per account on this device: it never converts or changes stored amounts. Owed/owing details retain their space while loading so the balance layout does not jump.

Profiles and their ledgers load in parallel and are published together. Returning launches restore their Keychain Supabase session and owner-scoped saved snapshot immediately, allowing local expense drafts offline. Server requests still require a valid Supabase token and RLS authorization. Then balances and recently viewed expense periods refresh in the background. Snapshots expire after 24 hours and are cleared on sign-out and money changes. Profile switching uses the already-loaded ledger immediately. First launches still require network data.

Account settings includes System, Light, and Dark appearance, saved on this device. Screens and charts use adaptive monochrome colors; primary glass actions stay black with white labels. Returning-user startup restores the local session without a blocking bootstrap call; expired tokens refresh before network operations. Only outstanding debts are fetched. Foreground refreshes skip data less than 10 seconds old, periodic refresh runs every 15 seconds while active, and pull-to-refresh/manual changes still update immediately.

Entry forms focus their first text input after opening. Return advances to the next input (skipping pickers); decimal keyboards have Next/Done buttons above the keyboard. Done finishes editing without submitting a payment. Primary actions use explicit contrasting fills and labels in both themes.

## Run

Complete the [Supabase cutover](../docs/supabase-auth.md) last. The older operation scripts below are prerequisites for the existing database, not scripts to rerun after cutover.

Requires Xcode 26 or newer and iOS 26 or newer.

Before using balance editing or payment history, run [activity-history.sql](Database/activity-history.sql) in the Supabase SQL Editor **after** the Firebase migration. This adds owner-private logs and atomic, retry-safe balance/payment/undo operations without changing existing balances. The build does not apply it automatically. New web and iOS payments share the same history; settlements made before this update cannot be reconstructed.

1. From the repository root, run `node ios/scripts/configure.mjs --force` after filling in the root `.env`. This copies the public Supabase settings, and HTTPS app URL into an ignored Xcode configuration. Never use a service-role key in iOS.
2. Apply [native-operations.sql](Database/native-operations.sql) in your existing Supabase project's SQL Editor. It adds transactional expense operations and duplicate-request protection; it does not reset existing data. The existing multi-user RLS policies and `add_tab`, `settle_tab`, and `transfer_money` functions must already be installed.
3. Open `ios/Expensive.xcodeproj`, select the **Expensive** scheme and an iPhone simulator, and Run. For a physical device, select your signing team in Signing & Capabilities.
4. Sign in with your username or email and password. Signup checks username availability; verify your email and confirm the name to reserve it. Existing users must reset their password using their original email after the account migration.

For manual configuration, copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`. Keep the URL escaping shown in that example. If you change `project.yml`, regenerate with `xcodegen generate --spec ios/project.yml` from the repository root.

## Behavior

### Latest controls

- Primary actions use one black-tinted glass capsule with white text; toolbar glass behind them is hidden.
- Category chips scroll horizontally. Nothing is selected initially; tap a selected chip again to clear it. In Log Expense, no selection saves as uncategorized; on Expenses it shows all categories.
- Expenses can be sorted newest first (default), oldest first, high to low, or low to high, alongside the existing period/category/search filters.
- Custom splits automatically calculate the one remaining blank share; explicit amounts are never overwritten. Adjust the other shares and the remainder follows.
- On **Record payment → On me.**, take a net amount owed to you as personal spending. This clears that amount and creates an expense without deducting cash twice: money originally paid for someone already left your balance. History supports the same safe undo.

Before using **On me.**, run [on-me.sql](Database/on-me.sql) after `activity-history.sql`. Existing records are not changed by installing it. It is not applied automatically.

While active, the app listens for realtime database changes, batches updates, and keeps cached expense rows visible during refresh. A 60-second fallback covers missed events; pull-to-refresh is also available. Network latency still applies. See [the upgrade guide](../docs/upgrades.md) for the new migrations and release checks.

### Back Tap / Shortcuts

1. Install the updated app and open it once.
2. In Apple's **Shortcuts** app, create a shortcut and add **Expens*** → Log Expense** (search “Log Expense”). Save it as “Quick Expense”.
3. Open **Settings → Accessibility → Touch → Back Tap → Double Tap**, and select **Quick Expense** under Shortcuts.

The action opens Home and the existing expense form, using your selected profile and normal keyboard/saving flow. Unlock/sign in if prompted; the form waits for authentication and account data. With no profile, create one first. It never records money automatically. Existing Home drafts aren't replaced, repeated taps don't create duplicate expenses, and pending launches expire after five minutes. Other open sheets may need to be dismissed first. Back Tap must be configured by each user and tested on a physical iPhone; it is not configurable by the app. See [Apple's Back Tap guide](https://support.apple.com/en-ph/guide/shortcuts/apd897693606/ios).

### Money and data

In Log Expense, tap a profile in the compact horizontal row above the fields. Swipe sideways for more profiles; the selected one is highlighted. Your draft stays intact and your main account selection is unchanged. The row appears when you have more than one profile, including when opening from Shortcuts.

- Edit balance offers Set, Add, and Subtract. Adjustments change your recorded balance, not spending.
- The small history button in Tabs shows balance adjustments and payments recorded by this iOS version. Undo restores a payment's tab amounts and balance and removes its generated expense. Changed records block undo; undo newer payments first. Older settlements cannot be reconstructed.
- Your current balance is primary. Tabs show what is owed in each direction and the balance after settlement.
- Recording money paid for someone reduces your balance immediately. Money you owe is deducted and saved as an expense when paid.
- Transfers move recorded balances between your profiles, not real money, and do not count as spending.
- Data refreshes on foreground, pull-to-refresh, realtime events and a 60-second fallback. New expenses are saved in a durable per-account outbox before sending; pending totals do not change the confirmed balance. Restoring a verified session still needs connectivity.
- Expense details now include Edit. Account settings includes recurring schedules, category management, CSV exports, and deletion of Expensive data (not the Expensive sign-in). Recurring occurrences are reviewed before recording; no automatic deductions or push reminders.
- Sessions stay in the device Keychain. Financial snapshots use disposable, file-protected device cache storage (not backups); the app obscures its content in the app switcher. Server-side RLS remains the access boundary.
- This is not a bank connection or a payment service.

## Verify

Run **Product → Test** in Xcode for money, dates, decoding, and tab calculations. Run `node --test ios/Database/native-operations.test.mjs` for isolated database tests (requires the root npm dependencies).

The simulator build and automated tests do not replace a live Supabase sign-in and a real-device check before distribution. No live database migrations are applied by the build.

Liquid Glass implementation follows [Apple's SwiftUI guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views). Bundled IBM Plex Mono is licensed under the [SIL Open Font License](Expensive/Fonts/OFL.txt).

### Quick Tabs and custom splits

The Log Expense form (including Shortcuts/Back Tap) has compact **Tabs** and **Split** buttons on the left above the keyboard, in a glass capsule matching **Next / Done** on the right. Tap a text field to show these controls. They open the existing add-amount/split form using the chosen expense profile, amount and reason. Cancelling returns to the untouched expense draft. Saving a tab/split closes the quick-entry flow without also saving an expense. Expense-only fields such as date, category and notes are not applied to tab entries.

Split offers **Equal** or **Custom amounts**. Custom mode accepts a positive amount for each selected person and an optional own share (zero allowed). The unassigned/excess amount is visible; saving requires all shares to exactly match the total, with at most two decimal places. The existing transactional tab endpoint records the full payment and only your own share as an expense. No database change is needed.

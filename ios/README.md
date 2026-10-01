# Expens\*\*\* for iOS

A native SwiftUI app with the web app's monochrome styling, IBM Plex Mono, and original icon. Liquid Glass is used for navigation and controls; balances and charts stay clear and readable.

Home, Expenses, Analytics, and Tabs use the same Firebase email/password account and shared username as the web app. Includes profile transfers, historical periods, categories, inline person search, equal splits, and partial settlements. Follow the [shared authentication guide](../docs/shared-auth.md) to configure Firebase, Resend, and the Supabase migration first.

Switch accounts with the scrolling name strip on any tab; the selected account stays visible, with a menu for accessibility text sizes. Analytics includes touch-to-inspect spending/cumulative charts, daily averages, category shares, the three largest expenses, completed no-spend days, and a pace-based estimate for ongoing periods. Historical periods show actual totals, and comparisons are explicitly against the previous full period. Use “back to this month” (or the selected period) to return to the present.

Home keeps the same boxed balance as Tabs, with a compact spending summary. Tap the account icon at the top left for your details, sign-out, and preferred currency. Currency is a display-symbol preference saved per account on this device: it never converts or changes stored amounts. Owed/owing details retain their space while loading so the balance layout does not jump.

Profiles and their ledgers load in parallel and are published together. Returning launches show an owner-scoped, read-only saved snapshot immediately while the account is verified. Controls and financial reads stay blocked until verification succeeds; failure removes the preview. Then balances and recently viewed expense periods refresh in the background. Snapshots expire after 24 hours and are cleared on sign-out and money changes. Profile switching uses the already-loaded ledger immediately. First launches still require network data.

Account settings includes System, Light, and Dark appearance, saved on this device. All screens, charts, sheets, and controls use adaptive monochrome colors. Returning-user startup validates the saved session through the server without repeating onboarding; expired tokens still refresh normally. Only outstanding debts are fetched. Foreground refreshes skip data less than a minute old, periodic refresh runs every two minutes while active, and pull-to-refresh/manual changes still update immediately.

Entry forms focus their first text input after opening. Return advances to the next input (skipping pickers); decimal keyboards have Next/Done buttons above the keyboard. Done finishes editing without submitting a payment. Primary actions use explicit contrasting fills and labels in both themes.

## Run

Requires Xcode 26 or newer and iOS 26 or newer.

Before using balance editing or payment history, run [activity-history.sql](Database/activity-history.sql) in the Supabase SQL Editor **after** the Firebase migration. This adds owner-private logs and atomic, retry-safe balance/payment/undo operations without changing existing balances. The build does not apply it automatically. New web and iOS payments share the same history; settlements made before this update cannot be reconstructed.

1. From the repository root, run `node ios/scripts/configure.mjs --force` after filling in the root `.env`. This copies the public Supabase settings, Firebase Web API key, and HTTPS service URLs into an ignored Xcode configuration. Never use a service-role key in iOS.
2. Apply [native-operations.sql](Database/native-operations.sql) in your existing Supabase project's SQL Editor. It adds transactional expense operations and duplicate-request protection; it does not reset existing data. The existing multi-user RLS policies and `add_tab`, `settle_tab`, and `transfer_money` functions must already be installed.
3. Open `ios/Expensive.xcodeproj`, select the **Expensive** scheme and an iPhone simulator, and Run. For a physical device, select your signing team in Signing & Capabilities.
4. Sign in with your username or email and password. Signup checks username availability; verify your email and confirm the name to reserve it. Existing email-code users must create their Firebase account with the same email and verify it to recover their records.

For manual configuration, copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`. Keep the URL escaping shown in that example. If you change `project.yml`, regenerate with `xcodegen generate --spec ios/project.yml` from the repository root.

## Behavior

- Edit balance offers Set, Add, and Subtract. Adjustments change your recorded balance, not spending.
- The small history button in Tabs shows balance adjustments and payments recorded by this iOS version. Undo restores a payment's tab amounts and balance and removes its generated expense. Changed records block undo; undo newer payments first. Older settlements cannot be reconstructed.
- Your current balance is primary. Tabs show what is owed in each direction and the balance after settlement.
- Recording money paid for someone reduces your balance immediately. Money you owe is deducted and saved as an expense when paid.
- Transfers move recorded balances between your profiles, not real money, and do not count as spending.
- Data refreshes on foreground, pull-to-refresh, after changes, and every two minutes while active. There is no offline write queue.
- Sessions stay in the device Keychain. Financial snapshots use disposable, file-protected device cache storage (not backups); the app obscures its content in the app switcher. Server-side RLS remains the access boundary.
- This is not a bank connection or a payment service.

## Verify

Run **Product → Test** in Xcode for money, dates, decoding, and tab calculations. Run `node --test ios/Database/native-operations.test.mjs` for isolated database tests (requires the root npm dependencies).

The simulator build and automated tests do not replace a live Firebase sign-in and a real-device check before distribution. No live database migrations are applied by the build.

Liquid Glass implementation follows [Apple's SwiftUI guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views). Bundled IBM Plex Mono is licensed under the [SIL Open Font License](Expensive/Fonts/OFL.txt).

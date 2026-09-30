# Expens\*\*\* for iOS

A native SwiftUI app with the web app's monochrome styling, IBM Plex Mono, and original icon. Liquid Glass is used for navigation and controls; balances and charts stay clear and readable.

Home, Expenses, Analytics, and Tabs use the same Firebase email/password account and shared username as the web app. Includes profile transfers, historical periods, categories, inline person search, equal splits, and partial settlements. Follow the [shared authentication guide](../docs/shared-auth.md) to configure Firebase, Resend, and the Supabase migration first.

## Run

Requires Xcode 26 or newer and iOS 26 or newer.

1. From the repository root, run `node ios/scripts/configure.mjs --force` after filling in the root `.env`. This copies the public Supabase settings, Firebase Web API key, and HTTPS service URLs into an ignored Xcode configuration. Never use a service-role key in iOS.
2. Apply [native-operations.sql](Database/native-operations.sql) in your existing Supabase project's SQL Editor. It adds transactional expense operations and duplicate-request protection; it does not reset existing data. The existing multi-user RLS policies and `add_tab`, `settle_tab`, and `transfer_money` functions must already be installed.
3. Open `ios/Expensive.xcodeproj`, select the **Expensive** scheme and an iPhone simulator, and Run. For a physical device, select your signing team in Signing & Capabilities.
4. Sign in with your username or email and password. Signup checks username availability; verify your email and confirm the name to reserve it. Existing email-code users must create their Firebase account with the same email and verify it to recover their records.

For manual configuration, copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`. Keep the URL escaping shown in that example. If you change `project.yml`, regenerate with `xcodegen generate --spec ios/project.yml` from the repository root.

## Behavior

- Your current balance is primary. Tabs show what is owed in each direction and the balance after settlement.
- Recording money paid for someone reduces your balance immediately. Money you owe is deducted and saved as an expense when paid.
- Transfers move recorded balances between your profiles, not real money, and do not count as spending.
- Data refreshes on foreground, pull-to-refresh, after changes, and every 30 seconds while active. There is no offline write queue.
- Sessions stay in the device Keychain. Financial data is cached only in memory; the app obscures its content in the app switcher. Server-side RLS remains the access boundary.
- This is not a bank connection or a payment service.

## Verify

Run **Product → Test** in Xcode for money, dates, decoding, and tab calculations. Run `node --test ios/Database/native-operations.test.mjs` for isolated database tests (requires the root npm dependencies).

The simulator build and automated tests do not replace a live Firebase sign-in and a real-device check before distribution. No live database migrations are applied by the build.

Liquid Glass implementation follows [Apple's SwiftUI guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views). Bundled IBM Plex Mono is licensed under the [SIL Open Font License](Expensive/Fonts/OFL.txt).

# Expens*** on Apple Watch

A small companion: horizontal profile chips, a boxed balance, five recent expenses, and **+ log expense**. Same monochrome theme and existing app icon. No separate Watch login or credentials. The phone now uses Supabase; finish the [auth cutover](../docs/supabase-auth.md) before updating it.

Swipe the profile strip left/right to choose an account, on the home screen or while logging. This does not change the iPhone's selected profile. Cached balances appear immediately; recent expenses refresh through the phone. Choose an optional category from the horizontal chips when logging; tap it again to clear it. Saved drafts retain their chosen profile and category when retried.

Tap **amount** for a numeric keypad with a decimal point and backspace. It allows up to two decimal places. **done** returns to the form without saving the expense; **save** submits it.

Glass is limited to Back/Done navigation controls. Balance cards, profile/category chips, and the number pad keep solid monochrome surfaces for readability.

## Try it on your Series 10

Your watchOS 27.0.1 watch is compatible (target minimum: watchOS 26). Keep the watch unlocked near the paired iPhone, enable Bluetooth/Wi-Fi, and connect the iPhone to the Mac. Developer Mode must be enabled on both.

1. Open `Expensive.xcodeproj`. The project includes **ExpensiveWatch** and embeds it in the iPhone app. Both targets must use the same signing team. The existing project team is preserved in `project.yml`.
2. Choose **Expensive → your iPhone**, then Run to update the companion. Do not uninstall the existing app; that can remove unsynced drafts.
3. In the iPhone's **Watch** app, find Expens*** under Available Apps and install it if it has not installed automatically. Alternatively select **ExpensiveWatch → your Watch** in Xcode and Run.
4. Open Expens*** on iPhone, sign in, and select your profile. Open the Watch app and tap **refresh**. Check the profile name, balance and recent expenses against the phone.
5. For a money-changing test, use a disposable profile, log a small test amount from the watch, and verify exactly one expense appears on the phone/web. Delete that test expense from Expenses afterward to restore the test profile's balance. Nothing is charged or transferred through a bank.

If Xcode loses the watch connection, unlock both devices, keep them nearby and check **Window → Devices and Simulators**. Signing/provisioning errors must be resolved for both bundle IDs, including `com.itsbypranav.expensive.watchkitapp`.

## What “saved” means

- Cached viewing is immediate, not a live bank balance. The updated time is always shown. The cache is file-protected and not backed up; launch ignores snapshots older than 24 hours.
- Saving first writes a local Watch draft with a stable request ID. **Queued on iPhone** means the iPhone has durably accepted it—not that the server has confirmed it. Check pending expenses on iPhone for sync failures.
- If the phone is unavailable, the draft stays on the watch. Open the iPhone app, then tap **retry pending expense**. Retry the same draft, rather than logging it again. Duplicate requests use the existing server-side expense receipts.
- Only one unacknowledged Watch draft is allowed, keeping the flow unambiguous. A draft stays attached to its original account/profile. Switch back to that account on iPhone to retry it.
- Logging requires the paired iPhone's verified session. This version is not a standalone cellular Watch client, does not have a complication, and cannot guarantee instant delivery while iOS suspends the companion. No credentials are copied to the watch.
- Sign-out/account changes send a cleared/new snapshot when connectivity permits. An unreachable watch can retain its old cached view until reconnecting; it cannot submit to a different account.

## Checks before everyday use

Compare balance/recent entries, save once, retry after interrupted connectivity, relaunch with a pending draft, switch phone profiles/accounts, and confirm no duplicate expense or cross-account write. Real-device communication must be tested: simulator builds alone do not verify [Watch Connectivity delivery](https://developer.apple.com/documentation/watchconnectivity/transferring-data-with-watch-connectivity).

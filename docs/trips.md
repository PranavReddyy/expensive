# Trips

On **Home**, tap the **suitcase icon beside Transfer** to open Trips. Choose a profile and create a trip with dates, an optional total budget and participants. Trips stays out of the main tab bar to keep navigation spacious. Search existing people or add someone inline. You are included automatically.

Each trip can have two independent budgets: **overall budget** for full bills, and **personal budget** for your allocated share regardless of who paid. Set or edit either one using an amount or `=` calculation; blank/zero means no limit. Both appear on trip cards, the summary and statistics, with remaining/over-budget amounts in the detail views. Budgets are planning limits—not deductions from your balance. Existing trips start with no personal budget set.

Previously viewed trips appear from account-scoped cache while refreshing. First-time loads use quiet placeholders rather than showing temporary zero balances. iOS keeps this trip cache in memory and clears it when the session ends; network operations still depend on your connection.

Log the total bill, choose who paid, then select who shares it. Equal splits preserve every cent. For custom splits, leave one share blank to calculate the remainder. Categories are optional.

Amount fields also accept calculations starting with `=`, such as `=(120+80)/2`. Use `+`, `-`, `*` and `/` (or `×` and `÷`). The final result is rounded to two decimals and saved as the amount. This works for ordinary expenses, balances, transfers, Tabs, budgets and custom shares too. On Watch, tap `=` on the amount keypad to enable its arithmetic buttons.

- **You paid:** the whole payment leaves the selected profile. Your share is an expense; other shares become amounts owed to you in Tabs.
- **Someone else paid:** your share becomes an amount you owe that person. Your balance is unchanged until you record payment in Tabs, which also records the expense.
- **Settlement:** the trip shows its remaining debts. Open Tabs to record payments or use its existing history/undo controls. Tabs settle the combined balance with a person, including non-trip amounts; they are not a separate trip-only payment ledger.

Tap a trip expense row to edit its description, total, payer, category or shares. Saving updates its linked expense, Tabs and profile balance together, while keeping the original date. Repeated saves cannot duplicate the bill. If linked records were settled, undo those payments first. Separately edited or deleted ledger records cannot be overwritten; older bills whose links cannot be safely identified also cannot be edited.

Equal shares reopen in equal-split mode, including a one-cent rounding difference; unequal shares reopen as custom. Trip forms have Next/Done controls above the keyboard. Tap the **chart icon beside Log expense and ⋯** for trip statistics: budget usage, bill count, average bill, spending per scheduled day, full-bill category totals, participants’ upfront payments and allocated shares, open Tabs and largest bills. Participant allocations are not a settlement ledger between other people.

Find **Delete expense** at the bottom of its edit form. It reverses that bill’s cash movement and removes its linked expense and open Tabs, only when those records are unchanged. **Delete trip**, at the bottom of **Edit trip**, removes the trip and bill summaries but keeps recorded expenses, balances and Tabs. Both require confirmation and cannot be undone. Delete individual bills first if you want their financial effects reversed too.

The budget covers total bills, not just your share. Finishing a trip stops new entries and edits; reopen it to make changes. It does not settle any debt. Editing a corresponding expense directly on the Expenses page does not rewrite the trip bill.

Trips are private to your account. There are no invitations, conversions, automatic bank payments, or debts between other participants. Trip writes currently require a connection; the existing offline queue remains for ordinary expense logging.

## Profile deletion

Open account settings → **manage profiles**. Choose a profile and type its exact name. Export anything needed first. Deletion removes its balance, expenses, recurring schedules, settled Tabs, trips and linked transfer history. It does not reverse transfers or change another profile’s balance. Open Tabs must be resolved first. Sync pending expenses on **every** device before deleting; offline drafts on another device cannot be detected remotely.

## Database updates

Apply the current `supabase-trips.sql`, then `supabase-trip-editing.sql`, then `supabase-trip-deletion.sql`. The editing migration links untouched legacy bills when their ledger records can be identified unambiguously; installation does not change existing balances or delete financial entries.

Apply `supabase-trip-budgets.sql` after those migrations to enable personal budgets. Older app versions can still edit trip details without clearing a saved personal budget.

# Expens\*\*\*

A small expense tracker you set up yourself. Keep an eye on what you have, what you spent, and what is still owed. Built with Next.js and Supabase.

![Expens*** icon](public/icon-192.png)

## What it does

- **Home:** See your current balance, today's and this month's spending, a seven-day chart, and your top categories. Create separate profiles for different pools of money and transfer between them.
- **Expenses:** Log a purchase with a reason, amount, date, and optional category or note. Browse by day, week, month, or year, and move or delete an entry.
- **Analytics:** Look back through spending periods and see where the money went.
- **Tabs:** Keep a running total for each person who owes you or whom you owe. Split a payment with several people and record payments when they happen.

Logging an expense reduces that profile's balance. Moving money between your own profiles does not count as spending. Tabs change the balance when you lend or receive money, or when you record a payment you owe.

## What it doesn't do

It does not connect to your bank, import transactions, send payment requests, or move real money. Balances are numbers you maintain in the app. Profiles are your own money buckets, not separate user accounts.

## Where your data lives

You connect Expens\*\*\* to **your own Supabase project**. Expense and Tabs records are stored there; there is no shared Expens\*\*\* database collecting everyone's data.

**Privacy limit:** The current SQL uses open database policies, and the simple app login does not secure the Supabase API. Someone with your project URL and public key could access its records. This setup cannot promise that only you can see your data. Before putting sensitive information in it or publishing it online, add real user authentication and restrictive [row-level security policies](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Get started

You'll need Node.js 18.17+ and a [Supabase](https://supabase.com) project.

1. In your Supabase project's **SQL Editor**, run [`supabase-schema.sql`](supabase-schema.sql).
2. Copy `.env.example` to `.env.local`. Set a login name and password, then paste your Supabase **Project URL** and **publishable/anon key** from **Project Settings → API**. Do not use the service role key.
3. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

Open [localhost:3000](http://localhost:3000), sign in, and create your first profile.

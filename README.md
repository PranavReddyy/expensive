# expensive

personal expense tracker — next.js + supabase

---

## setup

### 1. supabase

1. create a project at [supabase.com](https://supabase.com)
2. go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. go to **Project Settings > API** and copy your URL and anon key

### 2. environment variables

copy `.env.example` to `.env.local` and fill in:

```env
AUTH_USERNAME=admin
AUTH_PASSWORD=yourpassword

NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. install and run

```bash
npm install
npm run dev
```

open [http://localhost:3000](http://localhost:3000)

---

## features

- **fixed login** — credentials set in `.env.local`
- **profiles** — create multiple profiles, each with their own balance
- **log expenses** — reason, amount, optional notes, auto timestamp
- **balance tracking** — balance updates automatically when you log expenses
- **edit balance** — manually set balance (for top-ups etc.)
- **expenses page** — view all expenses with day/week/month/year/all filters
- **transfer** — move an expense from one profile to another (balances auto-adjust)
- **delete** — delete expense and restore balance
- **analytics** — bar chart + top reasons breakdown with period filters
- **realtime** — all data syncs in realtime across the app

---

## notes

- balances decrease when you log an expense
- transferring an expense: source profile gets the money back, target gets it deducted
- the `supabase_realtime` publication must include both tables (run the schema SQL)

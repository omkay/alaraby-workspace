# مساحة عمل العربي — Alaraby launch workspace

A shared, Arabic, phone-friendly workspace for the team opening the Alarabyicecream store in Daraa:

- **المهام (Tasks)** — stages and tasks with owners, statuses, expected dates, and a link to a cost item.
- **التكاليف (Costs)** — cost items, payment log, totals by stage and category, deposit balance and expected surplus/shortfall. Download to Excel.
- **التحديثات (Updates)** — a feed for updates, ideas and notes.

Team members open the site, pick their name and type the password they were given. No account sign-up.

## How it's built

- Static site (`index.html`, `styles.css`, `app.js`, `config.js`) hosted free on GitHub Pages.
- Data, login and live sync on a free Supabase project (`alaraby-planner`, Frankfurt).
- Every table has row-level security: only people on the `members` list who are signed in can read or write. The key in `config.js` is the public anon key and is safe to publish.

## Adding a person

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**. Use their email from the `members` table (for example `baraa@alarabyicecream.com`), set a password, and tick **Auto Confirm User**.
2. To add someone new, also add a row to the `members` table with their name and the same email.

Keep **Authentication → Sign In / Providers → Email → Allow new users to sign up** turned **off**, so only people you create can sign in.

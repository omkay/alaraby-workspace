# مساحة عمل العربي — Alaraby launch workspace

A shared, Arabic, phone-friendly workspace for the team opening the Alarabyicecream store in Daraa:

- **المهام (Tasks)** — stages and tasks with owners, statuses, expected dates, and a link to a cost item.
- **التكاليف (Costs)** — cost items, payment log, totals by stage and category, deposit balance and expected surplus/shortfall. Download to Excel.
- **التحديثات (Updates)** — a feed for updates, ideas and notes.
- **السجل (Log)** — admin only. Who signed in, who opened the app, and every add, edit and delete, with the old and new values.

Team members open the site, pick their name and type the password they were given. No account sign-up.

## How it's built

- Static site (`index.html`, `styles.css`, `app.js`, `config.js`) hosted free on GitHub Pages.
- Data, login and live sync on a free Supabase project (`alaraby-planner`, Frankfurt).
- Every table has row-level security: only people on the `members` list who are signed in can read or write. The key in `config.js` is the public anon key and is safe to publish.

## Adding a person

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**. Use their email from the `members` table (for example `baraa@alarabyicecream.com`), set a password, and tick **Auto Confirm User**.
2. To add someone new, also add a row to the `members` table with their name and the same email.

Keep **Authentication → Sign In / Providers → Email → Allow new users to sign up** turned **off**, so only people you create can sign in.

## Admin and the activity log

- `members.role` is `admin` or `member`. Only admins see the **السجل** tab and can read `activity_log`. Nobody can change roles from the app; change them in the Supabase table editor.
- Data changes are written by a database trigger (`public.log_change`) on every table, so they can't be skipped or faked from the browser. Sign-ins come from a trigger on `auth.sessions` (`public.log_login`). The app also adds an "opened the app" entry at most every 30 minutes per person.
- The log is append-only: no one can edit or delete entries through the app or the API.

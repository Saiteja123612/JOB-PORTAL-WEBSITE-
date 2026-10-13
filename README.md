# Pathway job portal

An Express.js / Node.js job portal with a vanilla HTML/CSS/JavaScript frontend and persistent SQLite storage. No React, Next.js, or Django dependency.

## Run locally

Requires Node.js 22.13+ (tested on Node 26).

```powershell
cd D:\MYSELF\job-portal
npm install
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000. Local development starts with 42 clearly labeled sample jobs across 24 companies and 13 career paths. Users register through **Create account**. No default accounts or passwords are installed. `npm test` runs isolated API tests without modifying the portal database.

## Features

- Public job search by keyword, location, category, and salary sorting.
- Job Seeker panel: saved jobs, applications with HTTPS resume links and cover letters, application status tracking, and career chatbot.
- Employer panel: company registration, owned job listings, applicant review, and status updates. Employers cannot access another employer’s applicants or edit their jobs.
- Admin panel: publish/close/reopen listings, inspect candidate applications, update status, view registered users and Google Sheets sync status.
- JWT login/signup using an HttpOnly, SameSite cookie; bcrypt password hashes; server-side role checks; schema validation; request-origin checks; rate limits; security headers.
- Signup records persist in a SQLite outbox and sync automatically to Google Sheets when configured. Failed attempts retry every minute while the server runs.
- Floating bottom-right chat assistant, available on every page including before login. The browser uses a rate-limited portal endpoint; the server-to-server n8n proxy is authenticated. Secrets never reach frontend JavaScript. Without n8n configuration, it provides clearly labeled built-in answers about hiring, signup, applications, saved jobs, and current listings. Free-form AI answers require the n8n credentials.

## Create an administrator

Set `ADMIN_PASSWORD` in your terminal session to a unique password of 12–72 UTF-8 bytes, then run:

```powershell
npm run admin -- admin@example.com "Portal Admin"
Remove-Item Env:ADMIN_PASSWORD
```

Open Job Seeker login → Administrator sign in, then use that email/password. The Admin panel appears only for administrators. The command promotes an existing matching account and resets its password if the email already exists; use an email you intend to administer. Public signup never accepts an admin role.

## Employer and Job Seeker accounts

- **For employers** opens Employer login. Create an Employer account with a company name to access the Hiring dashboard, post positions, and review only applicants for your own listings. Company ownership comes from the authenticated account, never from client-supplied IDs.
- **Job Seeker login** opens candidate login. Create a Job Seeker account to save jobs, apply with a resume link, and track progress. Employers and administrators cannot apply as candidates.
- Login checks the selected account type; choosing a different portal does not change account permissions. Use separate email addresses for separate account types.
- Existing `user` accounts automatically migrate to `job_seeker`; their saved jobs and applications stay intact. Administrator credentials are preserved. Existing unowned listings remain managed by the administrator.
- Both signup types queue their account role in Google Sheets. The floating chat panel stays open while navigating and can be minimized with its close button, the robot launcher, or Escape.

## Google Sheets setup

1. In a Google Cloud project, enable the Google Sheets API and create a service account. Store its JSON key securely outside this project.
2. Create a spreadsheet with a dedicated tab named `Signups`. Share the spreadsheet with the service account email as **Editor**.
3. In `.env`, set `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB=Signups`, and `GOOGLE_APPLICATION_CREDENTIALS` to the absolute key-file path. Restart the server.
4. Register a user. The header and user row are written automatically. Existing queued signups also sync. Admin → Registered users shows `pending`, `failed`, or `synced`; **Retry Sheets sync** triggers an immediate attempt.

Columns: User ID, Name, Email, Role, Signed up at (UTC). Passwords, hashes, JWTs, resumes, and application text are never sent to Sheets. Values use `RAW` to avoid treating user input as formulas.

This integration owns the dedicated Signups tab: user ID N always writes to row N+1, so retries cannot create duplicate rows. Do not insert/delete/reorder rows or sort that tab in place; use a filter view or a separate reporting tab. Keep the database and sheet paired; a fresh database needs a fresh tab. Ensure the tab has enough rows for your expected registrations. The administrator creation CLI does not queue administrator records.

See Google's [write-values documentation](https://developers.google.com/workspace/sheets/api/guides/values).

## n8n AI chatbot setup

1. Import `n8n/career-assistant.json` into n8n.
2. On **Career Chat**, create a Header Auth credential with name `X-Webhook-Secret` and a strong random value. Use the same value for `N8N_WEBHOOK_SECRET` in the portal's `.env`.
3. On **Career AI**, select an HTTP Header Auth credential named `x-goog-api-key`, with your Gemini API key as its value. Select a currently available Gemini generateContent model in the request URL if your account does not have access to the included example model.
4. Publish/activate the workflow. Copy its **Production URL** into `N8N_CHAT_WEBHOOK_URL`. Restart the portal.
5. Click the circular robot button at the bottom-right → send a message (sign-in is optional). The workflow receives the message, a server-derived user ID or a random guest request ID, and up to 30 current job summaries. It returns `{ "reply": "..." }`.

Workflow: authenticated Webhook → Gemini HTTP request → Respond to Webhook. The example handles individual questions; it does not persist conversation memory. The session ID is available if you later add a memory node. Portal timeouts and upstream errors are displayed as errors, never fabricated AI replies. The included workflow disables success/error execution-data saving; review your n8n instance's retention policy too.

References: [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [Gemini API](https://ai.google.dev/api).

## Configuration and deployment

`.env.example` lists every setting. Development uses a random JWT signing key when none is configured, so restarting signs users out. For a persistent login across restarts, set `JWT_SECRET` to a randomly generated secret of at least 32 characters.

For deployment, use a Node host with persistent disk and one application instance. Set `NODE_ENV=production`, a strong persistent `JWT_SECRET`, `APP_ORIGIN` to the public HTTPS origin, and `SEED_DEMO=false`. The server binds to loopback; place a TLS reverse proxy on the same host in front of it. Configure proxy trust deliberately if you need forwarded client IPs. Do not deploy this stateful Express server to static-only or Worker-only hosting. Back up the SQLite database consistently, including WAL state; do not copy a live database file alone.

JWTs expire after eight hours. Logout clears the browser cookie; this starter does not have a server-side token revocation list. Email verification, password recovery, resume file uploads, and multi-instance deployment are outside this implementation. Resume URLs are links only and are never fetched by the server.

## Verification

`npm test` covers signup, login, JWT tampering, cookie flags, rejection of role escalation, cross-origin requests, duplicate applications, application ownership, save/unsave, closed jobs, admin job creation and status updates, salary validation, the signup sync queue, n8n payload/reply handling, and required production secrets. External Google Sheets writes and n8n model execution require your credentials and are not claimed as live-tested.


## Expanded discovery and hiring features

- **Advanced filters:** keyword, location, career path, employer, work mode, employment type, years of experience, salary budget, and posting age. Results paginate nine at a time.
- **Private candidate profiles:** headline, skills, experience, work preference, expected salary, bio, portfolio and resume link. Saved resume links pre-fill applications. Profiles are not exposed through public company or employer endpoints.
- **Explainable matching:** cards show exact, case-insensitive skill-name overlap. Candidates can sort by matched-skill count and apply their saved preferences. This is not an AI ranking or a prediction of hiring outcomes.
- **Company directory:** searchable company cards and company-specific job lists, generated from currently open listings. No invented ratings or verification badges.
- **Compare up to three jobs:** salary budget, location, work style, experience, employment type, and skills.
- **Saved searches:** filters persist per account; current matches refresh when the page is opened. These are in-app saved searches, not email or background alerts.
- **Application timelines and activity:** submissions and every actual status change are recorded. Candidates can view only their own events.
- **Employer and admin editing:** update an existing listing, including the expanded work-mode and experience fields. Employer ownership checks also apply to edits.
- **Applicant pipeline:** search by candidate/role and filter by hiring stage.
- **Shareable job links:** Copy job link opens a specific active job through the `?job=ID` query parameter.

The 36 new openings and 18 new companies are fictional demonstration data. The six original company-name examples are also labeled demo openings. Salaries are example annual INR budgets. With `SEED_DEMO=false`, new production databases are empty; existing demonstration data is not automatically deleted. Expansion is recorded once per database, preserving existing accounts, applications, and employer listings. A real marketplace needs employers to post and maintain actual vacancies; no Naukri feed, recruitment partnership, or production-scale superiority is claimed.

Additional tests verify catalog idempotency, private profile isolation, saved-search ownership and combined filters, secure listing edits, and application event access. Browser QA uses an isolated in-memory database and covers comparison, profile saving, skill-based discovery, saved searches, resume prefill, timelines, company browsing, job edits, and applicant filtering.

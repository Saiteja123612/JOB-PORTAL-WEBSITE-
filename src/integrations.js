import { GoogleAuth } from 'google-auth-library';

export function createIntegrations(db, env, dependencies = {}) {
  let syncing = false;
  const sheetsReady = Boolean(env.GOOGLE_SHEET_ID && env.GOOGLE_APPLICATION_CREDENTIALS);
  const chatReady = Boolean(env.N8N_CHAT_WEBHOOK_URL && env.N8N_WEBHOOK_SECRET);
  const auth = dependencies.auth || (sheetsReady ? new GoogleAuth({ keyFile: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) : null);
  async function syncSignups() {
    if (!sheetsReady || syncing) return;
    syncing = true;
    try {
      const client = await auth.getClient();
      const tab = `'${(env.GOOGLE_SHEET_TAB || 'Signups').replaceAll("'", "''")}'`;
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values/`;
      await client.request({ url: `${base}${encodeURIComponent(`${tab}!A1:E1`)}?valueInputOption=RAW`, method: 'PUT', timeout: 15000, data: { values: [['User ID','Name','Email','Role','Signed up at (UTC)']] } });
      const rows = db.prepare("SELECT u.* FROM sheet_sync s JOIN users u ON u.id=s.user_id WHERE s.status != 'synced' LIMIT 50").all();
      for (const u of rows) {
        try {
          // Stable row per user makes retries idempotent; keep this dedicated tab unsorted.
          await client.request({ url: `${base}${encodeURIComponent(`${tab}!A${u.id + 1}:E${u.id + 1}`)}?valueInputOption=RAW`, method: 'PUT', timeout: 15000, data: { values: [[u.id,u.name,u.email,u.role,u.created_at]] } });
          db.prepare("UPDATE sheet_sync SET status='synced', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(u.id);
        } catch {
          db.prepare("UPDATE sheet_sync SET status='failed', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(u.id);
        }
      }
    } catch { console.warn('Google Sheets sync unavailable; queued signups will retry.'); }
    finally { syncing = false; }
  }
  async function chat(user, message) {
    if (!chatReady) {
      const text=message.toLowerCase();
      let reply='I can help with employer accounts, job applications, saved jobs, and application tracking. What would you like to do? Free-form AI answers will be available once the administrator connects n8n.';
      if (/compar/.test(text)) reply='Click “+ Compare” on up to three job cards, then choose Compare in the bottom tray. You can compare salary budgets, skills, location, experience, and work style side by side.';
      else if (/saved search|save.*search|alert/.test(text)) reply='Set filters in Discover jobs, then click “Save this search”. Your Job Seeker account keeps those filters under Saved searches, with current matching roles each time you visit. These are in-app searches; no email alerts are sent.';
      else if (/profile|skill match|portfolio/.test(text)) reply='Open My profile in your Job Seeker account to save skills, experience, preferred work style, and your resume link. Job cards show exact skill-name matches, and your resume link pre-fills applications. Your profile is private; skill matches are not hiring predictions.';
      else if (/compan/.test(text)&&!/employer|hire|hiring/.test(text)) reply='Open Explore companies to search by company name or career path. Choose Explore roles to see that company’s openings. Demo listings are clearly labeled and are not verified vacancies.';
      else if (/hire|hiring|employer|post.*job|edit.*job|company/.test(text)) reply='Choose “For employers” → “Create an account”, select Employer, and enter your company details. Your Hiring dashboard lets you post and edit jobs, search your applicants, filter hiring stages, and update application status.';
      else if (/apply|application|resume|job seeker/.test(text)) reply='Choose “Job Seeker login” and create a Job Seeker account. Open a job → “Apply for this role”, add an HTTPS resume link and a short introduction. Track progress under My applications.';
      else if (/save|bookmark/.test(text)) reply='Sign in as a Job Seeker and click the bookmark on any job card. Your shortlist appears under Saved jobs. Click the bookmark again to remove it.';
      else if (/login|sign in|sign up|account/.test(text)) reply='Choose Job Seeker if you want to apply for work, or Employer if you want to hire. Each account has its own workspace. Administrators can use “Administrator sign in” inside the login dialog.';
      else if (/remote|search|find|job|role/.test(text)) { const jobs=db.prepare("SELECT title,company,location FROM jobs WHERE active=1 AND (?=0 OR location='Remote') LIMIT 4").all(Number(text.includes('remote')));reply=jobs.length?'Here are some current listings:\n'+jobs.map(j=>`${j.title} at ${j.company} · ${j.location}`).join('\n')+'\nUse Discover jobs to filter and view the details.':'No matching listings right now. Check Discover jobs again later.'; }
      return { reply, connected:false };
    }
    const jobs = db.prepare('SELECT id,title,company,location,type,skills FROM jobs WHERE active=1 LIMIT 30').all();
    const response = await fetch(env.N8N_CHAT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': env.N8N_WEBHOOK_SECRET }, body: JSON.stringify({ message, sessionId: `user-${user.id}`, jobs }), signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error('Chat service unavailable');
    const data = await response.json();
    if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Invalid chat response');
    return { reply: data.reply.slice(0,12000), connected: true };
  }
  return { syncSignups, chat, sheetsReady, chatReady };
}

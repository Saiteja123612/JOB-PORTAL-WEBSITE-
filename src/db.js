import { migrateFeatures } from './features.js';
import { expandDemoCatalog } from './catalog.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createDb(filename = './data/portal.sqlite', seed = false) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, company TEXT NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, salary_min INTEGER NOT NULL, salary_max INTEGER NOT NULL, description TEXT NOT NULL, skills TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6759e8', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), job_id INTEGER NOT NULL REFERENCES jobs(id), cover_letter TEXT NOT NULL, resume_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Submitted', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, job_id));
    CREATE TABLE IF NOT EXISTS saved_jobs (user_id INTEGER NOT NULL REFERENCES users(id), job_id INTEGER NOT NULL REFERENCES jobs(id), PRIMARY KEY(user_id,job_id));
    CREATE TABLE IF NOT EXISTS sheet_sync (user_id INTEGER PRIMARY KEY REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
  `);
  // Additive migrations preserve existing accounts, applications, and admin access.
  if (!db.prepare('PRAGMA table_info(jobs)').all().some(c=>c.name==='employer_id')) db.exec('ALTER TABLE jobs ADD COLUMN employer_id INTEGER REFERENCES users(id)');
  if (!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='company')) db.exec("ALTER TABLE users ADD COLUMN company TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE sheet_sync SET status='pending' WHERE user_id IN (SELECT id FROM users WHERE role='user'); UPDATE users SET role='job_seeker' WHERE role='user'; CREATE INDEX IF NOT EXISTS jobs_employer ON jobs(employer_id);");
  migrateFeatures(db);
  if (seed && !db.prepare('SELECT id FROM jobs LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO jobs(title,company,location,type,category,salary_min,salary_max,description,skills,color) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const row of [
      ['Product Designer','Linear','Remote','Full-time','Design',1800000,2800000,'Help teams do their best work. Design thoughtful product experiences, take ideas from research to polished interfaces, and collaborate closely with engineering. You bring 3+ years of product design experience, a strong portfolio, and a love for simple solutions.','Figma,Product design,Prototyping','#665ae8'],
      ['Frontend Developer','Notion','Bengaluru','Full-time','Engineering',1600000,2600000,'Build fast, accessible web experiences for a collaborative workspace. Work with designers and backend engineers to ship well-tested features. Bring solid JavaScript, HTML, CSS, and modern frontend experience.','JavaScript,CSS,Accessibility','#282828'],
      ['Backend Engineer','Razorpay','Hyderabad','Full-time','Engineering',2000000,3200000,'Build reliable APIs and services for financial products. Own features from design through deployment with attention to security, observability, and testing. Experience with Node.js and relational databases is valuable.','Node.js,SQL,REST APIs','#3183e9'],
      ['Growth Marketing Manager','Spotify','Mumbai','Full-time','Marketing',1400000,2200000,'Plan and measure creative growth campaigns. Partner with content and analytics teams, run experiments, and turn customer insight into measurable improvements.','Marketing,Analytics,Strategy','#22895c'],
      ['UX Research Intern','Figma','Remote','Internship','Design',300000,600000,'Learn alongside experienced researchers. Support interviews, usability studies, and synthesis to help teams understand the people using their tools.','Research,Communication,Figma','#e37b53'],
      ['Data Analyst','Airbnb','Bengaluru','Contract','Data',1200000,2000000,'Turn complex data into clear decisions. Develop dashboards, investigate product questions, and communicate practical recommendations to cross-functional partners.','SQL,Python,Analytics','#e16c7b']
    ]) insert.run(...row);
  }
  if (seed) expandDemoCatalog(db);
  return db;
}

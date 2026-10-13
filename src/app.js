import { jobSchema, insertJob, registerFeatures } from './features.js';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createIntegrations } from './integrations.js';

export function createApp(db, env = process.env, overrides = {}) {
  const app = express();
  const secret = env.JWT_SECRET || randomBytes(48).toString('hex');
  if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) throw new Error('Set a strong JWT_SECRET (at least 32 characters).');
  const configuredOrigin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (env.NODE_ENV === 'production' && !configuredOrigin) throw new Error('Set APP_ORIGIN to the public HTTPS origin (Render supplies RENDER_EXTERNAL_URL automatically).');
  const originUrl = new URL(configuredOrigin || 'http://localhost:3000');
  if (!['http:','https:'].includes(originUrl.protocol) || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash || (env.NODE_ENV === 'production' && originUrl.protocol !== 'https:')) throw new Error('APP_ORIGIN must be an HTTPS origin in production, without a path, query, or credentials.');
  const allowedOrigin = originUrl.origin;
  // Only trust the configured number of proxy hops; never trust all forwarded addresses.
  const proxyHops = env.TRUST_PROXY_HOPS || '0';
  if (!/^\d+$/.test(proxyHops) || Number(proxyHops) > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  app.set('trust proxy', Number(proxyHops));
  const integrations = overrides.integrations || createIntegrations(db, env);
  app.locals.integrations = integrations;
  app.use(helmet({ contentSecurityPolicy: { directives: { styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'], fontSrc:["'self'",'https://fonts.gstatic.com'], upgradeInsecureRequests:env.NODE_ENV === 'production' ? [] : null } } }), express.json({ limit: '32kb' }), cookieParser());
  app.get('/healthz',(req,res)=> {
    res.set('Cache-Control','no-store');
    try { db.prepare('SELECT 1').get(); res.json({ok:true}); }
    catch { res.status(503).json({ok:false}); }
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (req.headers['x-requested-with'] !== 'Pathway' || (req.headers.origin && req.headers.origin !== allowedOrigin))) return res.status(403).json({ error: 'Request origin not allowed.' });
    next();
  });
  const authLimit = rateLimit({ windowMs: 15*60000, limit: 30, message: { error: 'Too many attempts. Please try again later.' } });
  const cleanUser = u => ({ id:u.id, name:u.name, email:u.email, role:u.role, company:u.company });
  function setSession(res,u) { res.cookie('session', jwt.sign({},secret,{ subject:String(u.id), expiresIn:'8h', issuer:'pathway', audience:'pathway-web', algorithm:'HS256' }),{ httpOnly:true, secure:env.NODE_ENV === 'production', sameSite:'lax', maxAge:8*3600000, path:'/' }); }
  function auth(req,res,next) {
    try { const payload = jwt.verify(req.cookies.session,secret,{ algorithms:['HS256'], issuer:'pathway', audience:'pathway-web' }); req.user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(payload.sub)); if (!req.user) throw new Error(); next(); }
    catch { res.status(401).json({ error:'Please sign in to continue.' }); }
  }
  const admin = (req,res,next) => req.user.role === 'admin' ? next() : res.status(403).json({ error:'Administrator access required.' });
  const seeker = (req,res,next) => req.user.role === 'job_seeker' ? next() : res.status(403).json({ error:'Please use a Job Seeker account to save or apply for jobs.' });
  const employer = (req,res,next) => req.user.role === 'employer' ? next() : res.status(403).json({ error:'Employer account required.' });
  const credentials = z.object({ email:z.email().max(254).transform(s=>s.toLowerCase()), password:z.string().min(8).max(72).refine(s=>Buffer.byteLength(s)<=72,'Password must be at most 72 UTF-8 bytes.') });
  app.post('/api/auth/signup',authLimit, async (req,res) => {
    const input = credentials.extend({ name:z.string().trim().min(2).max(80), role:z.enum(['job_seeker','employer']).default('job_seeker'), company:z.string().trim().max(80).default('') }).refine(v=>v.role!=='employer'||v.company.length>=2,'Enter your company name.').parse(req.body);
    const hash = await bcrypt.hash(input.password,12);
    try {
      db.exec('BEGIN');
      const result = db.prepare('INSERT INTO users(name,email,password_hash,role,company) VALUES (?,?,?,?,?)').run(input.name,input.email,hash,input.role,input.role==='employer'?input.company:'');
      db.prepare('INSERT INTO sheet_sync(user_id) VALUES (?)').run(result.lastInsertRowid);
      db.exec('COMMIT');
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
      setSession(res,u); res.status(201).json({ user:cleanUser(u) });
      void integrations.syncSignups();
    } catch(e) { if (db.isTransaction) db.exec('ROLLBACK'); if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error:'An account with this email already exists.' }); throw e; }
  });
  app.post('/api/auth/login',authLimit, async (req,res) => {
    const input = credentials.extend({ role:z.enum(['job_seeker','employer','admin']).optional() }).parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(input.email);
    const valid = await bcrypt.compare(input.password,u?.password_hash || '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Ttx0WYoFLKdHtvqyAdLRKVKCj9k2');
    if (!u || !valid) return res.status(401).json({ error:'Email or password is incorrect.' });
    if (input.role && u.role!==input.role) return res.status(403).json({ error:'This account belongs to a different portal. Select the correct account type to sign in.' });
    setSession(res,u); res.json({ user:cleanUser(u) });
  });
  app.post('/api/auth/logout',(req,res)=> { res.clearCookie('session',{path:'/'}); res.json({ ok:true }); });
  app.get('/api/auth/me',auth,(req,res)=>res.json({ user:cleanUser(req.user) }));
  app.get('/api/jobs',(req,res)=>res.json({ jobs:db.prepare('SELECT * FROM jobs WHERE active=1 ORDER BY id DESC').all() }));
  app.get('/api/dashboard',auth,(req,res)=>res.json({ applications:db.prepare('SELECT a.*,j.title,j.company,j.location FROM applications a JOIN jobs j ON a.job_id=j.id WHERE a.user_id=? ORDER BY a.id DESC').all(req.user.id), saved:db.prepare('SELECT job_id FROM saved_jobs WHERE user_id=?').all(req.user.id).map(r=>r.job_id) }));
  app.post('/api/jobs/:id/save',auth,seeker,(req,res)=> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    if (!db.prepare('SELECT id FROM jobs WHERE id=? AND active=1').get(id)) return res.status(404).json({ error:'Job not found.' });
    const exists = db.prepare('SELECT * FROM saved_jobs WHERE user_id=? AND job_id=?').get(req.user.id,id);
    if (exists) db.prepare('DELETE FROM saved_jobs WHERE user_id=? AND job_id=?').run(req.user.id,id); else db.prepare('INSERT INTO saved_jobs VALUES (?,?)').run(req.user.id,id);
    res.json({ saved:!exists });
  });
  app.post('/api/jobs/:id/apply',auth,seeker,(req,res)=> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = z.object({ cover_letter:z.string().trim().min(30).max(5000), resume_url:z.url().max(2000).refine(s=>s.startsWith('https://'),'Use an HTTPS resume link.') }).parse(req.body);
    if (!db.prepare('SELECT id FROM jobs WHERE id=? AND active=1').get(id)) return res.status(404).json({ error:'This role is no longer available.' });
    try { db.prepare('INSERT INTO applications(user_id,job_id,cover_letter,resume_url) VALUES (?,?,?,?)').run(req.user.id,id,input.cover_letter,input.resume_url); res.status(201).json({ ok:true }); }
    catch(e) { if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error:'You have already applied for this role.' }); throw e; }
  });
  app.post('/api/chat',rateLimit({ windowMs:60000, limit:10, message:{error:'Please wait a minute before sending more messages.'} }),async (req,res)=> {
    const { message } = z.object({ message:z.string().trim().min(1).max(2000) }).parse(req.body);
    let user={id:`guest-${randomBytes(12).toString('hex')}`};
    try { const p=jwt.verify(req.cookies.session,secret,{algorithms:['HS256'],issuer:'pathway',audience:'pathway-web'}); user=db.prepare('SELECT id FROM users WHERE id=?').get(Number(p.sub)) || user; } catch {}
    try { res.json(await integrations.chat(user,message)); } catch { res.status(502).json({ error:'The career assistant is temporarily unavailable. Please try again.' }); }
  });
  app.use('/api/admin',auth,admin);
  app.get('/api/admin',(req,res)=>res.json({ jobs:db.prepare('SELECT * FROM jobs ORDER BY id DESC').all(), users:db.prepare('SELECT u.id,u.name,u.email,u.role,u.created_at,s.status AS sync_status FROM users u LEFT JOIN sheet_sync s ON s.user_id=u.id ORDER BY u.id DESC').all(), applications:db.prepare('SELECT a.*,u.name,u.email,j.title,j.company FROM applications a JOIN users u ON a.user_id=u.id JOIN jobs j ON a.job_id=j.id ORDER BY a.id DESC').all(), integrations:{ sheets:integrations.sheetsReady, chatbot:integrations.chatReady } }));
  app.use('/api/employer',auth,employer);
  app.get('/api/employer',(req,res)=>res.json({ jobs:db.prepare('SELECT * FROM jobs WHERE employer_id=? ORDER BY id DESC').all(req.user.id), applications:db.prepare('SELECT a.*,u.name,u.email,j.title,j.company FROM applications a JOIN users u ON a.user_id=u.id JOIN jobs j ON a.job_id=j.id WHERE j.employer_id=? ORDER BY a.id DESC').all(req.user.id) }));
  app.post('/api/employer/jobs',(req,res)=>{const j=jobSchema.parse({...req.body,company:req.user.company});res.status(201).json({id:insertJob(db,j,req.user.id)});});
  app.patch('/api/employer/jobs/:id',(req,res)=>{const {active}=z.object({active:z.boolean()}).parse(req.body);const r=db.prepare('UPDATE jobs SET active=? WHERE id=? AND employer_id=?').run(Number(active),z.coerce.number().int().positive().parse(req.params.id),req.user.id);if(!r.changes)return res.status(404).json({error:'Job not found in your company.'});res.json({ok:true});});
  app.patch('/api/employer/applications/:id',(req,res)=>{const {status}=z.object({status:z.enum(['Submitted','Reviewing','Interview','Offered','Rejected'])}).parse(req.body);const r=db.prepare('UPDATE applications SET status=? WHERE id=? AND job_id IN (SELECT id FROM jobs WHERE employer_id=?)').run(status,z.coerce.number().int().positive().parse(req.params.id),req.user.id);if(!r.changes)return res.status(404).json({error:'Application not found in your company.'});res.json({ok:true});});
  app.post('/api/admin/jobs',(req,res)=>{const j=jobSchema.parse(req.body);res.status(201).json({id:insertJob(db,j)});});
  app.patch('/api/admin/jobs/:id',(req,res)=> { const { active }=z.object({ active:z.boolean() }).parse(req.body); const r=db.prepare('UPDATE jobs SET active=? WHERE id=?').run(Number(active),z.coerce.number().int().positive().parse(req.params.id)); if (!r.changes) return res.status(404).json({ error:'Job not found.' }); res.json({ ok:true }); });
  app.patch('/api/admin/applications/:id',(req,res)=> { const { status }=z.object({ status:z.enum(['Submitted','Reviewing','Interview','Offered','Rejected']) }).parse(req.body); const r=db.prepare('UPDATE applications SET status=? WHERE id=?').run(status,z.coerce.number().int().positive().parse(req.params.id)); if (!r.changes) return res.status(404).json({ error:'Application not found.' }); res.json({ ok:true }); });
  app.post('/api/admin/sync',async(req,res)=> { await integrations.syncSignups(); res.json({ configured:integrations.sheetsReady }); });
  registerFeatures(app,db,{auth,seeker,employer,admin});
  app.use('/api',(req,res)=>res.status(404).json({ error:'Endpoint not found.' }));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
  app.use((err,req,res,next)=> { if (err instanceof z.ZodError) return res.status(400).json({ error:err.issues.map(i=>`${i.path.join(' ')}: ${i.message}`).join('; ') }); if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error:'Invalid request body.' }); console.error('Request failed:',err.message); res.status(500).json({ error:'Something went wrong. Please try again.' }); });
  return app;
}


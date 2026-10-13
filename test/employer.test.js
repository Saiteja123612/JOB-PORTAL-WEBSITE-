import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('separate accounts, employer ownership, candidate privacy, and guest chat', async t=>{
  const db=createDb(':memory:',true), app=createApp(db,{JWT_SECRET:'test-employer-secret'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>{server.close();db.close();});
  const request=async(path,method='GET',body,cookie)=>{
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Requested-With':'Pathway',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const details={name:'Employer One',email:'one@example.com',password:'Employer-Password1',role:'employer',company:'One Company'};
  assert.equal((await request('/auth/signup','POST',{...details,role:'admin'})).status,400);
  assert.equal((await request('/auth/signup','POST',{...details,company:''})).status,400);
  const one=await request('/auth/signup','POST',details);
  const two=await request('/auth/signup','POST',{...details,email:'two@example.com',company:'Two Company'});
  const seeker=await request('/auth/signup','POST',{name:'Job Seeker',email:'seeker@example.com',password:'Seeker-Password1',role:'job_seeker'});
  assert.equal(one.data.user.role,'employer');assert.equal(seeker.data.user.role,'job_seeker');
  assert.equal((await request('/auth/login','POST',{email:details.email,password:details.password,role:'job_seeker'})).status,403);
  assert.equal((await request('/auth/login','POST',{email:details.email,password:details.password,role:'employer'})).status,200);
  assert.equal((await request('/employer','GET',undefined,seeker.cookie)).status,403);
  assert.equal((await request('/admin','GET',undefined,one.cookie)).status,403);
  const job={title:'Support Engineer',company:'Spoofed Company',location:'Remote',type:'Full-time',category:'Engineering',salary_min:800000,salary_max:1400000,description:'Help customers solve technical problems with care and precision.',skills:'Node.js,Communication',employer_id:two.data.user.id};
  const published=await request('/employer/jobs','POST',job,one.cookie);assert.equal(published.status,201);
  const id=published.data.id;
  assert.equal(db.prepare('SELECT employer_id FROM jobs WHERE id=?').get(id).employer_id,one.data.user.id);
  assert.equal(db.prepare('SELECT company FROM jobs WHERE id=?').get(id).company,'One Company');
  assert.equal((await request('/employer','GET',undefined,two.cookie)).data.jobs.length,0);
  assert.equal((await request(`/employer/jobs/${id}`,'PATCH',{active:false},two.cookie)).status,404);
  assert.equal((await request('/employer/jobs/1','PATCH',{active:false},one.cookie)).status,404);
  const application={resume_url:'https://example.com/resume',cover_letter:'I have the relevant experience to support your customers and engineering team.'};
  assert.equal((await request(`/jobs/${id}/apply`,'POST',application,one.cookie)).status,403);
  assert.equal((await request(`/jobs/${id}/save`,'POST',{},one.cookie)).status,403);
  assert.equal((await request(`/jobs/${id}/apply`,'POST',application,seeker.cookie)).status,201);
  const applicants=(await request('/employer','GET',undefined,one.cookie)).data.applications;
  assert.equal(applicants.length,1);assert.equal(applicants[0].email,'seeker@example.com');
  assert.equal((await request('/employer','GET',undefined,two.cookie)).data.applications.length,0);
  assert.equal((await request(`/employer/applications/${applicants[0].id}`,'PATCH',{status:'Interview'},two.cookie)).status,404);
  assert.equal((await request(`/employer/applications/${applicants[0].id}`,'PATCH',{status:'Interview'},one.cookie)).status,200);
  assert.equal((await request('/dashboard','GET',undefined,seeker.cookie)).data.applications[0].status,'Interview');
  assert.equal((await request(`/employer/jobs/${id}`,'PATCH',{active:false},one.cookie)).status,200);
  assert.equal((await request(`/employer/jobs/${id}`,'PATCH',{active:true},one.cookie)).status,200);
  const guest=await request('/chat','POST',{message:'How do I hire people?'});
  assert.equal(guest.status,200);assert.equal(guest.data.connected,false);assert.match(guest.data.reply,/Employer/);
  assert.deepEqual(db.prepare('SELECT role FROM users ORDER BY id').all().map(r=>r.role),['employer','employer','job_seeker']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sheet_sync').get().n,3);
});

test('migration preserves legacy users and administrator credentials',()=>{
  const directory=mkdtempSync(join(tmpdir(),'pathway-migration-'));
  try {
    const path=join(directory,'legacy.sqlite');const old=new DatabaseSync(path);
    old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,email TEXT UNIQUE,password_hash TEXT,role TEXT DEFAULT 'user',created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO users(name,email,password_hash,role) VALUES ('Candidate','legacy@example.com','legacy-hash','user'),('Admin','admin@example.com','admin-hash','admin');");old.close();
    const db=createDb(path);assert.equal(db.prepare('SELECT role FROM users WHERE id=1').get().role,'job_seeker');assert.equal(db.prepare('SELECT role,password_hash FROM users WHERE id=2').get().password_hash,'admin-hash');assert.equal(db.prepare('SELECT role FROM users WHERE id=2').get().role,'admin');db.close();
    const again=createDb(path);assert.equal(again.prepare('SELECT count(*) AS n FROM users').get().n,2);again.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});

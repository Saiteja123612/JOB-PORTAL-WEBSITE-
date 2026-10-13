import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createIntegrations } from '../src/integrations.js';

test('JWT accounts, authorization, applications, saves, admin management, and durable signup queue',async t=>{
  const db=createDb(':memory:',true);
  const app=createApp(db,{JWT_SECRET:'test-secret-with-at-least-thirty-two-characters',APP_ORIGIN:'http://localhost:3000'});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>{server.close();db.close();});
  const request=async(path,{method='GET',body,cookie,headers={}}={})=>{
    const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','X-Requested-With':'Pathway',...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
  };
  const signup=await request('/auth/signup',{method:'POST',body:{name:'Test Candidate',email:'CANDIDATE@example.com',password:'secure-test-password',role:'job_seeker'}});
  assert.equal(signup.status,201);assert.equal(signup.data.user.role,'job_seeker');assert.equal(signup.data.user.email,'candidate@example.com');assert.equal(signup.data.user.password_hash,undefined);
  assert.match(signup.cookie,/HttpOnly/);assert.match(signup.cookie,/SameSite=Lax/);
  const cookie=signup.cookie.split(';')[0];
  assert.equal(db.prepare('SELECT status FROM sheet_sync').get().status,'pending');
  assert.notEqual(db.prepare('SELECT password_hash FROM users').get().password_hash,'secure-test-password');
  assert.equal((await request('/auth/me',{cookie})).status,200);
  assert.equal((await request('/auth/me',{cookie:cookie+'tampered'})).status,401);
  assert.equal((await request('/admin',{cookie})).status,403);
  assert.equal((await request('/admin')).status,401);
  assert.equal((await request('/auth/signup',{method:'POST',body:{name:'Duplicate',email:'candidate@example.com',password:'secure-test-password'}})).status,409);
  assert.equal((await request('/auth/login',{method:'POST',body:{email:'candidate@example.com',password:'wrong-password'}})).status,401);
  assert.equal((await request('/auth/login',{method:'POST',body:{email:'candidate@example.com',password:'secure-test-password'}})).status,200);
  assert.equal((await request('/jobs/1/save',{method:'POST',cookie,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/jobs/1/save',{method:'POST',cookie})).data.saved,true);
  assert.deepEqual((await request('/dashboard',{cookie})).data.saved,[1]);
  assert.equal((await request('/jobs/1/save',{method:'POST',cookie})).data.saved,false);
  const application={resume_url:'https://example.com/resume.pdf',cover_letter:'I have five years of experience designing thoughtful accessible products.'};
  assert.equal((await request('/jobs/1/apply',{method:'POST',cookie,body:{...application,resume_url:'javascript:alert(1)'}})).status,400);
  assert.equal((await request('/jobs/1/apply',{method:'POST',cookie,body:application})).status,201);
  assert.equal((await request('/jobs/1/apply',{method:'POST',cookie,body:application})).status,409);
  const other=await request('/auth/signup',{method:'POST',body:{name:'Other Candidate',email:'other@example.com',password:'secure-test-password'}});
  assert.equal((await request('/dashboard',{cookie:other.cookie.split(';')[0]})).data.applications.length,0);
  assert.equal((await request('/chat',{method:'POST',cookie,body:{message:'Find a role'}})).data.connected,false);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES ('Admin','admin@example.com',?,'admin')").run(await bcrypt.hash('admin-test-password',4));
  const admin=await request('/auth/login',{method:'POST',body:{email:'admin@example.com',password:'admin-test-password'}});
  const adminCookie=admin.cookie.split(';')[0];
  assert.equal((await request('/admin',{cookie:adminCookie})).data.applications.length,1);
  assert.equal((await request('/admin/applications/1',{method:'PATCH',cookie:adminCookie,body:{status:'Interview'}})).status,200);
  assert.equal((await request('/dashboard',{cookie})).data.applications[0].status,'Interview');
  assert.equal((await request('/admin/jobs/2',{method:'PATCH',cookie:adminCookie,body:{active:false}})).status,200);
  assert.equal((await request('/jobs/2/apply',{method:'POST',cookie,body:application})).status,404);
  assert.equal((await request('/jobs')).data.jobs.length,41);
  const job={title:'QA Engineer',company:'Example',location:'Remote',type:'Full-time',category:'Engineering',salary_min:1000000,salary_max:1600000,skills:'Testing,JavaScript',description:'Help the team build reliable, well-tested applications for customers.'};
  assert.equal((await request('/admin/jobs',{method:'POST',cookie,body:job})).status,403);
  assert.equal((await request('/admin/jobs',{method:'POST',cookie:adminCookie,body:{...job,salary_min:2000000}})).status,400);
  assert.equal((await request('/admin/jobs',{method:'POST',cookie:adminCookie,body:job})).status,201);
  assert.equal((await request('/auth/logout',{method:'POST',cookie})).status,200);
});

test('n8n proxy sends authenticated job context and validates its reply',async t=>{
  const db=createDb(':memory:',true);t.after(()=>db.close());
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://n8n.example/webhook/pathway-chat');assert.equal(options.headers['X-Webhook-Secret'],'secret');const body=JSON.parse(options.body);assert.equal(body.sessionId,'user-1');assert.equal(body.jobs.length,30);assert.equal(body.email,undefined);return new Response(JSON.stringify({reply:'Explore the remote Product Designer role.'}),{status:200,headers:{'Content-Type':'application/json'}});};
  const integration=createIntegrations(db,{N8N_CHAT_WEBHOOK_URL:'https://n8n.example/webhook/pathway-chat',N8N_WEBHOOK_SECRET:'secret'});
  assert.equal((await integration.chat({id:1},'Find a role')).connected,true);
  globalThis.fetch=async()=>new Response(JSON.stringify({unexpected:true}),{status:200});
  await assert.rejects(()=>integration.chat({id:1},'Hello'),/Invalid chat response/);
});

test('production requires a persistent strong JWT secret',()=>{
  const db=createDb(':memory:');
  assert.throws(()=>createApp(db,{NODE_ENV:'production'}),/JWT_SECRET/);db.close();
});

test('Google Sheets retries use the same row, RAW values, and never transmit passwords',async t=>{
  const db=createDb(':memory:');t.after(()=>db.close());
  db.prepare('INSERT INTO users(name,email,password_hash) VALUES (?,?,?)').run('=Untrusted Name','sheets@example.com','private-hash');
  db.prepare('INSERT INTO sheet_sync(user_id) VALUES (1)').run();
  const calls=[];let fail=true;
  const auth={getClient:async()=>({request:async options=>{calls.push(options);if(options.data.values[0][0]===1 && fail)throw new Error('Temporary failure');}})};
  const integration=createIntegrations(db,{GOOGLE_SHEET_ID:'test-sheet',GOOGLE_APPLICATION_CREDENTIALS:'mock.json'},{auth});
  await integration.syncSignups();assert.equal(db.prepare('SELECT status FROM sheet_sync').get().status,'failed');
  fail=false;await integration.syncSignups();assert.equal(db.prepare('SELECT status FROM sheet_sync').get().status,'synced');
  const rows=calls.filter(c=>c.data.values[0][0]===1);assert.equal(rows.length,2);assert.equal(rows[0].url,rows[1].url);assert.match(rows[1].url,/valueInputOption=RAW/);assert.equal(rows[1].data.values[0].length,5);assert.equal(JSON.stringify(calls).includes('private-hash'),false);
  await integration.syncSignups();assert.equal(calls.filter(c=>c.data.values[0][0]===1).length,2);
});

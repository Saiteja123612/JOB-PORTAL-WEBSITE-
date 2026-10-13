import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb} from '../src/db.js';
import {createApp} from '../src/app.js';
import {expandDemoCatalog} from '../src/catalog.js';

test('catalog expansion is idempotent and explicitly labels demo openings',()=>{
  const db=createDb(':memory:',true);
  try{expandDemoCatalog(db);assert.equal(db.prepare('SELECT count(*) AS n FROM jobs').get().n,42);assert.equal(db.prepare('SELECT count(DISTINCT company) AS n FROM jobs').get().n,24);assert.equal(db.prepare('SELECT count(DISTINCT category) AS n FROM jobs').get().n,13);assert.equal(db.prepare('SELECT count(*) AS n FROM jobs WHERE is_demo=1').get().n,42);}finally{db.close();}
});
test('profile privacy, persistent search criteria, listing edits and application event ownership',async t=>{
  const db=createDb(':memory:',true),app=createApp(db,{JWT_SECRET:'features-test-secret'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>{server.close();db.close();});
  const req=async(path,method='GET',body,cookie)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Requested-With':'Pathway',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const candidate=(await req('/auth/signup','POST',{name:'Candidate One',email:'one@sample.test',password:'Password123!'})).cookie;
  const other=(await req('/auth/signup','POST',{name:'Candidate Two',email:'two@sample.test',password:'Password123!'})).cookie;
  const owner=(await req('/auth/signup','POST',{name:'Hiring Lead',email:'owner@sample.test',password:'Password123!',role:'employer',company:'Test Company'})).cookie;
  const stranger=(await req('/auth/signup','POST',{name:'Another Lead',email:'stranger@sample.test',password:'Password123!',role:'employer',company:'Other Company'})).cookie;
  const p={headline:'Full stack developer',location:'Hyderabad',skills:'JavaScript,Node.js,SQL',experience:2,resume_url:'https://example.com/private-resume',portfolio_url:'',bio:'I build accessible applications.',desired_salary:1500000,work_mode:'Remote'};
  assert.equal((await req('/profile')).status,401);
  assert.equal((await req('/profile','PUT',p,owner)).status,403);
  assert.equal((await req('/profile','PUT',{...p,resume_url:'javascript:alert(1)'},candidate)).status,400);
  assert.equal((await req('/profile','PUT',p,candidate)).status,200);
  assert.equal((await req('/profile','GET',undefined,candidate)).data.profile.headline,p.headline);
  assert.equal((await req('/profile','GET',undefined,other)).data.profile.resume_url,'');
  assert.equal(JSON.stringify((await req('/companies')).data).includes('private-resume'),false);
  const search=await req('/searches','POST',{name:'Remote developer',criteria:{query:'JavaScript',category:'Engineering',work_mode:'Remote',experience:2,salary:1500000}},candidate);
  assert.equal(search.status,201);
  const saved=(await req('/searches','GET',undefined,candidate)).data.searches[0];assert.ok(saved.matches.length>0);
  for(const id of saved.matches){const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);assert.equal(j.work_mode,'Remote');assert.equal(j.category,'Engineering');assert.ok(j.salary_max>=1500000);assert.ok(j.experience_min<=2&&j.experience_max>=2);}
  assert.equal((await req('/searches','GET',undefined,other)).data.searches.length,0);
  assert.equal((await req(`/searches/${search.data.id}`,'DELETE',undefined,other)).status,404);
  const job={title:'Security Specialist',company:'Test Company',location:'Remote',category:'Cybersecurity',type:'Full-time',salary_min:1200000,salary_max:2000000,description:'Help our team improve application security and response procedures.',skills:'OWASP,Python',experience_min:2,experience_max:4,work_mode:'Remote'};
  const id=(await req('/employer/jobs','POST',job,owner)).data.id;
  assert.equal(db.prepare('SELECT is_demo FROM jobs WHERE id=?').get(id).is_demo,0);
  assert.equal((await req(`/employer/jobs/${id}`,'PUT',{...job,title:'Updated Security Specialist'},stranger)).status,404);
  assert.equal((await req(`/employer/jobs/${id}`,'PUT',{...job,experience_min:8},owner)).status,400);
  assert.equal((await req(`/employer/jobs/${id}`,'PUT',{...job,title:'Updated Security Specialist'},owner)).status,200);
  assert.equal(db.prepare('SELECT title FROM jobs WHERE id=?').get(id).title,'Updated Security Specialist');
  await req(`/jobs/${id}/apply`,'POST',{resume_url:p.resume_url,cover_letter:'I have relevant experience building and securing production applications.'},candidate);
  const application=db.prepare('SELECT id FROM applications WHERE job_id=?').get(id).id;
  await req(`/employer/applications/${application}`,'PATCH',{status:'Interview'},owner);
  await req(`/employer/applications/${application}`,'PATCH',{status:'Interview'},owner);
  const events=(await req(`/applications/${application}/timeline`,'GET',undefined,candidate)).data.events;
  assert.deepEqual(events.map(e=>e.status),['Submitted','Interview']);
  assert.equal((await req(`/applications/${application}/timeline`,'GET',undefined,other)).status,404);
  assert.equal((await req('/activity','GET',undefined,other)).data.events.length,0);
  assert.equal((await req('/activity','GET',undefined,candidate)).data.events.length,2);
  assert.equal((await req(`/searches/${search.data.id}`,'DELETE',undefined,candidate)).status,200);
});

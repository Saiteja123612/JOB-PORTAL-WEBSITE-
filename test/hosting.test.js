import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const production = { NODE_ENV:'production', JWT_SECRET:'hosting-test-secret-at-least-thirty-two-characters', APP_ORIGIN:'https://pathway.example/', TRUST_PROXY_HOPS:'1' };

test('hosted HTTPS signup keeps secure cookies and accounts across database reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(),'pathway-hosting-'));
  const filename = join(directory,'portal.sqlite');
  let db, server;
  const stop = async () => { if (server) { await new Promise(resolve=>server.close(resolve)); server=null; } if (db) { db.close(); db=null; } };
  t.after(async()=> { await stop(); rmSync(directory,{recursive:true,force:true}); });
  const start = async () => {
    db = createDb(filename,false);
    const app = createApp(db,production);
    app.get('/test-client',(req,res)=>res.json({ip:req.ip,secure:req.secure}));
    server = app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  let base = await start();
  const headers = {'Content-Type':'application/json','X-Requested-With':'Pathway',Origin:'https://pathway.example','X-Forwarded-Proto':'https','X-Forwarded-For':'198.51.100.77, 203.0.113.9'};
  const identity = await fetch(base+'/test-client',{headers}).then(r=>r.json());
  assert.deepEqual(identity,{ip:'203.0.113.9',secure:true});
  const health = await fetch(base+'/healthz');
  assert.equal(health.status,200); assert.deepEqual(await health.json(),{ok:true});
  assert.equal(health.headers.get('cache-control'),'no-store');
  const body=JSON.stringify({name:'Hosted Candidate',email:'hosted@example.com',password:'hosting-test-password',role:'job_seeker'});
  const bad=await fetch(base+'/api/auth/signup',{method:'POST',headers:{...headers,Origin:'https://other.example'},body});
  assert.equal(bad.status,403);
  const signup=await fetch(base+'/api/auth/signup',{method:'POST',headers,body});
  assert.equal(signup.status,201);
  const cookie=signup.headers.get('set-cookie');
  assert.match(cookie,/Secure/); assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Lax/);
  await stop(); base=await start();
  const me=await fetch(base+'/api/auth/me',{headers:{...headers,Cookie:cookie.split(';')[0]}});
  assert.equal(me.status,200); assert.equal((await me.json()).user.email,'hosted@example.com');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body});
  assert.equal(login.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count,0);
});

test('hosting rejects unsafe origins and unbounded proxy trust',()=>{
  const db=createDb(':memory:',false);
  try {
    assert.throws(()=>createApp(db,{...production,APP_ORIGIN:''}),/APP_ORIGIN/);
    for (const origin of ['http://pathway.example','https://pathway.example/subpath','https://user:pass@pathway.example']) {
      assert.throws(()=>createApp(db,{...production,APP_ORIGIN:origin}),/APP_ORIGIN/);
    }
    assert.throws(()=>createApp(db,{...production,TRUST_PROXY_HOPS:'true'}),/TRUST_PROXY_HOPS/);
    const render=createApp(db,{...production,APP_ORIGIN:'',RENDER_EXTERNAL_URL:'https://pathway.onrender.com'});
    assert.equal(render.get('trust proxy'),1);
    assert.equal(createApp(db,{JWT_SECRET:production.JWT_SECRET}).get('trust proxy'),0);
  } finally {db.close();}
});

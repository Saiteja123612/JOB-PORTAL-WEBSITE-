import 'dotenv/config';
import { createDb } from './db.js';
import { createApp } from './app.js';
const db=createDb(process.env.DATABASE_PATH,process.env.SEED_DEMO === 'true' || (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO !== 'false'));
const app=createApp(db);
const port=Number(process.env.PORT || 3000);
const host=process.env.HOST || process.env.IP || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server=app.listen(port,host,()=>console.log(`Pathway is listening on ${host}:${server.address().port}`));
const timer=setInterval(()=>void app.locals.integrations.syncSignups(),60000);
void app.locals.integrations.syncSignups();
function shutdown() { clearInterval(timer); server.close(()=> { db.close(); process.exit(0); }); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [origin, flag] = process.argv.slice(2);
let url;
try { url = new URL(origin); } catch {}
if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (flag && flag !== '--demo')) {
  console.error('Usage: npm run setup:hosting -- https://YOUR-ACCOUNT.alwaysdata.net [--demo]');
  process.exit(1);
}
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) {
  console.error('A .env already exists. Kept it unchanged; edit APP_ORIGIN there if needed.');
  process.exit(1);
}
// Store the database outside the source checkout so code updates preserve accounts.
const dataDir = join(homedir(), 'pathway-data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
writeFileSync(envFile, [
  'NODE_ENV=production',
  `APP_ORIGIN=${url.origin}`,
  'TRUST_PROXY_HOPS=1',
  `JWT_SECRET=${randomBytes(48).toString('hex')}`,
  `DATABASE_PATH=${JSON.stringify(join(dataDir, 'portal.sqlite').replaceAll('\\', '/'))}`,
  `SEED_DEMO=${flag === '--demo'}`,
  'GOOGLE_SHEET_TAB=Signups',
  ''
].join('\n'), { mode: 0o600, flag: 'wx' });
console.log('Hosting settings saved privately in .env. No secret was printed.');
console.log('Start with node src/server.js from this project directory. The host supplies IP/HOST and PORT.');

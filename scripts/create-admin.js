import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createDb } from '../src/db.js';
const [email,name]=process.argv.slice(2);
const password=process.env.ADMIN_PASSWORD;
if (!email?.includes('@') || !name || !password || password.length < 12 || Buffer.byteLength(password)>72) { console.error('Set ADMIN_PASSWORD (12–72 bytes) in your environment, then run: npm run admin -- email@example.com "Admin Name"'); process.exit(1); }
const db=createDb(process.env.DATABASE_PATH);
const hash=await bcrypt.hash(password,12);
db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'admin') ON CONFLICT(email) DO UPDATE SET role='admin',password_hash=excluded.password_hash").run(name,email.toLowerCase(),hash);
db.close(); console.log('Admin account is ready. Sign in through the portal.');

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(readFileSync(join(process.cwd(), 'src', 'schema.sql'), 'utf8')).then(() => console.log('Database ready')).catch(console.error).finally(() => pool.end());

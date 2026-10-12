import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
};

async function main() {
  const conn = await mysql.createConnection(cfg);
  const root = process.cwd();

  if (process.argv.includes('--drop')) {
    await conn.query('DROP DATABASE IF EXISTS apex_ai');
    console.log('Dropped apex_ai');
  }

  const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('Schema applied');

  if (process.argv.includes('--seed')) {
    const seed = fs.readFileSync(path.join(root, 'database', 'seeds', '001_seed.sql'), 'utf8');
    await conn.query(seed);
    console.log('Seed applied');
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
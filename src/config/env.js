import dotenv from 'dotenv';
dotenv.config();
const required = ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET'];
export function validateEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) { console.error('Missing env:', missing.join(', ')); process.exit(1); }
}
export default {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 5000),
  API_PREFIX: process.env.API_PREFIX || '/api',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
};

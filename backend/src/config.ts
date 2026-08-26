import 'dotenv/config';
export const config = {
  port: Number(process.env.PORT ?? 4000), databaseUrl: process.env.DATABASE_URL!, redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173', sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret',
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10), minDelayMs: Number(process.env.MIN_SEND_DELAY_MS ?? 2000), hourlyLimit: Number(process.env.MAX_EMAILS_PER_HOUR ?? 200),
  googleClientId: process.env.GOOGLE_CLIENT_ID, googleClientSecret: process.env.GOOGLE_CLIENT_SECRET, googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/api/auth/google/callback', etherealUser: process.env.ETHEREAL_USER, etherealPass: process.env.ETHEREAL_PASS
};

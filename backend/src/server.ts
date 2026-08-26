import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';
import multer from 'multer';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { db } from './db';
import { scheduleMail } from './queue';
import './worker';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));
app.use(session({ secret: config.sessionSecret, resave: false, saveUninitialized: false,  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 86_400_000
  } }));
app.use(passport.initialize()); app.use(passport.session());

if (config.googleClientId && config.googleClientSecret) {
  passport.use(new GoogleStrategy({ clientID: config.googleClientId, clientSecret: config.googleClientSecret, callbackURL: config.googleCallbackUrl }, async (_access, _refresh, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Google account has no email'));
      const result = await db.query(`INSERT INTO users(id,google_id,name,email,avatar) VALUES($1,$2,$3,$4,$5) ON CONFLICT(google_id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,avatar=EXCLUDED.avatar RETURNING id`, [randomUUID(), profile.id, profile.displayName, email, profile.photos?.[0]?.value ?? null]);
      done(null, { id: result.rows[0].id });
    } catch (error) { done(error as Error); }
  }));
}
passport.serializeUser((user: any, done) => done(null, user.id));
passport.deserializeUser(async (id: string, done) => { const result = await db.query('SELECT id,name,email,avatar FROM users WHERE id=$1', [id]); done(null, result.rows[0]); });

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => req.user ? next() : res.status(401).json({ error: 'Authentication required' });
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: `${config.frontendUrl}/?error=login` }), (req, res) => { req.session.userId = (req.user as any).id; res.redirect(config.frontendUrl); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));
app.post('/api/auth/logout', (req, res) => req.logout(() => { req.session.destroy(() => res.status(204).end()); }));

app.get('/api/emails', requireAuth, async (req, res) => { const status = req.query.status === 'sent' ? 'sent' : 'scheduled'; const result = await db.query('SELECT id,recipient,subject,scheduled_at,status,sent_at,error FROM emails WHERE user_id=$1 AND status=$2 ORDER BY COALESCE(sent_at,scheduled_at) DESC LIMIT 500', [(req.user as any).id, status]); res.json(result.rows); });
app.get('/api/emails/counts', requireAuth, async (req, res) => { const result = await db.query("SELECT status, COUNT(*)::int AS count FROM emails WHERE user_id=$1 AND status IN ('scheduled','sent') GROUP BY status", [(req.user as any).id]); res.json(result.rows.reduce((counts, row) => ({ ...counts, [row.status]: row.count }), { scheduled: 0, sent: 0 })); });
app.post('/api/emails/schedule', requireAuth, upload.single('attachment'), async (req, res) => {
  let recipients: unknown;
  try { recipients = typeof req.body.recipients === 'string' ? JSON.parse(req.body.recipients) : req.body.recipients; } catch { return res.status(400).json({ error: 'Recipients must be valid JSON' }); }
  const { subject, body, startTime, delayBetweenMs = 2000, hourlyLimit } = req.body;
  if (!Array.isArray(recipients) || !recipients.length || !subject || !body || !startTime) return res.status(400).json({ error: 'Recipients, subject, body, and start time are required' });
  const start = new Date(startTime); if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'Start time must be in the future' });
  const sender = (req.user as any).email;
  const client = await db.connect(); const created: string[] = [];
  const campaignLimit = Math.max(1, Number(hourlyLimit) || config.hourlyLimit);
  try { await client.query('BEGIN'); let attachmentId: string | null = null; if (req.file) { attachmentId = randomUUID(); await client.query('INSERT INTO attachments(id,user_id,file_name,mime_type,file_size,file_data) VALUES($1,$2,$3,$4,$5,$6)', [attachmentId, (req.user as any).id, req.file.originalname, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer]); } for (let index = 0; index < recipients.length; index++) { const recipient = String(recipients[index]).trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(recipient)) continue; const id = randomUUID(); const scheduled = new Date(start.getTime() + index * Math.max(0, Number(delayBetweenMs))); await client.query('INSERT INTO emails(id,user_id,recipient,sender,subject,body,scheduled_at,hourly_limit,attachment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, (req.user as any).id, recipient, sender, subject, body, scheduled, campaignLimit, attachmentId]); created.push(id); } await client.query('COMMIT'); for (let index = 0; index < created.length; index++) await scheduleMail(created[index], new Date(start.getTime() + index * Math.max(0, Number(delayBetweenMs)))); res.status(201).json({ count: created.length, hourlyLimit: campaignLimit, attachment: req.file?.originalname ?? null }); } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: 'Could not schedule emails' }); } finally { client.release(); }
});
app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

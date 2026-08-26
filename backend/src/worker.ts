import nodemailer from 'nodemailer';
import { Worker, Job } from 'bullmq';
import { config } from './config';
import { db } from './db';
import { redis } from './queue';

const reserveSlot = async (sender: string, limit: number) => {
  const window = Math.floor(Date.now() / 3_600_000);
  const key = `outbox:rate:${sender}:${window}`;
  const script = `local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],7200) end; if count>tonumber(ARGV[1]) then redis.call('DECR',KEYS[1]); return 0 end; return count`;
  const result = await redis.eval(script, 1, key, limit) as number;
  return { allowed: result > 0, next: (window + 1) * 3_600_000 };
};

const transporter = config.etherealUser && config.etherealPass ? nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: config.etherealUser, pass: config.etherealPass } }) : null;
let lastSendAt = 0;

async function processEmail(job: Job<{ emailId: string }>) {
  console.log('[WORKER] Job received', { jobId: job.id, emailId: job.data.emailId });
  const client = await db.connect();
  try {
    console.log('[WORKER] Loading email', { emailId: job.data.emailId });
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM emails WHERE id = $1 FOR UPDATE', [job.data.emailId]);
    if (!result.rowCount) { console.warn('[WORKER] Email not found', { emailId: job.data.emailId }); await client.query('ROLLBACK'); return; }
    const email = result.rows[0];
    console.log('[WORKER] Current email status', { emailId: email.id, status: email.status, recipient: email.recipient, scheduledAt: email.scheduled_at });
    if (email.status === 'sent') { console.log('[WORKER] Email already sent', { emailId: email.id }); await client.query('ROLLBACK'); return; }
    const claimed = await client.query("UPDATE emails SET status='processing', attempts=attempts+1 WHERE id=$1 AND status='scheduled' RETURNING *", [job.data.emailId]);
    await client.query('COMMIT');
    if (!claimed.rowCount) { console.warn('[WORKER] Email was not claimable', { emailId: email.id, status: email.status }); return; }
    console.log('[WORKER] Email claimed', { emailId: email.id, attempt: claimed.rows[0].attempts });
    const slot = await reserveSlot(email.sender, email.hourly_limit);
    if (!slot.allowed) {
      console.log('[WORKER] Hourly limit reached; rescheduling', { emailId: email.id, nextAttemptAt: new Date(slot.next).toISOString() });
      await db.query("UPDATE emails SET status='scheduled' WHERE id=$1 AND status='processing'", [email.id]);
      await job.moveToDelayed(slot.next, job.token);
      return;
    }
    const wait = Math.max(0, lastSendAt + config.minDelayMs - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastSendAt = Date.now();
    if (!transporter) throw new Error('Ethereal credentials are not configured');
    console.log('[WORKER] Sending SMTP email', { emailId: email.id, from: email.sender, to: email.recipient });
    const attachment = email.attachment_id ? (await db.query('SELECT file_name,mime_type,file_data FROM attachments WHERE id=$1', [email.attachment_id])).rows[0] : null;
    const info = await transporter.sendMail({ from: email.sender, to: email.recipient, subject: email.subject, text: email.body, attachments: attachment ? [{ filename: attachment.file_name, contentType: attachment.mime_type, content: attachment.file_data }] : undefined });
    console.log('[WORKER] SMTP accepted email', { emailId: email.id, messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) });
    await db.query("UPDATE emails SET status='sent', sent_at=NOW(), provider_message_id=$2 WHERE id=$1", [email.id, info.messageId]);
    console.log('[WORKER] Database status updated to sent', { emailId: email.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[WORKER] Email processing failed', { jobId: job.id, emailId: job.data.emailId, error: message });
    await client.query('ROLLBACK').catch(() => undefined);
    const failed = await db.query("UPDATE emails SET status='failed', error=$2 WHERE id=$1 AND status='processing' RETURNING id,status,error", [job.data.emailId, message]);
    console.error('[WORKER] Database status updated to failed', { emailId: job.data.emailId, updated: failed.rowCount });
    throw error;
  } finally { client.release(); }
}

export const worker = new Worker('outbox-mail', processEmail, { connection: redis, concurrency: config.concurrency });
console.log('[WORKER] Started', { queue: 'outbox-mail', concurrency: config.concurrency });
worker.on('active', job => console.log('[WORKER] Job active', { jobId: job.id, emailId: job.data.emailId }));
worker.on('completed', job => console.log('[WORKER] Job completed', { jobId: job.id }));
worker.on('failed', (job, error) => console.error('[WORKER] Job failed', { jobId: job?.id, emailId: job?.data.emailId, error: error.message }));
worker.on('error', error => console.error('[WORKER] Worker error', error));

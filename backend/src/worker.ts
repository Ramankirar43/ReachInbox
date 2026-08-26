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
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM emails WHERE id = $1 FOR UPDATE', [job.data.emailId]);
    if (!result.rowCount || result.rows[0].status === 'sent') { await client.query('ROLLBACK'); return; }
    const email = result.rows[0];
    const claimed = await client.query("UPDATE emails SET status='processing', attempts=attempts+1 WHERE id=$1 AND status='scheduled' RETURNING *", [job.data.emailId]);
    await client.query('COMMIT');
    if (!claimed.rowCount) return;
    const slot = await reserveSlot(email.sender, email.hourly_limit);
    if (!slot.allowed) {
      await db.query("UPDATE emails SET status='scheduled' WHERE id=$1 AND status='processing'", [email.id]);
      await job.moveToDelayed(slot.next, job.token);
      return;
    }
    const wait = Math.max(0, lastSendAt + config.minDelayMs - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastSendAt = Date.now();
    if (!transporter) throw new Error('Ethereal credentials are not configured');
    const attachment = email.attachment_id ? (await db.query('SELECT file_name,mime_type,file_data FROM attachments WHERE id=$1', [email.attachment_id])).rows[0] : null;
    const info = await transporter.sendMail({ from: email.sender, to: email.recipient, subject: email.subject, text: email.body, attachments: attachment ? [{ filename: attachment.file_name, contentType: attachment.mime_type, content: attachment.file_data }] : undefined });
    await db.query("UPDATE emails SET status='sent', sent_at=NOW(), provider_message_id=$2 WHERE id=$1", [email.id, info.messageId]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await db.query("UPDATE emails SET status='failed', error=$2 WHERE id=$1 AND status='processing'", [job.data.emailId, error instanceof Error ? error.message : 'Send failed']);
    throw error;
  } finally { client.release(); }
}

export const worker = new Worker('outbox-mail', processEmail, { connection: redis, concurrency: config.concurrency });
worker.on('error', error => console.error('Worker error', error));

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const mailQueue = new Queue('outbox-mail', { connection: redis });
export const scheduleMail = async (id: string, timestamp: Date) => {
	const delay = Math.max(0, timestamp.getTime() - Date.now());
	console.log('[QUEUE] Scheduling email job', { emailId: id, scheduledAt: timestamp.toISOString(), delayMs: delay });
	const job = await mailQueue.add('send-email', { emailId: id }, { jobId: id, delay, removeOnComplete: 1000, removeOnFail: 5000 });
	console.log('[QUEUE] Job created', { jobId: job.id, emailId: id });
	return job;
};

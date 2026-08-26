import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const mailQueue = new Queue('outbox-mail', { connection: redis });
export const scheduleMail = (id: string, timestamp: Date) => mailQueue.add('send-email', { emailId: id }, { jobId: id, delay: Math.max(0, timestamp.getTime() - Date.now()), removeOnComplete: 1000, removeOnFail: 5000 });

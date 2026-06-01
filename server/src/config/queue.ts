import { ConnectionOptions } from 'bullmq';
import { env } from './env';

/**
 * Parse the Upstash Redis URL into BullMQ-compatible connection options.
 * BullMQ uses ioredis internally, so we pass host/port/password/tls directly.
 */
const redisUrl = new URL(env.UPSTASH_REDIS_URL);

export const bullmqConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  // Upstash requires TLS for rediss:// connections
  tls: env.UPSTASH_REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
};

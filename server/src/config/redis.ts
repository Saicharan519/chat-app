import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redis: Redis;

try {
  redis = new Redis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info('Connecting to Redis...');
  });

  redis.on('ready', () => {
    logger.info('Redis connection established successfully.');
  });

  redis.on('error', (err) => {
    logger.error('Redis error encountered', { error: err.message, stack: err.stack });
  });

  redis.on('close', () => {
    logger.warn('Redis connection closed.');
  });

  redis.on('reconnecting', (delay: number) => {
    logger.info(`Reconnecting to Redis in ${delay}ms...`);
  });

  redis.on('end', () => {
    logger.error('Redis connection ended permanently.');
  });
} catch (error: any) {
  logger.error('Failed to initialize Redis client', { error: error.message });
  process.exit(1);
}

export default redis;

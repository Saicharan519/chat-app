import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import redis from '../config/redis';
import { logger } from '../utils/logger';

const AI_RATE_LIMIT = 10; // max requests per window
const AI_RATE_WINDOW = 60; // seconds

/**
 * Sliding-window rate limiter for AI endpoints.
 * Allows 10 requests per user per 60 seconds.
 * Fails open on Redis errors to avoid blocking users.
 */
export async function aiRateLimiter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = `ratelimit:ai:${userId}`;

  try {
    const current = await redis.incr(key);

    // Set expiry only on first request in the window
    if (current === 1) {
      await redis.expire(key, AI_RATE_WINDOW);
    }

    if (current > AI_RATE_LIMIT) {
      const ttl = await redis.ttl(key);
      logger.warn('AI rate limit exceeded', { userId, current, ttl });
      return res.status(429).json({
        error: 'AI rate limit exceeded. Please wait before making more requests.',
        retryAfter: ttl,
      });
    }

    next();
  } catch (error: any) {
    // Fail open — don't block users when Redis is unavailable
    logger.error('Error in AI rate limiter — failing open', { error: error.message });
    next();
  }
}

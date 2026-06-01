import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../utils/auth';
import redis from '../config/redis';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token missing or invalid format' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    if (!token) {
      return res.status(401).json({ error: 'Access token missing' });
    }

    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(token);
    } catch (err: any) {
      logger.debug('JWT Verification failed', { error: err.message });
      return res.status(401).json({ error: 'Access token expired or invalid' });
    }

    // Check if the JWT ID (jti) is blacklisted in Redis (e.g. after logout)
    const isBlacklisted = await redis.get(`blacklist:${payload.jti}`);
    if (isBlacklisted) {
      logger.warn('Attempted use of blacklisted access token', { jti: payload.jti, userId: payload.userId });
      return res.status(401).json({ error: 'Access token has been revoked' });
    }

    // Attach user payload to the request object
    req.user = payload;
    next();
  } catch (error: any) {
    logger.error('Error in auth middleware', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

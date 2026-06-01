import { Request, Response } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';
import {
  hashPassword,
  comparePassword,
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  getCookieOptions,
} from '../utils/auth';
import { registerSchema, loginSchema } from '../schemas/auth.schema';
import jwt from 'jsonwebtoken';
import redis from '../config/redis';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

/**
 * Register a new user
 */
export async function register(req: Request, res: Response) {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { username, email, password } = parseResult.data;

    // Check if username or email already exists
    const existingUser = await pool.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1',
      [username.toLowerCase(), email.toLowerCase()]
    );

    if (existingUser.rowCount && existingUser.rowCount > 0) {
      const user = existingUser.rows[0];
      if (user.username === username.toLowerCase()) {
        return res.status(409).json({ error: 'Username is already taken' });
      }
      return res.status(409).json({ error: 'Email is already registered' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Insert user into PostgreSQL
    const insertResult = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username.toLowerCase(), email.toLowerCase(), hashedPassword]
    );

    const newUser = insertResult.rows[0];
    logger.info('User registered successfully', { userId: newUser.id, username: newUser.username });

    // Generate tokens
    const { token: accessToken } = generateAccessToken(newUser);
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken();

    // Store refresh token hash in DB
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [newUser.id, refreshHash, expiresAt]
    );

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, getCookieOptions());

    return res.status(201).json({
      message: 'Registration successful',
      accessToken,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        createdAt: newUser.created_at,
      },
    });
  } catch (error: any) {
    logger.error('Registration failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Registration failed due to an internal server error' });
  }
}

/**
 * Authenticate user and issue tokens
 */
export async function login(req: Request, res: Response) {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { email, password } = parseResult.data;

    // Find user by email
    const userResult = await pool.query(
      'SELECT id, username, email, password_hash, created_at FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()]
    );

    if (!userResult.rowCount || userResult.rowCount === 0) {
      // Return 401 with generic error to prevent email harvesting
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate tokens
    const { token: accessToken } = generateAccessToken(user);
    const { token: refreshToken, hash: refreshHash } = generateRefreshToken();

    // Store refresh token hash in DB
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, expiresAt]
    );

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, getCookieOptions());

    logger.info('User logged in successfully', { userId: user.id, username: user.username });

    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at,
      },
    });
  } catch (error: any) {
    logger.error('Login failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Login failed due to an internal server error' });
  }
}

/**
 * Refresh access token using rotation with breach detection
 */
export async function refresh(req: Request, res: Response) {
  try {
    const rawRefreshToken = req.cookies.refreshToken;
    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    // Hash the token to compare with database
    const tokenHash = hashToken(rawRefreshToken);

    // Fetch refresh token along with user details
    const tokenResult = await pool.query(
      `SELECT rt.id, rt.user_id, rt.revoked, rt.expires_at, u.username, u.email 
       FROM refresh_tokens rt 
       JOIN users u ON rt.user_id = u.id 
       WHERE rt.token_hash = $1 LIMIT 1`,
      [tokenHash]
    );

    if (!tokenResult.rowCount || tokenResult.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokenRow = tokenResult.rows[0];

    // ROTATION BREACH DETECTION
    // If token is already revoked, it suggests it was intercepted and used twice.
    // Immediately invalidate all tokens for this user.
    if (tokenRow.revoked) {
      logger.warn('REUSE DETECTED: Revoked refresh token reused! Revoking all sessions for user.', {
        userId: tokenRow.user_id,
        username: tokenRow.username,
      });

      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [tokenRow.user_id]);
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ error: 'Security breach detected. All sessions revoked.' });
    }

    // Check expiration
    if (new Date() > new Date(tokenRow.expires_at)) {
      logger.info('Expired refresh token presented', { userId: tokenRow.user_id });
      // Clean up the expired token
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenRow.id]);
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Valid token: Perform rotation
    // 1. Invalidate current refresh token
    await pool.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [tokenRow.id]);

    // 2. Generate new tokens
    const userPayload = { id: tokenRow.user_id, username: tokenRow.username, email: tokenRow.email };
    const { token: newAccessToken } = generateAccessToken(userPayload);
    const { token: newRefreshToken, hash: newRefreshHash } = generateRefreshToken();

    // 3. Store new refresh token hash
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [tokenRow.user_id, newRefreshHash, expiresAt]
    );

    // 4. Set cookie with new refresh token
    res.cookie('refreshToken', newRefreshToken, getCookieOptions());

    logger.debug('Refresh token rotated successfully', { userId: tokenRow.user_id });

    return res.status(200).json({
      accessToken: newAccessToken,
    });
  } catch (error: any) {
    logger.error('Token refresh failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Refresh failed due to an internal server error' });
  }
}

/**
 * Log out user: revoke refresh token and blacklist access token
 */
export async function logout(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Blacklist current access token in Redis
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      
      try {
        const decoded = jwt.decode(accessToken) as { exp?: number };
        let ttl = 15 * 60; // 15 mins default fallback
        if (decoded && decoded.exp) {
          const nowInSeconds = Math.floor(Date.now() / 1000);
          ttl = Math.max(0, decoded.exp - nowInSeconds);
        }
        
        if (ttl > 0) {
          await redis.setex(`blacklist:${user.jti}`, ttl, '1');
          logger.debug('Access token blacklisted in Redis', { jti: user.jti, ttl });
        }
      } catch (err: any) {
        logger.error('Error blacklisting access token', { error: err.message });
      }
    }

    // Revoke refresh token from DB if present
    const rawRefreshToken = req.cookies.refreshToken;
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1', [tokenHash]);
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken', { path: '/' });

    logger.info('User logged out successfully', { userId: user.userId, username: user.username });

    return res.status(200).json({ message: 'Logout successful' });
  } catch (error: any) {
    logger.error('Logout failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Logout failed due to an internal server error' });
  }
}

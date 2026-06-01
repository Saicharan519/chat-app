import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

const BCRYPT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compare plain text password with hashed password
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a cryptographically secure SHA-256 hash of a token
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Access Token Payload Structure
 */
export interface AccessTokenPayload {
  userId: string;
  username: string;
  email: string;
  jti: string;
}

/**
 * Generate a short-lived access token
 */
export function generateAccessToken(user: { id: string; username: string; email: string }): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const payload: AccessTokenPayload = {
    userId: user.id,
    username: user.username,
    email: user.email,
    jti,
  };
  
  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
  });

  return { token, jti };
}

/**
 * Verify access token and return payload
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * Generate a random UUID refresh token
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomUUID();
  const hash = hashToken(token);
  return { token, hash };
}

/**
 * Standard cookie options for HttpOnly Refresh Token
 */
export const getCookieOptions = () => {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
  };
};

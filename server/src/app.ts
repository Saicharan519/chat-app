import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import pool from './config/db';
import redis from './config/redis';
import { logger } from './utils/logger';
import authRoutes from './routes/auth.routes';
import roomRoutes from './routes/room.routes';
import messageRoutes from './routes/message.routes';
import fileRoutes from './routes/file.routes';
import aiRoutes from './routes/ai.routes';
import userRoutes from './routes/user.routes';

const app = express();

// Security middlewares
app.use(helmet());
app.use(
  cors({
    origin: env.NODE_ENV === 'production' ? false : true, // Configure properly when clients are deployed
    credentials: true,
  })
);

// Parsers
app.use(express.json());
app.use(cookieParser());

// Request logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
    });
  });
  next();
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rooms', roomRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/v1', fileRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/users', userRoutes);

// Health check endpoint (for container runtime/orchestrators)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness check endpoint (verifies third-party connections)
app.get('/ready', async (req: Request, res: Response) => {
  const checkStatus = {
    status: 'ok',
    db: 'disconnected',
    redis: 'disconnected',
  };

  let hasError = false;

  // Verify Database connection
  try {
    await pool.query('SELECT 1');
    checkStatus.db = 'connected';
  } catch (error: any) {
    checkStatus.db = 'error';
    logger.error('Readiness check failed for PostgreSQL database', { error: error.message });
    hasError = true;
  }

  // Verify Redis connection
  try {
    const redisStatus = await redis.ping();
    if (redisStatus === 'PONG') {
      checkStatus.redis = 'connected';
    } else {
      checkStatus.redis = 'error';
      hasError = true;
    }
  } catch (error: any) {
    checkStatus.redis = 'error';
    logger.error('Readiness check failed for Redis', { error: error.message });
    hasError = true;
  }

  if (hasError) {
    checkStatus.status = 'error';
    res.status(500).json(checkStatus);
  } else {
    res.status(200).json(checkStatus);
  }
});

// 404 Route handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled server error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Uncaught Exceptions & Unhandled Rejections
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception! Server is shutting down...', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection! Server is shutting down...', {
    reason: reason?.message || reason,
    stack: reason?.stack,
  });
  process.exit(1);
});

export default app;

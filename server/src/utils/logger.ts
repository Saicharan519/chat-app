import winston from 'winston';
import { env } from '../config/env';

// List of keys to mask in log metadata
const SENSITIVE_KEYS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'secret',
  'key',
  'apikey',
  'signature',
  'groq',
  'gemini',
  'supabase',
  'imagekit'
];

/**
 * Recursively masks sensitive fields in an object
 */
const maskSensitiveFields = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== 'object') {
    // If it's a string, we might also want to do a substring replace for safety, 
    // but object structure is the primary target for metadata logs.
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveFields);
  }

  const maskedObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(
      (sensitiveKey) => key.toLowerCase().includes(sensitiveKey.toLowerCase())
    );

    if (isSensitive) {
      maskedObj[key] = '[MASKED]';
    } else if (typeof value === 'object') {
      maskedObj[key] = maskSensitiveFields(value);
    } else {
      maskedObj[key] = value;
    }
  }

  return maskedObj;
};

// Custom Winston formatter to mask sensitive data
const maskFormat = winston.format((info) => {
  const maskedInfo = { ...info };
  
  // Mask properties in metadata/info object itself
  for (const key of Object.keys(maskedInfo)) {
    if (SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey.toLowerCase()))) {
      maskedInfo[key] = '[MASKED]';
    }
  }

  // Handle nested metadata
  if (maskedInfo.metadata) {
    maskedInfo.metadata = maskSensitiveFields(maskedInfo.metadata);
  }
  
  // Handled args/params if they exist
  if (maskedInfo.splat) {
    maskedInfo.splat = maskSensitiveFields(maskedInfo.splat);
  }

  return maskedInfo;
});

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  maskFormat(),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let metaStr = '';
    if (Object.keys(metadata).length > 0) {
      // Exclude standard labels to avoid redundancy
      const cleanMeta = { ...metadata };
      delete cleanMeta.timestamp;
      delete cleanMeta.level;
      if (Object.keys(cleanMeta).length > 0) {
        metaStr = ` ${JSON.stringify(cleanMeta)}`;
      }
    }
    return `[${timestamp}] [${level.toUpperCase()}]: ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: customFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    })
  ]
});

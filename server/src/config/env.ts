import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  PORT: z.string().transform((val) => parseInt(val, 10)).default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL starting with postgres:// or postgresql://' }),
  
  // Upstash Redis
  UPSTASH_REDIS_URL: z.string().url({ message: 'UPSTASH_REDIS_URL must be a valid redis:// or rediss:// URL' }),
  
  // JWT Secrets
  JWT_ACCESS_SECRET: z.string().min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters long' }),
  JWT_REFRESH_SECRET: z.string().min(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters long' }),
  
  // ImageKit
  IMAGEKIT_PUBLIC_KEY: z.string().min(1, { message: 'IMAGEKIT_PUBLIC_KEY is required' }),
  IMAGEKIT_PRIVATE_KEY: z.string().min(1, { message: 'IMAGEKIT_PRIVATE_KEY is required' }),
  IMAGEKIT_URL_ENDPOINT: z.string().url({ message: 'IMAGEKIT_URL_ENDPOINT must be a valid URL' }),
  
  // AI Keys
  GROQ_API_KEY: z.string().min(1, { message: 'GROQ_API_KEY is required' }),
  GEMINI_API_KEY: z.string().min(1, { message: 'GEMINI_API_KEY is required' }),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    const formattedErrors = result.error.format();
    for (const [key, value] of Object.entries(formattedErrors)) {
      if (key !== '_errors') {
        const errorDetails = (value as any)._errors?.join(', ');
        console.error(`   - ${key}: ${errorDetails || 'Invalid value'}`);
      }
    }
    process.exit(1);
  }

  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;

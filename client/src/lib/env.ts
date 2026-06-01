import { z } from 'zod';

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url({ message: 'VITE_API_BASE_URL must be a valid URL' }),
  VITE_SOCKET_URL: z.string().url({ message: 'VITE_SOCKET_URL must be a valid URL' }),
});

const parseEnv = () => {
  const result = envSchema.safeParse(import.meta.env);

  if (!result.success) {
    console.error('❌ Invalid client environment variables:');
    const formattedErrors = result.error.format();
    for (const [key, value] of Object.entries(formattedErrors)) {
      if (key !== '_errors') {
        const errorDetails = (value as any)._errors?.join(', ');
        console.error(`   - ${key}: ${errorDetails || 'Invalid value'}`);
      }
    }
    // We don't call process.exit(1) on browser, we just throw an error or log it.
    throw new Error('Invalid client environment variables');
  }

  return result.data;
};

export const env = parseEnv();

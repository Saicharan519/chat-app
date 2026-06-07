import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

// Managed Postgres providers (Supabase, Neon, Render, etc.) require SSL.
// `pg` doesn't auto-enable SSL from a `?sslmode=require` query parameter, so we
// force it on whenever NODE_ENV=production. `rejectUnauthorized: false` is
// needed because providers like Supabase use intermediate certs that aren't
// in Node's default trust store — the connection is still encrypted.
const useSSL = env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // 10s — free-tier cold starts can be slow
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

// Log pool errors
pool.on('error', (err) => {
  logger.error('Unexpected error on idle pg client', { error: err.message, stack: err.stack });
});

/**
 * Executes a query on the database.
 * Auto-logs query execution time and metadata in development mode.
 */
export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rowsCount: res.rowCount });
    return res;
  } catch (error: any) {
    const duration = Date.now() - start;
    logger.error('Query execution failed', { text, duration, error: error.message });
    throw error;
  }
};

/**
 * Gets a client from the connection pool for transaction support.
 */
export const getClient = async () => {
  const client = await pool.connect();
  const queryFunc = client.query.bind(client);
  const releaseFunc = client.release.bind(client);
  
  // Monkey-patch client.release to track client checkout
  let timeout = setTimeout(() => {
    logger.warn('A database client has been checked out for more than 10 seconds! Possible connection leak.');
  }, 10000);

  client.release = (err?: boolean | Error) => {
    clearTimeout(timeout);
    return releaseFunc(err);
  };

  return client;
};

export default pool;

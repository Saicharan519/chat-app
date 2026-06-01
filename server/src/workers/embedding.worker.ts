import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../config/queue';
import { EmbeddingJobData } from '../queues/embedding.queue';
import { generateEmbedding, formatVectorLiteral } from '../utils/gemini.service';
import pool from '../config/db';
import { logger } from '../utils/logger';

let workerInstance: Worker | null = null;

/**
 * Start the embedding background worker.
 * Should be called once at server startup (index.ts).
 * The worker fetches message text, calls Gemini, and writes the
 * 768-dim vector into messages.embedding via pgvector.
 */
export function startEmbeddingWorker(): Worker {
  const worker = new Worker<EmbeddingJobData>(
    'embedding',
    async (job: Job<EmbeddingJobData>) => {
      const { messageId } = job.data;

      // 1. Fetch message content from DB
      const msgRes = await pool.query(
        `SELECT content, type FROM messages WHERE id = $1 AND deleted_at IS NULL`,
        [messageId]
      );

      if (msgRes.rowCount === 0) {
        logger.warn('Embedding worker: message not found or deleted', { messageId });
        return; // Job complete — no retry needed
      }

      const { content, type } = msgRes.rows[0];

      // Only embed text-type messages with actual content
      if (type !== 'text' || !content?.trim()) {
        logger.debug('Embedding worker: skipping non-text or empty message', { messageId, type });
        return;
      }

      // 2. Generate embedding via Gemini
      const embedding = await generateEmbedding(content);
      if (!embedding) {
        throw new Error(`Gemini returned null embedding for message ${messageId}`);
      }

      // 3. Persist vector to Postgres using pgvector cast
      await pool.query(
        `UPDATE messages SET embedding = $1::vector WHERE id = $2`,
        [formatVectorLiteral(embedding), messageId]
      );

      logger.info('Embedding stored successfully', { messageId });
    },
    {
      connection: bullmqConnection,
      concurrency: 5, // Process up to 5 jobs in parallel
    }
  );

  worker.on('completed', (job) => {
    logger.debug('Embedding job completed', { jobId: job.id, messageId: job.data.messageId });
  });

  worker.on('failed', (job, err) => {
    logger.error('Embedding job failed', {
      jobId: job?.id,
      messageId: job?.data?.messageId,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Embedding worker error', { error: err.message });
  });

  logger.info('🔄 Embedding worker started (concurrency: 5)');
  workerInstance = worker;
  return worker;
}

/**
 * Gracefully close the worker.
 */
export async function stopEmbeddingWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    logger.info('Embedding worker stopped.');
    workerInstance = null;
  }
}

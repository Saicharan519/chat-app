import { Queue } from 'bullmq';
import { bullmqConnection } from '../config/queue';
import { logger } from '../utils/logger';

export interface EmbeddingJobData {
  messageId: string;
}

// Single shared queue instance
export const embeddingQueue = new Queue<EmbeddingJobData>('embedding', {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

/**
 * Add a message embedding job to the queue.
 * Called after every new text message is persisted to Postgres.
 */
export async function addEmbeddingJob(messageId: string): Promise<void> {
  try {
    await embeddingQueue.add('embed-message', { messageId });
    logger.info('Embedding job queued', { messageId });
  } catch (err: any) {
    // Non-critical — log and continue. The message was already saved.
    logger.warn('Failed to queue embedding job', { messageId, error: err.message });
  }
}

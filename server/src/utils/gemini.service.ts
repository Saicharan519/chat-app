import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { logger } from './logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
// gemini-embedding-001: the current production embedding model.
// outputDimensionality:768 truncates to match our pgvector(768) schema.
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

/**
 * Generate a 768-dimensional embedding vector for the provided text.
 * Returns null if the text is empty or the API call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const result = await embeddingModel.embedContent({
    content: { parts: [{ text: trimmed }], role: 'user' },
    // Truncate from 3072 → 768 dims to match schema.sql vector(768)
    taskType: 'RETRIEVAL_DOCUMENT' as any,
  } as any);

  const values = result.embedding.values;

  if (!values || values.length === 0) {
    logger.warn('Gemini returned empty embedding');
    return null;
  }

  // Truncate to 768 if model returned more
  return values.slice(0, 768);
}

/**
 * Format a float[] as a pgvector literal: '[0.1,0.2,...]'
 */
export function formatVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}


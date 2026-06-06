import { z } from 'zod';

export const smartReplySchema = z.object({
  roomId: z.string().uuid({ message: 'roomId must be a valid UUID' }),
});

export const toneSchema = z.object({
  text: z.string().min(1, 'text is required').max(5000, 'text must be under 5000 characters'),
  tone: z.enum(['professional', 'friendly', 'empathetic', 'concise', 'witty'], {
    errorMap: () => ({ message: 'tone must be one of: professional, friendly, empathetic, concise, witty' }),
  }),
});

export const editorSchema = z.object({
  text: z.string().min(1, 'text is required').max(5000, 'text must be under 5000 characters'),
  instruction: z.string().min(1, 'instruction is required').max(500, 'instruction must be under 500 characters'),
});

export const summarizeSchema = z.object({
  roomId: z.string().uuid({ message: 'roomId must be a valid UUID' }),
});

export const assistantSchema = z.object({
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1, 'content is required'),
    })
  ).min(1, 'history must contain at least one message'),
  roomId: z.string().uuid().optional(),
});

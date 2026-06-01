import { z } from 'zod';

export const queryMessagesSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
});

export const createMessageSchema = z.object({
  content: z
    .string({ required_error: 'Content is required' })
    .trim()
    .min(1, { message: 'Message content cannot be empty' })
    .max(5000, { message: 'Message content cannot exceed 5000 characters' }),
});

export const editMessageSchema = z.object({
  content: z
    .string({ required_error: 'Content is required' })
    .trim()
    .min(1, { message: 'Message content cannot be empty' })
    .max(5000, { message: 'Message content cannot exceed 5000 characters' }),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;

import { z } from 'zod';

export const signUploadSchema = z.object({
  roomId: z.string().uuid({ message: 'Invalid Room ID' }),
});

export const registerFileSchema = z.object({
  file_url: z.string().url({ message: 'Invalid file URL' }),
  file_name: z.string().min(1, { message: 'File name is required' }).max(255),
  file_size: z.number().int().min(1).max(25 * 1024 * 1024, { message: 'File size must not exceed 25MB' }),
  file_id: z.string().min(1, { message: 'File ID is required' }),
  type: z.enum(['image', 'file'], { message: 'Type must be image or file' }),
});

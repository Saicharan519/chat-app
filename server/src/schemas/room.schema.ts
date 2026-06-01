import { z } from 'zod';

export const createRoomSchema = z
  .object({
    type: z.enum(['direct', 'group'], {
      required_error: 'Room type is required',
    }),
    name: z
      .string()
      .trim()
      .min(1, { message: 'Room name cannot be empty' })
      .max(100, { message: 'Room name cannot exceed 100 characters' })
      .optional(),
    memberIds: z
      .array(z.string().uuid({ message: 'Each member ID must be a valid UUID' }))
      .min(1, { message: 'Must include at least one member' })
      .max(100, { message: 'Cannot exceed 100 members initially' }),
  })
  .refine(
    (data) => {
      if (data.type === 'group' && !data.name) {
        return false;
      }
      return true;
    },
    {
      message: 'Group rooms must have a name',
      path: ['name'],
    }
  );

export const addMemberSchema = z.object({
  userId: z.string().uuid({ message: 'User ID must be a valid UUID' }),
});

export const queryRoomMembersSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .pipe(z.number().int().min(0)),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;

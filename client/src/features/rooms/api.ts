import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';

export interface Room {
  id: string;
  name: string | null;
  type: 'direct' | 'group';
  created_by: string;
  created_at: string;
  role: string;
  last_read_at: string;
  other_member: {
    id: string;
    username: string;
    email: string;
  } | null;
}

export interface CreateRoomDto {
  type: 'direct' | 'group';
  name?: string;
  memberIds: string[];
}

export function useRooms() {
  return useQuery<Room[]>({
    queryKey: ['rooms'],
    queryFn: async () => {
      const response = await client.get<Room[]>('/rooms');
      return response.data;
    },
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();

  return useMutation<Room, Error, CreateRoomDto>({
    mutationFn: async (dto) => {
      const response = await client.post<Room>('/rooms', dto);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

export interface RoomMember {
  id: string;
  username: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface RoomMembersResponse {
  members: RoomMember[];
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();

  return useMutation<{ roomId: string; roomDeleted: boolean }, Error, string>({
    mutationFn: async (roomId) => {
      const response = await client.delete<{ roomId: string; roomDeleted: boolean }>(
        `/rooms/${roomId}`
      );
      return response.data;
    },
    onSuccess: (_data, roomId) => {
      // Drop room from list, clear cached messages
      queryClient.setQueryData<Room[]>(['rooms'], (old) =>
        old ? old.filter((r) => r.id !== roomId) : old
      );
      queryClient.removeQueries({ queryKey: ['messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

export function useRoomMembers(roomId: string | undefined) {
  return useQuery<RoomMembersResponse, Error>({
    queryKey: ['rooms', 'members', roomId],
    queryFn: async () => {
      const response = await client.get<RoomMembersResponse>(`/rooms/${roomId}/members`, {
        params: { limit: 100, offset: 0 },
      });
      return response.data;
    },
    enabled: !!roomId,
  });
}


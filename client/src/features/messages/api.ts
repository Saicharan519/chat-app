import { useInfiniteQuery, useQuery, useMutation } from '@tanstack/react-query';
import { client } from '@/lib/client';

export interface MessageReaction {
  emoji: string;
  users: string[];
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  type: 'text' | 'image' | 'file' | 'system';
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  reactions?: MessageReaction[];
}

export interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

export function useMessages(roomId: string | undefined) {
  return useInfiniteQuery<MessagesResponse, Error>({
    queryKey: ['messages', roomId],
    queryFn: async ({ pageParam }) => {
      const response = await client.get<MessagesResponse>(`/messages/room/${roomId}`, {
        params: {
          limit: 20,
          cursor: pageParam || undefined,
        },
      });
      return response.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!roomId,
  });
}

export interface SemanticSearchResult {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username: string;
  type: 'text' | 'image' | 'file' | 'system';
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  similarity: number;
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  total: number;
}

export function useSemanticSearch(roomId: string | undefined, query: string) {
  return useQuery<SemanticSearchResponse, Error>({
    queryKey: ['messages', 'search', roomId, query],
    queryFn: async () => {
      const response = await client.get<SemanticSearchResponse>(
        `/messages/room/${roomId}/semantic-search`,
        { params: { q: query } }
      );
      return response.data;
    },
    enabled: !!roomId && query.trim().length >= 2,
    staleTime: 1000 * 60,
  });
}

export function useSendMessage() {
  return useMutation<Message, Error, { roomId: string; content: string }>({
    mutationFn: async ({ roomId, content }) => {
      const response = await client.post<Message>(`/messages/room/${roomId}`, { content });
      return response.data;
    },
  });
}

export function useEditMessage() {
  return useMutation<Message, Error, { messageId: string; content: string }>({
    mutationFn: async ({ messageId, content }) => {
      const response = await client.patch<Message>(`/messages/${messageId}`, { content });
      return response.data;
    },
  });
}

export function useDeleteMessage() {
  return useMutation<void, Error, { messageId: string }>({
    mutationFn: async ({ messageId }) => {
      await client.delete(`/messages/${messageId}`);
    },
  });
}

export function useToggleReaction() {
  return useMutation<
    { messageId: string; reactions: MessageReaction[] },
    Error,
    { messageId: string; emoji: string }
  >({
    mutationFn: async ({ messageId, emoji }) => {
      const response = await client.post<{ messageId: string; reactions: MessageReaction[] }>(
        `/messages/${messageId}/react`,
        { emoji }
      );
      return response.data;
    },
  });
}

export function useUploadFile() {
  return useMutation<Message, Error, { roomId: string; file: File }>({
    mutationFn: async ({ roomId, file }) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await client.post<Message>(`/rooms/${roomId}/files`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
  });
}



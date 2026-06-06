import { useQuery, useMutation } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { tokenStore } from '@/lib/tokenStore';

export interface SmartReplyResponse {
  replies: string[];
  cached: boolean;
}

export interface ToneResponse {
  result: string;
}

export interface EditorResponse {
  result: string;
}

export interface AssistantMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function useSmartReplies(roomId: string | undefined, _latestMessageId: string | null) {
  return useQuery<SmartReplyResponse, Error>({
    queryKey: ['smart-replies', roomId],
    queryFn: async () => {
      const response = await client.post<SmartReplyResponse>('/ai/smart-reply', { roomId });
      return response.data;
    },
    enabled: !!roomId,
    staleTime: 1000 * 60 * 5, // Cache for 5 mins
    refetchOnWindowFocus: false,
  });
}

export function useRefineTone() {
  return useMutation<
    ToneResponse,
    Error,
    { text: string; tone: 'professional' | 'friendly' | 'empathetic' | 'concise' | 'witty' }
  >({
    mutationFn: async (variables) => {
      const response = await client.post<ToneResponse>('/ai/tone', variables);
      return response.data;
    },
  });
}

export function useRefineCustom() {
  return useMutation<EditorResponse, Error, { text: string; instruction: string }>({
    mutationFn: async (variables) => {
      const response = await client.post<EditorResponse>('/ai/editor', variables);
      return response.data;
    },
  });
}

export async function streamSse(
  url: string,
  body: any,
  onChunk: (content: string) => void,
  onDone: () => void,
  onError: (err: any) => void,
  signal?: AbortSignal
) {
  const token = tokenStore.getToken();
  // VITE_API_BASE_URL is required — fail loudly if missing rather than silently
  // pointing at a wrong host (this used to default to :5000 while the server
  // listens on :4000, masking misconfigurations).
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  if (!apiBaseUrl) {
    onError(new Error('VITE_API_BASE_URL is not configured. Set it in client/.env.'));
    return;
  }
  
  try {
    const response = await fetch(`${apiBaseUrl}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `Request failed: ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error || errJson.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.content) {
              onChunk(parsed.content);
            }
          } catch (e: any) {
            if (e.message && (e.message.includes('JSON') || e.message.includes('Unexpected'))) {
              // Ignore standard json parse error from potential incomplete line or different format
            } else {
              throw e;
            }
          }
        }
      }
    }
    // Final check for remaining buffer
    if (buffer.startsWith('data: ')) {
      const dataStr = buffer.slice(6).trim();
      if (dataStr === '[DONE]') {
        onDone();
        return;
      }
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.content) onChunk(parsed.content);
      } catch (_) {}
    }
    onDone();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return;
    }
    onError(error);
  }
}

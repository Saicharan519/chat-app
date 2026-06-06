import Groq from 'groq-sdk';
import { env } from '../config/env';
import { logger } from './logger';
import {
  SMART_REPLY_SYSTEM_PROMPT,
  TONE_SYSTEM_PROMPT,
  EDITOR_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
} from './ai.prompts';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

export interface ChatMessage {
  sender: string;
  content: string;
}

/**
 * Generate 3 smart reply suggestions written from the current user's perspective.
 */
export async function generateSmartReplies(
  messages: ChatMessage[],
  currentUsername: string,
  currentUserSpokeLast: boolean
): Promise<string[]> {
  const transcript = messages.map((m) => `${m.sender}: ${m.content}`).join('\n');

  const directive = currentUserSpokeLast
    ? `"${currentUsername}" sent the most recent message. Suggest 3 natural FOLLOW-UP messages they could send next to continue the conversation — do not echo or restate what they already said.`
    : `Someone other than "${currentUsername}" sent the most recent message. Suggest 3 different ways "${currentUsername}" could REPLY to that message.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SMART_REPLY_SYSTEM_PROMPT(currentUsername) },
      {
        role: 'user',
        content: `Conversation so far:\n${transcript}\n\n${directive}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 300,
  });

  const raw = completion.choices[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(raw);
    // Handle { "replies": [...] } and direct array formats
    if (Array.isArray(parsed)) return parsed.slice(0, 3);
    for (const val of Object.values(parsed)) {
      if (Array.isArray(val)) return (val as string[]).slice(0, 3);
    }
  } catch {
    logger.warn('Failed to parse smart replies JSON', { raw });
  }
  return [];
}

/**
 * Rewrite text with a specific tone preset.
 */
export async function refineTone(text: string, tone: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: TONE_SYSTEM_PROMPT(tone) },
      { role: 'user', content: `<text>${text}</text>` },
    ],
    temperature: 0.6,
    max_tokens: 1000,
  });
  return completion.choices[0]?.message?.content?.trim() || text;
}

/**
 * Rewrite text using a custom editing instruction.
 */
export async function refineCustom(text: string, instruction: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: EDITOR_SYSTEM_PROMPT },
      { role: 'user', content: `Instruction: ${instruction}\n\n<text>${text}</text>` },
    ],
    temperature: 0.6,
    max_tokens: 1000,
  });
  return completion.choices[0]?.message?.content?.trim() || text;
}

/**
 * Returns a streaming Groq completion for SSE-based summarization.
 */
export async function getChatSummaryStream(messages: ChatMessage[]) {
  const transcript = messages.map((m) => `${m.sender}: ${m.content}`).join('\n');

  return groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
      { role: 'user', content: `Chat transcript:\n${transcript}\n\nProvide a structured summary.` },
    ],
    stream: true,
    temperature: 0.4,
    max_tokens: 1000,
  });
}

/**
 * Returns a streaming Groq completion for the AI Assistant.
 * When roomContext is provided, the assistant grounds its answers in that transcript.
 */
export async function getAssistantStream(
  history: { role: 'user' | 'assistant' | 'system'; content: string }[],
  roomContext?: ChatMessage[]
) {
  let systemContent =
    'You are a helpful, friendly, and knowledgeable AI assistant in a team chat application. Keep your answers clear, concise, and helpful.';

  if (roomContext && roomContext.length > 0) {
    const transcript = roomContext.map((m) => `${m.sender}: ${m.content}`).join('\n');
    systemContent = `You are ContextChat's AI Co-pilot, embedded in a team chat. The user is asking questions about an ongoing conversation. Use ONLY the transcript below to answer questions about what was said, decided, or discussed. When citing what someone said, mention the sender by name.

If the answer is not present in the transcript, say so plainly — do NOT invent facts.

For general questions unrelated to the transcript, answer normally using your own knowledge.

--- ROOM TRANSCRIPT (most recent messages) ---
${transcript}
--- END TRANSCRIPT ---`;
  }

  return groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemContent },
      ...history,
    ],
    stream: true,
    temperature: 0.6,
    max_tokens: 1000,
  });
}

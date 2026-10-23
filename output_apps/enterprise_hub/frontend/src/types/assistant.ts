/** Contract of POST /enterprise-hub/assistant/chat (AssistantChatDto / AssistantChatResponseDto). */

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatRequest {
  message: string;
  history?: AssistantHistoryMessage[];
}

export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error: string | null;
}

export interface AssistantChatResponse {
  answer: string;
  toolCalls: AssistantToolCall[];
  model: string | null;
}

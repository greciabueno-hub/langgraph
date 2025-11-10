// add next to automotiveApiNode (or a new file)
import axios from "axios";

export async function fetchConversation(baseUrl: string, customerId: string, dealershipId?: string) {
  const base = `${baseUrl}/customers/${encodeURIComponent(customerId)}/conversations`;
  const url = typeof dealershipId === "string" && dealershipId.length > 0
    ? `${base}?dealershipId=${encodeURIComponent(dealershipId)}`
    : base;
  const { data } = await axios.get(url, { timeout: 30000 });
  return data; // expect { updatedState, messages, ... }
}

type Message = { role?: string; content?: string; createdAt?: string };
type Conversation = { updatedAt?: string; messages?: Message[] };

export function pickLatestAssistantFromConversations(payload: unknown): string {
  const convs = Array.isArray(payload) ? (payload as Conversation[]) : [];
  if (convs.length === 0) return "";

  // Pick the most recently updated conversation
  const latestConv = [...convs].sort((a, b) =>
    new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime()
  ).pop();

  const msgs = Array.isArray(latestConv?.messages) ? latestConv!.messages : [];
  if (msgs.length === 0) return "";

  // Prefer the most recent ASSISTANT message
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "ASSISTANT" && typeof m.content === "string") return m.content;
  }

  // Fallback: the very last message content (whatever the role)
  const last = msgs[msgs.length - 1];
  return typeof last?.content === "string" ? last.content : "";
}

// For POST responses or single-conversation GETs where payload has a top-level messages array.
export function pickLatestAssistant(payload: any): string {
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
  if (msgs.length === 0) return "";
  // Prefer the most recent ASSISTANT
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "ASSISTANT" && typeof m.content === "string") return m.content;
  }
  const last = msgs[msgs.length - 1];
  return typeof last?.content === "string" ? last.content : "";
}
// add next to automotiveApiNode (or a new file)
import axios from "axios";

export async function fetchConversation(baseUrl: string, customerId: string, dealershipId?: string) {
  const base = `${baseUrl}/customers/${encodeURIComponent(customerId)}/conversations`;
  const url = typeof dealershipId === "string" && dealershipId.length > 0
    ? `${base}?dealershipId=${encodeURIComponent(dealershipId)}`
    : base;
  if (process.env.DEBUG_CONVERSATION === "true") {
    console.log("[conversationApi] GET", url);
  }
  const { data } = await axios.get(url, { timeout: 30000 });
  if (process.env.DEBUG_CONVERSATION === "true") {
    console.log("[conversationApi] RESPONSE");
    console.dir(data, { depth: null });
  }
  return data; // expect { updatedState, messages, ... }
}



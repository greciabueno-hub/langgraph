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


// conversationApi.ts (or inline in simulator.ts)
// export function normalizeConversationHistory(convoPayload: any): {
//     history: string[];
//     lastAssistant?: string;
//   } {
//     const conv = Array.isArray(convoPayload) ? convoPayload[0] : convoPayload;
//   const discoveryHist: string[] =
//     conv?.contextData?.discoveryContext?.conversationHistory ?? [];
//   const appointmentHist: string[] =
//     conv?.contextData?.appointmentContext?.conversationHistory ?? [];

//   // Merge both histories, preserving order and removing duplicates
//   const mergedRaw: string[] = [];
//   const seen = new Set<string>();
//   for (const line of [...discoveryHist, ...appointmentHist]) {
//     const t = String(line ?? "");
//     if (!seen.has(t)) {
//       seen.add(t);
//       mergedRaw.push(t);
//     }
//   }
  
//   const mapped = mergedRaw.map((line: string) => {
//       const t = String(line);
//       if (/^\s*ASSISTANT\s*:/i.test(t)) {
//         return "AGENT: " + t.replace(/^\s*ASSISTANT\s*:\s*/i, "");
//       }
//       if (/^\s*USER\s*:/i.test(t)) {
//         return "CUSTOMER: " + t.replace(/^\s*USER\s*:\s*/i, "");
//       }
//       // No label → treat as assistant
//       return "AGENT: " + t;
//     });
  
//     // Find last assistant line
//     const lastAssistantIdx = [...mapped]
//       .reverse()
//       .findIndex((l) => l.startsWith("AGENT: "));
//   let lastAssistant: string | undefined;
//   if (lastAssistantIdx >= 0) {
//     const idx = mapped.length - 1 - lastAssistantIdx;
//     if (idx >= 0 && idx < mapped.length) {
//       const candidate = mapped[idx];
//       if (typeof candidate === "string") {
//         lastAssistant = candidate.replace(/^AGENT:\s*/i, "");
//       }
//     }
//   }
 
//   const result: { history: string[]; lastAssistant?: string } = { history: mapped };
//   if (typeof lastAssistant === "string") {
//     result.lastAssistant = lastAssistant;
//   }
//   return result;
//   }
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage } from "@langchain/core/messages";
import { MessagesAnnotation } from "@langchain/langgraph";

// Describe how the simulated customer should behave.
const CUSTOMER_SYSTEM_INSTRUCTION = [
  "You are a car buyer (customer) speaking with a dealership salesperson.",
  "Be practical, polite, and concise.",
  "Primary goal: clearly state preferences and constraints so the salesperson can recommend options.",
  "Output policy: 1–4 sentences. Focus on answering the salesperson’s last question.",
  "If something is unclear, ask at most one clarifying question.",
  "Keep answers specific (budget, body type, new/used, must‑haves, timeline).",
  "Do not propose vehicles yourself; let the salesperson propose options first.",
].join(" \n");

// Reuse a single model instance across calls.
const model = new ChatOpenAI({
  // Choose a small, fast model by default. Adjust if you prefer another model.
  model: "gpt-4o-mini",
  temperature: 0.4,
});

export type ConversationState = typeof MessagesAnnotation.State;

// Node function: reads state.messages, generates exactly one customer reply, returns a partial update.
export async function customer(state: ConversationState) {
  const response = await model.invoke([
    new SystemMessage(CUSTOMER_SYSTEM_INSTRUCTION),
    // Include prior conversation so the model can answer the salesperson's latest question.
    ...state.messages,
  ]);

  // Return a partial state update: one new assistant message appended by the graph runtime.
  return { messages: [response] };
}

export default customer;



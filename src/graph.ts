import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { createAutomotiveApiNode } from "./agents/automotiveApiNode.js";
import { fetchConversation, normalizeConversationHistory, selectConversation } from "./agents/conversationApi.js";
import { createCustomerSimulator } from "./agents/customerSimulator.js";
import "dotenv/config";

type ConversationState = typeof MessagesAnnotation.State;

const MAX_AGENT_TURNS = Number(process.env.MAX_TURNS || 5);

function countAiMessages(messages: BaseMessage[]) {
  return messages.filter((m) => m.type === "ai").length;
}

function extractLatestAssistant(payload: any): string {
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
  if (msgs.length === 0) return "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "ASSISTANT" && typeof m?.content === "string") return m.content as string;
  }
  const last = msgs[msgs.length - 1];
  return typeof last?.content === "string" ? (last.content as string) : "";
}

// Customer node: simulate customer using the persona, reading last agent reply and full history
async function customer(state: ConversationState) {
  const persona =
    process.env.CUSTOMER_PERSONA ||
    "Car buyer who wants to hear about financing black sedans.";
  const sim = createCustomerSimulator(persona);
 
  const baseUrl = process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const customerId = process.env.CUSTOMER_ID || "demo-customer";
  const dealershipId = process.env.DEALERSHIP_ID || "4675";
  const desiredConversationId = process.env.CONVERSATION_ID;
 
  // Pull the latest backend conversation context, but keep this node as the only output
  const convoPayload = await fetchConversation(baseUrl, customerId, dealershipId);
  const selected = selectConversation(convoPayload, desiredConversationId);
  const { history: mappedHistory, lastAssistant } = normalizeConversationHistory(selected);
 
  const agentReply =
    lastAssistant ||
    (typeof [...state.messages].reverse().find((m) => m.type === "ai")?.content === "string"
      ? ([...state.messages].reverse().find((m) => m.type === "ai")!.content as string)
      : "Hello! How can I help you today?");
 
  const { customerMessage } = await sim.invoke({
    agentReply,
    history: mappedHistory,
  });
 
  // Clean any accidental labels the model might add
  const cleaned = (typeof customerMessage === "string" ? customerMessage : "").replace(/^\s*(?:customer|user)\s*:\s*/i, "");
  return { messages: [new HumanMessage(cleaned)] };
}

// Adapter node that calls your backend salesperson via HTTP and returns one assistant message
async function salesperson(state: ConversationState) {
  const baseUrl = process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const channel = (process.env.SALES_CHANNEL as "SMS" | "EMAIL" | "WEB_CHAT") || "SMS";
  const customerId = process.env.CUSTOMER_ID || "demo-customer";
  const conversationId = process.env.CONVERSATION_ID;
  const dealershipId = process.env.DEALERSHIP_ID || "4675";
  const fromNumber = process.env.FROM || "+15551234567";
 
  if (!conversationId) {
    throw new Error(
      "CONVERSATION_ID is not set. Refusing to fallback to a placeholder to avoid creating a new conversation."
    );
  }

  const lastHuman = [...state.messages].reverse().find((m) => m.type === "human");
  const content = typeof lastHuman?.content === "string" ? lastHuman.content : "";

  const api = createAutomotiveApiNode(baseUrl);
  const result = await api.invoke({
    content,
    channel,
    customerId,
    conversationId,
    metadata: { dealershipId, from: fromNumber, sendRealResponses: true },
  });

  const reply = extractLatestAssistant(result) || "";
  return { messages: [new AIMessage(reply)] };
}

const app = new StateGraph(MessagesAnnotation)
  .addNode("customer", customer)
  .addNode("salesperson", salesperson)
  .addEdge(START, "customer")
  .addConditionalEdges(
    "customer",
    (state) => (countAiMessages(state.messages) >= MAX_AGENT_TURNS ? END : "salesperson"),
    ["salesperson", END]
  )
  .addConditionalEdges(
    "salesperson",
    (state) => (countAiMessages(state.messages) >= MAX_AGENT_TURNS ? END : "customer"),
    ["customer", END]
  )
  .compile();

export default app;


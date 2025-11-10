import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { createAutomotiveApiNode } from "./agents/automotiveApiNode.js";
import { fetchConversation, normalizeConversationHistory } from "./agents/conversationApi.js";
import { createCustomerSimulator } from "./agents/customerSimulator.js";
import "dotenv/config";
import "dotenv/config";

type ConversationState = typeof MessagesAnnotation.State;

const MAX_AGENT_TURNS = Number(process.env.MAX_TURNS || 10);

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

// Sync node: fetch full history from backend and append any new lines to state.messages
async function syncFromBackend(state: ConversationState) {
  const baseUrl = process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const customerId = process.env.CUSTOMER_ID || "demo-customer";
  const dealershipId = process.env.DEALERSHIP_ID || "4675";

  // Wrap fetch in a Runnable so LangSmith traces this step
  const fetchConvo = new RunnableLambda({
    func: async (input: { baseUrl: string; customerId: string; dealershipId?: string }) => {
      return await fetchConversation(input.baseUrl, input.customerId, input.dealershipId);
    },
  });
  const convo = await fetchConvo.invoke({ baseUrl, customerId, dealershipId });
  const { history: mapped } = normalizeConversationHistory(convo);
  // Optional visibility in console while developing
  console.log("[syncFromBackend] fetchedLines:", mapped.length, "customerId:", customerId, "dealer:", dealershipId);

  // Build a quick set of existing lines to avoid duplicates
  const existingLines = new Set(
    state.messages.map((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      return (m.type === "ai" ? "AGENT: " : m.type === "human" ? "CUSTOMER: " : "") + text;
    })
  );

  const newMessages: (AIMessage | HumanMessage)[] = [];
  for (const line of mapped) {
    if (!existingLines.has(line)) {
      if (line.startsWith("AGENT: ")) {
        newMessages.push(new AIMessage(line.replace(/^AGENT:\s*/i, "")));
      } else if (line.startsWith("CUSTOMER: ")) {
        newMessages.push(new HumanMessage(line.replace(/^CUSTOMER:\s*/i, "")));
      }
    }
  }
  if (newMessages.length === 0) return { messages: [] as BaseMessage[] };
  return { messages: newMessages };
}

// Customer node: simulate customer using the persona, reading last agent reply and full history
async function customer(state: ConversationState) {
  const persona =
    process.env.CUSTOMER_PERSONA ||
    "Car buyer who wants to hear about black colored family cars.";
  const sim = createCustomerSimulator(persona);

  const lastAgent = [...state.messages].reverse().find((m) => m.type === "ai");
  const agentReply =
    (typeof lastAgent?.content === "string" ? lastAgent.content : "") || "Hello! How can I help you today?";

  const historyLines = state.messages.map((m) => {
    const text = typeof m.content === "string" ? m.content : "";
    return (m.type === "ai" ? "AGENT: " : m.type === "human" ? "CUSTOMER: " : "") + text;
  });

  const { customerMessage } = await sim.invoke({
    agentReply,
    history: historyLines,
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
  const conversationId = process.env.CONVERSATION_ID || "demo-conv";
  const dealershipId = process.env.DEALERSHIP_ID || "4675";
  const fromNumber = process.env.FROM || "+15551234567";

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
  .addNode("sync", syncFromBackend)
  .addNode("customer", customer)
  .addNode("salesperson", salesperson)
  .addEdge(START, "sync")
  .addEdge("sync", "customer")
  .addConditionalEdges(
    "customer",
    (state) => (countAiMessages(state.messages) >= MAX_AGENT_TURNS ? END : "salesperson"),
    ["salesperson", END]
  )
  .addConditionalEdges(
    "salesperson",
    (state) => (countAiMessages(state.messages) >= MAX_AGENT_TURNS ? END : "sync"),
    ["sync", END]
  )
  .compile();

export default app;


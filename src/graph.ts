import { StateGraph, MessagesAnnotation, START, END, Annotation } from "@langchain/langgraph";
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { createAutomotiveApiNode } from "./agents/automotiveApiNode.js";
import { fetchConversation } from "./agents/conversationApi.js";
import { createCustomerSimulator } from "./agents/customerSimulator.js";
import { createConversationJudge } from "./agents/judge.js";
import "dotenv/config";

// Extend MessagesAnnotation to include appointmentCompleted flag
const ConversationAnnotation = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  appointmentCompleted: Annotation<boolean>({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
});

type ConversationState = typeof ConversationAnnotation.State;

const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 100);

function countTotalMessages(messages: BaseMessage[]) {
  return messages.length;
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

  // Only fetch from backend on the very first sync; afterwards we rely on POST responses.
  if (state.messages.length > 0) {
    if (process.env.DEBUG_CONVERSATION === "true") {
      console.log("[syncFromBackend] skipping GET after first sync (messages already present)");
    }
    return { messages: [] as BaseMessage[] };
  }

  // Wrap fetch in a Runnable so LangSmith traces this step
  const fetchConvo = new RunnableLambda({
    func: async (input: { baseUrl: string; customerId: string; dealershipId?: string }) => {
      return await fetchConversation(input.baseUrl, input.customerId, input.dealershipId);
    },
  });
  const payload = await fetchConvo.invoke({ baseUrl, customerId, dealershipId });
  const list = Array.isArray(payload) ? payload : [payload];
  const desiredConversationId = process.env.CONVERSATION_ID;
  const conv =
    typeof desiredConversationId === "string" && desiredConversationId.length > 0
      ? (list.find((c) => c && typeof c === "object" && c.id === desiredConversationId) ?? list[0])
      : list[0];
  // Only take the very first greeting message from the conversation for initial context
  let mapped: string[] = [];
  if (Array.isArray(conv?.messages) && conv.messages.length > 0) {
    const first = (conv.messages as any[])[0];
    const content = typeof first?.content === "string" ? first.content : "";
    if (content.length > 0) {
      mapped = ["AGENT: " + content];
    }
  }
  // Optional visibility in console while developing
  console.log("[syncFromBackend] fetchedLines:", mapped.length, "customerId:", customerId, "dealer:", dealershipId);
  if (process.env.DEBUG_CONVERSATION === "true") {
    console.log("[syncFromBackend] lines:");
    for (const line of mapped) {
      console.log("  -", line);
    }
  }

  // Build a quick set of existing lines to avoid duplicates
  const existingLines = new Set(
    state.messages.map((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      return (m.type === "ai" ? "AGENT: " : m.type === "human" ? "CUSTOMER: " : "") + text;
    })
  );

  const newMessages: (AIMessage | HumanMessage)[] = [];
  for (const line of mapped) {
    for (const line of mapped) {
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

  // Debug: Log full response payload to see appointment confirmation signals
  console.log("[salesperson] Full API Response Payload:", JSON.stringify(result, null, 2));
  console.log("[salesperson] Response Fields:", {
    success: (result as any)?.success,
    workflowType: (result as any)?.workflowType,
    completed: (result as any)?.completed,
    nextAction: (result as any)?.nextAction,
    updatedState: (result as any)?.updatedState,
    response: (result as any)?.response,
    messages: Array.isArray((result as any)?.messages) ? (result as any).messages.length : "not an array",
  });

  // Check if workflowStep in updatedState is "COMPLETED" - this indicates the conversation should end
  const stateUpdate = (result as any)?.updatedState;
  const workflowStep = stateUpdate && typeof stateUpdate.workflowStep === "string" 
    ? stateUpdate.workflowStep 
    : "";
  const appointmentCompleted = workflowStep === "COMPLETED";
  
  if (appointmentCompleted) {
    console.log("[salesperson] workflowStep is 'COMPLETED' - conversation should end.");
  } else if (workflowStep) {
    console.log("[salesperson] workflowStep:", workflowStep, "- continuing conversation.");
  }

  // Immediately enrich context from POST response so the next customer turn can see it,
  // without waiting for the backend projection to conversationHistory.
  const existingLines = new Set(
    state.messages.map((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      return (m.type === "ai" ? "AGENT: " : m.type === "human" ? "CUSTOMER: " : "") + text;
    })
  );
  const raw: any[] = [];
  // 0) Single assistant reply as per API schema
  if (typeof (result as any)?.response === "string" && (result as any).response.length > 0) {
    raw.push({
      role: "ASSISTANT",
      type: "assistant_response",
      content: (result as any).response,
      timestamp: (result as any)?.timestamp ?? undefined,
    });
  }
  // 1) Primary messages array from POST
  if (Array.isArray((result as any)?.messages)) {
    raw.push(...((result as any).messages as any[]));
  }

  // Sort by timestamp if present to preserve server ordering
  raw.sort((a, b) => {
    const ta = typeof a?.timestamp === "string" ? Date.parse(a.timestamp) : 0;
    const tb = typeof b?.timestamp === "string" ? Date.parse(b.timestamp) : 0;
    return ta - tb;
  });
  const assistantTypes = new Set(["assistant_response", "vehicle_recommendation", "workflow_response"]);
  const immediateAi: AIMessage[] = [];
  for (const m of raw) {
    const role = typeof m?.role === "string" ? m.role.toUpperCase() : undefined;
    const type = typeof m?.type === "string" ? m.type.toLowerCase() : undefined;
    const contentStr = typeof m?.content === "string" ? m.content : "";
    const isAssistant =
      role === "ASSISTANT" ||
      (typeof type === "string" && assistantTypes.has(type));
    if (!isAssistant || !contentStr) continue;
    immediateAi.push(new AIMessage(contentStr));
  }
  // Fallback: if nothing was parsed, still return the latest assistant string if present
  if (immediateAi.length === 0) {
    const reply =
      (typeof (result as any)?.response === "string" ? (result as any).response : "") ||
      extractLatestAssistant(result) ||
      "";
    return { 
      messages: [new AIMessage(reply)],
      appointmentCompleted: appointmentCompleted,
    };
  }
  return { 
    messages: immediateAi,
    appointmentCompleted: appointmentCompleted,
  };
}

// Judge node: evaluate the conversation at the end and optionally append a summary
async function judge(state: ConversationState) {
  const lines = state.messages.map((m) => {
    const text = typeof m.content === "string" ? m.content : "";
    const role = m.type === "ai" ? "EMPLOYEE" : m.type === "human" ? "CUSTOMER" : "OTHER";
    return `${role}: ${text}`;
  });
  const evaluator = createConversationJudge();
  const result = await evaluator.invoke({ transcript: lines });
  const emitMsg = (process.env.JUDGE_EMIT_MESSAGE ?? "true").toLowerCase() === "true";
  if (process.env.DEBUG_JUDGE === "true") {
    console.log("[judge] result");
    console.dir(result, { depth: null });
  }
  if (!emitMsg) {
    return { messages: [] as BaseMessage[] };
  }
  const subscoresText = result.employee.subscores
    .map((s) => `  • ${s.criterion}: ${s.score}/100`)
    .join("\n");
  const summary =
    `Evaluation — Overall: ${result.overallScore}/100\n` +
    `Employee: ${result.employee.score}/100 — ${result.employee.justification}\n\n` +
    `Score Breakdown:\n${subscoresText}\n` +
    (result.comments ? `\nNotes: ${result.comments}` : "");
  return { messages: [new AIMessage(summary)] };
}

const app = new StateGraph(ConversationAnnotation)
  .addNode("sync", syncFromBackend)
  .addNode("customer", customer)
  .addNode("salesperson", salesperson)
  .addNode("judge", judge)
  .addEdge(START, "sync")
  .addEdge("sync", "customer")
  .addConditionalEdges(
    "customer",
    (state) => (countTotalMessages(state.messages) >= MAX_MESSAGES ? "judge" : "salesperson"),
    ["salesperson", "judge"]
  )
  .addConditionalEdges(
    "salesperson",
    (state) => {
      // If appointment is completed, end conversation and go to judge
      if (state.appointmentCompleted === true) {
        console.log("[graph] Appointment completed - routing to judge");
        return "judge";
      }
      // If max messages reached, go to judge
      if (countTotalMessages(state.messages) >= MAX_MESSAGES) {
        return "judge";
      }
      // Otherwise continue conversation
      return "customer";
    },
    ["customer", "judge"]
  )
  .addEdge("judge", END)
  .compile();

export default app;


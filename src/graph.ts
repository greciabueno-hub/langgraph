import { StateGraph, MessagesAnnotation, START, END, Annotation } from "@langchain/langgraph";
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { createAutomotiveApiNode } from "./agents/automotiveApiNode.js";
import { fetchConversation } from "./agents/conversationApi.js";
import { createCustomerSimulator } from "./agents/customerSimulator.js";
import { createConversationJudge, calculateJudgeScores, type JudgeOutput } from "./agents/judge.js";
import "dotenv/config";

const ConversationAnnotation = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  appointmentCompleted: Annotation<boolean>({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
  judgeResult: Annotation<JudgeOutput | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
});

type ConversationState = typeof ConversationAnnotation.State;

const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 50);

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

  // Build conversation history from state.messages to send to backend
  const conversationHistory = state.messages.map((m) => {
    const text = typeof m.content === "string" ? m.content : "";
    return {
      role: m.type === "ai" ? "EMPLOYEE" as const : m.type === "human" ? "CUSTOMER" as const : "CUSTOMER" as const,
      content: text,
    };
  });

  // Log what we're sending to the backend
  if (process.env.DEBUG_CONVERSATION === "true") {
    console.log("[salesperson] Sending to backend:", {
      content: content.substring(0, 100) + (content.length > 100 ? "..." : ""),
      customerId,
      conversationId,
      totalMessagesInState: state.messages.length,
      conversationHistoryLength: conversationHistory.length,
      lastFewMessages: state.messages.slice(-4).map(m => ({
        type: m.type,
        content: (typeof m.content === "string" ? m.content : "").substring(0, 50)
      }))
    });
  }

  // Log full conversation state for debugging (if enabled)
  let logEntry: any = null;
  if (process.env.SAVE_CONVERSATION_LOGS === "true") {
    const { conversationLogger } = await import("./utils/conversationLogger.js");
    logEntry = conversationLogger.logRequest(
      customerId,
      conversationId,
      {
        url: `${baseUrl}/workflows/process`,
        method: "POST",
        body: {
          content,
          channel,
          customerId,
          conversationId,
          metadata: { dealershipId, from: fromNumber, sendRealResponses: true },
          conversationHistory,
        },
        fullConversationState: {
          totalMessages: state.messages.length,
          messages: state.messages.map(m => ({
            type: m.type,
            content: typeof m.content === "string" ? m.content : "",
          })),
        },
      }
    );
  }

  const api = createAutomotiveApiNode(baseUrl);
  const result = await api.invoke({
    content,
    channel,
    customerId,
    conversationId,
    metadata: { dealershipId, from: fromNumber, sendRealResponses: true },
    conversationHistory, // Send full conversation history to backend
  });
  
  // Save conversation log after each turn (optional - can be done at end of conversation)
  if (process.env.SAVE_CONVERSATION_LOGS === "true" && logEntry) {
    try {
      const { conversationLogger } = await import("./utils/conversationLogger.js");
      const filepath = await conversationLogger.saveToFile(conversationId);
      if (logEntry.turnNumber === 1 || logEntry.turnNumber % 5 === 0) {
        console.log(`[salesperson] Conversation log saved: ${filepath}`);
      }
    } catch (error) {
      console.warn("[salesperson] Failed to save conversation log:", error);
    }
  }

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
  
  // Log the actual messages array structure to see what's inside
  if (Array.isArray((result as any)?.messages)) {
    console.log("[salesperson] Messages array contents:", JSON.stringify((result as any).messages, null, 2));
  }

  // Check if workflowStep in updatedState is "COMPLETED" - this indicates the conversation should end
  const stateUpdate = (result as any)?.updatedState;
  
  // Log updatedState.messages to see full conversation history from backend
  if (stateUpdate && Array.isArray(stateUpdate.messages)) {
    console.log("[salesperson] Backend conversation history (updatedState.messages):", 
      stateUpdate.messages.length, "messages");
    if (process.env.DEBUG_CONVERSATION === "true") {
      console.log("[salesperson] Last 3 messages from backend:", 
        JSON.stringify(stateUpdate.messages.slice(-3), null, 2));
    }
  }
  const workflowStep = stateUpdate && typeof stateUpdate.workflowStep === "string" 
    ? stateUpdate.workflowStep 
    : "";
  const appointmentCompleted = workflowStep === "HUMAN_HANDOFF";
  
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
  
  // Check updatedState.messages first (this is where the backend stores full conversation history)
  if (stateUpdate && Array.isArray(stateUpdate.messages)) {
    // Backend maintains full conversation in updatedState.messages
    // Extract only new messages we haven't seen yet
    for (const msg of stateUpdate.messages) {
      const content = typeof msg?.content === "string" ? msg.content : "";
      const role = typeof msg?.role === "string" ? msg.role : "";
      const timestamp = typeof msg?.timestamp === "string" ? msg.timestamp : undefined;
      
      if (content && role) {
        raw.push({
          role: role.toUpperCase(),
          type: role.toLowerCase() === "assistant" ? "assistant_response" : "customer_message",
          content,
          timestamp,
        });
      }
    }
  }
  
  // 0) Single assistant reply as per API schema (fallback)
  if (typeof (result as any)?.response === "string" && (result as any).response.length > 0) {
    // Check if we already have this response in raw
    const responseExists = raw.some(m => m.content === (result as any).response);
    if (!responseExists) {
      raw.push({
        role: "ASSISTANT",
        type: "assistant_response",
        content: (result as any).response,
        timestamp: (result as any)?.timestamp ?? undefined,
      });
    }
  }
  // 1) Primary messages array from POST (fallback if updatedState.messages not available)
  if (raw.length === 0 && Array.isArray((result as any)?.messages)) {
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
  const rawEvaluation = await evaluator.invoke({ transcript: lines });
  
  // Calculate scores using function (not LLM math)
  const result = calculateJudgeScores(rawEvaluation);
  
  console.log(`[judge] Calculated score: ${result.overallScore}/100 (from behavior ratings)`);
  
  const emitMsg = (process.env.JUDGE_EMIT_MESSAGE ?? "true").toLowerCase() === "true";
  if (process.env.DEBUG_JUDGE === "true") {
    console.log("[judge] result");
    console.dir(result, { depth: null });
  }
  // Store judge result in state for collection
  if (!emitMsg) {
    return { messages: [] as BaseMessage[], judgeResult: result };
  }
  // Map criterion names to their max deduction points (case-insensitive matching)
  const criterionMaxPoints: Record<string, number> = {
    "repeated questions": 10,
    "generic or off-topic responses": 15,
    "ignoring budget or constraints": 15,
    "being too pushy": 10,
    "using jargon or acronyms": 10,
    "using jargon/acronyms": 10, // Alternative format
    "overly verbose or rambling responses": 10,
    "overly verbose/rambling responses": 10, // Alternative format
    "failing to acknowledge urgency or emotion": 15,
    "failing to acknowledge urgency/emotion": 15, // Alternative format
    "bad or irrelevant recommendation": 15,
    "bad/irrelevant recommendation": 15, // Alternative format
  };
  
  const subscoresText = result.employee.subscores
    .map((s) => {
      const criterionKey = s.criterion.toLowerCase();
      const max = s.maxPoints ?? (criterionMaxPoints[criterionKey] ?? 100);
      return `  • ${s.criterion}: -${s.pointsDeducted.toFixed(1)}/${max} (deduction, rating: ${s.rating}/4)`;
    })
    .join("\n");
  const summary =
    `Evaluation — Overall: ${result.overallScore}/100\n` +
    `Employee: ${result.employee.score}/100 — ${result.employee.justification}\n\n` +
    `Deduction Breakdown:\n${subscoresText}\n` +
    (result.comments ? `\nNotes: ${result.comments}` : "");
  return { messages: [new AIMessage(summary)], judgeResult: result };
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

// Wrap all methods to add recursion limit from environment variable
const RECURSION_LIMIT = Number(process.env.RECURSION_LIMIT || 100);
console.log(`[graph.ts] Setting recursion limit to: ${RECURSION_LIMIT} (from env: ${process.env.RECURSION_LIMIT || 'not set, using default 100'})`);

// Wrap invoke
const originalInvoke = app.invoke.bind(app);
app.invoke = async (input: any, config?: any) => {
  const finalConfig = { ...config, recursionLimit: config?.recursionLimit ?? RECURSION_LIMIT };
  console.log(`[graph.ts] invoke called with recursionLimit: ${finalConfig.recursionLimit}`);
  return originalInvoke(input, finalConfig);
};

// Wrap stream
const originalStream = app.stream.bind(app);
app.stream = function(input: any, config?: any) {
  const finalConfig = { ...config, recursionLimit: config?.recursionLimit ?? RECURSION_LIMIT };
  console.log(`[graph.ts] stream called with recursionLimit: ${finalConfig.recursionLimit}`);
  return originalStream(input, finalConfig);
};

// Wrap streamEvents
const originalStreamEvents = app.streamEvents.bind(app);
app.streamEvents = function(input: any, config?: any, streamOptions?: any): any {
  const finalConfig = { ...config, recursionLimit: config?.recursionLimit ?? RECURSION_LIMIT };
  console.log(`[graph.ts] streamEvents called with recursionLimit: ${finalConfig.recursionLimit}`);
  return originalStreamEvents(input, finalConfig, streamOptions);
};

export default app;


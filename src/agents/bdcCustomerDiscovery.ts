import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { MessagesAnnotation } from "@langchain/langgraph";

export type ConversationState = typeof MessagesAnnotation.State;

type DealerConfig = {
  business_basics?: { storeName?: string; oemDesignation?: string };
  conversation_style?: {
    tone?: string;
    aiPersona?: { name?: string; useStaffName?: boolean; staffMemberName?: string };
    emojiUsage?: "none" | "minimal" | "moderate" | "frequent";
    templates?: { greetings?: string[]; signOffs?: string[] };
    messageDelay?: { enabled?: boolean; minDelayMs?: number; maxDelayMs?: number };
  };
  conversation_flow?: Record<string, boolean>;
};

function loadDealerConfig(): DealerConfig {
  try {
    const raw = process.env.BDC_DEALER_CONFIG_JSON;
    if (raw) return JSON.parse(raw);
  } catch {}
  // Fallback sample based on provided config
  return {
    business_basics: { storeName: "Granite Motors", oemDesignation: "Toyota" },
    conversation_style: {
      tone: "conversational",
      aiPersona: { name: "Ava", useStaffName: false, staffMemberName: "" },
      emojiUsage: "minimal",
      templates: {
        greetings: ["Hi {firstName}! Thanks for reaching out to {storeName}."],
        signOffs: ["- {personaName}, {storeName}"],
      },
      messageDelay: { enabled: true, minDelayMs: 500, maxDelayMs: 1500 },
    },
    conversation_flow: {
      askForBudget: true,
      purchaseTimeline: true,
      financingPreferences: true,
      askForTradeIn: true,
    },
  };
}

function buildPersonalitySection(dealer: DealerConfig, channel: string, customerName: string) {
  const storeName = dealer.business_basics?.storeName ?? "our dealership";
  const style = dealer.conversation_style ?? {};
  const tone = style.tone ?? "conversational";
  const emojiUsage = style.emojiUsage ?? "minimal";
  const ai = style.aiPersona ?? {};
  const personaName = ai.useStaffName && ai.staffMemberName ? ai.staffMemberName : ai.name ?? "Assistant";

  const toneDescription =
    tone === "formal"
      ? "Sophisticated and refined language. Demonstrates deep product knowledge. Consultative approach to financial options. Respectful of customer's time and intelligence.\nExample: \"Good afternoon. To ensure I can curate the most suitable options for your test drive, may I ask what's driving your vehicle search today? Are you prioritizing performance dynamics, advanced safety systems, or perhaps executive comfort features?\""
      : "Warm and conversational. Focuses on lifestyle fit and practical needs. Patient and supportive.\nExample: \"Hi! I'm so glad you're looking for a new car—it's exciting! Let me help make this easy for you. Can you tell me a bit about what you'll be using the car for? Daily commuting, family road trips, or maybe a mix of everything?\"";

  let responseStyle = "";
  if (channel === "SMS") {
    responseStyle += "\n- Keep responses under 160 characters when possible\n- Be concise and direct";
  } else if (channel === "EMAIL") {
    responseStyle += "\n- Use professional email formatting\n- Include clear subject lines when appropriate";
  }
  switch (emojiUsage) {
    case "none":
      responseStyle += "\n- Do not use emojis";
      break;
    case "minimal":
      responseStyle += "\n- Use emojis sparingly and only when appropriate";
      break;
    case "moderate":
      responseStyle += "\n- Use emojis moderately to enhance communication";
      break;
    case "frequent":
      responseStyle += "\n- Use emojis frequently to create a friendly tone";
      break;
  }

  return `You are an automotive sales assistant for ${storeName} via ${channel}.

CUSTOMER: ${customerName || "there"}
CHANNEL: ${channel}
DEALERSHIP: ${storeName}
AI PERSONA: ${personaName}

PERSONALITY & BEHAVIOR:
- Tone: ${toneDescription}

RESPONSE STYLE:
${responseStyle}

PERSONALIZATION:
- Use customer's name when appropriate
- Customize responses based on preferences and interests
- Reference previous interactions when relevant
- Maintain professional but friendly communication`;
}

function buildGoalsSection(): string {
  // Minimal text block; later replace with real goals service
  return `REQUIRED (must collect before scheduling):
- vehicle_of_interest: What the customer is looking for
- vehicle_price_range: Budget or price range
- purchase_timeline: When they plan to buy

OPTIONAL (collect if naturally mentioned):
- financing_preferences, has_trade_in, trade_in_details, best_time_to_contact, urgency_level`;
}

function buildRulesBlock(): string {
  // Condensed from provided rules, preserving key logic
  return `RULES AND INSTRUCTIONS:
1. If customer is busy/unavailable, ask for best_time_to_contact ONCE and then END.
2. Only ask purchase_timeline if missing and customer is not busy.
3. Extract new information per EXTRACTION RULES; update collected goals; never repeat or ask for collected info.
4. If has_trade_in = false, never ask for trade_in_details.
5. Accept general timeframes ("tomorrow", "this week"); don't over‑specify.
6. If best_time_to_contact is collected, respond: "Perfect! I'll reach out [timeframe]. Thanks for your time!" and END.
7. One targeted question, 2–4 sentences max, conversational.
8. PRIORITIZE price vs financing mentions:
   - Price phrases → vehicle_price_range ({"maxPrice": n, "minPrice": n})
   - Payment/financing phrases → financing_preferences (string)
9. Extract urgency_level as one of "high" | "medium" | "low".
`;
}

function buildExtractionBlock(): string {
  return `EXTRACTION RULES:
- vehicle_of_interest: Any specific or general vehicle/category requests. Store exact customer phrasing.
- vehicle_price_range: Parse price mentions into {"minPrice"?, "maxPrice"?}.
- purchase_timeline: When they want to buy.
- urgency_level: Classify to "high" | "medium" | "low" based on language.
- financing_preferences: Payment/financing details (e.g., "monthly under $500", "cash", "lease").
- has_trade_in: boolean; trade_in_details only if has_trade_in = true.
`;
}

function buildJsonInstructionBlock(): string {
  return `Respond with JSON only:
{
  "extractedGoals": [
    {"id": "goal_id", "collected": true, "data": {"key": "value"}}
  ],
  "response": "Your response to the customer",
  "isComplete": false,
  "nextQuestions": ["question1"]
}

EXAMPLES:
- {"id": "vehicle_price_range", "collected": true, "data": {"maxPrice": 30000}}
- {"id": "vehicle_price_range", "collected": true, "data": {"minPrice": 30000, "maxPrice": 50000}}
- {"id": "vehicle_price_range", "collected": true, "data": {"maxPrice": 45000, "minPrice": 40000}}
- {"id": "financing_preferences", "collected": true, "data": "monthly payment under $500"}
- {"id": "urgency_level", "collected": true, "data": "high"}`;
}

function formatHistory(messages: ConversationState["messages"], maxItems = 8): string {
  const recent = messages.slice(-maxItems);
  return recent
    .map((m) => `${m.type === "human" ? "Human" : m.type === "ai" ? "Assistant" : m.type}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");
}

export async function bdcCustomerDiscovery(state: ConversationState) {
  const dealer = loadDealerConfig();
  const channel = process.env.BDC_CHANNEL || "SMS";
  const customerName = process.env.BDC_CUSTOMER_FIRST_NAME || "there";

  const systemPrompt = [
    buildPersonalitySection(dealer, channel, customerName),
    "\nCONVERSATION GOALS:\n" + buildGoalsSection(),
    "\n" + buildRulesBlock(),
    buildExtractionBlock(),
    buildJsonInstructionBlock(),
  ].join("\n\n");

  // Build a compact user prompt block from current conversation
  const lastHuman = [...state.messages].reverse().find((m) => m.type === "human");
  const customerMessage = typeof lastHuman?.content === "string" ? lastHuman?.content : "";
  const userBlock = `CUSTOMER MESSAGE: "${customerMessage}"

CONVERSATION HISTORY:
${formatHistory(state.messages)}

CURRENT GOALS STATUS:
vehicle_of_interest: MISSING [REQUIRED]
vehicle_price_range: MISSING [REQUIRED]
purchase_timeline: MISSING [REQUIRED]
financing_preferences: MISSING [OPTIONAL]
has_trade_in: MISSING [OPTIONAL]
trade_in_details: MISSING [CONDITIONAL]
urgency_level: MISSING [OPTIONAL]
best_time_to_contact: MISSING [CONDITIONAL]

INFORMATION ALREADY COLLECTED:
`; // Start simple; can be enriched when state includes goals

  const model = new ChatOpenAI({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0.4 });

  const completion = await model.invoke([
    new SystemMessage(systemPrompt),
    // Provide the dynamic "user prompt" as a single user message
    new HumanMessage(userBlock),
    ...state.messages,
  ]);

  // Try to parse JSON to extract the assistant-facing "response"
  let text = typeof completion.content === "string" ? completion.content : "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.response === "string") {
      text = parsed.response;
    }
  } catch {
    // leave text as-is if not valid JSON
  }

  // Return exactly one assistant message
  // The runtime will append this to state.messages via the reducer
  return { messages: [new AIMessage(text)] };
}

export default bdcCustomerDiscovery;



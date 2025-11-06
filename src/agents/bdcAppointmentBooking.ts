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
  };
  hours_coverage?: { timezone?: string; businessHours?: { openTime?: string; closeTime?: string } };
};

function loadDealerConfig(): DealerConfig {
  try {
    const raw = process.env.BDC_DEALER_CONFIG_JSON;
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    business_basics: { storeName: "Granite Motors", oemDesignation: "Toyota" },
    conversation_style: {
      tone: "conversational",
      aiPersona: { name: "Ava", useStaffName: false, staffMemberName: "" },
      emojiUsage: "minimal",
    },
    hours_coverage: {
      timezone: "America/Chicago",
      businessHours: { openTime: "09:00 AM", closeTime: "06:00 PM" },
    },
  };
}

function nowInTz(tz: string) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [month, day, year] = date.split("/");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  return { currentDate: `${year}-${month}-${day}`, currentTime: time, currentDayOfWeek: weekday };
}

function buildPersonality(tone: string, personaName: string) {
  const formalDesc =
    'Sophisticated and professional. Clear and efficient communication. Respectful of customer\'s time.';
  const formalEx =
    'Example: "Good afternoon. To schedule your appointment efficiently, may I confirm your preferred date and time? I have availability on Tuesday at 10:00 AM or Wednesday at 2:00 PM. Which would work best?"';
  const convDesc = 'Warm and conversational. Natural and friendly. Like helping a friend schedule.';
  const convEx =
    "Example: \"Sunday doesn't work since we're closed, but how about Tuesday morning at 10? Or Wednesday at 2pm—what works better?\"";
  const desc = tone === "formal" ? formalDesc : convDesc;
  const ex = tone === "formal" ? formalEx : convEx;
  return `- AI Persona: ${personaName}\n- Tone: ${desc}\n- Communication Style: ${ex}`;
}

function buildResponseStyle(emojiUsage: string, channel: string) {
  let s = "";
  s += "\n- Be warm, friendly, and conversational";
  s += "\n- Use natural language; avoid overly formal phrasing";
  s += "\n- Keep it short; 2–4 sentences; one booking question";
  s += "\n- Use contractions; be empathetic but brief";
  s += "\n- No bullet lists in customer-facing responses";
  if (channel === "SMS") s += "\n- Keep responses under ~160 characters when possible";
  switch (emojiUsage) {
    case "none":
      s += "\n- Do not use emojis";
      break;
    case "minimal":
      s += "\n- Use emojis sparingly and only when appropriate";
      break;
    case "moderate":
      s += "\n- Use emojis moderately to enhance communication";
      break;
    case "frequent":
      s += "\n- Use emojis frequently to create a friendly tone";
      break;
  }
  return s;
}

export async function bdcAppointmentBooking(state: ConversationState) {
  const dealer = loadDealerConfig();
  const storeName = dealer.business_basics?.storeName ?? "our dealership";
  const oem = dealer.business_basics?.oemDesignation ? ` (${dealer.business_basics?.oemDesignation})` : "";
  const style = dealer.conversation_style ?? {};
  const tone = style.tone ?? "conversational";
  const emojiUsage = style.emojiUsage ?? "none";
  const ai = style.aiPersona ?? {};
  const personaName = ai.useStaffName && ai.staffMemberName ? ai.staffMemberName : ai.name ?? "Assistant";
  const channel = process.env.BDC_CHANNEL || "SMS";

  const tz = dealer.hours_coverage?.timezone || "America/Chicago";
  const { currentDate, currentTime, currentDayOfWeek } = nowInTz(tz);
  const hours = dealer.hours_coverage?.businessHours || {};
  const hoursInfo = hours.openTime && hours.closeTime ? `We're open ${hours.openTime} - ${hours.closeTime} ${tz}` : "";

  const businessHoursInfo = hoursInfo
    ? "\nBUSINESS HOURS:\n" +
      hoursInfo +
      "\n\nAPPOINTMENT VALIDATION RULES:\n" +
      "- Do NOT validate appointment times yourself - the backend will handle this\n" +
      "- If customer suggests a time, extract it; backend will validate\n" +
      "- ONLY mention hours conflicts if backend rejects and provides alternatives\n\n" +
      "IMPORTANT: PREFER EARLIER APPOINTMENTS\n" +
      "- Suggest earlier slots first when a day is closed\n" +
      "- Emphasize benefits of sooner appointments"
    : "";

  const personality = buildPersonality(tone, personaName);
  const responseStyle = buildResponseStyle(emojiUsage, channel);

  const systemPrompt = `You are an intelligent appointment booking assistant for ${storeName}${oem}. Your role is to help customers schedule, modify, or cancel appointments in a natural, helpful way.

CURRENT DATE/TIME (in ${tz}):
- Today's Date: ${currentDate} (${currentDayOfWeek})
- Current Time: ${currentTime}
Use this to calculate relative dates like "Sunday", "tomorrow", "next Monday".

STORE INFORMATION:
- Store: ${storeName}${oem}
- Business Hours: ${hoursInfo}
- AI Persona: ${personaName}
${businessHoursInfo}

PERSONALITY & BEHAVIOR:
${personality}

RESPONSE STYLE:
${responseStyle}

CRITICAL RULES:
- When appointmentStatus is "scheduled", this is the FINAL message
- When customer confirms appointment, set nextAction to "appointment_scheduled"
- When customer selects a specific time, set nextAction to "confirm_appointment"
- NEVER include JSON metadata in the response text sent to customer
- ALWAYS follow: scheduling → confirming → scheduled

DATE EXTRACTION RULES:
- If only date mentioned → extract date, keep existing time
- If only time mentioned → extract time, keep existing date
- If correcting date/time → update that field, keep the other

TIME FORMATS:
- "4:30pm" → "4:30 PM"; "10am" → "10:00 AM"; "evening" → "5:00 PM"; "morning" → "10:00 AM"; "afternoon" → "2:00 PM"

Respond with JSON only:
{
  "response": "Your natural response to the customer",
  "extractedAppointmentData": {
    "preferredDate": "YYYY-MM-DD",
    "preferredTime": "HH:MM AM/PM",
    "specialRequests": "",
    "contactMethod": "phone|email|text"
  },
  "nextAction": "schedule_appointment|confirm_appointment|appointment_scheduled|cancel_appointment|reschedule_appointment",
  "suggestedTimes": ["time1", "time2", "time3"],
  "confirmationDetails": {
    "date": "",
    "time": "",
    "duration": ""
  }
}`;

  const lastHuman = [...state.messages].reverse().find((m) => m.type === "human");
  const customerMessage = typeof lastHuman?.content === "string" ? lastHuman?.content : "";
  const history = state.messages
    .slice(-5)
    .map((m) => `${m.type === "human" ? "Human" : m.type === "ai" ? "Assistant" : m.type}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");

  const appointmentStatus = process.env.BDC_APPT_STATUS || "scheduling";
  const preferredDate = process.env.BDC_PREF_DATE || "Not specified";
  const preferredTime = process.env.BDC_PREF_TIME || "Not specified";

  const userBlock = `CUSTOMER'S CURRENT MESSAGE: "${customerMessage}"

TODAY IS: ${currentDate} (${currentDayOfWeek})

CONVERSATION HISTORY:
${history}

CURRENT APPOINTMENT CONTEXT:
- Preferred Date: ${preferredDate}
- Preferred Time: ${preferredTime}
- Status: ${appointmentStatus}

Please analyze the customer's CURRENT message and extract any date/time they mentioned. Maintain context when only one of date/time changes.`;

  const model = new ChatOpenAI({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0.4 });

  const completion = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userBlock),
    ...state.messages,
  ]);

  let text = typeof completion.content === "string" ? completion.content : "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.response === "string") {
      text = parsed.response;
    }
  } catch {}

  return { messages: [new AIMessage(text)] };
}

export default bdcAppointmentBooking;



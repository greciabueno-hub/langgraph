// simulate.ts
import { createCustomerSimulator } from "./customerSimulator.js";
import { createAutomotiveApiNode } from "./automotiveApiNode.js";
import { pickLatestAssistant, pickLatestAssistantFromConversations, fetchConversation } from "./conversationApi.js";

import "dotenv/config";

import type { AutomotiveApiResponse } from "./automotiveApiNode.js";

async function main() {
  const baseUrl = process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const persona =
    process.env.CUSTOMER_PERSONA ||
    "Car buyer who wants to hear about black colored family cars.";
  const automotive = createAutomotiveApiNode(baseUrl);
  const customer = createCustomerSimulator(persona);

  // Required identifiers provided by your data generator/back-end
  const customerId = process.env.CUSTOMER_ID || "cust_123";
  let conversationId = process.env.CONVERSATION_ID || "conv_124";
  const channel = (process.env.SALES_CHANNEL as "SMS" | "EMAIL" | "WEB_CHAT") || "SMS";
  const dealershipId = process.env.DEALERSHIP_ID || "4675";
  const fromNumber = process.env.FROM || "+15551234567";
  const backendFirst = process.env.BACKEND_FIRST === "true"; // if true, backend speaks first
  const maxTurns = Number(process.env.MAX_TURNS || 2);

  const history: string[] = [];
  let agentReply = "Hello! How can I help you today?"; // only used if backendFirst=false
  let turns = 0;

  // If backend initiates, fetch first agent reply before customer speaks (via GET)
  if (backendFirst) {
    const convo = await fetchConversation(baseUrl, customerId, dealershipId);
    const firstReply = pickLatestAssistantFromConversations(convo);
    if (firstReply) {
      agentReply = firstReply;
      history.push(`AGENT: ${agentReply}`);
    }
  }

  while (turns < maxTurns) {
    // Customer replies to the agent
    console.log("TURN", turns + 1, "convId:", conversationId);
    const { customerMessage } = await customer.invoke({ agentReply, history });
    {
      const customerText = typeof customerMessage === "string" ? customerMessage : "";
      const cleanedCustomer = customerText.replace(/^\s*(?:customer|user)\s*:\s*/i, "");
      history.push(`CUSTOMER: ${cleanedCustomer}`);
    }

    // Send to automotive-api
    const result: AutomotiveApiResponse = await automotive.invoke({
      content: customerMessage,
      channel,
      customerId,
      conversationId,
      metadata: { dealershipId, from: fromNumber, sendRealResponses: true },
    });

    const reply = pickLatestAssistant(result) || "";
    const cleanedReply = reply.replace(/^\s*(?:agent|assistant)\s*:\s*/i, "");
    history.push(`AGENT: ${cleanedReply}`);
    agentReply = cleanedReply;

    if (
      result &&
      (result as any).updatedState &&
      typeof (result as any).updatedState.conversationId === "string"
    ) {
      conversationId = (result as any).updatedState.conversationId as string;
    }

    if (result.completed === true || /goodbye|thanks/i.test(agentReply)) break;
    turns += 1;
  }

  console.log(history.join("\n"));
}

main().catch(console.error);
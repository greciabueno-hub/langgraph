import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import customer from "./agents/customer.js";
import customerDiscovery from "./agents/bdcCustomerDiscovery.js";

// Simple stopping rule: end after N AI messages (combined across both agents)
const MAX_AGENT_TURNS = 6;

function countAiMessages(messages: BaseMessage[]) {
  // Use the stable role field; instance checks can fail across bundles/runtimes
  return messages.filter((m) => m.type === "ai").length;
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode("customer", customer)
  .addNode("customerDiscovery", customerDiscovery)
  .addEdge(START, "customer")
  .addConditionalEdges(
    "customer",
    (state) => {
      const aiTurns = countAiMessages(state.messages);
      return aiTurns >= MAX_AGENT_TURNS ? END : "customerDiscovery";
    },
    ["customerDiscovery", END]
  )
  .addConditionalEdges(
    "customerDiscovery",
    (state) => {
      const aiTurns = countAiMessages(state.messages);
      return aiTurns >= MAX_AGENT_TURNS ? END : "customer";
    },
    ["customer", END]
  );

const app = graph.compile();

export default app;



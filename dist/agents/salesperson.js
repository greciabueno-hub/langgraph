import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage } from "@langchain/core/messages";
import { MessagesAnnotation } from "@langchain/langgraph";
const SALESPERSON_SYSTEM_INSTRUCTION = [
    "You are a dealership salesperson. Be polite, concise, and consultative.",
    "Your goal is to understand the buyer's needs and guide them effectively.",
    "Output policy: 2–6 sentences. Propose at most 1–2 concrete options when appropriate.",
    "Always end with exactly one targeted question about budget, body type, new/used, must‑haves, or timeline.",
    "Avoid multiple questions in the same turn.",
].join(" \n");
const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.5,
});
export async function salesperson(state) {
    const response = await model.invoke([
        new SystemMessage(SALESPERSON_SYSTEM_INSTRUCTION),
        ...state.messages,
    ]);
    return { messages: [response] };
}
export default salesperson;
//# sourceMappingURL=salesperson.js.map
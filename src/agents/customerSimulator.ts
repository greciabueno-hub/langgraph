// customerSimulator.ts
import { ChatOpenAI } from "@langchain/openai";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export function createCustomerSimulator(persona: string): Runnable<{ agentReply: string; history: string[] }, { customerMessage: string }> {
  const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.7 });
  return new RunnableLambda({
    func: async (input: { agentReply: string; history: string[] }) => {
      const { agentReply, history } = input;
    const messages = [
      new SystemMessage(
        `You are a car buyer. Persona: ${persona}.
         Stay on goal, be concise, realistic, and respond as a customer.
         If the agent asks a question, answer briefly.`
      ),
      new HumanMessage(`Conversation so far:
${history.join("\n")}

Agent just said:
${agentReply}

Your reply:`),
    ];
    const res = await model.invoke(messages);
    return { customerMessage: res.content as string };
    },
  });
}
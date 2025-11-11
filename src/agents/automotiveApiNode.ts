// automotiveApiNode.ts
import axios from "axios";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";

type Request = {
  content: string;
  channel: "SMS" | "EMAIL" | "WEB_CHAT";
  customerId: string;
  conversationId: string;
  metadata?: { dealershipId?: string; from?: string; sendRealResponses?: boolean };
};

export type AutomotiveApiMessage = {
  content?: string;
  [key: string]: unknown;
};

export type AutomotiveApiResponse = {
  success?: boolean;
  messages?: AutomotiveApiMessage[];
  updatedState?: unknown;
  workflowType?: string;
  completed?: boolean;
  nextAction?: string;
  [key: string]: unknown;
};

export function createAutomotiveApiNode(baseUrl: string): Runnable<Request, AutomotiveApiResponse> {
  return new RunnableLambda({
    func: async (req: Request) => {
    const url = `${baseUrl}/workflows/process`;
    if (process.env.DEBUG_AUTOMOTIVE_API === "true") {
      // Safe, structured log of outbound request
      console.log("[automotiveApi] POST", url);
      console.dir(req, { depth: null });
    }
    const { data } = await axios.post(url, req, {
      timeout: 30000,
    });
    if (process.env.DEBUG_AUTOMOTIVE_API === "true") {
      console.log("[automotiveApi] RESPONSE");
      console.dir(data, { depth: null });
    }
      return data as AutomotiveApiResponse; // { success, messages, updatedState, workflowType, nextAction, completed, ... }
    },
  });
}
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
    
    try {
      const { data } = await axios.post(url, req, {
        timeout: 30000,
      });
      
      // Always log the full response payload for debugging
      if (process.env.DEBUG_AUTOMOTIVE_API === "true") {
        console.log("[automotiveApi] RESPONSE");
        console.dir(data, { depth: null });
      }
      
      // Log key fields that might indicate appointment confirmation
      const response = data as AutomotiveApiResponse;
      console.log("[automotiveApi] Response Summary:", {
        success: response.success,
        workflowType: response.workflowType,
        completed: response.completed,
        nextAction: response.nextAction,
        messageCount: Array.isArray(response.messages) ? response.messages.length : 0,
        hasResponse: typeof (response as any)?.response === "string",
      });
      
      return response; // { success, messages, updatedState, workflowType, nextAction, completed, ... }
    } catch (error) {
      // Enhanced error logging
      if (axios.isAxiosError(error)) {
        console.error("[automotiveApi] Request failed:", {
          url,
          method: "POST",
          status: error.response?.status,
          statusText: error.response?.statusText,
          requestData: {
            content: req.content?.substring(0, 100) + (req.content?.length > 100 ? "..." : ""),
            channel: req.channel,
            customerId: req.customerId,
            conversationId: req.conversationId,
            dealershipId: req.metadata?.dealershipId,
          },
          responseData: error.response?.data,
          message: error.message,
        });
        
        // If we have response data, log it
        if (error.response?.data) {
          console.error("[automotiveApi] Error response body:", JSON.stringify(error.response.data, null, 2));
        }
      } else {
        console.error("[automotiveApi] Unexpected error:", error);
      }
      throw error; // Re-throw to maintain existing error handling behavior
    }
    },
  });
}
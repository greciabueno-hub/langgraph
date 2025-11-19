// promptApi.ts
// API client for managing BDC prompts in the database
import axios from "axios";
import "dotenv/config";

export interface PromptTemplateWithMetadata {
  id: string;
  agentName: string;
  version: number;
  promptTemplate: string;
  metadata: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  dealershipPrompt: string;
}

// Legacy interface for backward compatibility
export interface BdcPrompt {
  id?: string;
  prompt: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * GET current prompt from database
 * Uses PROMPT_ENDPOINT environment variable or defaults to /customer_discovery
 */
export async function getCurrentPrompt(baseUrl: string): Promise<PromptTemplateWithMetadata> {
  const endpoint = process.env.PROMPT_ENDPOINT || "/customer_discovery";
  const url = `${baseUrl}${endpoint}`;
  
  // Always log the URL being requested (helpful for debugging)
  console.log("[promptApi] GET", url);
  
  if (process.env.DEBUG_PROMPT_API === "true") {
    console.log("[promptApi] Full request details:", { baseUrl, endpoint, url });
  }
  
  try {
    const { data } = await axios.get<any>(url, { timeout: 30000 });
    
    // Backend returns an array with one object: [{ id, promptContent, ... }]
    // Extract the first element if it's an array, otherwise use data directly
    const promptData = Array.isArray(data) ? data[0] : data;
    
    if (!promptData) {
      throw new Error(`Backend returned empty response. Response structure: ${JSON.stringify(data, null, 2)}`);
    }
    
    // Always log the raw response so we can see the actual structure
    if (process.env.DEBUG_PROMPT_API === "true") {
      console.log("[promptApi] Raw response from backend:", JSON.stringify(data, null, 2));
      console.log("[promptApi] Extracted prompt data:", JSON.stringify(promptData, null, 2));
    }
    
    // Map backend response to expected structure
    const result: PromptTemplateWithMetadata = {
      id: promptData.id || promptData._id || "unknown",
      agentName: promptData.agentName || promptData.agent_name || "BDC",
      version: promptData.version || 1,
      promptTemplate: promptData.promptTemplate || promptData.promptContent || promptData.prompt || "",
      metadata: promptData.metadata || {},
      isActive: promptData.isActive !== undefined ? promptData.isActive : true,
      createdAt: promptData.createdAt ? new Date(promptData.createdAt) : new Date(),
      updatedAt: promptData.updatedAt ? new Date(promptData.updatedAt) : new Date(),
      dealershipPrompt: promptData.dealershipPrompt || "",
    };
    
    if (!result.promptTemplate) {
      throw new Error(`Backend response missing promptTemplate. Response structure: ${JSON.stringify(data, null, 2)}`);
    }
    
    if (process.env.DEBUG_PROMPT_API === "true") {
      console.log("[promptApi] Current prompt retrieved:", {
        id: result.id,
        agentName: result.agentName,
        version: result.version,
        promptLength: result.promptTemplate.length,
        isActive: result.isActive,
        hasDealershipPrompt: !!result.dealershipPrompt,
      });
    }
    
    return result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Log detailed error information
      console.error("[promptApi] Error fetching prompt:", {
        url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        message: error.message,
      });
      
      if (error.response?.status === 404) {
        // If no prompt exists, return a default
        console.warn("[promptApi] No prompt found at", url, "- using default prompt");
        console.warn("[promptApi] To fix: Make sure your backend has a prompt at this endpoint, or set PROMPT_ENDPOINT to the correct path");
        return {
          id: "default",
          agentName: "BDC",
          version: 1,
          promptTemplate: "You are a helpful car salesperson. Help customers find the right vehicle for their needs.",
          metadata: {},
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          dealershipPrompt: "",
        };
      }
    }
    throw error;
  }
}

/**
 * POST candidate prompt to database (for testing)
 * Assumes your backend has an endpoint like: POST /api/prompts/bdc/candidate
 */
export async function postCandidatePrompt(
  baseUrl: string,
  prompt: string,
  metadata?: { iteration?: number; score?: number }
): Promise<PromptTemplateWithMetadata> {
  const url = `${baseUrl}/agents/prompts`;
  const agentName = process.env.AGENT_NAME || "customer_discovery";
  
  if (process.env.DEBUG_PROMPT_API === "true") {
    console.log("[promptApi] POST candidate prompt:", {
      url,
      agentName,
      promptLength: prompt.length,
      metadata,
    });
  }
  
  const { data } = await axios.post<any>(
    url,
    {
      agentName,
      promptTemplate: prompt,
      metadata,
    },
    { timeout: 30000 }
  );
  
  // Map response to PromptTemplateWithMetadata structure
  // Backend might return array or object, handle both
  const responseData = Array.isArray(data) ? data[0] : data;
  
  return {
    id: responseData.id || responseData._id || "unknown",
    agentName: responseData.agentName || agentName,
    version: responseData.version || 1,
    promptTemplate: responseData.promptTemplate || responseData.promptContent || prompt,
    metadata: responseData.metadata || metadata || {},
    isActive: responseData.isActive !== undefined ? responseData.isActive : true,
    createdAt: responseData.createdAt ? new Date(responseData.createdAt) : new Date(),
    updatedAt: responseData.updatedAt ? new Date(responseData.updatedAt) : new Date(),
    dealershipPrompt: responseData.dealershipPrompt || "",
  };
}

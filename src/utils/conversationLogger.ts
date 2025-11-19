// conversationLogger.ts
// Utility to log all conversation requests and responses to a file
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export interface ConversationLogEntry {
  timestamp: string;
  customerId: string;
  conversationId: string;
  turnNumber: number;
  request: {
    url: string;
    method: string;
    body: {
      content: string;
      channel: string;
      customerId: string;
      conversationId: string;
      metadata?: any;
      conversationHistory?: Array<{
        role: "CUSTOMER" | "EMPLOYEE";
        content: string;
        timestamp?: string;
      }>;
    };
    fullConversationState?: {
      totalMessages: number;
      messages: Array<{
        type: string;
        content: string;
      }>;
    };
  };
  response: {
    status?: number;
    success?: boolean;
    workflowType?: string;
    completed?: boolean;
    nextAction?: string;
    response?: string;
    messages?: any[];
    updatedState?: {
      messages?: any[];
      workflowStep?: string;
      [key: string]: any;
    };
    fullResponse?: any;
  };
  error?: {
    message: string;
    stack?: string;
    responseData?: any;
  };
}

class ConversationLogger {
  private logs: ConversationLogEntry[] = [];
  private currentConversationId: string | null = null;
  private turnNumber: number = 0;

  startConversation(conversationId: string) {
    this.currentConversationId = conversationId;
    this.turnNumber = 0;
    this.logs = [];
  }

  logRequest(
    customerId: string,
    conversationId: string,
    request: ConversationLogEntry["request"],
    fullConversationState?: ConversationLogEntry["request"]["fullConversationState"]
  ) {
    if (conversationId !== this.currentConversationId) {
      this.startConversation(conversationId);
    }
    this.turnNumber++;

    const entry: ConversationLogEntry = {
      timestamp: new Date().toISOString(),
      customerId,
      conversationId,
      turnNumber: this.turnNumber,
      request: {
        ...request,
        ...(fullConversationState && { fullConversationState }),
      },
      response: {},
    };

    this.logs.push(entry);
    return entry;
  }

  logResponse(
    conversationId: string,
    response: ConversationLogEntry["response"],
    error?: ConversationLogEntry["error"]
  ) {
    const lastEntry = this.logs[this.logs.length - 1];
    if (lastEntry && lastEntry.conversationId === conversationId) {
      lastEntry.response = response;
      if (error) {
        lastEntry.error = error;
      }
    }
  }

  async saveToFile(conversationId: string): Promise<string> {
    const logsDir = join(process.cwd(), "results", "conversation-logs");
    if (!existsSync(logsDir)) {
      await mkdir(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `conversation-${conversationId}-${timestamp}.json`;
    const filepath = join(logsDir, filename);

    const logData = {
      conversationId,
      timestamp: new Date().toISOString(),
      totalTurns: this.logs.length,
      logs: this.logs,
    };

    await writeFile(filepath, JSON.stringify(logData, null, 2));
    return filepath;
  }

  getLogs(): ConversationLogEntry[] {
    return this.logs;
  }
}

// Singleton instance
export const conversationLogger = new ConversationLogger();


// src/utils/saveConversationResult.ts
// Utility to save individual conversation results with judge scores and full transcript

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { Persona } from "../personas.js";
import type { JudgeOutput } from "../agents/judge.js";

export interface ConversationResultData {
  persona: Persona;
  customerName?: string; // Generated customer name (firstName + lastName)
  customerId: string;
  conversationId: string;
  timestamp: string;
  judgeResult: JudgeOutput | null;
  transcript: Array<{ role: string; content: string }>;
  messageCount: number;
  appointmentCompleted: boolean;
}

/**
 * Save an individual conversation result to a JSON file
 * File format: conversation-{personaId}-{timestamp}.json
 */
export async function saveConversationResult(
  data: ConversationResultData
): Promise<string> {
  const resultsDir = join(process.cwd(), "results", "conversations");
  
  // Ensure results/conversations directory exists
  if (!existsSync(resultsDir)) {
    await mkdir(resultsDir, { recursive: true });
  }

  // Create filename with persona ID and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `conversation-${data.persona.id}-${timestamp}.json`;
  const filepath = join(resultsDir, filename);

  // Prepare the output structure
  const output = {
    persona: {
      id: data.persona.id,
      description: data.persona.description,
      name: data.persona.name || data.customerName || undefined,
    },
    customer: {
      name: data.customerName || data.persona.name || undefined,
      customerId: data.customerId,
      conversationId: data.conversationId,
    },
    timestamp: data.timestamp,
    judge: data.judgeResult
      ? {
          overallScore: data.judgeResult.overallScore,
          summary: {
            justification: data.judgeResult.employee.justification,
            comments: data.judgeResult.comments,
          },
          subscores: data.judgeResult.employee.subscores.map((sub) => ({
            criterion: sub.criterion,
            pointsDeducted: sub.pointsDeducted,
            maxPoints: sub.maxPoints,
            rating: sub.rating,
            explanation: sub.explanation,
          })),
        }
      : null,
    conversation: {
      messageCount: data.messageCount,
      appointmentCompleted: data.appointmentCompleted,
      transcript: data.transcript,
    },
  };

  // Write to file
  await writeFile(filepath, JSON.stringify(output, null, 2), "utf-8");

  return filepath;
}


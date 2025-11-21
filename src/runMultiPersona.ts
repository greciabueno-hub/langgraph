// src/runMultiPersona.ts
// Script to run conversations with multiple personas sequentially and collect judge scores

import app from "./graph.js";
import { personas, type Persona } from "./personas.js";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { JudgeOutput } from "./agents/judge.js";
import type { BaseMessage } from "@langchain/core/messages";
import { saveConversationResult } from "./utils/saveConversationResult.js";

interface ConversationResult {
  persona: Persona;
  timestamp: string;
  judgeResult: JudgeOutput | null;
  transcript: Array<{ role: string; content: string }>;
  messageCount: number;
  appointmentCompleted: boolean;
}

interface AggregatedReport {
  timestamp: string;
  totalPersonas: number;
  results: ConversationResult[];
  summary: {
    averageScore: number;
    scoresByPersona: Record<string, number>;
    averageDeductionsByBehavior: Record<string, number>;
    worstBehaviors: Array<{ behavior: string; averageDeduction: number }>;
  };
}

async function ensureResultsDirectory(): Promise<string> {
  const resultsDir = join(process.cwd(), "results");
  if (!existsSync(resultsDir)) {
    await mkdir(resultsDir, { recursive: true });
  }
  return resultsDir;
}

function formatTranscript(messages: BaseMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => {
    const role = m.type === "ai" ? "EMPLOYEE" : m.type === "human" ? "CUSTOMER" : "OTHER";
    const content = typeof m.content === "string" ? m.content : "";
    return { role, content };
  });
}

async function runConversationWithPersona(persona: Persona): Promise<ConversationResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Starting conversation with persona: ${persona.id}`);
  console.log(`Description: ${persona.description}`);
  console.log(`${"=".repeat(60)}\n`);

  // Set the persona as environment variable
  process.env.CUSTOMER_PERSONA = persona.description;

  // Generate unique customer and conversation IDs for this run
  const customerId = `customer-${persona.id}-${Date.now()}`;
  const conversationId = `conv-${persona.id}-${Date.now()}`;
  
  process.env.CUSTOMER_ID = customerId;
  process.env.CONVERSATION_ID = conversationId;
  
  console.log(`Customer ID: ${customerId} (generated)`);
  console.log(`Conversation ID: ${conversationId} (generated)`);

  // Run the conversation graph
  const finalState = await app.invoke({ messages: [] });

  // Save conversation log at end of conversation
  if (process.env.SAVE_CONVERSATION_LOGS === "true") {
    try {
      const { conversationLogger } = await import("./utils/conversationLogger.js");
      const filepath = await conversationLogger.saveToFile(conversationId);
      console.log(`[runMultiPersona] Final conversation log saved: ${filepath}`);
    } catch (error) {
      console.warn("[runMultiPersona] Failed to save final conversation log:", error);
    }
  }

  // Extract results
  const judgeResult = finalState.judgeResult || null;
  const transcript = formatTranscript(finalState.messages || []);
  const messageCount = transcript.length;
  const appointmentCompleted = finalState.appointmentCompleted || false;

  console.log(`\n${"-".repeat(60)}`);
  console.log(`Conversation completed for ${persona.id}`);
  console.log(`Messages: ${messageCount}`);
  console.log(`Appointment completed: ${appointmentCompleted}`);
  if (judgeResult) {
    console.log(`Overall Score: ${judgeResult.overallScore}/100`);
  }
  console.log(`${"-".repeat(60)}\n`);

  const timestamp = new Date().toISOString();
  const result = {
    persona,
    timestamp,
    judgeResult,
    transcript,
    messageCount,
    appointmentCompleted,
  };

  // Save individual conversation result
  try {
    const conversationData: Parameters<typeof saveConversationResult>[0] = {
      persona,
      customerId,
      conversationId,
      timestamp,
      judgeResult,
      transcript,
      messageCount,
      appointmentCompleted,
      ...(persona.name && { customerName: persona.name }),
    };
    const filepath = await saveConversationResult(conversationData);
    console.log(`[runMultiPersona] Conversation result saved: ${filepath}`);
  } catch (error) {
    console.warn("[runMultiPersona] Failed to save conversation result:", error);
  }

  return result;
}

function calculateAggregatedSummary(results: ConversationResult[]): AggregatedReport["summary"] {
  // Calculate average score
  const scores = results
    .map((r) => r.judgeResult?.overallScore)
    .filter((s): s is number => s !== null && s !== undefined);
  const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  // Scores by persona
  const scoresByPersona: Record<string, number> = {};
  results.forEach((r) => {
    if (r.judgeResult?.overallScore !== undefined) {
      scoresByPersona[r.persona.id] = r.judgeResult.overallScore;
    }
  });

  // Average deductions by behavior
  const behaviorDeductions: Record<string, number[]> = {};
  results.forEach((r) => {
    if (r.judgeResult?.employee.subscores) {
      r.judgeResult.employee.subscores.forEach((subscore) => {
        const behavior = subscore.criterion.toLowerCase();
        if (!behaviorDeductions[behavior]) {
          behaviorDeductions[behavior] = [];
        }
        behaviorDeductions[behavior]!.push(subscore.pointsDeducted);
      });
    }
  });

  const averageDeductionsByBehavior: Record<string, number> = {};
  Object.entries(behaviorDeductions).forEach(([behavior, deductions]) => {
    averageDeductionsByBehavior[behavior] =
      deductions.reduce((a, b) => a + b, 0) / deductions.length;
  });

  // Worst behaviors (highest average deductions)
  const worstBehaviors = Object.entries(averageDeductionsByBehavior)
    .map(([behavior, avgDeduction]) => ({ behavior, averageDeduction: avgDeduction }))
    .sort((a, b) => b.averageDeduction - a.averageDeduction)
    .slice(0, 5); // Top 5 worst behaviors

  return {
    averageScore,
    scoresByPersona,
    averageDeductionsByBehavior,
    worstBehaviors,
  };
}

async function saveResults(results: ConversationResult[], summary: AggregatedReport["summary"]): Promise<void> {
  const resultsDir = await ensureResultsDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Save individual results
  for (const result of results) {
    const filename = `persona-${result.persona.id}-${timestamp}.json`;
    const filepath = join(resultsDir, filename);
    await writeFile(filepath, JSON.stringify(result, null, 2));
    console.log(`Saved individual result: ${filepath}`);
  }

  // Save aggregated report
  const aggregatedReport: AggregatedReport = {
    timestamp: new Date().toISOString(),
    totalPersonas: results.length,
    results,
    summary,
  };

  const reportFilename = `aggregated-report-${timestamp}.json`;
  const reportFilepath = join(resultsDir, reportFilename);
  await writeFile(reportFilepath, JSON.stringify(aggregatedReport, null, 2));
  console.log(`\nSaved aggregated report: ${reportFilepath}`);

  // Print summary to console
  console.log(`\n${"=".repeat(60)}`);
  console.log("AGGREGATED SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Average Score: ${summary.averageScore.toFixed(2)}/100`);
  console.log(`\nScores by Persona:`);
  Object.entries(summary.scoresByPersona).forEach(([personaId, score]) => {
    const persona = personas.find((p) => p.id === personaId);
    console.log(`  ${personaId}: ${score.toFixed(2)}/100`);
  });
  console.log(`\nTop 5 Worst Behaviors (Highest Average Deductions):`);
  summary.worstBehaviors.forEach((behavior, index) => {
    console.log(`  ${index + 1}. ${behavior.behavior}: -${behavior.averageDeduction.toFixed(2)} points`);
  });
  console.log(`${"=".repeat(60)}\n`);
}

async function main() {
  console.log("Starting multi-persona evaluation...");
  console.log(`Will run ${personas.length} personas sequentially\n`);

  const results: ConversationResult[] = [];

  // Run each persona sequentially
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i];
    if (!persona) continue; // Skip if undefined (shouldn't happen, but TypeScript safety)
    
    console.log(`\n[${i + 1}/${personas.length}] Processing persona: ${persona.id}`);

    try {
      const result = await runConversationWithPersona(persona);
      results.push(result);

      // Small delay between runs to avoid rate limiting
      if (i < personas.length - 1) {
        console.log("Waiting 2 seconds before next persona...\n");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`\n${"=".repeat(60)}`);
      console.error(`ERROR running conversation for persona: ${persona.id}`);
      console.error(`Persona ID: ${persona.id}`);
      console.error(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(`Stack trace:`, error.stack);
      }
      console.error(`${"=".repeat(60)}\n`);
      // Continue with next persona even if one fails
    }
  }

  // Calculate and save aggregated results
  if (results.length > 0) {
    const summary = calculateAggregatedSummary(results);
    await saveResults(results, summary);
    console.log("Multi-persona evaluation completed!");
  } else {
    console.error("No results collected. Please check for errors above.");
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { main, runConversationWithPersona, calculateAggregatedSummary };


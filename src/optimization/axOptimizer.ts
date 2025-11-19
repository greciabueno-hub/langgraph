// axOptimizer.ts
// Ax (DSPy for TypeScript) optimization for BDC prompts
// NOTE: Install @ax-llm/ax package: npm install @ax-llm/ax
import { ai, ax } from "@ax-llm/ax";
import app from "../graph.js";
import { personas, type Persona } from "../personas.js";
import { postCandidatePrompt } from "../agents/promptApi.js";
import type { BaseMessage } from "@langchain/core/messages";
import "dotenv/config";

// Mapping of criterion names to their maximum possible deduction points
const CRITERION_MAX_POINTS: Record<string, number> = {
  "Repeated questions": 10,
  "Generic or off-topic responses": 15,
  "Ignoring budget or constraints": 15,
  "Being too pushy": 10,
  "Using jargon or acronyms": 10,
  "Overly verbose or rambling responses": 10,
  "Failing to acknowledge urgency or emotion": 15,
  "Bad or irrelevant recommendation": 15,
};

// Re-define ConversationResult here to avoid circular dependency
export interface ConversationResult {
  persona: Persona;
  timestamp: string;
  judgeResult: { overallScore: number; employee: { score: number; justification: string; subscores: Array<{ criterion: string; score: number }> }; comments: string } | null;
  transcript: Array<{ role: string; content: string }>;
  messageCount: number;
  appointmentCompleted: boolean;
}

export interface OptimizationConfig {
  maxIterations?: number;
  targetScore?: number;
  personasToTest?: string[]; // If undefined, test all personas
  llmModel?: string;
  apiBaseUrl?: string;
}

export interface OptimizationResult {
  bestPrompt: string;
  bestScore: number;
  iterations: Array<{
    iteration: number;
    prompt: string;
    score: number;
    scoresByPersona: Record<string, number>;
    judgeResults?: Array<{
      persona: string;
      overallScore: number;
      employee: {
        score: number;
        justification: string;
        subscores: Array<{ 
          criterion: string; 
          pointsDeducted: number; 
          maxPoints: number;
        }>;
      };
      comments: string;
    }>;
  }>;
  totalEvaluations: number;
}

/**
 * Run a full simulation with a given prompt and return judge scores
 */
async function evaluatePrompt(
  prompt: string,
  config: OptimizationConfig
): Promise<{
  averageScore: number;
  scoresByPersona: Record<string, number>;
  results: ConversationResult[];
}> {
  const apiBaseUrl = config.apiBaseUrl || process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  
  // TODO: Set the prompt in the backend before running simulation
  // This would typically be done via the prompt API
  // For now, we'll assume the backend reads from an environment variable or config
  // In production, you'd POST the prompt to the backend before running
  
  console.log(`[axOptimizer] Evaluating prompt (length: ${prompt.length})...`);
  
  const personasToTest = config.personasToTest 
    ? personas.filter(p => config.personasToTest!.includes(p.id))
    : personas;
  
  const results: ConversationResult[] = [];
  
  // Run simulation for each persona
  for (const persona of personasToTest) {
    console.log(`[axOptimizer] Testing persona: ${persona.name}`);
    
    // Set persona
    process.env.CUSTOMER_PERSONA = persona.description;
    
    // Always use predefined IDs from persona - they must exist in the database
    if (!persona.customerId || !persona.conversationId) {
      throw new Error(
        `Persona "${persona.name}" (${persona.id}) is missing required IDs. ` +
        `Please provide customerId and conversationId in personas.ts. ` +
        `These IDs must exist in your backend database.`
      );
    }
    
    const customerId = persona.customerId;
    const conversationId = persona.conversationId;
    
    process.env.CUSTOMER_ID = customerId;
    process.env.CONVERSATION_ID = conversationId;
    
    console.log(`[axOptimizer] Customer ID: ${customerId} (from persona)`);
    console.log(`[axOptimizer] Conversation ID: ${conversationId} (from persona)`);
    
    // Run the conversation graph
    const finalState = await app.invoke({ messages: [] });
    
    // Extract judge result
    const judgeResult = finalState.judgeResult;
    const transcript = formatTranscript(finalState.messages || []);
    
    if (judgeResult) {
      results.push({
        persona,
        timestamp: new Date().toISOString(),
        judgeResult,
        transcript,
        messageCount: transcript.length,
        appointmentCompleted: finalState.appointmentCompleted || false,
      });
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Calculate average score
  const scores = results
    .map(r => r.judgeResult?.overallScore)
    .filter((s): s is number => s !== null && s !== undefined);
  
  const averageScore = scores.length > 0 
    ? scores.reduce((a, b) => a + b, 0) / scores.length 
    : 0;
  
  // Scores by persona
  const scoresByPersona: Record<string, number> = {};
  results.forEach(r => {
    if (r.judgeResult?.overallScore !== undefined) {
      scoresByPersona[r.persona.id] = r.judgeResult.overallScore;
    }
  });
  
  console.log(`[axOptimizer] Evaluation complete - Average score: ${averageScore.toFixed(2)}/100`);
  
  return {
    averageScore,
    scoresByPersona,
    results,
  };
}

function formatTranscript(messages: BaseMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => {
    const role = m.type === "ai" ? "EMPLOYEE" : m.type === "human" ? "CUSTOMER" : "OTHER";
    const content = typeof m.content === "string" ? m.content : "";
    return { role, content };
  });
}

/**
 * Main Ax optimization function
 */
export async function optimizeBdcPrompt(
  initialPrompt: string,
  config: OptimizationConfig = {}
): Promise<OptimizationResult> {
  const maxIterations = config.maxIterations || 2;
  const targetScore = config.targetScore || 90;
  const llmModel = config.llmModel || "gpt-4o-mini";
  
  console.log("\n" + "=".repeat(60));
  console.log("AX PROMPT OPTIMIZATION");
  console.log("=".repeat(60));
  console.log(`Initial prompt length: ${initialPrompt.length}`);
  console.log(`Max iterations: ${maxIterations}`);
  console.log(`Target score: ${targetScore}/100`);
  console.log("=".repeat(60) + "\n");
  
  // Initialize Ax LLM
  const llm = ai({
    name: "openai",
    apiKey: process.env.OPENAI_API_KEY!,
    model: llmModel,
  });
  
  // Define Ax signature for prompt optimization
  // Input: current prompt + evaluation results
  // Output: optimized prompt
  const promptOptimizer = ax(`
    currentPrompt: string,
    currentScore: number,
    evaluationFeedback: string ->
    optimizedPrompt: string
  `);
  
  let currentPrompt = initialPrompt;
  let bestPrompt = initialPrompt;
  let bestScore = 0;
  const iterations: OptimizationResult["iterations"] = [];
  
  // Initial evaluation
  console.log("[axOptimizer] Initial evaluation...");
  const initialEval = await evaluatePrompt(currentPrompt, config);
  bestScore = initialEval.averageScore;
  
        // Extract judge results for each persona
        const initialJudgeResults = initialEval.results.map(r => ({
          persona: r.persona.name,
          overallScore: r.judgeResult?.overallScore || 0,
          employee: r.judgeResult?.employee ? {
            score: r.judgeResult.employee.score,
            justification: r.judgeResult.employee.justification,
            subscores: r.judgeResult.employee.subscores.map(sub => ({
              criterion: sub.criterion,
              pointsDeducted: sub.score,
              maxPoints: CRITERION_MAX_POINTS[sub.criterion] || 0,
            })),
          } : {
            score: 0,
            justification: "",
            subscores: [],
          },
          comments: r.judgeResult?.comments || "",
        }));
  
  iterations.push({
    iteration: 0,
    prompt: currentPrompt,
    score: initialEval.averageScore,
    scoresByPersona: initialEval.scoresByPersona,
    judgeResults: initialJudgeResults,
  });
  
  console.log(`[axOptimizer] Initial score: ${bestScore.toFixed(2)}/100\n`);
  
  // Optimization loop
  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n[axOptimizer] Iteration ${i}/${maxIterations}`);
    console.log("-".repeat(60));
    
    // Generate evaluation feedback
    const lastIteration = iterations[iterations.length - 1];
    if (!lastIteration) {
      throw new Error("No previous iteration found");
    }
    const feedback = generateFeedback(lastIteration);
    
    // Use Ax to optimize the prompt
    console.log("[axOptimizer] Generating optimized prompt...");
    const optimizationResult = await promptOptimizer.forward(llm, {
      currentPrompt: currentPrompt,
      currentScore: lastIteration.score,
      evaluationFeedback: feedback,
    });
    
    const candidatePrompt = optimizationResult.optimizedPrompt;
    console.log(`[axOptimizer] Candidate prompt generated (length: ${candidatePrompt.length})`);
    
    // Evaluate the candidate prompt
    const evalResult = await evaluatePrompt(candidatePrompt, config);
    
    console.log(`[axOptimizer] Candidate score: ${evalResult.averageScore.toFixed(2)}/100`);
    
    // POST candidate prompt to database (versioned) with score
    // The latest versioned prompt will be used for the next optimization run
    const apiBaseUrl = config.apiBaseUrl || process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
    const promptApiBaseUrl = process.env.PROMPT_API_BASE_URL || apiBaseUrl;
    
    try {
      await postCandidatePrompt(promptApiBaseUrl, candidatePrompt, {
        iteration: i,
        score: evalResult.averageScore,
      });
      console.log(`[axOptimizer] ✓ Candidate prompt posted to database (iteration ${i}, score: ${evalResult.averageScore.toFixed(2)})`);
    } catch (error) {
      console.warn(`[axOptimizer] ⚠ Failed to post candidate prompt:`, error);
      // Continue optimization even if posting fails
    }
    
          // Extract judge results for each persona
          const candidateJudgeResults = evalResult.results.map(r => ({
            persona: r.persona.name,
            overallScore: r.judgeResult?.overallScore || 0,
            employee: r.judgeResult?.employee ? {
              score: r.judgeResult.employee.score,
              justification: r.judgeResult.employee.justification,
              subscores: r.judgeResult.employee.subscores.map(sub => ({
                criterion: sub.criterion,
                pointsDeducted: sub.score,
                maxPoints: CRITERION_MAX_POINTS[sub.criterion] || 0,
              })),
            } : {
              score: 0,
              justification: "",
              subscores: [],
            },
            comments: r.judgeResult?.comments || "",
          }));
    
    // Track iteration
    iterations.push({
      iteration: i,
      prompt: candidatePrompt,
      score: evalResult.averageScore,
      scoresByPersona: evalResult.scoresByPersona,
      judgeResults: candidateJudgeResults,
    });
    
    // Update best if improved
    if (evalResult.averageScore > bestScore) {
      console.log(`[axOptimizer] ✓ New best score! ${evalResult.averageScore.toFixed(2)} > ${bestScore.toFixed(2)}`);
      bestScore = evalResult.averageScore;
      bestPrompt = candidatePrompt;
    } else {
      console.log(`[axOptimizer] ✗ Score did not improve (${evalResult.averageScore.toFixed(2)} <= ${bestScore.toFixed(2)})`);
    }
    
    // Update current prompt for next iteration
    currentPrompt = candidatePrompt;
    
    // Early exit if target score reached
    if (bestScore >= targetScore) {
      console.log(`[axOptimizer] Target score reached! Stopping early.`);
      break;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("OPTIMIZATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Best score: ${bestScore.toFixed(2)}/100`);
  console.log(`Best prompt length: ${bestPrompt.length}`);
  console.log(`Total iterations: ${iterations.length}`);
  console.log("=".repeat(60) + "\n");
  
  return {
    bestPrompt,
    bestScore,
    iterations,
    totalEvaluations: iterations.length * (config.personasToTest?.length || personas.length),
  };
}

/**
 * Generate feedback string for Ax based on evaluation results
 */
function generateFeedback(iteration: {
  score: number;
  scoresByPersona: Record<string, number>;
}): string {
  const feedback: string[] = [];

  feedback.push("CRITICAL: The prompt contains template placeholders in the format {{PLACEHOLDER_NAME}} (e.g., {{PERSONALITY_SECTION}}, {{GOALS_SECTION}}, etc.). You MUST preserve ALL placeholders exactly as they appear. Do NOT remove, modify, or change any placeholders. Only optimize the text content BETWEEN placeholders, not the placeholders themselves.");
  
  if (iteration.score < 70) {
    feedback.push("The prompt needs significant improvement. Focus on being more helpful and responsive to customer needs.");
  } else if (iteration.score < 85) {
    feedback.push("The prompt is decent but could be more effective. Improve clarity and customer engagement.");
  } else {
    feedback.push("The prompt is performing well. Fine-tune for consistency across different customer types.");
  }
  
  // Add persona-specific feedback
  const lowScoringPersonas = Object.entries(iteration.scoresByPersona)
    .filter(([_, score]) => score < 80)
    .map(([personaId, score]) => {
      const persona = personas.find(p => p.id === personaId);
      return `${persona?.name || personaId} (${score.toFixed(1)}/100)`;
    });
  
  if (lowScoringPersonas.length > 0) {
    feedback.push(`Lower scores observed for: ${lowScoringPersonas.join(", ")}. Consider adapting the prompt for these customer types.`);
  }
  
  return feedback.join(" ");
}


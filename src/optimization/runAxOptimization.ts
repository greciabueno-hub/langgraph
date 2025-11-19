// runAxOptimization.ts
// Main script to run Ax optimization loop for BDC prompts
import { optimizeBdcPrompt, type OptimizationConfig } from "./axOptimizer.js";
import { getCurrentPrompt } from "../agents/promptApi.js";
import "dotenv/config";

interface OptimizationRunResult {
  timestamp: string;
  initialPrompt: string;
  optimizationResult: {
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
      isBest?: boolean; // Marks which prompt was selected as best
    }>;
    totalEvaluations: number;
  };
  saved: boolean;
}

/**
 * Main Ax optimization loop
 * 
 * Flow:
 * 1. GET current prompt from DB
 * 2. For each iteration:
 *    - POST candidate prompt
 *    - Run full sim via POST /workflows/process (BDC ↔ simulator until done)
 *    - Judge scores transcript
 *    - Ax proposes next candidate
 * 3. POST best prompt
 */
async function runAxOptimization(config: OptimizationConfig = {}): Promise<OptimizationRunResult> {
  const apiBaseUrl = config.apiBaseUrl || process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const promptApiBaseUrl = process.env.PROMPT_API_BASE_URL || apiBaseUrl;
  
  console.log("\n" + "=".repeat(70));
  console.log("AX OPTIMIZATION LOOP - BDC PROMPT OPTIMIZATION");
  console.log("=".repeat(70));
  console.log(`Prompt API Base URL: ${promptApiBaseUrl}`);
  console.log(`Automotive API Base URL: ${apiBaseUrl}`);
  console.log("=".repeat(70) + "\n");
  
  // Step 1: GET current prompt from DB
  console.log("[Step 1] GET current prompt from database...");
  let currentPrompt: string;
  
  try {
    const promptData = await getCurrentPrompt(promptApiBaseUrl);
    
    // Safety check: ensure promptTemplate exists and is a string
    if (!promptData.promptTemplate || typeof promptData.promptTemplate !== "string") {
      throw new Error(`Invalid prompt data: promptTemplate is missing or not a string. Received: ${JSON.stringify(promptData)}`);
    }
    
    currentPrompt = promptData.promptTemplate;
    console.log(`[Step 1] ✓ Retrieved current prompt (length: ${currentPrompt.length})`);
    console.log(`[Step 1] Prompt preview: ${currentPrompt.substring(0, 100)}...\n`);
  } catch (error) {
    console.error("[Step 1] ✗ Failed to get current prompt:", error);
    console.log("[Step 1] Using default prompt instead...\n");
    currentPrompt = "You are a helpful car salesperson. Help customers find the right vehicle for their needs. Be friendly, professional, and focus on understanding the customer's requirements.";
  }
  
  // Step 2-6: Ax optimization loop
  // Each iteration posts the candidate prompt to database (versioned)
  // The latest prompt in the database will be used for the next run
  console.log("[Step 2-6] Starting Ax optimization loop...\n");
  console.log("[Note] Each iteration will post the candidate prompt to the database.\n");
  
  const optimizationResult = await optimizeBdcPrompt(currentPrompt, {
    ...config,
    apiBaseUrl,
  });
  
  // During optimization, each candidate was:
  // - Posted to database (versioned) via postCandidatePrompt
  // - Evaluated with full simulation
  // - Scored by judge
  // - Used by Ax to propose next candidate
  
  // No need to post "best" prompt separately - the latest versioned prompt
  // in the database will be used automatically for the next run
  
  // Build detailed iterations - now includes judge results from axOptimizer
  const detailedIterations = optimizationResult.iterations.map((iter) => ({
    iteration: iter.iteration,
    prompt: iter.prompt,
    score: iter.score,
    scoresByPersona: iter.scoresByPersona,
    judgeResults: iter.judgeResults || [],
    isBest: iter.prompt === optimizationResult.bestPrompt, // Mark which one is best
  }));
  
  const result: OptimizationRunResult = {
    timestamp: new Date().toISOString(),
    initialPrompt: currentPrompt,
    optimizationResult: {
      bestPrompt: optimizationResult.bestPrompt,
      bestScore: optimizationResult.bestScore,
      iterations: detailedIterations,
      totalEvaluations: optimizationResult.totalEvaluations,
    },
    saved: true, // All iterations were saved during the loop
  };
  
  console.log("\n" + "=".repeat(70));
  console.log("OPTIMIZATION RUN COMPLETE");
  console.log("=".repeat(70));
  console.log(`Initial score: ${optimizationResult.iterations[0]?.score.toFixed(2) || "N/A"}/100`);
  console.log(`Best score: ${optimizationResult.bestScore.toFixed(2)}/100`);
  console.log(`Improvement: ${(optimizationResult.bestScore - (optimizationResult.iterations[0]?.score || 0)).toFixed(2)} points`);
  console.log(`Iterations: ${optimizationResult.iterations.length}`);
  console.log(`Total evaluations: ${optimizationResult.totalEvaluations}`);
  console.log(`All prompts versioned in DB: Yes (latest will be used for next run)`);
  console.log("=".repeat(70) + "\n");
  
  return result;
}

// CLI entry point
async function main() {
  const config: OptimizationConfig = {
    maxIterations: Number(process.env.AX_MAX_ITERATIONS || "2"),
    targetScore: Number(process.env.AX_TARGET_SCORE || "90"),
    ...(process.env.AX_PERSONAS && {
      personasToTest: process.env.AX_PERSONAS.split(",").map(s => s.trim()),
    }),
    llmModel: process.env.AX_LLM_MODEL || "gpt-4o-mini",
    apiBaseUrl: process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000",
  };
  
  try {
    const result = await runAxOptimization(config);
    
    // Optionally save results to file
    if (process.env.SAVE_OPTIMIZATION_RESULTS === "true") {
      const { writeFile, mkdir } = await import("fs/promises");
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      
      const resultsDir = join(process.cwd(), "results");
      if (!existsSync(resultsDir)) {
        await mkdir(resultsDir, { recursive: true });
      }
      
      const filename = `ax-optimization-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filepath = join(resultsDir, filename);
      await writeFile(filepath, JSON.stringify(result, null, 2));
      console.log(`Results saved to: ${filepath}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runAxOptimization, main };


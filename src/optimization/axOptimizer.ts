// axOptimizer.ts
// Ax (DSPy for TypeScript) optimization for BDC prompts
// NOTE: Install @ax-llm/ax package: npm install @ax-llm/ax
import { ai, ax } from "@ax-llm/ax";
import app from "../graph.js";
import { personas, type Persona } from "../personas.js";
import { postCandidatePrompt } from "../agents/promptApi.js";
import { generateFreshCustomersForPersonas } from "../utils/generatePersonaCustomers.js";
import { type JudgeOutput } from "../agents/judge.js";
import type { BaseMessage } from "@langchain/core/messages";
import "dotenv/config";
import { saveConversationResult } from "../utils/saveConversationResult.js";

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
  customerName?: string; // Actual customer name (firstName + lastName) from generated customer
  timestamp: string;
  judgeResult: JudgeOutput | null;
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
      persona: string; // Customer name or persona ID
      personaId: string; // Persona ID (e.g., "budget-conscious")
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

// generateFreshCustomersForPersonas is imported from generatePersonaCustomers.ts

/**
 * Run a full simulation with a given prompt and return judge scores
 */
async function evaluatePrompt(
  prompt: string,
  config: OptimizationConfig,
  freshCustomers?: Map<string, { customerId: string; conversationId: string; firstName: string; lastName: string }>
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
    console.log(`[axOptimizer] Testing persona: ${persona.id}`);
    
    // Set persona
    process.env.CUSTOMER_PERSONA = persona.description;
    
    // Use fresh customer/conversation IDs if provided, otherwise fall back to persona defaults
    let customerId: string;
    let conversationId: string;
    let customerName: string | undefined;
    
    if (freshCustomers && freshCustomers.has(persona.id)) {
      const freshIds = freshCustomers.get(persona.id)!;
      customerId = freshIds.customerId;
      conversationId = freshIds.conversationId;
      customerName = `${freshIds.firstName} ${freshIds.lastName}`;
      console.log(`[axOptimizer] Using fresh customer ID: ${customerId}`);
      console.log(`[axOptimizer] Using fresh conversation ID: ${conversationId}`);
      console.log(`[axOptimizer] Customer name: ${customerName}`);
    } else {
      // This should never happen during Ax optimization since fresh customers are always generated
      throw new Error(
        `Fresh customers must be provided for persona "${persona.id}". ` +
        `Customer generation is required for all evaluations.`
      );
    }
    
    process.env.CUSTOMER_ID = customerId;
    process.env.CONVERSATION_ID = conversationId;
    
    // Run the conversation graph
    const finalState = await app.invoke({ messages: [] });
    
    // Extract judge result
    const judgeResult = finalState.judgeResult;
    const transcript = formatTranscript(finalState.messages || []);
    const timestamp = new Date().toISOString();
    const messageCount = transcript.length;
    const appointmentCompleted = finalState.appointmentCompleted || false;
    
    if (judgeResult) {
      results.push({
        persona,
        customerName,
        timestamp,
        judgeResult,
        transcript,
        messageCount,
        appointmentCompleted,
      });

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
          ...(customerName && { customerName }),
        };
        const filepath = await saveConversationResult(conversationData);
        console.log(`[axOptimizer] Conversation result saved: ${filepath}`);
      } catch (error) {
        console.warn("[axOptimizer] Failed to save conversation result:", error);
      }
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
  
  // Generate fresh customers for initial evaluation
  const personasToTest = config.personasToTest 
    ? personas.filter(p => config.personasToTest!.includes(p.id))
    : personas;
  
  console.log("[axOptimizer] Generating fresh customers for initial evaluation...");
  const initialApiBaseUrl = config.apiBaseUrl || process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const initialDealerId = Number(process.env.DEALERSHIP_ID || "4675");
  const initialFreshCustomers = await generateFreshCustomersForPersonas(personasToTest, initialDealerId, initialApiBaseUrl, 0);
  
  // Initial evaluation
  console.log("[axOptimizer] Initial evaluation...");
  const initialEval = await evaluatePrompt(currentPrompt, config, initialFreshCustomers);
  bestScore = initialEval.averageScore;
  
        // Extract judge results for each persona
        const initialJudgeResults = initialEval.results.map(r => ({
          persona: r.customerName || r.persona.id,
          personaId: r.persona.id, // Always include persona ID
          overallScore: r.judgeResult?.overallScore || 0,
          employee: r.judgeResult?.employee ? {
            score: r.judgeResult.employee.score,
            justification: r.judgeResult.employee.justification,
            subscores: r.judgeResult.employee.subscores.map(sub => ({
              criterion: sub.criterion,
              pointsDeducted: sub.pointsDeducted,
              maxPoints: sub.maxPoints,
              rating: sub.rating, // 0-4 rating from LLM
              explanation: sub.explanation, // Optional explanation from LLM
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
  
  ///////////////////////////////////////// FOR LOOP FOR EACH ITERATION /////////////////////////////////////////
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
    
    // Log the feedback being passed to Ax in a readable format
    console.log("\n" + "=".repeat(80));
    console.log("FEEDBACK BEING PASSED TO AX FOR PROMPT OPTIMIZATION");
    console.log("=".repeat(80));
    console.log(feedback);
    console.log("=".repeat(80) + "\n");
    
    // Use Ax to optimize the prompt
    console.log("[axOptimizer] Generating optimized prompt...");
    const optimizationResult = await promptOptimizer.forward(llm, {
      currentPrompt: currentPrompt,
      currentScore: lastIteration.score,
      evaluationFeedback: feedback,
    });
    
    const candidatePrompt = optimizationResult.optimizedPrompt;
    console.log(`[axOptimizer] Candidate prompt generated (length: ${candidatePrompt.length})`);
    
          // Generate fresh customers for this iteration
          console.log(`[axOptimizer] Generating fresh customers for iteration ${i}...`);
          const iterApiBaseUrl = config.apiBaseUrl || process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
          const iterDealerId = Number(process.env.DEALERSHIP_ID || "4675");
          const iterationFreshCustomers = await generateFreshCustomersForPersonas(personasToTest, iterDealerId, iterApiBaseUrl, i);
    
    // Evaluate the candidate prompt with fresh customers
    const evalResult = await evaluatePrompt(candidatePrompt, config, iterationFreshCustomers);
    
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
            persona: r.customerName || r.persona.id,
            personaId: r.persona.id, // Always include persona ID
            overallScore: r.judgeResult?.overallScore || 0,
            employee: r.judgeResult?.employee ? {
              score: r.judgeResult.employee.score,
              justification: r.judgeResult.employee.justification,
              subscores: r.judgeResult.employee.subscores.map(sub => ({
                criterion: sub.criterion,
                pointsDeducted: sub.pointsDeducted,
                maxPoints: sub.maxPoints,
                rating: sub.rating, // 0-4 rating from LLM
                explanation: sub.explanation, // Optional explanation from LLM
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
      console.log(`[axOptimizer] Target score reached (${bestScore.toFixed(2)} >= ${targetScore})! Stopping early.`);
      console.log(`[axOptimizer] Completed ${i} optimization iteration(s) out of ${maxIterations} planned.`);
      break;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("OPTIMIZATION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Best score: ${bestScore.toFixed(2)}/100`);
  console.log(`Target score: ${targetScore}/100`);
  console.log(`Best prompt length: ${bestPrompt.length}`);
  console.log(`Total iterations completed: ${iterations.length} (expected: ${maxIterations + 1})`);
  if (iterations.length < maxIterations + 1) {
    console.log(`⚠️  Note: Only ${iterations.length} iteration(s) completed, expected ${maxIterations + 1}`);
    console.log(`   This could be due to early exit (target score reached) or an error.`);
  }
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
  judgeResults?: Array<{
    persona: string;
    personaId: string;
    overallScore: number;
    employee: {
      score: number;
      justification: string;
      subscores: Array<{ 
        criterion: string; 
        pointsDeducted: number; 
        maxPoints: number;
        rating?: number; // 0-4 rating from LLM
        explanation?: string; // Optional explanation from LLM
      }>;
    };
    comments: string;
  }>;
}): string {
  const feedback: string[] = [];

  // CRITICAL: Placeholder preservation note
  feedback.push("CRITICAL: The prompt contains template placeholders in the format {{PLACEHOLDER_NAME}} (e.g., {{PERSONALITY_SECTION}}, {{GOALS_SECTION}}, etc.). You MUST preserve ALL placeholders exactly as they appear. Do NOT remove, modify, or change any placeholders. Only optimize the text content BETWEEN placeholders, not the placeholders themselves.");
  
  // Overall Performance
  feedback.push(`\nOverall Performance: ${iteration.score.toFixed(1)}/100`);
  
  // TOP ISSUES REQUIRING FIXES - Aggregated from subscores
  if (iteration.judgeResults && iteration.judgeResults.length > 0) {
    // Criterion to suggestion mapping
    const criterionSuggestions: Record<string, { suggestion: string; rule: string }> = {
      "Repeated questions": {
        suggestion: "Add explicit instruction to avoid repeating the same response.",
        rule: "If you've already said something, acknowledge the customer's new request and provide new information instead of repeating."
      },
      "Generic or off-topic responses": {
        suggestion: "Prioritize answering direct questions before pivoting.",
        rule: "When a customer asks a specific question, answer it directly before moving to other topics or appointment-setting."
      },
      "Ignoring budget or constraints": {
        suggestion: "Always acknowledge and respect stated budget constraints.",
        rule: "When a customer states a budget, acknowledge it explicitly and only recommend vehicles within that budget range."
      },
      "Being too pushy": {
        suggestion: "Answer customer questions before suggesting appointments.",
        rule: "Do not push for appointments until you have answered all of the customer's questions and provided requested information."
      },
      "Using jargon or acronyms": {
        suggestion: "Explain technical terms when used.",
        rule: "If you must use technical terms or acronyms, always provide a brief explanation in plain language."
      },
      "Overly verbose or rambling responses": {
        suggestion: "Keep responses concise and focused.",
        rule: "Provide clear, structured responses. Avoid unnecessary repetition or lengthy explanations that don't directly address the customer's question."
      },
      "Failing to acknowledge urgency or emotion": {
        suggestion: "Acknowledge customer emotions and urgency cues.",
        rule: "When a customer expresses urgency, stress, or emotion, acknowledge it explicitly before proceeding with information or recommendations."
      },
      "Bad or irrelevant recommendation": {
        suggestion: "Match recommendations to customer's stated needs and constraints.",
        rule: "Only recommend vehicles that match the customer's stated budget, preferences, and requirements. If no match exists, explain why and ask for flexibility."
      }
    };

    // Step 1: Collect all subscores from all personas (including rating and explanation)
    const allSubscores: Array<{ 
      criterion: string; 
      pointsDeducted: number; 
      maxPoints: number;
      rating?: number;
      explanation?: string;
      personaId?: string; // Track which persona this came from
    }> = [];
    
    iteration.judgeResults.forEach(result => {
      if (result.employee.subscores) {
        result.employee.subscores.forEach(sub => {
          const scoreEntry: {
            criterion: string;
            pointsDeducted: number;
            maxPoints: number;
            rating?: number;
            explanation?: string;
            personaId?: string;
          } = {
            criterion: sub.criterion,
            pointsDeducted: sub.pointsDeducted,
            maxPoints: sub.maxPoints,
            personaId: result.personaId
          };
          
          if (sub.rating !== undefined) {
            scoreEntry.rating = sub.rating;
          }
          if (sub.explanation !== undefined) {
            scoreEntry.explanation = sub.explanation;
          }
          
          allSubscores.push(scoreEntry);
        });
      }
    });

    // Step 2: Group by criterion name (for calculations) and collect examples
    const criterionGroups: Record<string, Array<{ pointsDeducted: number; maxPoints: number }>> = {};
    const criterionExamples: Record<string, Array<{ rating: number; explanation: string; personaId: string }>> = {};
    
    allSubscores.forEach(sub => {
      // Group for average calculation
      if (!criterionGroups[sub.criterion]) {
        criterionGroups[sub.criterion] = [];
      }
      const group = criterionGroups[sub.criterion];
      if (group) {
        group.push({
          pointsDeducted: sub.pointsDeducted,
          maxPoints: sub.maxPoints
        });
      }
      
      // Collect severe examples (rating 3-4) with explanations
      if (sub.rating !== undefined && sub.rating >= 3 && sub.explanation) {
        if (!criterionExamples[sub.criterion]) {
          criterionExamples[sub.criterion] = [];
        }
        const examplesGroup = criterionExamples[sub.criterion];
        if (examplesGroup) {
          examplesGroup.push({
            rating: sub.rating,
            explanation: sub.explanation,
            personaId: sub.personaId || "unknown"
          });
        }
      }
    });

    // Step 3: Calculate average deduction for each criterion
    const criterionAverages: Array<{
      criterion: string;
      avgDeduction: number;
      maxPoints: number;
      affectedPersonas: number;
      totalPersonas: number;
    }> = [];

    Object.entries(criterionGroups).forEach(([criterion, deductions]) => {
      if (deductions.length === 0) return;
      
      const totalDeduction = deductions.reduce((sum, d) => sum + d.pointsDeducted, 0);
      const avgDeduction = totalDeduction / deductions.length;
      const maxPoints = deductions[0]!.maxPoints; // All should have same maxPoints
      const affectedPersonas = deductions.length;
      const totalPersonas = iteration.judgeResults!.length;

      criterionAverages.push({
        criterion,
        avgDeduction,
        maxPoints,
        affectedPersonas,
        totalPersonas
      });
    });

    // Step 4: Sort by highest average deduction (worst issues first)
    criterionAverages.sort((a, b) => b.avgDeduction - a.avgDeduction);

    // Step 5: Get top 5 worst issues (or all if less than 5)
    const topIssues = criterionAverages.slice(0, Math.min(5, criterionAverages.length));

    // Step 6: Format for Ax
    if (topIssues.length > 0) {
      feedback.push("\nTOP ISSUES REQUIRING FIXES:");
      
      topIssues.forEach((issue, index) => {
        const suggestion = criterionSuggestions[issue.criterion];
        const percentage = issue.maxPoints > 0 
          ? ((issue.avgDeduction / issue.maxPoints) * 100).toFixed(1)
          : "0";
        
        feedback.push(`\n${index + 1}. "${issue.criterion}" - Average deduction: ${issue.avgDeduction.toFixed(2)}/${issue.maxPoints} points (${percentage}% of max, affects ${issue.affectedPersonas}/${issue.totalPersonas} personas)`);
        
        if (suggestion) {
          feedback.push(`   SUGGESTION: ${suggestion.suggestion}`);
          feedback.push(`   Add rule: "${suggestion.rule}"`);
        } else {
          feedback.push(`   SUGGESTION: Address this criterion to improve overall performance.`);
        }
        
        // Add severe examples (rating 3-4) for this criterion
        const examples = criterionExamples[issue.criterion];
        if (examples && examples.length > 0) {
          // Sort by rating (highest first) and take top 2
          const severeExamples = examples
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 2);
          
          if (severeExamples.length > 0) {
            feedback.push(`   \n   SEVERE EXAMPLES FROM JUDGE (rating 3-4):`);
            severeExamples.forEach((example, exIndex) => {
              feedback.push(`   ${exIndex + 1}. [Persona: ${example.personaId}, Rating: ${example.rating}/4] ${example.explanation}`);
            });
          }
        }
      });
    }
  }
  
  // CRITICAL ISSUES - Worst Performing Personas
  if (iteration.judgeResults && iteration.judgeResults.length > 0) {
    // Sort by score (lowest first) to get worst performers
    const sortedResults = [...iteration.judgeResults].sort((a, b) => 
      a.overallScore - b.overallScore
    );
    
    // Get bottom 3 personas (or all if less than 3)
    const worstPerformers = sortedResults.slice(0, Math.min(3, sortedResults.length));
    
    if (worstPerformers.length > 0) {
      feedback.push("\nCRITICAL ISSUES - WORST PERFORMING PERSONAS:");
      
      worstPerformers.forEach((result, index) => {
        const personaName = result.persona;
        const personaId = result.personaId;
        const score = result.overallScore;
        const justification = result.employee.justification;
        
        feedback.push(`\n${index + 1}. ${personaName} (ID: ${personaId}, Score: ${score}/100):`);
        feedback.push(`${justification}`);
      });
    }
    
    // ALL PERSONA EVALUATIONS
    feedback.push("\nALL PERSONA EVALUATIONS:");
    
    iteration.judgeResults.forEach((result, index) => {
      const personaName = result.persona;
      const personaId = result.personaId;
      const justification = result.employee.justification;
      
      feedback.push(`\n- Persona ${index + 1} - ${personaName} (ID: ${personaId}):`);
      feedback.push(`${justification}`);
    });
  } else {
    // Fallback to old behavior if judgeResults not available
    if (iteration.score < 70) {
      feedback.push("\nThe prompt needs significant improvement. Focus on being more helpful and responsive to customer needs.");
    } else if (iteration.score < 85) {
      feedback.push("\nThe prompt is decent but could be more effective. Improve clarity and customer engagement.");
    } else {
      feedback.push("\nThe prompt is performing well. Fine-tune for consistency across different customer types.");
    }
    
    // Add persona-specific feedback
    const lowScoringPersonas = Object.entries(iteration.scoresByPersona)
      .filter(([_, score]) => score < 80)
      .map(([personaId, score]) => {
        const persona = personas.find(p => p.id === personaId);
        return `${personaId} (${score.toFixed(1)}/100)`;
      });
    
    if (lowScoringPersonas.length > 0) {
      feedback.push(`\nLower scores observed for: ${lowScoringPersonas.join(", ")}. Consider adapting the prompt for these customer types.`);
    }
  }
  
  return feedback.join(" ");
}


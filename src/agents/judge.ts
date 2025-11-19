import { ChatOpenAI } from "@langchain/openai";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";

export type JudgeInput = {
	transcript: string[]; // e.g. ["CUSTOMER: ...", "EMPLOYEE: ..."]
};

// Raw evaluation from LLM - only behavior ratings (0-4), no math
export type JudgeRawEvaluation = {
	employee: {
		justification: string;
		behaviorRatings: Array<{
			criterion: string;
			rating: number; // 0-4 scale (0=no issue, 4=severe issue)
			explanation?: string; // Optional explanation for the rating
		}>;
	};
	comments: string;
};

// Calculated output with scores computed by function
export type JudgeOutput = {
	overallScore: number; // 0-100 (calculated)
	employee: {
		score: number; // 0-100 (calculated, same as overallScore)
		justification: string;
		subscores: Array<{
			criterion: string;
			pointsDeducted: number; // Calculated deduction amount
			maxPoints: number; // Maximum possible deduction for this criterion
			rating: number; // Original 0-4 rating from LLM
			explanation?: string; // Optional explanation from LLM
		}>;
	};
	comments: string;
};

const defaultRubric = `
You are an impartial judge evaluating the ENTIRE CONVERSATION QUALITY, focusing on the EMPLOYEE (salesperson) performance in a car sales conversation.
Be STRICT and CONSISTENT. Read the ENTIRE conversation transcript carefully - every customer question and every employee response.

CRITICAL: You must evaluate how well the employee responds to the customer's questions and requests. If a customer asks a direct question and the employee ignores it, changes the subject, or gives a vague non-answer, this is a MAJOR issue.

BEHAVIOR EVALUATION RUBRIC:
Evaluate the employee on 8 negative behaviors using a 0-4 scale for each:
- 0 = No issue observed
- 1 = Minor issue (occasional occurrence)
- 2 = Moderate issue (noticeable problem)
- 3 = Significant issue (frequent problem)
- 4 = Severe issue (major problem throughout)

The 8 behaviors to evaluate:
1. "Repeated questions"
   Rate how often the employee asks the same question multiple times or re-asks information already provided by the customer.

2. "Generic or off-topic responses"
   Rate how often the employee gives vague, generic answers that don't address the customer's specific question, or goes off-topic.
   CRITICAL: If the customer asks a direct question (e.g., "What are the key features?", "What is the fuel efficiency?", "Is it reliable?") and the employee does NOT answer it, ignores it, or changes the subject, this is a SEVERE issue (rating 3-4). Examples of ignoring questions:
   - Customer asks for specific information → Employee asks about appointment instead
   - Customer asks for details → Employee gives vague "it's great" without specifics
   - Customer asks multiple questions → Employee only answers one or none

3. "Ignoring budget or constraints"
   Rate how often the employee recommends vehicles or options that exceed the customer's stated budget, or ignores other constraints they mentioned (size, features, etc.).

4. "Being too pushy"
   Rate how often the employee uses aggressive sales tactics, pressures the customer, or doesn't respect their pace or decisions.
   CRITICAL: If the customer asks questions or requests information, and the employee repeatedly asks to schedule an appointment instead of answering, this is being pushy. Examples:
   - Customer asks for information → Employee asks about appointment (rating 2-3)
   - Customer asks multiple times for same info → Employee keeps pushing appointment (rating 3-4)
   - Customer hasn't gotten answers yet → Employee repeatedly asks to book appointment (rating 3-4)

5. "Using jargon or acronyms"
   Rate how often the employee uses technical terms, industry jargon, or acronyms without explanation, making responses unclear to the customer.

6. "Overly verbose or rambling responses"
   Rate how often the employee gives responses that are unnecessarily long, repetitive, or rambling without clear structure or purpose.

7. "Failing to acknowledge urgency or emotion"
   Rate how often the employee fails to recognize or respond appropriately to the customer's emotional state, urgency, concerns, or expressed needs.

8. "Bad or irrelevant recommendation"
   Rate how often the employee recommends vehicles that don't match the customer's stated needs, preferences, or requirements.

Output JSON only. Always include ALL required fields exactly with these keys:
- employee: { 
    justification: string (overall assessment of employee performance),
    behaviorRatings: array of { 
      criterion: string (exact name of one of the 8 behaviors),
      rating: number (0-4 scale),
      explanation: string (optional brief explanation of the rating)
    } - MUST include all 8 behaviors
  }
- comments: string (any additional observations)

IMPORTANT: 
- Provide a rating (0-4) for EACH of the 8 behaviors listed above
- Use the exact criterion names as listed
- Do NOT calculate any scores or deductions - just provide the 0-4 ratings
- The justification should explain the overall employee performance
- Include explanations for ratings if helpful

If you have no comments, set comments to an empty string \"\".
Do not omit any fields and do not add extra fields.
`;

// Criterion weights for calculating deductions
export const CRITERION_WEIGHTS: Record<string, number> = {
	"Repeated questions": 10,
	"Generic or off-topic responses": 15,
	"Ignoring budget or constraints": 15,
	"Being too pushy": 10,
	"Using jargon or acronyms": 10,
	"Overly verbose or rambling responses": 10,
	"Failing to acknowledge urgency or emotion": 15,
	"Bad or irrelevant recommendation": 15,
};

/**
 * Calculate scores from behavior ratings (0-4 scale)
 * Converts ratings to deductions and calculates final score
 */
export function calculateJudgeScores(rawEvaluation: JudgeRawEvaluation): JudgeOutput {
	const subscores: JudgeOutput["employee"]["subscores"] = [];
	let totalDeductions = 0;

	for (const behaviorRating of rawEvaluation.employee.behaviorRatings) {
		const criterion = behaviorRating.criterion;
		const rating = behaviorRating.rating; // 0-4 scale
		const weight = CRITERION_WEIGHTS[criterion] || 0;
		
		// Calculate deduction: (rating / 4) × weight
		const pointsDeducted = (rating / 4) * weight;
		totalDeductions += pointsDeducted;

		const subscore: JudgeOutput["employee"]["subscores"][0] = {
			criterion,
			pointsDeducted: Math.round(pointsDeducted * 100) / 100, // Round to 2 decimal places
			maxPoints: weight,
			rating,
		};
		
		// Only add explanation if it exists and is not null
		if (behaviorRating.explanation) {
			subscore.explanation = behaviorRating.explanation;
		}
		
		subscores.push(subscore);
	}

	// Calculate final score: 100 - total deductions
	const overallScore = Math.max(0, Math.min(100, Math.round((100 - totalDeductions) * 100) / 100));

	return {
		overallScore,
		employee: {
			score: overallScore, // Same as overallScore
			justification: rawEvaluation.employee.justification,
			subscores,
		},
		comments: rawEvaluation.comments,
	};
}

export function createConversationJudge(options?: {
	rubric?: string;
	modelName?: string;
	temperature?: number;
}): Runnable<JudgeInput, JudgeRawEvaluation> {
	const rubric = (options?.rubric ?? process.env.JUDGE_RUBRIC ?? defaultRubric).toString();
	const model = new ChatOpenAI({
		model: options?.modelName ?? process.env.JUDGE_MODEL ?? "gpt-4o-mini",
		temperature: options?.temperature ?? 0,
	});

	const schema = z.object({
		employee: z.object({
			justification: z.string(),
			behaviorRatings: z.array(
				z.object({
					criterion: z.string(),
					rating: z.number().min(0).max(4),
					explanation: z.string().nullable(),
				})
			),
		}),
		comments: z.string().default(""),
	});

	const structured = model.withStructuredOutput(schema);

	return new RunnableLambda({
		func: async (input: JudgeInput) => {
			const transcriptText = input.transcript.join("\n");
			const prompt = [
				{ role: "system", content: rubric },
				{
					role: "user",
					content: `Evaluate the following conversation transcript.\n\nTranscript:\n${transcriptText}`,
				},
			] as const;
			const result = await structured.invoke(prompt as any);
			return result as JudgeRawEvaluation;
		},
	});
}



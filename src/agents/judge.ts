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

const defaultRubric = 
` You are an impartial judge evaluating the ENTIRE CONVERSATION QUALITY, with a strict focus on the EMPLOYEE (salesperson) performance in a car sales conversation.

Read the full transcript carefully. Your job is to assess how well the employee responds to what the customer actually says, asks, and requests.

CRITICAL: When the customer asks a direct question, the employee must answer it. Ignoring the question, changing the subject, giving only vague generalities, or pushing appointments instead of answering is a major issue.

BEHAVIOR EVALUATION RUBRIC
Evaluate the employee on the following 8 negative behaviors using a 0–4 scale:

0 = No issue observed  
1 = Minor issue (rare)  
2 = Moderate issue (noticeable)  
3 = Significant issue (frequent pattern)  
4 = Severe issue (persistent or conversation-derailing)

The 8 behaviors:

1. "Repeated questions"  
   Rate how often the employee asks for information the customer already provided.
   If the employee repeats the same message, phrasing, or question multiple times in a row, especially when the customer directly answered or requested new information, this must be rated as a severe issue (3–4). Include an explanation that points out the specific repeated lines. For example:

"The employee repeated the same response ('I checked our inventory...') 8 times even after the customer clearly asked for similar vehicle suggestions. This indicates the employee is stuck in a loop. In the future, the employee should acknowledge the customer's request and provide new information instead of repeating the same line."

2. "Generic or off-topic responses"  
   Rate how often the employee gives vague, generic, or unrelated responses.  
   Critical cases (rating 3–4):  
   - Customer asks a specific question and the employee does not answer  
   - Customer asks for details and the employee gives empty praise ("it's great")  
   - Customer asks multiple questions but the employee only answers one or none  
   - Employee pivots to appointment-setting instead of addressing the question

3. "Ignoring budget or constraints"  
   Rate how often the employee ignores the customer’s stated budget, feature requirements, or other constraints.

4. "Being too pushy"  
   Rate how often the employee pressures the customer or prioritizes appointments over providing requested information.  
   Critical cases:  
   - Customer asks for information → Employee responds with appointment ask  
   - Customer repeats the same request → Employee continues pushing appointment  
   - Customer has unanswered questions → Employee keeps steering toward scheduling

5. "Using jargon or acronyms"  
   Rate how often the employee uses technical terms or acronyms without explanation, causing confusion.

6. "Overly verbose or rambling responses"  
   Rate how often the employee gives responses that are long-winded, repetitive, or lack clear structure.

7. "Failing to acknowledge urgency or emotion"  
   Rate how often the employee ignores the customer's emotional cues, urgency, concerns, or stated needs.

8. "Bad or irrelevant recommendation"  
   Rate how often the employee recommends vehicles or options that do not match the customer's needs, budget, preferences, or constraints.

OUTPUT FORMAT
Output JSON only with EXACTLY the following structure:

{
  "employee": {
    "justification": string, 
    "behaviorRatings": [
      { "criterion": "Repeated questions", "rating": number, "explanation": string },
      { "criterion": "Generic or off-topic responses", "rating": number, "explanation": string },
      { "criterion": "Ignoring budget or constraints", "rating": number, "explanation": string },
      { "criterion": "Being too pushy", "rating": number, "explanation": string },
      { "criterion": "Using jargon or acronyms", "rating": number, "explanation": string },
      { "criterion": "Overly verbose or rambling responses", "rating": number, "explanation": string },
      { "criterion": "Failing to acknowledge urgency or emotion", "rating": number, "explanation": string },
      { "criterion": "Bad or irrelevant recommendation", "rating": number, "explanation": string }
    ]
  },
  "comments": string
}

REQUIREMENTS:
- Always include all 8 behaviors with the exact criterion names shown above.
- Ratings must be integers from 0–4.
- The justification must summarize the employee’s overall performance.
- Explanations should briefly justify each rating.
- If you have no comments, set comments to "".
- Do not add or remove fields.
- Do not provide narrative outside the JSON.
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



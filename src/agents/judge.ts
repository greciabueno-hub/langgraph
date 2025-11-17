import { ChatOpenAI } from "@langchain/openai";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import { z } from "zod";

export type JudgeInput = {
	transcript: string[]; // e.g. ["CUSTOMER: ...", "EMPLOYEE: ..."]
};

export type JudgeOutput = {
	overallScore: number; // 0-100
	employee: {
		score: number; // 0-100
		justification: string;
		subscores: Array<{
			criterion: string;
			score: number; // 0-100 for that criterion
		}>;
	};
	comments: string;
};

const defaultRubric = `
You are an impartial judge evaluating ONLY the EMPLOYEE (salesperson) performance in a car sales conversation.
Use a deduction-based scoring system. Start with 100 points and deduct points for negative behaviors.
Be strict and consistent. Consider the entire transcript.

DEDUCTION-BASED SCORING RUBRIC:
Start with a base score of 100 points. Evaluate the employee on 8 negative behaviors using a 0-4 scale for each:
- 0 = No issue observed
- 1 = Minor issue (occasional occurrence)
- 2 = Moderate issue (noticeable problem)
- 3 = Significant issue (frequent problem)
- 4 = Severe issue (major problem throughout)

For each behavior, calculate the deduction as: (score/4) × weight

The 8 behaviors and their weights:
1. "Repeated questions" - Weight: 10 points
   Deduct for asking the same question multiple times or re-asking information already provided by the customer.

2. "Generic or off-topic responses" - Weight: 15 points
   Deduct for giving vague, generic answers that don't address the customer's specific question, or going off-topic.

3. "Ignoring budget or constraints" - Weight: 15 points
   Deduct for recommending vehicles or options that exceed the customer's stated budget, or ignoring other constraints they mentioned (size, features, etc.).

4. "Being too pushy" - Weight: 10 points
   Deduct for aggressive sales tactics, pressuring the customer, or not respecting their pace or decisions.

5. "Using jargon or acronyms" - Weight: 10 points
   Deduct for using technical terms, industry jargon, or acronyms without explanation, making responses unclear to the customer.

6. "Overly verbose or rambling responses" - Weight: 10 points
   Deduct for responses that are unnecessarily long, repetitive, or rambling without clear structure or purpose.

7. "Failing to acknowledge urgency or emotion" - Weight: 15 points
   Deduct for not recognizing or responding appropriately to the customer's emotional state, urgency, concerns, or expressed needs.

8. "Bad or irrelevant recommendation" - Weight: 15 points
   Deduct for recommending vehicles that don't match the customer's stated needs, preferences, or requirements.

Total possible deductions: 10 + 15 + 15 + 10 + 10 + 10 + 15 + 15 = 100 points
Maximum deduction cap: 80 points (80% of total)
Final score = 100 - total deductions (minimum score is 20 if all deductions are maximum)

Output JSON only. Always include ALL required fields exactly with these keys:
- overallScore: number 0-100
- employee: { 
    score: number 0-100, 
    justification: string,
    subscores: array of { criterion: string, score: number } for each of the 8 behaviors
  }
- comments: string

For subscores, provide one entry for each of the 8 behaviors. The score field should be the DEDUCTION amount (0 to the weight for that behavior):
1. "Repeated questions" - deduction out of 10 (e.g., if score 2/4: deduction = 2/4 × 10 = 5 points)
2. "Generic or off-topic responses" - deduction out of 15 (e.g., if score 3/4: deduction = 3/4 × 15 = 11.25 points)
3. "Ignoring budget or constraints" - deduction out of 15
4. "Being too pushy" - deduction out of 10
5. "Using jargon or acronyms" - deduction out of 10
6. "Overly verbose or rambling responses" - deduction out of 10
7. "Failing to acknowledge urgency or emotion" - deduction out of 15
8. "Bad or irrelevant recommendation" - deduction out of 15

IMPORTANT: 
- Calculate total deductions by summing all 8 subscores
- Cap total deductions at 80 points maximum
- Calculate overallScore = 100 - total deductions (minimum 20)
- The employee.score should equal the overallScore
- For example, if deductions total 25 points, then overallScore = 75 and employee.score = 75

If you have no comments, set comments to an empty string \"\".
Do not omit any fields and do not add extra fields.
`;

export function createConversationJudge(options?: {
	rubric?: string;
	modelName?: string;
	temperature?: number;
}): Runnable<JudgeInput, JudgeOutput> {
	const rubric = (options?.rubric ?? process.env.JUDGE_RUBRIC ?? defaultRubric).toString();
	const model = new ChatOpenAI({
		model: options?.modelName ?? process.env.JUDGE_MODEL ?? "gpt-4o-mini",
		temperature: options?.temperature ?? 0,
	});

	const schema = z.object({
		overallScore: z.number().min(0).max(100),
		employee: z.object({
			score: z.number().min(0).max(100),
			justification: z.string(),
			subscores: z.array(
				z.object({
					criterion: z.string(),
					score: z.number().min(0).max(100),
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
			return result as JudgeOutput;
		},
	});
}



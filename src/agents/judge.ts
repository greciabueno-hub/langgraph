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
Use a 0-100 scale. Be strict and consistent. Consider the entire transcript.

Employee scoring rubric (0-100 total):
- Greeting and professionalism (0-20)
- Identifying needs: asked targeted questions, clarified constraints (0-25)
- Product knowledge and recommendations relevance (0-25)
- Progressing the sale: next steps, appointment, call to action (0-20)
- Empathy and tone (0-10)

Total possible points: 20 + 25 + 25 + 20 + 10 = 100 points

Output JSON only. Always include ALL required fields exactly with these keys:
- overallScore: number 0-100
- employee: { 
    score: number 0-100, 
    justification: string,
    subscores: array of { criterion: string, score: number (0 to max for that category) } for each rubric category
  }
- comments: string

For subscores, provide one entry for each of these 5 categories. Score each category out of its maximum points:
1. "Greeting and professionalism" - score out of 20 (e.g., 15/20)
2. "Identifying needs" - score out of 25 (e.g., 20/25)
3. "Product knowledge and recommendations" - score out of 25 (e.g., 18/25)
4. "Progressing the sale" - score out of 20 (e.g., 12/20)
5. "Empathy and tone" - score out of 10 (e.g., 8/10)

The score field should be the actual points earned (0 to the max for that category), not a percentage.

IMPORTANT: 
- Calculate the overallScore by summing all the subscores: overallScore = sum of all subscores
- The employee.score should equal the overallScore (they represent the same total)
- For example, if subscores are: 15/20 + 20/25 + 18/25 + 12/20 + 8/10 = 73, then overallScore = 73 and employee.score = 73

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



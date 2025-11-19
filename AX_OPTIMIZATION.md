# Ax Optimization for BDC Prompts

This document explains the Ax (DSPy for TypeScript) optimization system for BDC (Business Development Center) prompts.

## Overview

The Ax optimization loop automatically improves BDC salesperson prompts by:
1. Testing different prompt variations
2. Running full conversation simulations
3. Evaluating performance with the judge
4. Using Ax to propose better prompts
5. Saving the best prompt to the database

## Architecture

### Flow Diagram

```
┌─────────────────┐
│  GET Prompt     │  ← Step 1: Fetch current prompt from DB
│  from DB        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Ax Loop        │
│  ┌───────────┐ │
│  │ Iteration │ │
│  └─────┬─────┘ │
│        │       │
│        ▼       │
│  ┌─────────────────┐
│  │ POST Candidate  │  ← Step 2: Set candidate prompt in backend
│  │ Prompt to DB    │
│  └────────┬────────┘
│           │
│           ▼
│  ┌─────────────────┐
│  │ Run Simulation  │  ← Step 3: BDC ↔ Simulator conversation
│  │ (Full Graph)    │     via POST /workflows/process
│  └────────┬────────┘
│           │
│           ▼
│  ┌─────────────────┐
│  │ Judge Scores    │  ← Step 4: Evaluate transcript
│  │ Transcript      │
│  └────────┬────────┘
│           │
│           ▼
│  ┌─────────────────┐
│  │ Ax Proposes     │  ← Step 5: Generate next candidate
│  │ Next Candidate  │
│  └────────┬────────┘
│           │
│           └───► Repeat until max iterations or target score
│
└───────────┬───────────┘
            │
            ▼
    ┌───────────────┐
    │ POST Best     │  ← Step 6: Save optimized prompt
    │ Prompt to DB  │
    └───────────────┘
```

## Components

### 1. Prompt API Client (`src/agents/promptApi.ts`)

Handles communication with the backend database for prompts:

- `getCurrentPrompt()` - Fetches the current BDC prompt
- `postCandidatePrompt()` - Saves a candidate prompt for testing
- `postBestPrompt()` - Saves the final optimized prompt

**API Endpoints (assumed):**
- `GET /api/prompts/bdc/current` - Get current prompt
- `POST /api/prompts/bdc/candidate` - Save candidate prompt
- `POST /api/prompts/bdc/best` - Save best prompt

### 2. Ax Optimizer (`src/optimization/axOptimizer.ts`)

Core optimization logic:

- `optimizeBdcPrompt()` - Main optimization function
- `evaluatePrompt()` - Runs simulation and gets judge scores
- `generateFeedback()` - Creates feedback for Ax based on results

**Ax Signature:**
```typescript
currentPrompt: string,
currentScore: number,
evaluationFeedback: string ->
optimizedPrompt: string
```

### 3. Optimization Runner (`src/optimization/runAxOptimization.ts`)

Orchestrates the full optimization loop:

- Fetches initial prompt
- Runs Ax optimization
- Saves best prompt

## Usage

### Installation

First, install the Ax package:

```bash
npm install @ax-llm/ax
```

### Environment Variables

Add to your `.env` file:

```bash
# Required
OPENAI_API_KEY=your_key_here
AUTOMOTIVE_API_BASE_URL=http://automotive-api:5000

# Optional - Prompt API (defaults to AUTOMOTIVE_API_BASE_URL)
PROMPT_API_BASE_URL=http://your-api:5000

# Optional - Optimization config
AX_MAX_ITERATIONS=5          # Max optimization iterations
AX_TARGET_SCORE=90           # Target judge score (0-100)
AX_PERSONAS=budget-conscious,urgent-buyer  # Comma-separated persona IDs
AX_LLM_MODEL=gpt-4o-mini     # Model for Ax optimization

# Optional - Debugging
DEBUG_PROMPT_API=true        # Log prompt API calls
SAVE_OPTIMIZATION_RESULTS=true  # Save results to JSON file
```

### Running Optimization

**Via npm script:**
```bash
npm run optimize-prompt
```

**Via Docker:**
```bash
docker-compose run --rm run-multi-persona npm run optimize-prompt
```

**Direct execution:**
```bash
node --loader ts-node/esm src/optimization/runAxOptimization.ts
```

## How It Works

### Step-by-Step Process

1. **GET Current Prompt**
   - Fetches the current BDC prompt from your database
   - Falls back to a default prompt if none exists

2. **Initial Evaluation**
   - Runs full simulation with current prompt
   - Tests against all personas (or specified subset)
   - Gets judge scores for each conversation

3. **Optimization Loop** (repeats for each iteration)
   
   a. **POST Candidate Prompt**
      - Saves the candidate prompt to backend
      - Backend uses this prompt for the next simulation
   
   b. **Run Full Simulation**
      - Executes the conversation graph
      - BDC (via `/workflows/process`) ↔ Customer Simulator
      - Continues until appointment completed or max messages
   
   c. **Judge Scores Transcript**
      - Evaluates conversation quality
      - Returns score (0-100) and detailed feedback
   
   d. **Ax Proposes Next Candidate**
      - Uses current prompt, score, and feedback
      - Generates optimized prompt via Ax signature
      - Learns from previous iterations

4. **POST Best Prompt**
   - Saves the highest-scoring prompt to database
   - Includes metadata (score, iterations, date)

### Evaluation Metrics

The optimization uses the **judge score** as the primary metric:
- **Overall Score**: 0-100 (higher is better)
- **Persona-specific scores**: Performance per customer type
- **Subscores**: Detailed breakdown by behavior criteria

### Ax Learning

Ax uses the following information to improve prompts:
- Current prompt text
- Current judge score
- Evaluation feedback (e.g., "needs improvement in X area")
- Iteration history

## Integration with Backend

### Required Backend Changes

Your backend needs to support:

1. **Prompt Storage**
   - Store prompts in database
   - Version control for prompts
   - Metadata (scores, dates, etc.)

2. **Prompt Retrieval**
   - Endpoint to get current prompt
   - Backend reads prompt at runtime for BDC agent

3. **Prompt Updates**
   - Endpoint to save candidate prompts (for testing)
   - Endpoint to save best prompt (for production)

### Example Backend Endpoints

```typescript
// GET current prompt
GET /api/prompts/bdc/current
Response: {
  id: string;
  prompt: string;
  version: number;
  createdAt: string;
}

// POST candidate prompt (for testing)
POST /api/prompts/bdc/candidate
Body: {
  prompt: string;
  metadata?: {
    iteration?: number;
    score?: number;
  }
}

// POST best prompt (final)
POST /api/prompts/bdc/best
Body: {
  prompt: string;
  metadata?: {
    finalScore?: number;
    iterations?: number;
    optimizationDate?: string;
  }
}
```

## Output

### Console Output

The optimization process logs:
- Initial prompt and score
- Each iteration's candidate prompt and score
- Best prompt found
- Final statistics

### Results File (if enabled)

If `SAVE_OPTIMIZATION_RESULTS=true`, saves to:
```
results/ax-optimization-{timestamp}.json
```

Contains:
- Initial prompt
- Best prompt
- All iteration results
- Scores by persona
- Metadata

## Customization

### Adjusting Optimization

Modify `OptimizationConfig` in `runAxOptimization.ts`:

```typescript
const config: OptimizationConfig = {
  maxIterations: 10,        // More iterations
  targetScore: 95,          // Higher target
  personasToTest: ["budget-conscious"],  // Test specific personas
  llmModel: "gpt-4",        // Use stronger model
};
```

### Custom Feedback Generation

Modify `generateFeedback()` in `axOptimizer.ts` to provide more specific guidance to Ax based on your evaluation criteria.

## Troubleshooting

### Ax Package Not Found

If you get `Cannot find module '@ax-llm/ax'`:
1. Check the correct package name (may vary)
2. Install: `npm install @ax-llm/ax`
3. Verify package exists in npm registry

### Backend API Errors

If prompt API calls fail:
1. Check `PROMPT_API_BASE_URL` is correct
2. Verify backend endpoints exist
3. Check network connectivity (Docker network)
4. Enable `DEBUG_PROMPT_API=true` for detailed logs

### Low Scores

If optimization doesn't improve scores:
1. Increase `maxIterations`
2. Use a stronger LLM model (`gpt-4` instead of `gpt-4o-mini`)
3. Check judge scoring is working correctly
4. Verify backend is using the candidate prompts

## Next Steps

1. **Implement Backend Endpoints** - Add prompt storage/retrieval to your backend
2. **Test with Small Iterations** - Start with 2-3 iterations to verify flow
3. **Monitor Results** - Check judge scores improve over iterations
4. **Production Integration** - Deploy optimized prompts to production BDC

## References

- [Ax Documentation](https://axllm.dev/)
- [DSPy Paper](https://github.com/stanfordnlp/dspy)
- Your existing judge evaluation system (`src/agents/judge.ts`)


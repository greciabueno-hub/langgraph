# Ax Prompt Flow - Where Prompts Are Saved and Used

## Overview
This document shows where Ax saves prompts to the database and where it uses prompts for the next iteration.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INITIAL PROMPT FETCH (runAxOptimization.ts)                 │
│    Line 69: getCurrentPrompt(promptApiBaseUrl)                 │
│    ↓                                                             │
│    Fetches latest prompt from database                          │
│    GET {PROMPT_API_BASE_URL}{PROMPT_ENDPOINT}                  │
│    ↓                                                             │
│    Returns: promptTemplate (string)                              │
│    ↓                                                             │
│    Stored in: currentPrompt variable                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. PASSED TO OPTIMIZER (runAxOptimization.ts)                   │
│    Line 91: optimizeBdcPrompt(currentPrompt, config)           │
│    ↓                                                             │
│    currentPrompt passed as initialPrompt parameter              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. OPTIMIZATION LOOP (axOptimizer.ts)                           │
│                                                                  │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ ITERATION 0: Initial Evaluation                      │    │
│    │ Line 263: evaluatePrompt(currentPrompt, ...)        │    │
│    │ Uses: currentPrompt (from initialPrompt parameter)   │    │
│    └──────────────────────────────────────────────────────┘    │
│                            ↓                                    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ ITERATION 1, 2, 3... (Optimization Loop)             │    │
│    │                                                        │    │
│    │ Line 312-316: Ax generates candidate prompt          │    │
│    │   promptOptimizer.forward(llm, {                     │    │
│    │     currentPrompt: currentPrompt,  ← Uses in-memory   │    │
│    │     currentScore: lastIteration.score,                │    │
│    │     evaluationFeedback: feedback,                     │    │
│    │   })                                                   │    │
│    │   Returns: candidatePrompt                            │    │
│    │                                                        │    │
│    │ Line 328: Evaluate candidate                          │    │
│    │   evaluatePrompt(candidatePrompt, ...)                │    │
│    │                                                        │    │
│    │ Line 338: SAVE TO DATABASE ⭐                         │    │
│    │   postCandidatePrompt(promptApiBaseUrl, candidatePrompt, {│
│    │     iteration: i,                                     │    │
│    │     score: evalResult.averageScore,                    │    │
│    │   })                                                   │    │
│    │   POST {PROMPT_API_BASE_URL}/agents/prompts            │    │
│    │                                                        │    │
│    │ Line 389: UPDATE IN-MEMORY VARIABLE ⚠️                 │    │
│    │   currentPrompt = candidatePrompt;                     │    │
│    │   (NOT re-fetched from database!)                       │    │
│    └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Key Locations

### 1. **Where Initial Prompt is Fetched**
**File:** `src/optimization/runAxOptimization.ts`
- **Line 69:** `getCurrentPrompt(promptApiBaseUrl)`
- **Function:** `src/agents/promptApi.ts` → `getCurrentPrompt()`
- **Endpoint:** `GET {PROMPT_API_BASE_URL}{PROMPT_ENDPOINT}` (default: `/customer_discovery`)
- **Purpose:** Fetches the latest prompt from database at the start of optimization

### 2. **Where Candidate Prompts are Saved**
**File:** `src/optimization/axOptimizer.ts`
- **Line 338:** `postCandidatePrompt(promptApiBaseUrl, candidatePrompt, {...})`
- **Function:** `src/agents/promptApi.ts` → `postCandidatePrompt()`
- **Endpoint:** `POST {PROMPT_API_BASE_URL}/agents/prompts`
- **When:** After each optimization iteration (after evaluation)
- **What's saved:**
  - `agentName`: From `AGENT_NAME` env var (default: "customer_discovery")
  - `promptTemplate`: The candidate prompt string
  - `metadata`: `{ iteration: i, score: evalResult.averageScore }`
- **Purpose:** Saves each candidate prompt to database (versioned)

### 3. **Where Prompt is Used for Next Iteration**
**File:** `src/optimization/axOptimizer.ts`
- **Line 313:** `currentPrompt: currentPrompt` (passed to Ax)
- **Line 389:** `currentPrompt = candidatePrompt;` (updated in-memory)
- **Important:** The code does NOT re-fetch from database between iterations
- **It uses:** The in-memory `currentPrompt` variable that gets updated after each iteration

## Important Notes

### ⚠️ Current Behavior
- **Between iterations:** The code uses the in-memory `currentPrompt` variable
- **NOT re-fetched:** The latest prompt from the database is NOT fetched before each iteration
- **Only fetched once:** At the very start in `runAxOptimization.ts`

### ✅ What Gets Saved
- Each candidate prompt is saved to the database after evaluation
- The database will have all versioned prompts
- The latest version in the database will be used for the NEXT optimization RUN (not the next iteration)

### 🔄 Flow Summary
1. **Start of run:** Fetch latest prompt from DB → `currentPrompt`
2. **Each iteration:**
   - Use `currentPrompt` (in-memory) to generate next candidate
   - Evaluate candidate
   - Save candidate to DB (versioned)
   - Update `currentPrompt = candidatePrompt` (in-memory)
3. **Next run:** Will fetch the latest prompt from DB (which includes all saved candidates)

## If You Want to Use Latest DB Prompt Between Iterations

If you want to fetch the latest prompt from the database before each iteration (instead of using in-memory), you would need to:

1. Add a call to `getCurrentPrompt()` before line 312 in `axOptimizer.ts`
2. Update `currentPrompt` with the fetched value
3. This would ensure each iteration uses the actual latest version from the database

However, the current design uses in-memory prompts during a single optimization run, which is more efficient and ensures consistency within a run.


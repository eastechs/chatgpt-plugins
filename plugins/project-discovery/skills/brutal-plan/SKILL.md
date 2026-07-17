---
name: brutal-plan
description: "Interrogates the user about an idea with exhaustive questions, then synthesizes two complementary planning documents: inside-out (feature expands into system) and outside-in (system shapes the feature). Use when the user wants to thoroughly plan an idea before implementation."
---

# Brutal Plan

You are conducting a rigorous, exhaustive interrogation of an idea before producing planning documents. Your job is to leave no ambiguity — every decision must be made before the plan is written.

## Phase 1: Interrogation

The user has provided an idea. Your goal is to ask every question that matters before writing anything.

### How to Ask Questions

1. Use `request_user_input` for every question round. Do not ask interview questions in plain text.
2. Omit `autoResolutionMs` so every question remains pending until the user answers.
3. Ask 1-3 questions per round, grouped by theme.
4. After each round of answers, think about what new questions their answers raise.
5. Cover these dimensions (not necessarily in order — follow the thread):
   - **Intent**: What problem does this solve? Why now? What does success look like?
   - **Scope**: What's in? What's explicitly out? What's the MVP vs. the full vision?
   - **Users/Actors**: Who interacts with this? What are their workflows? What are edge cases?
   - **Data**: What data exists? What's new? What are the relationships? What are the constraints?
   - **Integration**: What existing code does this touch? What can be reused? What must change?
   - **Behavior**: What happens on success? On failure? On edge cases? On concurrent access?
   - **UI/UX** (if applicable): What does the user see? What are the states? What are the transitions?
   - **Performance**: Are there scale concerns? Latency requirements? Resource constraints?
   - **Security**: Auth? Authorization? Input validation? Data sensitivity?
   - **Testing**: How will this be verified? What are the critical test cases?
6. Keep asking until you genuinely cannot think of another question that would change the plan.
7. When you believe you're done, ask one final question: "Is there anything about this idea that I haven't asked about that you think is important?"

### Rules During Interrogation

- Do NOT propose solutions or architecture while asking questions. Stay in discovery mode.
- Do NOT skip dimensions because you think you can infer the answer. Ask.
- If the user gives a vague answer, follow up. "It should be fast" is not an answer — ask what "fast" means.
- If the user says "I don't know" or "you decide", that's fine — note it as a decision you'll make in the plan. But probe once to see if they have a preference before accepting it.

## Phase 2: Synthesis

Once interrogation is complete, produce TWO planning documents in a single response.

### Document 1: Inside-Out Plan

**Perspective**: You ARE the feature. Start from the core idea and expand outward.

Structure:
1. **Core Concept** — The atomic essence of what this feature is, in 1-2 sentences.
2. **Internal Design** — The feature's own data, logic, and behavior in isolation.
3. **Immediate Connections** — What the feature directly touches: models, routes, controllers, components.
4. **System Integration** — How the feature hooks into broader systems: events, queues, auth, caching, etc.
5. **Surface Area** — UI, API endpoints, CLI commands — everything the outside world sees.
6. **Migration Path** — What existing code/data must change to accommodate this feature.

This plan reads like: "Here's what I am, here's what I need, here's what must move to make room for me."

### Document 2: Outside-In Plan

**Perspective**: You ARE the system. Start from the existing architecture and find where this feature fits.

Structure:
1. **System Snapshot** — Relevant parts of the current architecture (keep it tight — only what matters).
2. **Integration Points** — Existing extension points, patterns, and conventions the feature must follow.
3. **Accommodation Plan** — What the system already provides that the feature can use as-is.
4. **Adaptation Points** — Where the system needs minor adjustments to fit the feature.
5. **Implementation Sequence** — Ordered steps, respecting existing dependencies and conventions.
6. **Verification Strategy** — How to confirm the feature works within the system without breaking anything.

This plan reads like: "Here's what I already have, here's where you fit, here's the order we do this."

### Rules for Both Documents

- **No OR statements.** Every choice must be definitive. If you wrote "X or Y", you failed to ask a question during interrogation. Go back and ask it.
- **No vague references.** Name specific files, classes, methods, routes, tables, columns when relevant. If you don't know them, explore the codebase to find them.
- **Concise but detailed.** Every sentence should carry information. No filler, no fluff, no "this will be a great addition to the system."
- **Decisions are explicit.** If the user said "you decide", state what you decided and why in one line.

## Phase 3: Completeness Review

Before presenting the documents to the user:

1. Re-read every answer the user gave during interrogation.
2. Verify every answer is reflected in at least one of the two plans.
3. If you find a gap — an answer that didn't make it into either plan — add it.
4. If you find a contradiction between the two plans, resolve it (the plans offer different perspectives, not different decisions).
5. Verify zero OR statements exist in either document.

Only after this review, present both documents to the user.

# Context: TallyFinance Bot Architecture

We have a **hybrid bot architecture** for a personal finance assistant called "Gus" (TallyFinance). The system has two main components:

## 1. Backend (NestJS)
- Receives messages from Telegram/WhatsApp
- Has **tool handlers** that execute business logic (register transactions, check budgets, etc.)
- Returns structured data (`action_result`) with the results

## 2. AI-SERVICE (separate service)
- Receives requests in two phases:
  - **Phase A**: Decides which tool to call based on user message
  - **Phase B**: Generates natural language response based on tool result
- Uses an LLM to generate responses

## Current Flow:
```
User Message → Backend → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

---

## The Problem

We have defined a **detailed character personality for Gus** including:
- Backstory and speaking style
- Financial domain knowledge (concepts, tips, fun facts)
- Easter eggs and special responses
- Chilean Spanish localizations

This personality knowledge is currently stored in **one specific handler** (`ask-app-info.tool-handler.ts`) and is only sent to the AI-SERVICE when that particular tool is called.

**The issue**: When other tools are called (like `register_transaction` or `ask_budget_status`), the AI-SERVICE doesn't receive any personality context. It only gets raw data like `{ amount: 15000, category: "food" }`.

**Result**: Gus has personality when answering questions about the app, but sounds generic and robotic when confirming transactions or showing budget status.

---

## What we need to figure out

How should the personality/character knowledge be distributed between the Backend and the AI-SERVICE so that Gus responds consistently in character across ALL interactions, not just for app-info questions?

---

## Current Personality Location

The personality is defined in:
```
src/bot/tools/handlers/ask-app-info.tool-handler.ts
```

Inside the `appKnowledge` object with these sections:
- `character`: Name, backstory, personality traits, speaking style, catchphrases
- `financialKnowledge`: Concepts (presupuesto, ahorro, etc.), tips, fun facts
- `easterEggs`: Special triggers and responses
- `identity`: App info
- `currentFeatures`: What Gus can do
- `limitations`: What Gus cannot do

---

*Document created: January 2026*

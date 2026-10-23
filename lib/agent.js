// Chooses the AI brain: Claude when ANTHROPIC_API_KEY is set, otherwise the free Gemini key for testing.
// If Claude fails (no credit, busy, network), the same request goes to Gemini so Partner keeps answering.
import { emptyResult } from "./prompt.js";

// After a credit / key error, skip Claude for an hour so every answer doesn't wait for a failing call first.
let claudeOffUntil = 0;
const useClaude = () => !!process.env.ANTHROPIC_API_KEY && Date.now() > claudeOffUntil;
function claudeFailed(err) {
  const msg = String(err?.message || "");
  if (/credit balance|billing|authentication|invalid x-api-key|permission/i.test(msg)) claudeOffUntil = Date.now() + 60 * 60 * 1000;
  console.error("Claude failed, using Gemini instead:", msg.slice(0, 160));
}

export async function runAgent(body) {
  let result;
  if (useClaude()) {
    try {
      const { runClaude } = await import("./claude.js");
      result = await runClaude(body);
    } catch (err) {
      if (!process.env.GEMINI_API_KEY) throw err;
      claudeFailed(err);
    }
  }
  if (!result) {
    if (!process.env.GEMINI_API_KEY) throw new Error("No AI key found. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY for free testing) in the .env file.");
    const { runGemini } = await import("./gemini.js");
    result = await runGemini(body);
  }
  // Fill any missing field so the app never breaks on a partial answer.
  return { ...emptyResult(body.lang), ...result };
}

// Screen translation for languages beyond Gujarati / Hindi / English (same Claude -> Gemini fallback).
export async function translateStrings({ lang, strings }) {
  if (!lang || !strings || typeof strings !== "object") throw new Error("Missing 'lang' or 'strings'");
  if (useClaude()) {
    try {
      const { translateClaude } = await import("./claude.js");
      return await translateClaude(lang, strings);
    } catch (err) {
      if (!process.env.GEMINI_API_KEY) throw err;
      claudeFailed(err);
    }
  }
  if (!process.env.GEMINI_API_KEY) throw new Error("No AI key found");
  const { translateGemini } = await import("./gemini.js");
  return translateGemini(lang, strings);
}

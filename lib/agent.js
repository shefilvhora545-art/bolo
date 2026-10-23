// Chooses the AI brain: Claude when ANTHROPIC_API_KEY is set, otherwise the free Gemini key for testing.
// If Claude fails (no credit yet, busy, network), the same request goes to Gemini so Bolo keeps answering.
import { emptyResult } from "./prompt.js";

export async function runAgent(body) {
  let result;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { runClaude } = await import("./claude.js");
      result = await runClaude(body);
    } catch (err) {
      if (!process.env.GEMINI_API_KEY) throw err;
      console.error("Claude failed, using Gemini instead:", err.message);
      const { runGemini } = await import("./gemini.js");
      result = await runGemini(body);
    }
  } else if (process.env.GEMINI_API_KEY) {
    const { runGemini } = await import("./gemini.js");
    result = await runGemini(body);
  } else {
    throw new Error("No AI key found. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY for free testing) in the .env file.");
  }
  // Fill any missing field so the app never breaks on a partial answer.
  return { ...emptyResult(body.lang), ...result };
}

// Screen translation for languages beyond Gujarati / Hindi / English (same Claude -> Gemini fallback).
export async function translateStrings({ lang, strings }) {
  if (!lang || !strings || typeof strings !== "object") throw new Error("Missing 'lang' or 'strings'");
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { translateClaude } = await import("./claude.js");
      return await translateClaude(lang, strings);
    } catch (err) {
      if (!process.env.GEMINI_API_KEY) throw err;
      console.error("Claude translation failed, using Gemini:", err.message);
    }
  }
  if (!process.env.GEMINI_API_KEY) throw new Error("No AI key found");
  const { translateGemini } = await import("./gemini.js");
  return translateGemini(lang, strings);
}

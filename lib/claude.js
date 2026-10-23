// Bolo's brain on Claude: turns one spoken sentence into a spoken reply + one phone action.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildMessages, emptyResult } from "./prompt.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// body = { text, lang, now, contacts, memory, history, sharedText }
export async function runClaude(body) {
  const messages = buildMessages(body);

  // Streaming keeps long code answers from hitting HTTP timeouts.
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low", // voice needs fast answers
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages,
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    return { ...emptyResult(body.lang), reply: "Maaf karjo, hu aa kaam nahi kari shakto." };
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No answer from Claude");
  return JSON.parse(textBlock.text);
}

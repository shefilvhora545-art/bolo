// Bolo's brain on Claude: turns one spoken sentence into a spoken reply + one phone action.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, TRANSLATE_PROMPT, buildMessages, emptyResult } from "./prompt.js";

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

// Translates the app's screen texts (an object of key -> English text) into another language.
export async function translateClaude(lang, strings) {
  const keys = Object.keys(strings);
  const schema = {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    required: keys,
    additionalProperties: false,
  };
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system: TRANSLATE_PROMPT,
    messages: [{ role: "user", content: `Target language: ${lang}\n\n${JSON.stringify(strings)}` }],
  });
  const response = await stream.finalMessage();
  const textBlock = response.content.find((b) => b.type === "text");
  if (response.stop_reason === "refusal" || !textBlock) throw new Error("Translation failed");
  return JSON.parse(textBlock.text);
}

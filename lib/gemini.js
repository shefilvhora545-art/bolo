// Free testing option: Google Gemini through its REST API (used only when no Claude key is set).
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildMessages } from "./prompt.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// Free-tier models, best first. If one is busy, retired or out of quota, the next one is tried.
const MODELS = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"]);
const RETRY_NEXT = new Set([404, 429, 500, 503]);

export async function runGemini(body) {
  const key = process.env.GEMINI_API_KEY;
  const request = JSON.stringify({
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: buildMessages(body).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    // The schema goes in its own field, so Gemini fills it in instead of copying it.
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA, temperature: 0.3 },
  });

  let lastError = "Gemini error";
  for (const model of MODELS) {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: request,
    });
    const data = await res.json();
    if (!res.ok) {
      lastError = data.error?.message || `Gemini error ${res.status}`;
      if (RETRY_NEXT.has(res.status)) continue;
      throw new Error(lastError);
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) { lastError = "No answer from Gemini"; continue; }
    const result = parseFirstJson(text);
    // A real answer always has a spoken reply and a known action; otherwise try the next model.
    if (typeof result.reply !== "string" || !result.reply || !RESPONSE_SCHEMA.properties.action.enum.includes(result.action)) {
      lastError = "Gemini gave an incomplete answer";
      continue;
    }
    return result;
  }
  throw new Error(lastError.split("\n")[0]);
}

// Gemini sometimes repeats the JSON object; keep only the first complete one.
function parseFirstJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf("{");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i >= 0 && i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;          // this character was escaped, skip it
      else if (ch === "\\") escaped = true;  // next character is escaped
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("Could not read Gemini's answer");
}

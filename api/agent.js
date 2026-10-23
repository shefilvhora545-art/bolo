// Vercel serverless function: POST /api/agent
import { runAgent } from "../lib/agent.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    res.status(200).json(await runAgent(body));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

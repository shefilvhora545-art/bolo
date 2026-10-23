// Vercel serverless function: GET /api/status -> which AI brain is configured
export default function handler(req, res) {
  const provider = process.env.ANTHROPIC_API_KEY ? "Claude" : process.env.GEMINI_API_KEY ? "Gemini" : "";
  res.status(200).json({ provider });
}

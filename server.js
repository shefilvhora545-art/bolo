// Local server: serves the web app from /public and the AI from POST /api/agent.
// Run: npm start  ->  open http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const { runAgent } = await import("./lib/agent.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = process.env.PORT || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// PC helper (only when Bolo runs on this Windows PC): opens WhatsApp Desktop with the text typed
// and presses Enter, so "ha / yes" sends the message with no extra tap.
function pcSendWhatsApp(phone, text) {
  const digits = String(phone).replace(/\D/g, "");
  const number = digits.length === 10 ? "91" + digits : digits;
  const url = `whatsapp://send?phone=${number}&text=${encodeURIComponent(text)}`;
  const script = [
    `Start-Process '${url.replace(/'/g, "''")}'`,
    "Start-Sleep -Seconds 4",
    "$sh = New-Object -ComObject WScript.Shell",
    "if ($sh.AppActivate('WhatsApp')) { Start-Sleep -Milliseconds 700; $sh.SendKeys('{ENTER}'); 'sent' } else { 'whatsapp-not-found' }",
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: 20000 }, (err, stdout) =>
      resolve(err ? "error" : String(stdout).trim()));
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
  });
}

http.createServer(async (req, res) => {
  if (req.url === "/api/status") {
    const provider = process.env.ANTHROPIC_API_KEY ? "Claude" : process.env.GEMINI_API_KEY ? "Gemini" : "";
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ provider }));
    return;
  }
  if (req.url === "/api/pc-status") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ pc: process.platform === "win32" }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/pc-send") {
    const { phone, text } = await readJson(req).catch(() => ({}));
    const result = phone && text ? await pcSendWhatsApp(phone, text) : "missing";
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ result }));
    return;
  }
  if (req.method === "POST" && req.url === "/api/agent") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const out = await runAgent(JSON.parse(raw));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
      } catch (err) {
        console.error(err);
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  const file = path.join(PUBLIC, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Bolo running at http://localhost:${PORT}`));

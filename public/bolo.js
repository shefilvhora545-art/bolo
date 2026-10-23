// Saathi front end: listens, sends the sentence to /api/agent, speaks the reply and runs the phone action.
"use strict";

const $ = (id) => document.getElementById(id);

// ---------- storage (works even if the browser blocks localStorage) ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: keep in memory only */ }
}

// Demo family with fake numbers (98000000xx) so no real person is called during testing.
const DEMO_CONTACTS = [
  { id: "c1", name: "Anish", relation: "uncle (kaka, father's brother)", city: "Nadiad", phone: "9800000001", email: "", birthday: "5 Nov", emergency: false },
  { id: "c2", name: "Anish", relation: "uncle (kaka, father's brother)", city: "Ahmedabad", phone: "9800000002", email: "", birthday: "12 Jan", emergency: false },
  { id: "c3", name: "Ramesh", relation: "uncle (mama, mother's brother)", city: "Vadodara", phone: "9800000003", email: "", birthday: "20 Dec", emergency: false },
  { id: "c4", name: "Geeta", relation: "aunt (fai, father's sister)", city: "Surat", phone: "9800000004", email: "", birthday: "2 Mar", emergency: false },
  { id: "c5", name: "Rahul", relation: "son (dikro)", city: "Pune", phone: "9800000005", email: "rahul.demo@example.com", birthday: "15 Aug", emergency: true },
  { id: "c6", name: "Priya", relation: "sister (ben)", city: "Nadiad", phone: "9800000006", email: "priya.demo@example.com", birthday: "9 Jul", emergency: false },
  { id: "c7", name: "Shad", relation: "brother (bhai)", city: "Nadiad", phone: "9800000007", email: "", birthday: "1 Jun", emergency: false },
];

const state = {
  lang: load("bolo.lang", defaultLang()),
  contacts: load("bolo.contacts", DEMO_CONTACTS),
  memory: load("bolo.memory", []),
  reminders: load("bolo.reminders", []),
  scheduled: load("bolo.scheduled", []), // [{ id, at, contact_id, phone, text, channel }]
  verification: load("bolo.verification", "smart"), // smart | two-step | one-step | off
  pending: null, // an action waiting for "ha / yes"
  history: [],
  sharedText: "",
  busy: false,
};

const YES = /^(h+a+n?|ha+ji|haa+|hā|yes|yeah|yep|ok(ay)?|barabar|sachu|theek|thik|kar(o|i)?|mokl(o|i|je)|send|haan ji|ji haan|हाँ|हां|हा|જી|હા|હાં|બરાબર)(?=$|[\s.,!?])/i;
const NO = /^(n+a+|nahi|nai|no|nope|cancel|rehva de|rahne do|mat|ના|નહીં|नहीं|ना)(?=$|[\s.,!?])/i;
const OK_TEXT = { "gu-IN": "બરાબર, કરું છું.", "hi-IN": "ठीक है, कर रहा हूँ।", "en-IN": "Okay, doing it now." };
const CANCEL_TEXT = { "gu-IN": "બરાબર, રદ કર્યું.", "hi-IN": "ठीक है, रद्द कर दिया।", "en-IN": "Okay, cancelled." };

// Safety rules enforced by the app itself, whatever the AI answers: these actions wait for a spoken "yes".
const NEEDS_YES = {
  smart: ["whatsapp", "sms", "email", "schedule_message"],
  "two-step": ["whatsapp", "sms", "email", "schedule_message"],
  "one-step": [],
  off: [],
};
const ASK_YES = {
  "gu-IN": (who, what, when) => `${who} ને ${when ? when + " એ " : ""}આ મોકલું: "${what}"? હા કે ના?`,
  "hi-IN": (who, what, when) => `${who} को ${when ? when + " पर " : ""}यह भेजूँ: "${what}"? हाँ या ना?`,
  "en-IN": (who, what, when) => `Send this to ${who}${when ? " at " + when : ""}: "${what}"? Yes or no?`,
};

// Local time as "YYYY-MM-DD HH:MM", the format the AI uses for schedules.
function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// First visit: use the phone's own language if Saathi has it, otherwise English.
function defaultLang() {
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("gu")) return "gu-IN";
  if (nav.startsWith("hi")) return "hi-IN";
  return "en-IN";
}

// "Try saying..." examples, shown in the selected language (English for the others).
const SUGGESTIONS = {
  "gu-IN": ["મારા અનીશ કાકા ને કોલ લગાવ", "કાલે પ્રિયા બેન નો બર્થડે છે, રાત્રે 12 વાગે વિશ મોકલજે", "મને 8 વાગે દવા યાદ કરાવજે", "ગીતા ફઈ નો બર્થડે ક્યારે છે?"],
  "hi-IN": ["मेरे अनीश चाचा को कॉल लगाओ", "रमेश मामा को व्हाट्सएप करो कि मैं 5 बजे आऊंगा", "मुझे रात 8 बजे दवा याद दिलाना", "शाद भाई को कॉल करो"],
  "en-IN": ["Call my uncle Anish", "Tomorrow is my sister Priya's birthday, send her a wish at 12 AM", "Remind me to take my medicine at 8 PM", "Make me a simple calculator website"],
};
const STATE_TEXT = { idle: "Ready", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking" };

const HINTS = {
  "gu-IN": "સ્ક્રીન પર ગમે ત્યાં દબાવો અને બોલો",
  "hi-IN": "स्क्रीन पर कहीं भी दबाएं और बोलें",
  "en-IN": "Tap anywhere on the screen and speak",
};
const TAP_TO_CONFIRM = {
  "gu-IN": "કન્ફર્મ કરવા સ્ક્રીન પર ગમે ત્યાં દબાવો.",
  "hi-IN": "पक्का करने के लिए स्क्रीन पर कहीं भी दबाएं।",
  "en-IN": "Tap anywhere on the screen to confirm.",
};
const t = (table) => table[state.lang] || table[state.lang.split("-")[0] + "-IN"] || table["en-IN"];

// ---------- UI state ----------
function setMode(mode) { // idle | listening | thinking | speaking
  document.body.classList.remove("listening", "thinking", "speaking");
  if (mode !== "idle") document.body.classList.add(mode);
  $("ringIcon").textContent = { idle: "🎤", listening: "👂", thinking: "💭", speaking: "🔊" }[mode];
  $("stateText").textContent = STATE_TEXT[mode];
}
function vibrate(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* not supported */ } }
function toast(text) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function renderLang() {
  document.querySelectorAll("#langs .chip[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
  const more = $("moreLangs");
  more.value = [...more.options].some((o) => o.value === state.lang) ? state.lang : "";
  more.classList.toggle("on", more.value !== "");
  $("hint").textContent = t(HINTS);
  $("suggest").innerHTML = "";
  (SUGGESTIONS[state.lang] || SUGGESTIONS["en-IN"]).forEach((text) => {
    const b = document.createElement("button");
    b.textContent = "“" + text + "”";
    b.onclick = (e) => { e.stopPropagation(); handleUtterance(text); };
    $("suggest").appendChild(b);
  });
  document.documentElement.lang = state.lang.split("-")[0];
}

// ---------- speaking ----------
function speak(text, lang) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || state.lang;
    const voices = speechSynthesis.getVoices();
    const base = u.lang.split("-")[0];
    u.voice = voices.find((v) => v.lang === u.lang) || voices.find((v) => v.lang.startsWith(base)) || null;
    u.rate = 0.95;
    setMode("speaking");
    lastSpoken = text;
    u.onend = u.onerror = () => {
      setMode("idle");
      spokeUntil = Date.now() + 800; // ignore the echo of Saathi's own voice for a moment
      if (handsFree) hfAwake = Date.now() + 10000; // the user can reply without saying "Saathi" again
      resolve();
    };
    speechSynthesis.speak(u);
  });
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

// ---------- listening ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function listen() {
  if (handsFree) { hfAwake = Date.now() + 10000; setMode("listening"); vibrate(60); return; } // already listening
  if (state.busy) return;
  if (!Recognition) { toast("Voice input needs Google Chrome. You can type below."); $("typeInput").focus(); return; }
  if (recognizer) { recognizer.stop(); return; }
  speechSynthesis && speechSynthesis.cancel();
  recognizer = new Recognition();
  recognizer.lang = state.lang;
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;
  let finalText = "";
  recognizer.onstart = () => { setMode("listening"); vibrate(60); $("youSaid").textContent = "…"; };
  recognizer.onresult = (e) => {
    let interim = "";
    for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
    $("youSaid").textContent = "“" + (finalText || interim) + "”";
  };
  recognizer.onerror = (e) => {
    if (e.error === "not-allowed") toast("Please allow the microphone for this site.");
    else if (e.error !== "no-speech" && e.error !== "aborted") toast("Mic error: " + e.error);
  };
  recognizer.onend = () => {
    recognizer = null;
    setMode("idle");
    if (finalText.trim()) handleUtterance(finalText.trim());
  };
  recognizer.start();
}

// ---------- hands-free: say "Saathi ..." - no tapping at all ----------
let handsFree = load("bolo.handsfree", false);
let hfRec = null, hfAwake = 0, spokeUntil = 0, lastSpoken = "";
const WAKE = /^(hey |ok |hi |hello |he )?(saathi|sathi|saathee|sathee|saati|sati|saathi ji|સાથી|साथी|ساتھی)(?=$|[\s,.!?])[\s,.!?]*/i;
const HF_HINTS = {
  "gu-IN": "“સાથી” કહો અને પછી તમારું કામ કહો",
  "hi-IN": "“साथी” कहें और फिर अपना काम बताएं",
  "en-IN": "Say “Saathi” and then your request",
};
function renderHandsFree() {
  $("hfBtn").classList.toggle("on", handsFree);
  $("hfText").textContent = handsFree ? "Hands-free ON" : "Hands-free";
  $("hint").textContent = handsFree ? t(HF_HINTS) : t(HINTS);
}
function startHandsFree() {
  if (!Recognition || !handsFree || hfRec) return;
  hfRec = new Recognition();
  hfRec.lang = state.lang;
  hfRec.continuous = true;
  hfRec.interimResults = true;
  hfRec.onresult = (e) => {
    if (speechSynthesis.speaking || state.busy || Date.now() < spokeUntil) return;
    const r = e.results[e.results.length - 1];
    const heard = r[0].transcript.trim();
    const awake = Date.now() < hfAwake;
    if (!r.isFinal) { if (awake || WAKE.test(heard)) $("youSaid").textContent = "“" + heard + "”"; return; }
    if (lastSpoken && heard.length > 6 && lastSpoken.toLowerCase().includes(heard.toLowerCase().slice(0, 12))) return; // own echo
    let command = heard;
    if (WAKE.test(command)) command = command.replace(WAKE, "").trim();
    else if (!awake) return;
    if (!command) { hfAwake = Date.now() + 8000; setMode("listening"); vibrate(60); return; } // just "Saathi": waiting
    hfAwake = 0;
    handleUtterance(command);
  };
  hfRec.onerror = (e) => {
    if (e.error === "not-allowed") { handsFree = false; save("bolo.handsfree", false); renderHandsFree(); toast("Please allow the microphone for hands-free mode."); }
  };
  hfRec.onend = () => { hfRec = null; if (handsFree && document.visibilityState === "visible") setTimeout(startHandsFree, 300); };
  try { hfRec.start(); } catch { hfRec = null; }
}
function stopHandsFree() { const r = hfRec; hfRec = null; r && r.abort(); }
$("hfBtn").onclick = (e) => {
  e.stopPropagation();
  if (!Recognition) { toast("Hands-free needs Google Chrome."); return; }
  handsFree = !handsFree;
  save("bolo.handsfree", handsFree);
  renderHandsFree();
  if (handsFree) { startHandsFree(); speak(t(HF_HINTS), state.lang); } else stopHandsFree();
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && handsFree) startHandsFree(); });

// ---------- talking to the AI ----------
async function handleUtterance(text) {
  // Step 2 of verification: a plain "ha" / "na" is handled right here, instantly and without the AI.
  if (state.pending) {
    const pending = state.pending;
    const said = text.trim().replace(/^["“]|["”.!?,]$/g, "");
    if (pending.kind === "scheduled" && (YES.test(said) || NO.test(said))) {
      state.pending = null;
      if (YES.test(said)) {
        $("reply").textContent = t(OK_TEXT);
        await speak(t(OK_TEXT), state.lang);
        await sendWhatsApp(pending.s.phone, pending.s.text, pending.who);
      } else {
        goHome(); // WhatsApp was never opened, so nothing is left typed anywhere
        $("reply").textContent = t(CANCEL_TEXT);
        await speak(t(CANCEL_TEXT), state.lang);
      }
      finishAsk();
      return;
    }
    if (YES.test(said)) {
      state.pending = null;
      $("youSaid").textContent = "“" + text + "”";
      $("card").innerHTML = "";
      state.history.push({ role: "user", content: text }, { role: "assistant", content: `[confirmed ${pending.planned_action}]` });
      await runAction({ ...pending, action: pending.planned_action, reply: t(OK_TEXT) });
      return;
    }
    if (NO.test(said)) {
      state.pending = null;
      $("youSaid").textContent = "“" + text + "”";
      $("card").innerHTML = "";
      $("reply").textContent = t(CANCEL_TEXT);
      state.history.push({ role: "user", content: text }, { role: "assistant", content: "[cancelled]" });
      speak(t(CANCEL_TEXT), state.lang);
      return;
    }
    state.pending = null; // anything else: let the AI understand the new sentence
  }
  state.busy = true;
  $("youSaid").textContent = "“" + text + "”";
  $("reply").textContent = "";
  $("card").innerHTML = "";
  setMode("thinking");
  vibrate([30, 60, 30]);

  // "Read this message" by voice: try the clipboard first.
  if (!state.sharedText && /vanch|vaanch|padh|read|samjav|fraud|message|sms/i.test(text)) {
    try { state.sharedText = (await navigator.clipboard.readText()) || ""; } catch { /* no clipboard permission */ }
  }

  let result;
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        lang: state.lang,
        now: new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" }),
        nowIso: localIso(),
        verification: state.verification,
        scheduled: state.scheduled.map((s) => ({ contact_id: s.contact_id, at: localIso(new Date(s.at)), text: s.text })),
        contacts: state.contacts,
        memory: state.memory,
        history: state.history,
        sharedText: state.sharedText,
      }),
    });
    result = await res.json();
    if (!res.ok) throw new Error(result.error || res.statusText);
  } catch (err) {
    state.busy = false;
    setMode("idle");
    $("reply").textContent = "⚠️ " + err.message;
    speak(state.lang === "en-IN" ? "Sorry, something went wrong. Please try again." : "માફ કરજો, ફરી પ્રયત્ન કરો.", state.lang);
    return;
  }
  state.sharedText = "";
  state.history.push({ role: "user", content: text });
  state.history.push({ role: "assistant", content: `${result.reply} [action=${result.action}${result.contact_id ? ", contact=" + result.contact_id : ""}]` });
  state.history = state.history.slice(-12);

  state.busy = false;
  $("reply").textContent = result.reply;
  // A new number by voice ("call my mother, her number is ...") is saved to Family automatically.
  if (result.new_contact_name && result.phone && /\d{6,}/.test(result.phone)) {
    const digits = result.phone.replace(/\D/g, "").slice(-10);
    let saved = state.contacts.find((c) => c.phone.replace(/\D/g, "").slice(-10) === digits);
    if (!saved) {
      saved = { id: "c" + Date.now(), name: result.new_contact_name, relation: result.new_contact_relation || "", city: "", phone: result.phone, email: "", birthday: "", emergency: false };
      state.contacts.push(saved);
      save("bolo.contacts", state.contacts);
      toast(`💾 Saved ${saved.name} to Family`);
    }
    if (!result.contact_id) result.contact_id = saved.id;
  }
  // Never lose a task: if the AI filled a reminder or a note next to another action, keep it too.
  if (result.reminder_time && result.action !== "reminder" && result.action !== "confirm" && /^\d{1,2}:\d{2}$/.test(result.reminder_time)) {
    addReminder(result.reminder_time, result.reminder_text || result.reply);
    toast("⏰ Reminder set for " + result.reminder_time);
  }
  if (result.memory_note && !["remember", "forget"].includes(result.action) && !state.memory.includes(result.memory_note)) {
    state.memory.push(result.memory_note); save("bolo.memory", state.memory);
  }
  // Sending something always waits for "yes" (unless the user turned safety off).
  if ((NEEDS_YES[state.verification] || []).includes(result.action)) {
    const who = label(contactById(result.contact_id)) || result.phone || result.email_to;
    const what = (result.message_text || result.email_subject || "").slice(0, 120);
    result = { ...result, planned_action: result.action, action: "confirm", reply: t(ASK_YES)(who, what, result.schedule_at) };
    $("reply").textContent = result.reply;
  }
  if (result.learn_note && !state.memory.includes(result.learn_note)) { // Saathi learns the user's choices
    state.memory.push(result.learn_note);
    save("bolo.memory", state.memory);
  }
  await runAction(result);
  // One sentence, many tasks: run the rest automatically.
  if (result.follow_up && !state.pending && result.action !== "clarify") setTimeout(() => handleUtterance(result.follow_up), 700);
}

// ---------- WhatsApp sending ----------
// On the PC (local server) Saathi sends through WhatsApp Desktop by itself; on a phone WhatsApp opens with the text typed.
let pcHelper = false;
fetch("/api/pc-status").then((r) => r.ok && r.json()).then((d) => (pcHelper = !!(d && d.pc))).catch(() => {});

async function sendWhatsApp(phone, text, who) {
  if (pcHelper) {
    toast("💬 Sending on WhatsApp Desktop…");
    const r = await fetch("/api/pc-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, text }) })
      .then((x) => x.json()).catch(() => ({ result: "error" }));
    if (r.result === "sent") { toast("✅ Sent to " + (who || phone)); return; }
    toast("WhatsApp Desktop not found – opening WhatsApp Web");
  }
  window.location.href = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

// ---------- actions ----------
function contactById(id) { return state.contacts.find((c) => c.id === id); }
function label(c) { return c ? `${c.name} ${c.relation ? "(" + c.relation + (c.city ? ", " + c.city : "") + ")" : ""}` : ""; }
function waNumber(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length === 10 ? "91" + digits : digits;
}
function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }

async function runAction(r) {
  const c = contactById(r.contact_id);
  const phone = r.phone || c?.phone || "";
  const card = $("card");

  switch (r.action) {
    case "clarify": {
      const box = el(`<div class="card"><div class="options"></div></div>`);
      (r.options || []).forEach((o) => {
        const b = el(`<button class="big alt">${esc(o.label || label(contactById(o.contact_id)))}</button>`);
        b.onclick = (e) => { e.stopPropagation(); handleUtterance(o.label || label(contactById(o.contact_id))); };
        box.querySelector(".options").appendChild(b);
      });
      card.appendChild(box);
      await speak(r.reply, r.reply_lang);
      listen(); // the user can answer straight away by voice
      return;
    }
    case "call":
    case "sos": {
      await speak(r.reply, r.reply_lang);
      if (!phone) return;
      if (r.action === "sos") sendSosWhatsApp(c);
      confirmAction(`📞 ${label(c) || phone}`, `tel:${phone}`, r.action === "sos");
      return;
    }
    case "whatsapp":
    case "sms": {
      card.appendChild(el(`<div class="card"><h3>${r.action === "whatsapp" ? "💬 WhatsApp" : "✉️ SMS"} → ${esc(label(c) || phone)}</h3><p>${esc(r.message_text)}</p></div>`));
      await speak(r.reply, r.reply_lang);
      if (r.action === "whatsapp") {
        confirmAction(`💬 WhatsApp: ${label(c) || phone}`, () => sendWhatsApp(phone, r.message_text, label(c)));
      } else {
        confirmAction(`✉️ SMS: ${label(c) || phone}`, `sms:${phone}?body=${encodeURIComponent(r.message_text)}`);
      }
      return;
    }
    case "email": {
      card.appendChild(el(`<div class="card"><h3>📧 ${esc(r.email_to)}</h3><p><b>${esc(r.email_subject)}</b></p><p style="white-space:pre-wrap">${esc(r.email_body)}</p></div>`));
      await speak(r.reply, r.reply_lang);
      const url = `mailto:${encodeURIComponent(r.email_to)}?subject=${encodeURIComponent(r.email_subject)}&body=${encodeURIComponent(r.email_body)}`;
      confirmAction(`📧 Email: ${r.email_to}`, url);
      return;
    }
    case "remember": {
      if (r.memory_note) { state.memory.push(r.memory_note); save("bolo.memory", state.memory); }
      card.appendChild(el(`<div class="card"><h3>🧠 Saved</h3><p>${esc(r.memory_note)}</p></div>`));
      break;
    }
    case "forget": {
      const key = (r.memory_note || "").toLowerCase();
      state.memory = state.memory.filter((m) => !key || !(m.toLowerCase().includes(key) || key.includes(m.toLowerCase())));
      save("bolo.memory", state.memory);
      break;
    }
    case "reminder": {
      if (/^\d{1,2}:\d{2}$/.test(r.reminder_time)) {
        addReminder(r.reminder_time, r.reminder_text || r.reply);
        card.appendChild(el(`<div class="card"><h3>⏰ ${esc(r.reminder_time)}</h3><p>${esc(r.reminder_text)}</p><p class="meta">Keep Saathi open on the phone so it can speak the reminder.</p></div>`));
      }
      break;
    }
    case "read_explain": {
      if (r.scam_risk === "high") {
        vibrate([300, 100, 300, 100, 300]);
        card.appendChild(el(`<div class="card scam"><h3>⚠️ FRAUD / છેતરપિંડી</h3><p>Do not click links, pay money or share OTP.</p></div>`));
      }
      break;
    }
    case "code": {
      showCode(r);
      break;
    }
    case "confirm": {
      // Step 2 of verification: show exactly what will happen, then wait for "ha" / "na" (voice or tap).
      state.pending = r;
      const who = label(c) || phone || r.email_to;
      const when = r.schedule_at ? `<p class="meta">⏰ ${esc(r.schedule_at)}</p>` : "";
      const box = el(`<div class="card"><h3>✅ Confirm: ${esc(r.planned_action)} → ${esc(who)}</h3>${when}
        <p style="white-space:pre-wrap">${esc(r.message_text || r.email_subject || "")}</p>
        <div class="row"><button class="big yes">✔ હા / Yes</button><button class="big alt no">✖ ના / No</button></div></div>`);
      box.querySelector(".yes").onclick = (e) => { e.stopPropagation(); handleUtterance("yes"); };
      box.querySelector(".no").onclick = (e) => { e.stopPropagation(); handleUtterance("no"); };
      card.appendChild(box);
      await speak(r.reply, r.reply_lang);
      listen(); // answer by voice straight away
      return;
    }
    case "schedule_message": {
      const at = parseLocal(r.schedule_at);
      if (!at || !phone) break;
      state.scheduled.push({ id: "s" + Date.now(), at: at.getTime(), contact_id: r.contact_id, phone, text: r.message_text, channel: "whatsapp" });
      save("bolo.scheduled", state.scheduled);
      card.appendChild(el(`<div class="card"><h3>⏰ ${esc(at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))} → ${esc(label(c) || phone)}</h3>
        <p>${esc(r.message_text)}</p><p class="meta">🌙 Keep Saathi open and the phone charging. Night mode keeps the screen awake so it fires on time.</p></div>`));
      keepAwake();
      break;
    }
    case "cancel_schedule": {
      state.scheduled = r.contact_id ? state.scheduled.filter((s) => s.contact_id !== r.contact_id) : [];
      save("bolo.scheduled", state.scheduled);
      break;
    }
  }
  await speak(r.reply, r.reply_lang);
}

// Voice-first: open the call / app straight away. If the phone blocks it (or in 2-step mode),
// show one big "tap anywhere" button instead.
function confirmAction(text, url, danger = false) {
  if (state.verification === "smart" || state.verification === "off") { // 1-step / 2-step always show the tap screen
    if (typeof url === "function") { url(); return; }
    if (/^https?:/.test(url)) {
      if (window.open(url, "_blank")) return; // WhatsApp in a new tab keeps Saathi (and its timers) alive
    } else {
      window.location.href = url; // tel: / sms: / mailto: open the phone app without leaving Saathi
      setTimeout(() => { if (document.visibilityState === "visible") showTapScreen(text, url, danger); }, 1500);
      return;
    }
  }
  showTapScreen(text, url, danger);
}

// Full-screen "tap anywhere" button - used when the phone needs a real tap to open another app.
function showTapScreen(text, url, danger = false) {
  const box = $("confirm"), go = $("confirmGo");
  go.textContent = text + "  ✔";
  go.classList.toggle("danger", danger);
  box.classList.remove("hidden");
  vibrate(200);
  speak(t(TAP_TO_CONFIRM), state.lang);
  go.onclick = () => {
    box.classList.add("hidden"); speechSynthesis.cancel();
    typeof url === "function" ? url() : (window.location.href = url);
  };
  $("confirmCancel").onclick = () => { box.classList.add("hidden"); speechSynthesis.cancel(); };
}

function sendSosWhatsApp(c) {
  const target = c || state.contacts.find((x) => x.emergency);
  if (!target || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const link = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      const msg = `🆘 EMERGENCY! I need help. My location: ${link}`;
      $("card").appendChild(el(`<div class="card scam"><h3>🆘 SOS → ${esc(label(target))}</h3><a class="big" href="https://wa.me/${waNumber(target.phone)}?text=${encodeURIComponent(msg)}">💬 Send location on WhatsApp</a></div>`));
    },
    () => { /* location denied: the call still works */ },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function showCode(r) {
  const isHtml = /html|website|web/i.test(r.code_lang);
  const box = el(`<div class="card">
    <h3>💻 ${esc(r.code_title)} <span class="meta">(${esc(r.code_lang)})</span></h3>
    ${isHtml ? '<iframe class="preview" sandbox="allow-scripts allow-forms allow-modals"></iframe>' : ""}
    <pre><code></code></pre>
    <div class="row"><button class="primary copy">📋 Copy code</button><button class="ghost dl">⬇ Download</button></div>
  </div>`);
  box.querySelector("code").textContent = r.code;
  if (isHtml) box.querySelector("iframe").srcdoc = r.code;
  box.querySelector(".copy").onclick = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(r.code); toast("Copied ✔"); } catch { toast("Copy blocked by the browser"); }
  };
  box.querySelector(".dl").onclick = (e) => {
    e.stopPropagation();
    const ext = { html: "html", python: "py", javascript: "js", java: "java", "c++": "cpp", c: "c", "c#": "cs", kotlin: "kt",
      swift: "swift", go: "go", rust: "rs", php: "php", sql: "sql", typescript: "ts", react: "jsx" }[r.code_lang.toLowerCase()] || "txt";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.code], { type: "text/plain" }));
    a.download = (r.code_title || "bolo-code").replace(/[^\w-]+/g, "_") + "." + ext;
    a.click();
  };
  $("card").appendChild(box);
}

// ---------- scheduled messages (e.g. a birthday wish at exactly 12:00 AM) ----------
function parseLocal(s) { // "YYYY-MM-DD HH:MM" -> Date in the phone's time zone
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
let wakeLock = null;
async function keepAwake() { // Night mode: stop the screen from sleeping while something is scheduled
  try {
    if ("wakeLock" in navigator && !wakeLock && state.scheduled.length) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
      toast("🌙 Night mode on: screen stays awake for scheduled messages");
    }
  } catch { /* battery saver can refuse; the timer still works while the screen is on */ }
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && keepAwake());

function fireScheduled() {
  const now = Date.now();
  const due = state.scheduled.filter((s) => s.at <= now);
  if (!due.length) return;
  state.scheduled = state.scheduled.filter((s) => s.at > now);
  save("bolo.scheduled", state.scheduled);
  due.forEach((s) => askScheduled(s));
}
setInterval(fireScheduled, 1000);

// At the scheduled time Saathi asks "Ha ke na?". Ha -> send. Na -> delete it and go back to Saathi's home screen.
const ASK_SEND = {
  "gu-IN": (who) => `સમય થઈ ગયો. ${who} ને આ મેસેજ મોકલું? હા કે ના?`,
  "hi-IN": (who) => `समय हो गया। ${who} को यह मैसेज भेजूँ? हाँ या ना?`,
  "en-IN": (who) => `It's time. Shall I send this message to ${who}? Yes or no?`,
};
const askQueue = [];
function askScheduled(s) {
  askQueue.push(s);
  if (askQueue.length === 1) showNextAsk();
}
function showNextAsk() {
  const s = askQueue[0];
  if (!s) return;
  const who = label(contactById(s.contact_id)) || s.phone;
  vibrate([600, 200, 600, 200, 600]);
  goHome();
  $("reply").textContent = "⏰ " + s.text;
  const box = el(`<div class="card"><h3>⏰ ${esc(who)}</h3><p style="white-space:pre-wrap">${esc(s.text)}</p>
    <div class="row"><button class="big yes">✔ હા / Yes – send</button><button class="big alt no">✖ ના / No – delete</button></div></div>`);
  box.querySelector(".yes").onclick = (e) => { e.stopPropagation(); handleUtterance("yes"); };
  box.querySelector(".no").onclick = (e) => { e.stopPropagation(); handleUtterance("no"); };
  $("card").appendChild(box);
  state.pending = { kind: "scheduled", s, who };
  speak(t(ASK_SEND)(who), state.lang).then(() => listen());
}
function finishAsk() { askQueue.shift(); setTimeout(showNextAsk, 1500); }

// Back to Saathi's clean home screen (a web page cannot open the phone's own home screen).
function goHome() {
  ["confirm", "family", "readBox"].forEach((id) => $(id).classList.add("hidden"));
  $("card").innerHTML = ""; $("youSaid").textContent = ""; $("reply").textContent = "";
  window.scrollTo(0, 0);
}

// Proactive birthday helper: "Tomorrow is Rahul's birthday - schedule a wish for 12 AM?"
function birthdayCheck() {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const isOn = (b, d) => {
    const m = /(\d{1,2})\s*([a-z]{3})/i.exec(b || "");
    return m && +m[1] === d.getDate() && months.indexOf(m[2].toLowerCase()) === d.getMonth();
  };
  const today = state.contacts.filter((c) => isOn(c.birthday, new Date()));
  const tmrw = state.contacts.filter((c) => isOn(c.birthday, tomorrow) && !state.scheduled.some((s) => s.contact_id === c.id));
  if (!today.length && !tmrw.length) return;
  const box = el(`<div class="card"><h3>🎂 Birthdays</h3><div class="options"></div></div>`);
  const add = (text, ask) => {
    const b = el(`<button class="big alt">${esc(text)}</button>`);
    b.onclick = (e) => { e.stopPropagation(); handleUtterance(ask); };
    box.querySelector(".options").appendChild(b);
  };
  today.forEach((c) => add(`🎉 Today: ${label(c)} – send wish now`, `${c.name} ${c.relation} (${c.city}) no aaje birthday che, ene WhatsApp par saras birthday wish moklo`));
  tmrw.forEach((c) => add(`⏰ Tomorrow: ${label(c)} – wish at 12:00 AM`, `Kale ${c.name} ${c.relation} (${c.city}) no birthday che, raat na 12 vage WhatsApp par birthday wish moklje`));
  $("card").appendChild(box);
}

// ---------- reminders (spoken while Saathi is open) ----------
function addReminder(time, text) {
  const [h, m] = time.split(":").map(Number);
  const due = new Date();
  due.setHours(h, m, 0, 0);
  if (due < new Date()) due.setDate(due.getDate() + 1);
  state.reminders.push({ at: due.getTime(), text, lang: state.lang });
  save("bolo.reminders", state.reminders);
}
setInterval(() => {
  const now = Date.now();
  const due = state.reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  state.reminders = state.reminders.filter((r) => r.at > now);
  save("bolo.reminders", state.reminders);
  due.forEach((r) => {
    vibrate([500, 200, 500, 200, 500]);
    $("reply").textContent = "⏰ " + r.text;
    speak("⏰ " + r.text, r.lang);
  });
}, 15000);

// ---------- family setup ----------
function renderFamily() {
  $("contactList").innerHTML = "";
  state.contacts.forEach((c) => {
    const row = el(`<div class="contact"><div><b>${esc(c.name)}</b> ${c.emergency ? "🆘" : ""}<small>${esc(c.relation)} · ${esc(c.city)} · ${esc(c.phone)}${c.birthday ? " · 🎂 " + esc(c.birthday) : ""}</small></div><div><button class="edit">✏️</button> <button class="del">🗑</button></div></div>`);
    row.querySelector(".edit").onclick = () => {
      const f = $("contactForm");
      for (const k of ["id", "name", "relation", "city", "phone", "email", "birthday"]) f.elements[k].value = c[k] || "";
      f.elements.emergency.checked = !!c.emergency;
      f.elements.name.focus();
    };
    row.querySelector(".del").onclick = () => {
      state.contacts = state.contacts.filter((x) => x.id !== c.id);
      save("bolo.contacts", state.contacts);
      renderFamily();
    };
    $("contactList").appendChild(row);
  });
  $("memoryList").innerHTML = state.memory.length ? "" : "<li>—</li>";
  state.memory.forEach((m, i) => {
    const li = el(`<li>${esc(m)} <button title="Delete">✖</button></li>`);
    li.querySelector("button").onclick = () => { state.memory.splice(i, 1); save("bolo.memory", state.memory); renderFamily(); };
    $("memoryList").appendChild(li);
  });
  $("verifyMode").value = state.verification;
  $("scheduledList").innerHTML = state.scheduled.length ? "" : "<li>—</li>";
  state.scheduled.forEach((sc) => {
    const li = el(`<li>${new Date(sc.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} → ${esc(label(contactById(sc.contact_id)) || sc.phone)}: ${esc(sc.text)} <button title="Cancel">✖</button></li>`);
    li.querySelector("button").onclick = () => { state.scheduled = state.scheduled.filter((x) => x.id !== sc.id); save("bolo.scheduled", state.scheduled); renderFamily(); };
    $("scheduledList").appendChild(li);
  });
  $("reminderList").innerHTML = state.reminders.length ? "" : "<li>—</li>";
  state.reminders.forEach((r) => $("reminderList").appendChild(el(`<li>${new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} – ${esc(r.text)}</li>`)));
}
$("contactForm").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  const data = Object.fromEntries(["name", "relation", "city", "phone", "email", "birthday"].map((k) => [k, f.elements[k].value.trim()]));
  data.emergency = f.elements.emergency.checked;
  const id = f.elements.id.value;
  if (id) Object.assign(contactById(id), data);
  else state.contacts.push({ id: "c" + Date.now(), ...data });
  save("bolo.contacts", state.contacts);
  f.reset(); f.elements.id.value = "";
  renderFamily();
};
$("btnFamily").onclick = (e) => { e.stopPropagation(); renderFamily(); $("family").classList.remove("hidden"); };
$("closeFamily").onclick = () => $("family").classList.add("hidden");
$("verifyMode").onchange = (e) => { state.verification = e.target.value; save("bolo.verification", state.verification); };
// Import people from the phone's own contact list (Chrome on Android).
const RELATION_FROM_NAME = [
  [/\b(mummy|mumma|mom|mommy|maa|mother|mata|ammi|ammijaan|amma|ba)\b/i, "mother"],
  [/\b(papa|pappa|dad|daddy|father|pita|abbu|abba|abbajaan|bapuji)\b/i, "father"],
  [/\b(bhai|bhaiya|bhaijaan|brother|bro)\b/i, "brother"],
  [/\b(didi|ben|behen|appi|baji|aapa|sister|sis)\b/i, "sister"],
  [/\b(kaka|chacha)\b/i, "uncle (kaka, father's brother)"],
  [/\b(mama|mamu|mamujaan)\b/i, "uncle (mama/mamu, mother's brother)"],
  [/\b(fai|foi|bua|phuppo|phuphi)\b/i, "aunt (fai/phuppo, father's sister)"],
  [/\b(masi|mausi|khala)\b/i, "aunt (masi/khala, mother's sister)"],
  [/\b(dada|nana|grandpa)\b/i, "grandfather"],
  [/\b(dadi|nani|grandma)\b/i, "grandmother"],
];
$("importPhone").onclick = async () => {
  if (!("contacts" in navigator && "select" in navigator.contacts)) {
    toast("Open Saathi in Chrome on an Android phone to import contacts. You can also add them below.");
    return;
  }
  try {
    const picked = await navigator.contacts.select(["name", "tel", "email"], { multiple: true });
    let added = 0;
    for (const p of picked) {
      const name = (p.name && p.name[0]) || "";
      const phone = (p.tel && p.tel[0]) || "";
      if (!name || !phone) continue;
      const digits = phone.replace(/\D/g, "").slice(-10);
      if (state.contacts.some((c) => c.phone.replace(/\D/g, "").slice(-10) === digits)) continue;
      const relation = (RELATION_FROM_NAME.find(([re]) => re.test(name)) || [, ""])[1];
      state.contacts.push({ id: "c" + Date.now() + added, name, relation, city: "", phone, email: (p.email && p.email[0]) || "", birthday: "", emergency: false });
      added++;
    }
    save("bolo.contacts", state.contacts);
    renderFamily();
    toast(`📱 Added ${added} contact(s). Edit to add relation / city.`);
  } catch { toast("Contact import was cancelled."); }
};
$("resetDemo").onclick = () => { state.contacts = structuredClone(DEMO_CONTACTS); save("bolo.contacts", state.contacts); renderFamily(); };

// ---------- read a message ----------
$("btnRead").onclick = async (e) => {
  e.stopPropagation();
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { /* ask the user to paste instead */ }
  $("readText").value = text || "";
  $("readBox").classList.remove("hidden");
};
$("readCancel").onclick = () => $("readBox").classList.add("hidden");
$("readGo").onclick = () => {
  state.sharedText = $("readText").value.trim();
  $("readBox").classList.add("hidden");
  if (!state.sharedText) return;
  const ask = { "gu-IN": "આ મેસેજ વાંચી સંભળાવ અને સમજાવ. ફ્રોડ તો નથી ને?", "hi-IN": "यह मैसेज पढ़कर सुनाओ और समझाओ। कहीं फ्रॉड तो नहीं?" };
  handleUtterance(ask[state.lang] || "Read this message to me, explain it simply, and tell me if it is a fraud.");
};

// ---------- SOS button ----------
$("btnSos").onclick = (e) => {
  e.stopPropagation();
  const ask = { "gu-IN": "મદદ! ઇમરજન્સી છે", "hi-IN": "मदद! इमरजेंसी है" };
  handleUtterance(ask[state.lang] || "Help! This is an emergency.");
};

// ---------- wiring ----------
$("stage").addEventListener("click", (e) => {
  if (e.target.closest("button, a, iframe, pre, input, textarea, .card")) return;
  listen();
});
$("typeForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("typeInput").value.trim();
  if (v) { $("typeInput").value = ""; handleUtterance(v); }
};
document.querySelectorAll("#langs .chip[data-lang]").forEach((b) => (b.onclick = (e) => {
  e.stopPropagation(); state.lang = b.dataset.lang; save("bolo.lang", state.lang); renderLang(); restartHandsFree();
}));
function restartHandsFree() { if (handsFree) { stopHandsFree(); setTimeout(startHandsFree, 300); } renderHandsFree(); }
$("moreLangs").onchange = (e) => {
  if (e.target.value) { state.lang = e.target.value; save("bolo.lang", state.lang); renderLang(); restartHandsFree(); }
};
document.addEventListener("keydown", (e) => { // PC: press Space to talk
  if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); listen(); }
});

renderLang();
renderHandsFree();
startHandsFree();
setMode("idle");
// Live status pill: which AI brain is answering.
fetch("/api/status").then((r) => r.json()).then((d) => {
  $("statusText").textContent = d.provider ? `Online · ${d.provider}` : "No AI key";
  $("status").classList.toggle("off", !d.provider);
}).catch(() => { $("statusText").textContent = "Offline"; $("status").classList.add("off"); });
birthdayCheck();
keepAwake();

// Direct link to the family screen: open Saathi with #family
if (location.hash === "#family") $("btnFamily").click();

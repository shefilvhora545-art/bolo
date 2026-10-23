// Partner front end: listens, sends the sentence to /api/agent, speaks the reply and runs the phone action.
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

const YES = /^(h+a+n?|ha+ji|haa+|hā|yes|yeah|yep|ok(ay)?|barabar|sachu|theek|thik|kar(o|i)?|mokl(o|i|je)|send|haan ji|ji haan|हाँ|हां|हा|हो|જી|હા|હાં|બરાબર|ہاں|جی|sí|si|oui|ja|sim|да|はい|是|ndiyo|ya)(?=$|[\s.,!?])/i;
const NO = /^(n+a+|nahi|nai|no|nope|cancel|rehva de|rahne do|mat|ના|નહીં|नहीं|ना|नाही|نہیں|non|nein|não|nao|нет|いいえ|不|hapana|tidak)(?=$|[\s.,!?])/i;

// Safety rules enforced by the app itself, whatever the AI answers: these actions wait for a spoken "yes".
const NEEDS_YES = {
  smart: ["whatsapp", "sms", "email", "schedule_message"],
  "two-step": ["whatsapp", "sms", "email", "schedule_message"],
  "one-step": [],
  off: [],
};

// Local time as "YYYY-MM-DD HH:MM", the format the AI uses for schedules.
function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// First visit: use the phone's own language if Partner has it, otherwise English.
function defaultLang() {
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("gu")) return "gu-IN";
  if (nav.startsWith("hi")) return "hi-IN";
  return "en-IN";
}


// ---------- UI state ----------
function setMode(mode) { // idle | listening | thinking | speaking
  document.body.classList.remove("listening", "thinking", "speaking");
  if (mode !== "idle") document.body.classList.add(mode);
  $("ringIcon").textContent = { idle: "🎤", listening: "👂", thinking: "💭", speaking: "🔊" }[mode];
  $("stateText").textContent = tr({ idle: "ready", listening: "listening", thinking: "thinking", speaking: "speaking" }[mode]);
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
  applyStaticStrings();
  $("hint").textContent = handsFree ? tr("hfHint") : tr("hint");
  $("hfText").textContent = handsFree ? tr("hfOn") : tr("hf");
  $("stateText").textContent = tr("ready");
  $("suggest").innerHTML = "";
  ["sug1", "sug2", "sug3", "sug4"].map((k) => tr(k)).forEach((text) => {
    const b = document.createElement("button");
    b.textContent = "“" + text + "”";
    b.onclick = (e) => { e.stopPropagation(); handleUtterance(text); };
    $("suggest").appendChild(b);
  });
  document.documentElement.lang = state.lang.split("-")[0];
  document.documentElement.dir = /^(ur|ar)/.test(state.lang) ? "rtl" : "ltr";
  if (statusProvider !== null) showStatus();
}

// Switch the whole screen to a language (AI-translated once for languages beyond gu/hi/en).
async function setLanguage(lang) {
  state.lang = lang;
  save("bolo.lang", lang);
  renderLang();
  const ok = await loadStrings(lang, () => toast(tr("translating")));
  if (state.lang !== lang) return; // the user picked another language meanwhile
  if (!ok) toast(tr("translateFailed"));
  renderLang();
  restartHandsFree();
  if (!$("family").classList.contains("hidden")) renderFamily();
}

let statusProvider = null;
function showStatus() {
  $("statusText").textContent = statusProvider === "" ? tr("noKey") : statusProvider ? `${tr("online")} · ${statusProvider}` : tr("offline");
  $("status").classList.toggle("off", !statusProvider);
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
      spokeUntil = Date.now() + 800; // ignore the echo of Partner's own voice for a moment
      if (handsFree) hfAwake = Date.now() + FOLLOW_UP_MS; // the user can reply without saying "Partner" again
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
  if (!Recognition) { toast(tr("needChrome")); $("typeInput").focus(); return; }
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
    if (e.error === "not-allowed") toast(tr("allowMic"));
    else if (e.error !== "no-speech" && e.error !== "aborted") toast(tr("micError", { e: e.error }));
  };
  recognizer.onend = () => {
    recognizer = null;
    setMode("idle");
    if (finalText.trim()) handleUtterance(finalText.trim());
  };
  recognizer.start();
}

// ---------- hands-free: say "Partner ..." - no tapping at all ----------
let handsFree = load("bolo.handsfree", false);
let hfRec = null, hfAwake = 0, spokeUntil = 0, lastSpoken = "";
const WAKE = /^(hey |ok |hi |hello |he )?(partner|partnar|patner|pardner|partner ji|પાર્ટનર|પાટનર|पार्टनर|पाटनर|پارٹنر)(?=$|[\s,.!?])[\s,.!?]*/i;
function renderHandsFree() {
  $("hfBtn").classList.toggle("on", handsFree);
  $("hfText").textContent = handsFree ? tr("hfOn") : tr("hf");
  $("hint").textContent = handsFree ? tr("hfHint") : tr("hint");
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
    if (!command) { hfAwake = Date.now() + 8000; setMode("listening"); vibrate(60); return; } // just "Partner": waiting
    hfAwake = 0;
    handleUtterance(command);
  };
  hfRec.onerror = (e) => {
    if (e.error === "not-allowed") { handsFree = false; save("bolo.handsfree", false); renderHandsFree(); toast(tr("allowMicHf")); }
  };
  hfRec.onend = () => { hfRec = null; if (handsFree && document.visibilityState === "visible") setTimeout(startHandsFree, 300); };
  try { hfRec.start(); } catch { hfRec = null; }
}
function stopHandsFree() { const r = hfRec; hfRec = null; r && r.abort(); }
$("hfBtn").onclick = (e) => {
  e.stopPropagation();
  if (!Recognition) { toast(tr("hfChrome")); return; }
  handsFree = !handsFree;
  save("bolo.handsfree", handsFree);
  renderHandsFree();
  if (handsFree) { startHandsFree(); speak(tr("hfHint"), state.lang); } else stopHandsFree();
};
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && handsFree) startHandsFree(); });

// ---------- talking to the AI ----------
async function handleUtterance(text) {
  // Step 2 of verification: a plain "ha" / "na" is handled right here, instantly and without the AI.
  if (state.pending) {
    const pending = state.pending;
    const said = text.trim().replace(/^["“]|["”.!?,]$/g, "");
    const short = said.split(/\s+/).length <= 3; // "ha", "no", "yes please" - anything longer may be a correction
    if (pending.kind === "scheduled" && short && (YES.test(said) || NO.test(said))) {
      state.pending = null;
      if (YES.test(said)) {
        $("reply").textContent = tr("okText");
        await speak(tr("okText"), state.lang);
        await sendWhatsApp(pending.s.phone, pending.s.text, pending.who);
      } else {
        goHome(); // WhatsApp was never opened, so nothing is left typed anywhere
        $("reply").textContent = tr("cancelText");
        await speak(tr("cancelText"), state.lang);
      }
      finishAsk();
      return;
    }
    if (short && YES.test(said)) {
      state.pending = null;
      $("youSaid").textContent = "“" + text + "”";
      $("card").innerHTML = "";
      state.history.push({ role: "user", content: text }, { role: "assistant", content: `[confirmed ${pending.planned_action}]` });
      await runAction({ ...pending, action: pending.planned_action, reply: tr("okText") });
      return;
    }
    if (short && NO.test(said)) {
      state.pending = null;
      $("youSaid").textContent = "“" + text + "”";
      $("card").innerHTML = "";
      $("reply").textContent = tr("cancelText");
      state.history.push({ role: "user", content: text }, { role: "assistant", content: "[cancelled]" });
      speak(tr("cancelText"), state.lang);
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
    speak(tr("errorSpeak"), state.lang);
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
      toast(tr("savedContact", { name: saved.name }));
    }
    if (!result.contact_id) result.contact_id = saved.id;
  }
  // Never lose a task: if the AI filled a reminder or a note next to another action, keep it too.
  if (result.reminder_time && result.action !== "reminder" && result.action !== "confirm" && /^\d{1,2}:\d{2}$/.test(result.reminder_time)) {
    addReminder(result.reminder_time, result.reminder_text || result.reply);
    toast(tr("reminderSet", { time: result.reminder_time }));
  }
  if (result.memory_note && !["remember", "forget"].includes(result.action) && !state.memory.includes(result.memory_note)) {
    state.memory.push(result.memory_note); save("bolo.memory", state.memory);
  }
  // Sending something always waits for "yes" (unless the user turned safety off).
  if ((NEEDS_YES[state.verification] || []).includes(result.action)) {
    const who = label(contactById(result.contact_id)) || result.phone || result.email_to;
    const what = (result.message_text || result.email_subject || "").slice(0, 120);
    result = { ...result, planned_action: result.action, action: "confirm", reply: tr("askYes", { who, what, when: result.schedule_at ? tr("askYesWhen", { time: result.schedule_at }) : "" }) };
    $("reply").textContent = result.reply;
  }
  // Remember exactly what Partner is about to do, so a spoken correction changes only the wrong part.
  const task = {};
  for (const k of ["action", "planned_action", "contact_id", "phone", "email_to", "email_subject", "email_body", "message_text", "schedule_at", "reminder_time"]) {
    if (result[k] && result[k] !== "none") task[k] = result[k];
  }
  state.history.push({ role: "assistant", content: `${result.reply}\n${result.action === "confirm" || result.action === "clarify" ? "PENDING " : "DONE "}${JSON.stringify(task)}` });
  state.history = state.history.slice(-12);
  if (result.learn_note && !state.memory.includes(result.learn_note)) { // Partner learns the user's choices
    state.memory.push(result.learn_note);
    save("bolo.memory", state.memory);
  }
  await runAction(result);
  // One sentence, many tasks: run the rest automatically.
  if (result.follow_up && !state.pending && result.action !== "clarify") setTimeout(() => handleUtterance(result.follow_up), 700);
  else if (!state.pending && !["clarify", "confirm"].includes(result.action)) followUpListen();
}

// After finishing a task Partner stays active for a few seconds, so the next command needs no wake word or tap.
const FOLLOW_UP_MS = 8000;
let followTimer = null;
function followUpListen() {
  if (document.visibilityState !== "visible" || !Recognition) return;
  clearTimeout(followTimer);
  if (handsFree) {
    hfAwake = Date.now() + FOLLOW_UP_MS;
    setMode("listening");
    followTimer = setTimeout(() => { if (!state.busy && !speechSynthesis.speaking && Date.now() >= hfAwake) setMode("idle"); }, FOLLOW_UP_MS);
    return;
  }
  if (recognizer || state.busy) return;
  listen();
  followTimer = setTimeout(() => { if (recognizer && !state.busy) recognizer.stop(); }, FOLLOW_UP_MS);
}

// ---------- WhatsApp sending ----------
// On the PC (local server) Partner sends through WhatsApp Desktop by itself; on a phone WhatsApp opens with the text typed.
let pcHelper = false;
fetch("/api/pc-status").then((r) => r.ok && r.json()).then((d) => (pcHelper = !!(d && d.pc))).catch(() => {});

async function sendWhatsApp(phone, text, who) {
  if (pcHelper) {
    toast(tr("sendingDesktop"));
    const r = await fetch("/api/pc-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, text }) })
      .then((x) => x.json()).catch(() => ({ result: "error" }));
    if (r.result === "sent") { toast(tr("sentTo", { who: who || phone })); return; }
    toast(tr("noDesktop"));
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
      confirmAction(`📧 ${r.email_to}`, url);
      return;
    }
    case "remember": {
      if (r.memory_note) { state.memory.push(r.memory_note); save("bolo.memory", state.memory); }
      card.appendChild(el(`<div class="card"><h3>${esc(tr("saved"))}</h3><p>${esc(r.memory_note)}</p></div>`));
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
        card.appendChild(el(`<div class="card"><h3>⏰ ${esc(r.reminder_time)}</h3><p>${esc(r.reminder_text)}</p><p class="meta">${esc(tr("reminderNote"))}</p></div>`));
      }
      break;
    }
    case "read_explain": {
      if (r.scam_risk === "high") {
        vibrate([300, 100, 300, 100, 300]);
        card.appendChild(el(`<div class="card scam"><h3>${esc(tr("fraudTitle"))}</h3><p>${esc(tr("fraudText"))}</p></div>`));
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
      const box = el(`<div class="card"><h3>${esc(tr("confirmTitle"))}: ${esc(who)}</h3>${when}
        <p style="white-space:pre-wrap">${esc(r.message_text || r.email_subject || "")}</p>
        <div class="row"><button class="big yes">${esc(tr("yes"))}</button><button class="big alt no">${esc(tr("no"))}</button></div></div>`);
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
        <p>${esc(r.message_text)}</p><p class="meta">${esc(tr("schedNote"))}</p></div>`));
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
      if (window.open(url, "_blank")) return; // WhatsApp in a new tab keeps Partner (and its timers) alive
    } else {
      window.location.href = url; // tel: / sms: / mailto: open the phone app without leaving Partner
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
  speak(tr("tapConfirm"), state.lang);
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
      const msg = tr("sosMsg", { link });
      $("card").appendChild(el(`<div class="card scam"><h3>${esc(tr("sosTitle"))} → ${esc(label(target))}</h3><a class="big" href="https://wa.me/${waNumber(target.phone)}?text=${encodeURIComponent(msg)}">${esc(tr("sosSendLoc"))}</a></div>`));
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
    <div class="row"><button class="primary copy">${esc(tr("copyCode"))}</button><button class="ghost dl">${esc(tr("download"))}</button></div>
  </div>`);
  box.querySelector("code").textContent = r.code;
  if (isHtml) box.querySelector("iframe").srcdoc = r.code;
  box.querySelector(".copy").onclick = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(r.code); toast(tr("copied")); } catch { toast(tr("copyBlocked")); }
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
      toast(tr("nightOn"));
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

// At the scheduled time Partner asks "Ha ke na?". Ha -> send. Na -> delete it and go back to Partner's home screen.
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
  notify(tr("scheduledTitle"), `${who}: ${s.text}`);
  goHome();
  $("reply").textContent = "⏰ " + s.text;
  const box = el(`<div class="card"><h3>⏰ ${esc(who)}</h3><p style="white-space:pre-wrap">${esc(s.text)}</p>
    <div class="row"><button class="big yes">${esc(tr("yesSend"))}</button><button class="big alt no">${esc(tr("noDelete"))}</button></div></div>`);
  box.querySelector(".yes").onclick = (e) => { e.stopPropagation(); handleUtterance("yes"); };
  box.querySelector(".no").onclick = (e) => { e.stopPropagation(); handleUtterance("no"); };
  $("card").appendChild(box);
  state.pending = { kind: "scheduled", s, who };
  speak(tr("askSend", { who }), state.lang).then(() => listen());
}
function finishAsk() { askQueue.shift(); setTimeout(showNextAsk, 1500); }

// Back to Partner's clean home screen (a web page cannot open the phone's own home screen).
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
  const box = el(`<div class="card"><h3>${esc(tr("birthdays"))}</h3><div class="options"></div></div>`);
  const add = (text, ask) => {
    const b = el(`<button class="big alt">${esc(text)}</button>`);
    b.onclick = (e) => { e.stopPropagation(); handleUtterance(ask); };
    box.querySelector(".options").appendChild(b);
  };
  today.forEach((c) => add(tr("bdayToday", { who: label(c) }), tr("bdayAskToday", { who: label(c) })));
  tmrw.forEach((c) => add(tr("bdayTomorrow", { who: label(c) }), tr("bdayAskTomorrow", { who: label(c) })));
  $("card").appendChild(box);
}

// ---------- reminders (spoken while Partner is open) ----------
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
    notify(tr("reminderTitle"), r.text);
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
    const li = el(`<li>${esc(m)} <button title="${esc(tr("deleteTitle"))}">✖</button></li>`);
    li.querySelector("button").onclick = () => { state.memory.splice(i, 1); save("bolo.memory", state.memory); renderFamily(); };
    $("memoryList").appendChild(li);
  });
  $("verifyMode").value = state.verification;
  $("scheduledList").innerHTML = state.scheduled.length ? "" : "<li>—</li>";
  state.scheduled.forEach((sc) => {
    const li = el(`<li>${new Date(sc.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} → ${esc(label(contactById(sc.contact_id)) || sc.phone)}: ${esc(sc.text)} <button title="${esc(tr("cancelTitle"))}">✖</button></li>`);
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
    toast(tr("importNeedsChrome"));
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
    toast(tr("imported", { n: added }));
  } catch { toast(tr("importCancelled")); }
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
  handleUtterance(tr("askRead"));
};

// ---------- SOS button ----------
$("btnSos").onclick = (e) => {
  e.stopPropagation();
  handleUtterance(tr("askSos"));
};

// ---------- first-run setup: language + permissions ----------
async function notify(title, body) { // a phone notification, also when Partner is in the background
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = "serviceWorker" in navigator && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", vibrate: [300, 100, 300] });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch { /* notifications not available */ }
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderSetup(); });
window.addEventListener("appinstalled", () => { installPrompt = null; save("bolo.installed", true); renderSetup(); });

function markPerm(id, status) { // status: "ok" | "no" | ""
  const row = $(id), btn = row.querySelector("button");
  row.classList.toggle("ok", status === "ok");
  row.classList.toggle("no", status === "no");
  const isInstall = id === "permInstall";
  btn.textContent = status === "ok" ? tr(isInstall ? "installed" : "allowed") : status === "no" ? tr("denied") : tr(isInstall ? "install" : "allow");
}
async function permState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return "prompt"; }
}
async function renderSetup() {
  if ($("setup").classList.contains("hidden")) return;
  document.querySelectorAll("[data-setlang]").forEach((b) => b.classList.toggle("on", b.dataset.setlang === state.lang));
  const mic = await permState("microphone");
  markPerm("permMic", mic === "granted" ? "ok" : mic === "denied" ? "no" : "");
  const n = "Notification" in window ? Notification.permission : "denied";
  markPerm("permNotif", n === "granted" ? "ok" : n === "denied" ? "no" : "");
  markPerm("permContacts", state.contacts.some((c) => !DEMO_CONTACTS.some((d) => d.id === c.id)) ? "ok" : "");
  const geo = await permState("geolocation");
  markPerm("permLocation", geo === "granted" ? "ok" : geo === "denied" ? "no" : "");
  const standalone = matchMedia("(display-mode: standalone)").matches || load("bolo.installed", false);
  markPerm("permInstall", standalone ? "ok" : "");
}
function openSetup() { $("family").classList.add("hidden"); $("setup").classList.remove("hidden"); renderSetup(); }

$("permMic").querySelector("button").onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((tk) => tk.stop());
    if (Recognition && !handsFree) { handsFree = true; save("bolo.handsfree", true); renderHandsFree(); } // always listening for "Partner"
  } catch { toast(tr("blockedHelp")); }
  renderSetup();
};
$("permNotif").querySelector("button").onclick = async () => {
  if (!("Notification" in window)) { toast(tr("blockedHelp")); return; }
  const r = await Notification.requestPermission();
  if (r === "granted") notify(tr("reminderTitle"), tr("allowed")); else if (r === "denied") toast(tr("blockedHelp"));
  renderSetup();
};
$("permContacts").querySelector("button").onclick = async () => {
  if ("contacts" in navigator && "select" in navigator.contacts) { await $("importPhone").onclick(); renderSetup(); }
  else { $("setup").classList.add("hidden"); renderFamily(); $("family").classList.remove("hidden"); toast(tr("importNeedsChrome")); }
};
$("permLocation").querySelector("button").onclick = () => {
  if (!navigator.geolocation) { toast(tr("blockedHelp")); return; }
  navigator.geolocation.getCurrentPosition(() => renderSetup(), () => { toast(tr("blockedHelp")); renderSetup(); }, { timeout: 10000 });
};
$("permInstall").querySelector("button").onclick = async () => {
  if (installPrompt) { installPrompt.prompt(); const c = await installPrompt.userChoice; if (c.outcome === "accepted") save("bolo.installed", true); installPrompt = null; }
  else toast(tr("installHelp"));
  renderSetup();
};
document.querySelectorAll("[data-setlang]").forEach((b) => (b.onclick = async () => { await setLanguage(b.dataset.setlang); renderSetup(); }));
$("setupDone").onclick = () => {
  save("bolo.setupDone", true);
  $("setup").classList.add("hidden");
  if (handsFree) { startHandsFree(); speak(tr("hfHint"), state.lang); }
};
$("openSetup").onclick = openSetup;

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
  e.stopPropagation(); setLanguage(b.dataset.lang);
}));
function restartHandsFree() { if (handsFree) { stopHandsFree(); setTimeout(startHandsFree, 300); } renderHandsFree(); }
$("moreLangs").onchange = (e) => {
  if (e.target.value) setLanguage(e.target.value);
};
document.addEventListener("keydown", (e) => { // PC: press Space to talk
  if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); listen(); }
});

renderLang();
renderHandsFree();
startHandsFree();
setMode("idle");
// Live status pill: which AI brain is answering.
fetch("/api/status").then((r) => r.json()).then((d) => { statusProvider = d.provider || ""; showStatus(); })
  .catch(() => { statusProvider = undefined; showStatus(); });
setLanguage(state.lang).then(() => {
  birthdayCheck();
  if (!load("bolo.setupDone", false)) openSetup(); // first visit: language + permissions, like a normal app
  const q = new URLSearchParams(location.search); // long-press shortcuts on the app icon
  if (q.get("sos") === "1") $("btnSos").click();
  else if (q.get("talk") === "1") listen();
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
keepAwake();

// Direct link to the family screen: open Partner with #family
if (location.hash === "#family") $("btnFamily").click();

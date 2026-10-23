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
  profile: load("bolo.profile", {}), // the user's own details for emails and forms (name, mobile, IDs) - kept on this phone
  pending: null, // an action waiting for "ha / yes"
  settings: load("bolo.settings", {}), // user choices: true = allowed, false = not allowed, missing = not asked yet
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

// First visit: English (the user can switch to Hindi or Gujarati with one tap).
function defaultLang() {
  return "en-IN";
}


// iPhone / iPad (iPadOS also reports itself as a Mac with touch).
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// ---------- UI state ----------
const RING_ICONS = {
  idle: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  listening: '<svg viewBox="0 0 24 24"><path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/></svg>',
  thinking: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>',
  speaking: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
};
function setMode(mode) { // idle | listening | thinking | speaking
  document.body.classList.remove("listening", "thinking", "speaking");
  if (mode !== "idle") document.body.classList.add(mode);
  $("ringIcon").innerHTML = RING_ICONS[mode];
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
  renderNight();
  if (!$("features").classList.contains("hidden")) renderFeatures();
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
let hfBuffer = "", hfTimer = null; // pieces of one sentence, sent after a pause
function waitForMore() {
  clearTimeout(hfTimer);
  const words = hfBuffer.split(/\s+/).filter(Boolean).length;
  hfTimer = setTimeout(() => {
    const command = hfBuffer.trim();
    hfBuffer = ""; hfTimer = null;
    if (command) { hfAwake = 0; handleUtterance(command); }
  }, words < 3 ? 2500 : 1500);
}
const WAKE = /^(hey |ok |hi |hello |he )?(partner|partnar|patner|pardner|partner ji|પાર્ટનર|પાટનર|पार्टनर|पाटनर|پارٹنر|பார்ட்னர்|పార్ట్నర్|পার্টনার|ಪಾರ್ಟ್ನರ್|പാർട്ണർ|ਪਾਰਟਨਰ|بارتنر|پارتنر)(?=$|[\s,.!?])[\s,.!?]*/i;
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
    if (!r.isFinal) { // still speaking: show it and keep waiting
      if (awake || hfBuffer || WAKE.test(heard)) {
        $("youSaid").textContent = "“" + (hfBuffer + " " + heard.replace(WAKE, "")).trim() + "”";
        if (hfTimer) waitForMore();
      }
      return;
    }
    if (lastSpoken && heard.length > 6 && lastSpoken.toLowerCase().includes(heard.toLowerCase().slice(0, 12))) return; // own echo
    let command = heard;
    if (WAKE.test(command)) command = command.replace(WAKE, "").trim();
    else if (!awake && !hfBuffer) return;
    if (!command && !hfBuffer) { hfAwake = Date.now() + 8000; setMode("listening"); vibrate(60); return; } // just "Partner": waiting
    // Android cuts a sentence at every small pause - collect the pieces until the person really stops.
    hfBuffer = (hfBuffer + " " + command).trim();
    $("youSaid").textContent = "“" + hfBuffer + "”";
    setMode("listening");
    waitForMore();
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
  state.settings.listen = handsFree;
  save("bolo.handsfree", handsFree); save("bolo.settings", state.settings);
  renderHandsFree();
  renderSetup();
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
    if (pending.kind === "ask" && short && (YES.test(said) || NO.test(said))) { pending.done(YES.test(said)); return; }
    if (pending.kind === "photo" && short && (YES.test(said) || NO.test(said))) {
      state.pending = null;
      if (YES.test(said)) await sendPhotoAfterYes(pending.to);
      else { $("camShare").classList.add("hidden"); speak(tr("camKept"), state.lang); }
      return;
    }
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
        profile: state.profile,
        photoReady: !!camBlob && Date.now() - camTakenAt < 30 * 60 * 1000,
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
  for (const k of ["action", "planned_action", "contact_id", "phone", "email_to", "email_cc", "email_bcc", "email_subject", "email_body", "message_text", "schedule_at", "reminder_time"]) {
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
  if (document.visibilityState !== "visible" || !Recognition || state.settings.listen === false) return;
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

// ---------- email details: type, CC, BCC, signature, mobile, reference IDs ----------
const DETAIL_FIELDS = [ // [key, label key, input type, saved in profile?]
  ["cc", "fCc", "email", false], ["bcc", "fBcc", "email", false], ["name", "fName", "text", true], ["mobile", "fMobile", "tel", true],
  ["application_id", "fAppId", "text", true], ["loan_id", "fLoanId", "text", true], ["account_no", "fAcc", "text", true], ["other", "fOther", "text", false],
];
function emailDetails(r) {
  const p = state.profile;
  const wrap = el(`<details class="details"><summary>${esc(tr("addDetails"))}</summary><div class="dgrid">
    <label class="small">${esc(tr("emailType"))}<select class="dtype">${["tGeneral", "tLeave", "tBank", "tComplaint", "tJob", "tOfficial"].map((k) => `<option value="${k}">${esc(tr(k))}</option>`).join("")}</select></label>
  </div></details>`);
  const grid = wrap.querySelector(".dgrid");
  for (const [key, labelKey, type, saved] of DETAIL_FIELDS) {
    const start = key === "cc" ? r.email_cc || "" : key === "bcc" ? r.email_bcc || "" : saved ? p[key] || "" : "";
    const f = el(`<div class="dfield${start ? " on" : ""}"><label><input type="checkbox"${start ? " checked" : ""}> ${esc(tr(labelKey))}</label>
      <div class="dinputs">${key === "other" ? `<input type="text" class="dlabel" placeholder="${esc(tr("otherLabelPh"))}">` : ""}<input type="${type}" class="dval" value="${esc(start)}"></div></div>`);
    f.dataset.key = key;
    f.querySelector('input[type="checkbox"]').onchange = (e) => { f.classList.toggle("on", e.target.checked); if (e.target.checked) f.querySelector(".dval").focus(); };
    grid.appendChild(f);
  }
  const btn = el(`<button class="big">${esc(tr("updateEmail"))}</button>`);
  btn.onclick = (e) => {
    e.stopPropagation();
    const picked = [...grid.querySelectorAll(".dfield.on")].map((f) => ({ key: f.dataset.key, value: f.querySelector(".dval").value.trim(), label: f.querySelector(".dlabel")?.value.trim() })).filter((x) => x.value);
    for (const x of picked) { const def = DETAIL_FIELDS.find((d) => d[0] === x.key); if (def && def[3]) state.profile[x.key] = x.value; }
    save("bolo.profile", state.profile);
    toast(tr("savedProfile"));
    const type = tr(grid.querySelector(".dtype").value);
    const lines = picked.map((x) => `${x.key === "other" ? x.label || "Other detail" : tr(DETAIL_FIELDS.find((d) => d[0] === x.key)[1])}: ${x.value}`);
    handleUtterance(`Update the pending email: make it a "${type}" email and include these details – ${lines.join("; ") || "no extra details"}. Put CC/BCC addresses into email_cc / email_bcc. Keep the same recipient and purpose. Reply in ${state.lang}.`);
  };
  grid.appendChild(btn);
  wrap.addEventListener("click", (e) => e.stopPropagation());
  return wrap;
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
  openWhatsAppChat(phone, text);
}
// Opens the WhatsApp app straight away; only if it is not installed, fall back to the web link.
function openWhatsAppChat(phone, text) {
  const n = waNumber(phone), t = encodeURIComponent(text || "");
  const isPhone = /android|iphone|ipad/i.test(navigator.userAgent) || IS_IOS;
  if (!isPhone) { window.open(`https://wa.me/${n}${t ? "?text=" + t : ""}`, "_blank"); return; }
  window.location.href = `whatsapp://send?phone=${n}${t ? "&text=" + t : ""}`;
  setTimeout(() => { if (document.visibilityState === "visible") window.location.href = `https://wa.me/${n}${t ? "?text=" + t : ""}`; }, 2500);
}

// ---------- actions ----------
function contactById(id) { return state.contacts.find((c) => c.id === id); }
// "Anish (uncle, Nadiad)" - only the first word group of the relation, so labels stay short.
function label(c) {
  if (!c) return "";
  const rel = (c.relation || "").split(" (")[0].trim();
  const extra = [rel, c.city].filter(Boolean).join(", ");
  return extra ? `${c.name} (${extra})` : c.name;
}
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
      confirmAction(`📞 ${label(c) || phone}`, `tel:${phone}`, r.action === "sos", { say: tr("dialHint"), tap: tr("tapCall", { who: c ? c.name : phone }) });
      return;
    }
    case "whatsapp":
    case "sms": {
      card.appendChild(el(`<div class="card"><h3>${r.action === "whatsapp" ? "💬 WhatsApp" : "✉️ SMS"} → ${esc(label(c) || phone)}</h3><p>${esc(r.message_text)}</p></div>`));
      await speak(r.reply, r.reply_lang);
      if (r.action === "whatsapp") {
        if (!pcHelper) showTapScreen(`💬 WhatsApp: ${label(c) || phone}`, () => sendWhatsApp(phone, r.message_text, label(c)), false, tr("tapWhatsApp", { who: c ? c.name : phone }));
        else confirmAction(`💬 WhatsApp: ${label(c) || phone}`, () => sendWhatsApp(phone, r.message_text, label(c)));
      } else {
        confirmAction(`✉️ SMS: ${label(c) || phone}`, `sms:${phone}?body=${encodeURIComponent(r.message_text)}`, false, { say: tr("sendHint"), tap: tr("tapSms") });
      }
      return;
    }
    case "email": {
      card.appendChild(el(`<div class="card"><h3>📧 ${esc(r.email_to)}</h3><p><b>${esc(r.email_subject)}</b></p><p style="white-space:pre-wrap">${esc(r.email_body)}</p></div>`));
      await speak(r.reply, r.reply_lang);
      const extra = (r.email_cc ? `&cc=${encodeURIComponent(r.email_cc)}` : "") + (r.email_bcc ? `&bcc=${encodeURIComponent(r.email_bcc)}` : "");
      const url = `mailto:${encodeURIComponent(r.email_to)}?subject=${encodeURIComponent(r.email_subject)}&body=${encodeURIComponent(r.email_body)}${extra}`;
      confirmAction(`📧 ${r.email_to}`, url, false, { say: tr("sendHint"), tap: tr("tapEmail") });
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
    case "open_app": {
      await speak(r.reply, r.reply_lang);
      const target = appTarget(r.app, r.app_query);
      if (!target) return;
      if (target.uninstall) { uninstallPartner(); return; } // ask yes / no first, then Android's uninstall screen
      if (target.install) { // Chrome shows its install prompt only after a real tap
        if (IS_STANDALONE) { toast(tr("installed")); return; }
        if (IS_IOS) { iosInstallHelp(); return; }
        if (!installPrompt) { toast(tr("installHelp")); speak(tr("installHelp"), state.lang); return; }
        showTapScreen("📲 " + tr("pInstall"), async () => {
          installPrompt.prompt();
          const c = await installPrompt.userChoice;
          if (c.outcome === "accepted") save("bolo.installed", true);
          installPrompt = null;
        }, false, tr("tapInstall"));
        return;
      }
      if (target.androidOnly && IS_IOS) { showInfo(target.icon, target.name, tr("iosSettings", { app: target.name })); return; }
      if (target.androidOnly && !/android/i.test(navigator.userAgent)) { toast(tr("androidSettings")); return; }
      toast(tr("opening", { app: target.name }));
      confirmAction(`${target.icon} ${target.name}${r.app_query ? ": " + r.app_query : ""}`, target.url, false,
        target.androidOnly ? { tap: tr("tapSettings") } : { tap: tr("tapApp", { app: target.name }) });
      return;
    }
    case "share_photo": {
      if (!camBlob) { speak(tr("noPhoto"), state.lang); return; }
      await speak(r.reply, r.reply_lang);
      const to = { who: c ? c.name : phone, phone };
      if (pcHelper && to.phone && (await pcSendPhoto(to))) return; // this PC: zero taps
      // The phone's share screen needs a real tap, so show one big button that opens it with the photo attached.
      showTapScreen(tr("camSendPhoto", { who: to.who }), async () => {
        const file = new File([camBlob], "Partner-photo.jpg", { type: "image/jpeg" });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
        } catch { return; /* cancelled */ }
        openWhatsAppChat(to.phone, "");
      }, false, tr("camTapPhoto", { who: to.who }));
      return;
    }
    case "camera": {
      if (state.settings.camera === false) { speak(tr("camOff"), state.lang); return; }
      await speak(r.reply, r.reply_lang);
      const shareTo = c ? { who: c.name, phone: c.phone } : phone ? { who: phone, phone } : null;
      openCamera(r.camera_facing === "front" ? "user" : "environment", Math.max(0, Math.min(10, +r.camera_timer || 3)), shareTo);
      return;
    }
    case "confirm": {
      // Step 2 of verification: show exactly what will happen, then wait for "ha" / "na" (voice or tap).
      state.pending = r;
      const who = label(c) || phone || r.email_to;
      const when = r.schedule_at ? `<p class="meta">⏰ ${esc(r.schedule_at)}</p>` : "";
      const box = el(`<div class="card"><h3>${esc(tr("confirmTitle"))}: ${esc(who)}</h3>${when}
        <p style="white-space:pre-wrap">${esc(r.message_text || r.email_subject || "")}</p>
        ${r.planned_action === "email" && (r.email_cc || r.email_bcc) ? `<p class="meta">${r.email_cc ? "CC: " + esc(r.email_cc) + " " : ""}${r.email_bcc ? "BCC: " + esc(r.email_bcc) : ""}</p>` : ""}
        ${r.planned_action === "email" && r.email_body ? `<p class="meta" style="white-space:pre-wrap">${esc(r.email_body)}</p>` : ""}
        <div class="row"><button class="big yes">${esc(tr("yes"))}</button><button class="big alt no">${esc(tr("no"))}</button></div></div>`);
      box.querySelector(".yes").onclick = (e) => { e.stopPropagation(); handleUtterance("yes"); };
      box.querySelector(".no").onclick = (e) => { e.stopPropagation(); handleUtterance("no"); };
      card.appendChild(box);
      if (r.planned_action === "email") {
        box.querySelector(".row").before(emailDetails(r));
      }
      await speak(r.reply, r.reply_lang);
      if (r.planned_action === "email") await speak(tr("detailsHint"), state.lang);
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
      keepAwake(true);
      break;
    }
    case "cancel_schedule": {
      state.scheduled = r.contact_id ? state.scheduled.filter((s) => s.contact_id !== r.contact_id) : [];
      save("bolo.scheduled", state.scheduled);
      keepAwake();
      break;
    }
  }
  await speak(r.reply, r.reply_lang);
}

// Voice-first: open the call / app straight away. If the phone blocks it (or in 2-step mode),
// show one big "tap anywhere" button instead.
// guide.say = spoken before the phone opens the app ("Press the green Call button…"),
// guide.tap = spoken when the phone needs a tap on Partner's big button first.
async function confirmAction(text, url, danger = false, guide = {}) {
  if (state.verification === "smart" || state.verification === "off") { // 1-step / 2-step always show the tap screen
    if (typeof url === "function") { url(); return; }
    if (/^https?:/.test(url)) {
      if (window.open(url, "_blank")) { if (guide.say) speak(guide.say, state.lang); return; } // new tab keeps Partner alive
    } else {
      if (guide.say) await speak(guide.say, state.lang);
      window.location.href = url; // tel: / sms: / mailto: / settings open the phone app without leaving Partner
      setTimeout(() => { if (document.visibilityState === "visible") showTapScreen(text, url, danger, guide.tap); }, 1500);
      return;
    }
  }
  showTapScreen(text, url, danger, guide.tap);
}

// Full-screen "tap anywhere" button - used when the phone needs a real tap to open another app.
function showTapScreen(text, url, danger = false, spoken = "") {
  const box = $("confirm"), go = $("confirmGo");
  go.textContent = text + "  ✔";
  go.classList.toggle("danger", danger);
  box.classList.remove("hidden");
  vibrate(200);
  speak(spoken || tr("tapConfirm"), state.lang);
  go.onclick = () => {
    box.classList.add("hidden"); speechSynthesis.cancel();
    typeof url === "function" ? url() : (window.location.href = url);
  };
  $("confirmCancel").onclick = () => { box.classList.add("hidden"); speechSynthesis.cancel(); };
}

function sendSosWhatsApp(c) {
  const target = c || state.contacts.find((x) => x.emergency);
  if (!target || !navigator.geolocation || state.settings.location === false) return; // the call still happens
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const link = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      const msg = tr("sosMsg", { link });
      $("card").appendChild(el(`<div class="card scam"><h3>${esc(tr("sosTitle"))} → ${esc(label(target))}</h3><a class="big" href="whatsapp://send?phone=${waNumber(target.phone)}&text=${encodeURIComponent(msg)}">${esc(tr("sosSendLoc"))}</a></div>`));
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

// ---------- open apps by voice ----------
// Web links that phones open in the matching app (YouTube, Maps...), and Android "intent:" links for settings pages.
function appTarget(app, query = "") {
  const q = encodeURIComponent(query.trim());
  const settings = (action) => `intent:#Intent;action=android.settings.${action};end`;
  const map = {
    youtube: { name: "YouTube", icon: "▶️", url: q ? `https://www.youtube.com/results?search_query=${q}` : "https://www.youtube.com/" },
    youtube_music: { name: "YouTube Music", icon: "🎵", url: q ? `https://music.youtube.com/search?q=${q}` : "https://music.youtube.com/" },
    spotify: { name: "Spotify", icon: "🎧", url: q ? `https://open.spotify.com/search/${q}` : "https://open.spotify.com/" },
    google: { name: "Google", icon: "🔎", url: `https://www.google.com/search?q=${q}` },
    maps: { name: "Google Maps", icon: "🗺️", url: `https://www.google.com/maps/search/?api=1&query=${q}` },
    maps_directions: { name: "Google Maps", icon: "🧭", url: `https://www.google.com/maps/dir/?api=1&destination=${q}` },
    play_store: IS_IOS
      ? { name: "App Store", icon: "🛍️", url: `itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=${q}` }
      : { name: "Play Store", icon: "🛍️", url: `https://play.google.com/store/search?q=${q}&c=apps` },
    netflix: { name: "Netflix", icon: "🎬", url: q ? `https://www.netflix.com/search?q=${q}` : "https://www.netflix.com/" },
    prime_video: { name: "Prime Video", icon: "🎬", url: q ? `https://www.primevideo.com/search/?phrase=${q}` : "https://www.primevideo.com/" },
    instagram: { name: "Instagram", icon: "📷", url: "https://www.instagram.com/" },
    facebook: { name: "Facebook", icon: "📘", url: "https://www.facebook.com/" },
    gmail: { name: "Gmail", icon: "📧", url: "https://mail.google.com/" },
    calendar: { name: "Google Calendar", icon: "📅", url: "https://calendar.google.com/" },
    news: { name: "Google News", icon: "📰", url: q ? `https://news.google.com/search?q=${q}` : "https://news.google.com/" },
    bluetooth_settings: { name: "Bluetooth", icon: "🔵", url: settings("BLUETOOTH_SETTINGS"), androidOnly: true },
    wifi_settings: { name: "Wi-Fi", icon: "📶", url: settings("WIFI_SETTINGS"), androidOnly: true },
    phone_settings: { name: "Settings", icon: "⚙️", url: settings("SETTINGS"), androidOnly: true },
    uninstall_partner: { name: "Apps", icon: "🗑️", url: settings("MANAGE_APPLICATIONS_SETTINGS"), androidOnly: true, uninstall: true },
    install_partner: { name: "Partner", icon: "📲", url: "", install: true },
  };
  return map[app] || null;
}

// ---------- camera by voice: open, count down aloud, take the photo, save it ----------
let camStream = null, camBlob = null, camFacing = "environment", camTimer = 3, camShareTo = null, camTakenAt = 0;
function stopCamera() { camStream && camStream.getTracks().forEach((tk) => tk.stop()); camStream = null; }
async function openCamera(facing, timer, shareTo = camShareTo) {
  camFacing = facing; camTimer = timer; camShareTo = shareTo;
  const video = $("camVideo"), photo = $("camPhoto");
  photo.classList.add("hidden"); video.classList.remove("hidden");
  ["camShare", "camAgain"].forEach((id) => $(id).classList.add("hidden"));
  $("cam").classList.remove("hidden");
  stopHandsFree(); // the microphone is not needed while the camera is open
  try {
    stopCamera();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 } }, audio: false });
  } catch {
    $("cam").classList.add("hidden"); toast(tr("camError")); speak(tr("camError"), state.lang); startHandsFree(); return;
  }
  video.srcObject = camStream;
  video.classList.toggle("mirror", facing === "user"); // a selfie preview looks like a mirror
  await video.play();
  for (let n = timer; n > 0; n--) { // spoken countdown: 3... 2... 1...
    $("camCount").textContent = n;
    vibrate(80);
    const num = n.toLocaleString(state.lang);
    if ("speechSynthesis" in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(num); u.lang = state.lang; speechSynthesis.speak(u); }
    await new Promise((res) => setTimeout(res, 1000));
    if ($("cam").classList.contains("hidden")) return; // closed during the countdown
  }
  $("camCount").textContent = "";
  $("camCount").classList.remove("flash"); void $("camCount").offsetWidth; $("camCount").classList.add("flash");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (facing === "user") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);
  stopCamera();
  camBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  camTakenAt = Date.now();
  photo.src = URL.createObjectURL(camBlob);
  photo.classList.remove("hidden"); video.classList.add("hidden");
  const a = document.createElement("a"); // saved to the phone's Downloads / gallery
  a.href = photo.src; a.download = `Partner-photo-${localIso().replace(/[ :]/g, "-")}.jpg`; a.click();
  toast(tr("camSaved"));
  ["camShare", "camAgain"].forEach((id) => $(id).classList.remove("hidden"));
  $("camShare").textContent = camShareTo ? tr("camSendTo", { who: camShareTo.who }) : tr("camShare");
  $("camShare").classList.toggle("yes", !!camShareTo);
  if (!camShareTo) { speak(tr("camDone"), state.lang); return; }
  // Ask permission by voice before sending: "Shall I send this photo to Shad on WhatsApp? Say yes or no."
  state.pending = { kind: "photo", to: camShareTo };
  speak(tr("camAskPhoto", { who: camShareTo.who }), state.lang).then(() => { if (state.pending?.kind === "photo") listen(); });
}
async function sendPhotoAfterYes(to) {
  if (pcHelper && (await pcSendPhoto(to))) return; // this PC: zero taps
  const file = new File([camBlob], "Partner-photo.jpg", { type: "image/jpeg" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch { /* the phone wants a real tap first */ }
  $("camShare").classList.add("pulse");
  speak(tr("camTapToSend"), state.lang);
}
async function pcSendPhoto(to) {
  speak(tr("camSendingPc", { who: to.who }), state.lang);
  const image = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(camBlob); });
  const out = await fetch("/api/pc-send-photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: to.phone, image }) })
    .then((x) => x.json()).catch(() => ({ result: "error" }));
  if (out.result !== "sent") { toast(tr("noDesktop")); return false; }
  toast(tr("sentTo", { who: to.who }));
  $("camShare").classList.add("hidden");
  return true;
}
$("camClose").onclick = () => { if (state.pending?.kind === "photo") state.pending = null; stopCamera(); $("cam").classList.add("hidden"); speechSynthesis.cancel(); startHandsFree(); };
$("camAgain").onclick = () => openCamera(camFacing, camTimer);
// One tap: the phone's share screen with the photo attached (WhatsApp → the person, usually at the top).
// On a PC: the photo is copied and the person's WhatsApp chat opens - press Ctrl+V and Enter.
$("camShare").onclick = async () => {
  if (state.pending?.kind === "photo") state.pending = null;
  $("camShare").classList.remove("pulse");
  if (camShareTo && pcHelper && (await pcSendPhoto(camShareTo))) return;
  const file = new File([camBlob], "Partner-photo.jpg", { type: "image/jpeg" });
  const canShareFiles = navigator.canShare && navigator.canShare({ files: [file] }) && /android|iphone|ipad/i.test(navigator.userAgent);
  if (canShareFiles) {
    toast(tr("camPinTip"));
    try { await navigator.share({ files: [file] }); } catch { /* share cancelled */ }
    return;
  }
  try { // copy the photo so it can be pasted into the chat
    const png = await new Promise((res) => { const img = new Image(); img.onload = () => { const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d").drawImage(img, 0, 0); cv.toBlob(res, "image/png"); }; img.src = $("camPhoto").src; });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast(tr("camPasteTip"));
  } catch { toast(tr("camSaved")); }
  if (camShareTo) { if (pcHelper) window.open(`whatsapp://send?phone=${waNumber(camShareTo.phone)}`, "_blank"); else openWhatsAppChat(camShareTo.phone, ""); }
};

// ---------- scheduled messages (e.g. a birthday wish at exactly 12:00 AM) ----------
function parseLocal(s) { // "YYYY-MM-DD HH:MM" -> Date in the phone's time zone
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
let wakeLock = null;
// Night mode: keep the screen awake only while a message is scheduled in the next 24 hours.
// The pop-up is shown once, when a message is scheduled; after that a small 🌙 badge shows it is on.
async function keepAwake(announce = false) {
  const soon = state.scheduled.some((s) => s.at - Date.now() < 24 * 3600 * 1000);
  try {
    if (!soon && wakeLock) { await wakeLock.release(); wakeLock = null; }
    if (soon && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; renderNight(); });
    }
  } catch { /* battery saver can refuse; the timer still works while the screen is on */ }
  if (announce && soon) toast(tr("nightOn"));
  renderNight();
}
function renderNight() {
  $("nightBadge").classList.toggle("hidden", !state.scheduled.length);
  $("nightBadge").title = tr("nightOn");
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && keepAwake());

function fireScheduled() {
  const now = Date.now();
  const due = state.scheduled.filter((s) => s.at <= now);
  if (!due.length) return;
  state.scheduled = state.scheduled.filter((s) => s.at > now);
  save("bolo.scheduled", state.scheduled);
  keepAwake();
  due.forEach((s) => askScheduled(s));
}
setInterval(fireScheduled, 1000);

// At the scheduled time Partner asks "yes or no?". Yes -> send. No -> delete it and go back to Partner's home screen.
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
    li.querySelector("button").onclick = () => { state.scheduled = state.scheduled.filter((x) => x.id !== sc.id); save("bolo.scheduled", state.scheduled); keepAwake(); renderFamily(); };
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
$("btnFamily").onclick = (e) => { e.stopPropagation(); $("setup").classList.add("hidden"); renderFamily(); $("family").classList.remove("hidden"); };
$("closeFamily").onclick = () => { $("family").classList.add("hidden"); if (load("bolo.setupDone", false)) return; openSetup(); };
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
// Adds people ({ name, phone, email }) to Family, skipping numbers that are already saved.
function addContacts(people) {
  let added = 0;
  for (const p of people) {
    if (!p.name || !p.phone) continue;
    const digits = p.phone.replace(/\D/g, "").slice(-10);
    if (state.contacts.some((c) => c.phone.replace(/\D/g, "").slice(-10) === digits)) continue;
    const relation = (RELATION_FROM_NAME.find(([re]) => re.test(p.name)) || [, ""])[1];
    state.contacts.push({ id: "c" + Date.now() + "_" + added, name: p.name, relation, city: "", phone: p.phone, email: p.email || "", birthday: "", emergency: false });
    added++;
  }
  save("bolo.contacts", state.contacts);
  renderFamily();
  renderSetup();
  return added;
}

// "Choose contacts": the phone's own picker (Chrome on Android) - the user ticks only the people needed.
$("importPhone").onclick = async () => {
  if (!("contacts" in navigator && "select" in navigator.contacts)) { if (IS_IOS) showInfo("📱", tr("pContacts"), tr("iosContacts")); else toast(tr("importNeedsChrome")); return; }
  toast(tr("pickerTip"));
  try {
    const picked = await navigator.contacts.select(["name", "tel", "email"], { multiple: true });
    const added = addContacts(picked.map((p) => ({ name: (p.name && p.name[0]) || "", phone: (p.tel && p.tel[0]) || "", email: (p.email && p.email[0]) || "" })));
    toast(tr("imported", { n: added }));
  } catch { toast(tr("importCancelled")); }
};

// "All contacts": a .vcf file exported from the phone's Contacts app (works on Android, iPhone and PC).
function decodeQuotedPrintable(s) {
  const bytes = [];
  s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})|([^=])/gi, (_, hex, ch) => {
    if (hex) bytes.push(parseInt(hex, 16)); else for (const b of new TextEncoder().encode(ch)) bytes.push(b);
    return "";
  });
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function parseVcf(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, ""); // vCard folds long lines
  return unfolded.split(/BEGIN:VCARD/i).slice(1).map((card) => {
    const field = (name) => {
      const m = new RegExp("^" + name + "([^:\\n]*):(.*)$", "mi").exec(card);
      if (!m) return "";
      return /QUOTED-PRINTABLE/i.test(m[1]) ? decodeQuotedPrintable(m[2]).trim() : m[2].trim();
    };
    const n = field("N").split(";").filter(Boolean).reverse().join(" ");
    return { name: field("FN") || n, phone: field("TEL"), email: field("EMAIL") };
  });
}
$("importAll").onclick = () => { toast(tr("vcfHelp")); $("vcfFile").click(); };
$("vcfFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const added = addContacts(parseVcf(await file.text()));
  toast(added ? tr("imported", { n: added }) : tr("importedNone"));
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
    if (state.settings.notify === false || !("Notification" in window) || Notification.permission !== "granted") return;
    const reg = "serviceWorker" in navigator && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", vibrate: [300, 100, 300] });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch { /* notifications not available */ }
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderSetup(); });
window.addEventListener("appinstalled", () => { installPrompt = null; save("bolo.installed", true); renderSetup(); });

// Install row keeps a button; the other permissions are Allow / Don't allow choices.
function markInstall(done) {
  const row = $("permInstall");
  row.classList.toggle("ok", done);
  row.querySelector('input[value="install"]').checked = done;
  row.querySelector('input[value="uninstall"]').checked = false;
}
async function permState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return "prompt"; }
}
// Each permission: the app setting it controls and the browser permission behind it.
const PERMS = {
  permMic: { key: "listen", query: "microphone" },
  permCamera: { key: "camera", query: "camera" },
  permNotif: { key: "notify" },
  permContacts: { key: "contacts" },
  permLocation: { key: "location", query: "geolocation" },
};
async function browserState(id) {
  if (id === "permNotif") return "Notification" in window ? (Notification.permission === "default" ? "prompt" : Notification.permission) : "denied";
  if (id === "permContacts") return state.contacts.some((c) => !DEMO_CONTACTS.some((d) => d.id === c.id)) ? "granted" : "prompt";
  return permState(PERMS[id].query);
}
async function renderSetup() {
  if ($("setup").classList.contains("hidden")) return;
  document.querySelectorAll("[data-setlang]").forEach((b) => b.classList.toggle("on", b.dataset.setlang === state.lang));
  for (const id of Object.keys(PERMS)) {
    const row = $(id), choice = state.settings[PERMS[id].key], st = await browserState(id);
    const allowed = choice !== false && (st === "granted" || choice === true);
    row.querySelector('input[value="allow"]').checked = allowed;
    row.querySelector('input[value="deny"]').checked = choice === false;
    row.classList.toggle("ok", allowed && st === "granted");
    row.querySelector(".blocked").classList.toggle("hidden", !(choice !== false && st === "denied"));
  }
  markInstall(IS_STANDALONE || load("bolo.installed", false));
}
function openSetup() { $("family").classList.add("hidden"); $("setup").classList.remove("hidden"); $("appVersion").textContent = "Partner v" + APP_VERSION; renderSetup(); }

function saveSettings() { save("bolo.settings", state.settings); }
// Ask the phone for one permission. Returns true when it is granted.
async function requestPerm(id) {
  try {
    if (id === "permMic" || id === "permCamera") {
      const st = await navigator.mediaDevices.getUserMedia(id === "permMic" ? { audio: true } : { video: true });
      st.getTracks().forEach((tk) => tk.stop());
      return true;
    }
    if (id === "permNotif") {
      if (IS_IOS && !IS_STANDALONE) { await showInfo("🔔", tr("pNotif"), tr("iosNotif")); return false; }
      return "Notification" in window && (await Notification.requestPermission()) === "granted";
    }
    if (id === "permLocation") return await new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(() => res(true), () => res(false), { timeout: 10000 }) : res(false));
    if (id === "permContacts") {
      if ("contacts" in navigator && "select" in navigator.contacts) { await $("importPhone").onclick(); return true; }
      $("setup").classList.add("hidden"); renderFamily(); $("family").classList.remove("hidden");
      if (IS_IOS) showInfo("📱", tr("pContacts"), tr("iosContacts")); else toast(tr("importNeedsChrome"));
      return true;
    }
  } catch { /* blocked or cancelled */ }
  return false;
}
// What each choice changes inside Partner.
function applyChoice(id, on) {
  state.settings[PERMS[id].key] = on;
  saveSettings();
  if (id === "permMic") {
    handsFree = on && !!Recognition; save("bolo.handsfree", handsFree); renderHandsFree();
    if (handsFree) startHandsFree(); else { stopHandsFree(); if (!on) toast(tr("listenOff")); }
  }
  if (id === "permNotif" && !on) toast(tr("notifOff"));
  if (id === "permLocation" && !on) toast(tr("locOff"));
}
for (const id of Object.keys(PERMS)) {
  $(id).querySelectorAll('input[type="radio"]').forEach((radio) => (radio.onchange = async () => {
    if (radio.value === "allow") {
      const ok = await requestPerm(id);
      applyChoice(id, true);
      if (!ok && id !== "permContacts") toast(tr("blockedHelp"));
    } else applyChoice(id, false);
    renderSetup();
  }));
}
// One tap: allow everything a normal app asks for at install.
$("allowAll").onclick = async () => {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    st.getTracks().forEach((tk) => tk.stop());
  } catch { /* each one can still be allowed below */ }
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch { /* needs its own tap on some phones */ }
  await new Promise((res) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, res, { timeout: 10000 }) : res()));
  ["permMic", "permCamera", "permNotif", "permLocation"].forEach((id) => applyChoice(id, true));
  renderSetup();
};
$("pickAll").onclick = () => $("importAll").onclick();
// Install: the phone's own install prompt. Uninstall: no app can remove itself, so Partner shows and says the steps.
$("permInstall").querySelectorAll('input[type="radio"]').forEach((radio) => (radio.onchange = async () => {
  if (radio.value === "install") {
    if (IS_IOS && !IS_STANDALONE) await iosInstallHelp();
    else if (installPrompt) { installPrompt.prompt(); const c = await installPrompt.userChoice; if (c.outcome === "accepted") save("bolo.installed", true); installPrompt = null; }
    else toast(tr("installHelp"));
  } else {
    await uninstallPartner();
  }
  setTimeout(renderSetup, 400);
}));
document.querySelectorAll("[data-setlang]").forEach((b) => (b.onclick = async () => { await setLanguage(b.dataset.setlang); renderSetup(); }));
$("setupDone").onclick = () => {
  save("bolo.setupDone", true);
  $("setup").classList.add("hidden");
  showTab("home");
  if (handsFree) { startHandsFree(); speak(tr("hfHint"), state.lang); }
};
$("openSetup").onclick = openSetup;
$("settingsBtn").onclick = (e) => { e.stopPropagation(); showTab("settings"); $("features").classList.add("hidden"); openSetup(); };

// ---------- Features page and bottom navigation ----------
const FEATURE_ICONS = ["📞", "💬", "🎂", "⏰", "📸", "▶️", "🛡️", "🆘", "🌐", "💻"];
function renderFeatures() {
  $("featureList").innerHTML = "";
  FEATURE_ICONS.forEach((icon, i) => {
    const n = i + 1;
    const card = el(`<div class="fcard"><h3><span>${icon}</span>${esc(tr("f" + n + "t"))}</h3><p>${esc(tr("f" + n + "d"))}</p><button>${esc(tr("tryIt", { x: tr("f" + n + "e") }))}</button></div>`);
    card.querySelector("button").onclick = () => { showTab("home"); handleUtterance(tr("f" + n + "e")); };
    $("featureList").appendChild(card);
  });
}
function showTab(name) {
  $("features").classList.toggle("hidden", name !== "features");
  if (name === "features") renderFeatures();
  if (name === "home") ["setup", "family"].forEach((id) => $(id).classList.add("hidden"));
  ["tabHome", "tabFeatures", "settingsBtn"].forEach((id) => $(id).classList.remove("on"));
  $({ home: "tabHome", features: "tabFeatures", settings: "settingsBtn" }[name]).classList.add("on");
}
$("tabHome").onclick = () => showTab("home");
$("tabFeatures").onclick = () => showTab("features");
$("featuresBack").onclick = () => showTab("home");

// ---------- Yes / No pop-up: answer by tap or by voice ----------
function askYesNo(icon, title, question) {
  return new Promise((resolve) => {
    $("askIcon").textContent = icon; $("askTitle").textContent = title; $("askText").textContent = question;
    $("ask").classList.remove("hidden");
    const done = (yes) => { $("ask").classList.add("hidden"); if (state.pending?.kind === "ask") state.pending = null; speechSynthesis.cancel(); resolve(yes); };
    $("askYes").onclick = (e) => { e.stopPropagation(); done(true); };
    $("askNo").onclick = (e) => { e.stopPropagation(); done(false); };
    state.pending = { kind: "ask", done };
    speak(question, state.lang).then(() => { if (state.pending?.kind === "ask") listen(); });
  });
}
// Information pop-up with a single OK button, also read aloud.
function showInfo(icon, title, text) {
  return new Promise((resolve) => {
    $("askIcon").textContent = icon; $("askTitle").textContent = title; $("askText").textContent = text;
    $("askNo").classList.add("hidden");
    $("askYes").textContent = tr("ok");
    $("ask").classList.remove("hidden");
    $("askYes").onclick = (e) => {
      e.stopPropagation();
      $("ask").classList.add("hidden"); $("askNo").classList.remove("hidden"); $("askYes").textContent = tr("yes");
      speechSynthesis.cancel(); resolve();
    };
    speak(text, state.lang);
  });
}
// Install on iPhone: Safari has no install button, so show and read the Share -> Add to Home Screen steps.
function iosInstallHelp() { return showInfo("📲", tr("iosInstallTitle"), tr("iosInstall")); }

// Uninstall: ask first, then open Android's own uninstall screen (Android always asks for its final OK).
async function uninstallPartner() {
  if (!(await askYesNo("🗑️", tr("uninstallTitle"), tr("uninstallAsk")))) { speak(tr("cancelText"), state.lang); return; }
  save("bolo.installed", false);
  if (IS_IOS) { showInfo("🗑️", tr("uninstallTitle"), tr("iosUninstall")); return; }
  if (!/android/i.test(navigator.userAgent)) { toast(tr("uninstallHelp")); speak(tr("uninstallHelp"), state.lang); return; }
  await speak(tr("uninstallGo"), state.lang);
  window.location.href = "intent:#Intent;action=android.settings.MANAGE_APPLICATIONS_SETTINGS;end";
}

// ---------- going back: the ← Back buttons and the phone's own Back button return to Home ----------
const SCREENS = ["setup", "family", "readBox", "features", "confirm", "cam", "ask"];
function backToHome() {
  if (!$("cam").classList.contains("hidden")) { stopCamera(); if (state.pending?.kind === "photo") state.pending = null; startHandsFree(); }
  SCREENS.forEach((id) => $(id).classList.add("hidden"));
  speechSynthesis.cancel();
  showTab("home");
}
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); backToHome(); }));
// Each time a screen opens, add a history step, so the phone's Back button closes it instead of leaving Partner.
new MutationObserver(() => {
  const open = SCREENS.some((id) => !$(id).classList.contains("hidden"));
  if (open && !history.state?.screen) history.pushState({ screen: true }, "");
  if (!open && history.state?.screen) history.back();
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
window.addEventListener("popstate", () => {
  if (SCREENS.some((id) => !$(id).classList.contains("hidden"))) backToHome();
});

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
// Microphone already allowed (and not switched off by the user) -> always listening for "Partner" from the start.
permState("microphone").then((st) => {
  if (st === "granted" && Recognition && !handsFree && state.settings.listen !== false && !IS_IOS) {
    handsFree = true; save("bolo.handsfree", true); renderHandsFree(); startHandsFree();
  }
});
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
// Always run the newest Partner: compare with the live version and, if this copy is old,
// clear the saved copy and reload once.
const APP_VERSION = "2026.10.24-18";
fetch("version.json", { cache: "no-store" }).then((r) => r.json()).then(async ({ version }) => {
  if (!version || version === APP_VERSION || sessionStorage.getItem("bolo.reloadedFor") === version) return;
  sessionStorage.setItem("bolo.reloadedFor", version);
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* no cache storage */ }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* no service worker */ }
  location.reload();
}).catch(() => { /* offline: keep this copy */ });

// Installed apps update themselves: check for a new version on every open and switch to it right away.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => reg.update()).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded || state.busy) return; // first install: nothing to reload
    reloaded = true;
    location.reload();
  });
}
keepAwake();

// Direct link to the family screen: open Partner with #family
if (location.hash === "#family") $("btnFamily").click();

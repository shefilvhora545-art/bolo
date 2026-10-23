# Partner – a voice assistant for people who can't use a smartphone screen

**Partner** is a voice assistant you call like a friend – a simulated **Alexa+** experience for elders, people who cannot read and people with weak eyesight. They don't tap through apps; they just talk, in **Gujarati, Hindi, English** or 18 other languages, and Partner does the job.

> 🎬 **Demo video:** https://www.youtube.com/watch?v=tN2GZXQRiMg
> 🔗 **Live demo:** https://partner-voice-assistant.vercel.app (open in Google Chrome, allow the microphone)
> Built for the **Build, Ship, Shape: Amazon Developer Hackathon 2026** – Alexa+ track (simulated Alexa+ experience) + Open Source mini challenge.

## The problem
Hundreds of millions of people in India own a smartphone but cannot really *use* it: the screen is in English, the text is small, and every task needs many taps. Normal assistants also don't understand how Indian families talk – *"mara Anish kaka ne call lagav"* ("call my Anish uncle") means nothing to them when there are two Anish uncles, one in Nadiad and one in Ahmedabad.

## What Partner does
| You say | Partner does |
|---|---|
| "મારા અનીશ કાકા ને કોલ લગાવ" | Finds **two** Anish kakas and asks *"Nadiad vala ke Ahmedabad vala?"*, then calls the right one – and **remembers** your choice next time |
| "Shad bhai ne call kar" | Only one Shad → calls straight away |
| "Tomorrow is my sister Priya's birthday, send her a wish at 12 AM" | Writes a warm wish, reads it back, asks *"Yes or no?"*, and at exactly 12:00 AM asks once more and sends it on WhatsApp |
| "रमेश मामा को व्हाट्सएप करो कि मैं 5 बजे आऊंगा" | Writes the WhatsApp, asks *"हाँ या ना?"*, opens WhatsApp with the text typed |
| "Write an email to … that I'm on leave tomorrow" | Writes a formal email, reads the summary aloud, opens the mail app ready to send |
| "Remind me at 8 to take medicine **and** call Shad bhai" | Does **both** tasks from one sentence |
| "Read this message – is it a fraud?" | Reads an SMS aloud in simple Gujarati/Hindi and warns: *"This is a fraud, don't share OTP"* |
| "मदद! मैं गिर गई हूँ" | **SOS** – calls the emergency contact immediately and prepares a WhatsApp with the live location |
| "Make me a calculator website" | Code mode: writes the code, shows a live preview, copy/download |
| "Open my front camera and take a selfie" | Opens the camera, counts down aloud, takes and saves the photo, offers Share |
| "Open YouTube and play Sholay movie" / "way to Nadiad station" / "install PhonePe" | Opens YouTube, Maps directions, Play Store (also YouTube Music, Google, News, Netflix, Prime Video, Gmail…) |
| "Turn on my Bluetooth" | Opens the phone's Bluetooth settings (Android) – one tap to switch it on |

### Works like a real app
- **First-run setup** – choose a language and allow microphone, notifications, contacts and location, like any phone app.
- **Install to the home screen** – long-press the icon for **Talk** and **SOS** shortcuts.
- **Whole-screen language switch** – Gujarati, Hindi and English built in; 18 more languages translated once by Claude and saved on the phone.
- **Follow-up listening** – after each task Partner keeps listening for 8 seconds, so the next command needs no wake word.
- **Spoken corrections** – "no, the email is …" fixes only that detail; spoken email addresses are rebuilt automatically.

### Designed for people who can't use a screen
- **Hands-free mode** – say *"Partner, …"* (or *"Hey Partner"*); no tapping at all. When Partner asks a question, just answer.
- **Tap anywhere to talk** – the whole screen is one big button; everything is spoken back; the phone vibrates.
- **Smart safety** – easy tasks just happen; sending a message waits for a spoken *"ha / yes"*; hard tasks (scheduled messages, unknown email addresses) get a full read-back first; SOS never waits. The app enforces these rules itself, whatever the AI says.
- **Understands Indian family words** – kaka, kaki, mama, mami, fai, masi, dada, ba, bhai, ben, chacha, bua, mausi… plus "Nadiad vala" (the one from Nadiad).
- **Learns** – remembers which relative you mean, facts you tell it, birthdays (and proactively offers: *"Tomorrow is Rahul's birthday – wish at 12 AM?"*).
- **20+ languages** – replies in the language you speak.

## How it works
```
Phone browser (Chrome)                         Vercel serverless function
┌──────────────────────────────┐   sentence   ┌──────────────────────────────┐
│ Web Speech API (voice in/out)│ ───────────► │ /api/agent                   │
│ Contacts + memory (on device)│              │  Claude (claude-opus-5-5)    │
│ Safety rules, reminders,     │ ◄─────────── │  or Gemini (free fallback)   │
│ scheduler, actions           │  JSON action │  → reply + one action (JSON) │
└──────────────────────────────┘              └──────────────────────────────┘
        │ tel: / WhatsApp / mailto: / sms:
        ▼
   Phone apps (one confirming tap where the phone requires it)
```
- The AI returns **structured JSON** (`reply`, `action`, `contact_id`, `message_text`, `schedule_at`, `follow_up`, `learn_note`, …), so every answer becomes a real phone action.
- **Contacts and memory stay on the user's phone** (browser storage); only the current request is sent to the AI.
- On a Windows PC with WhatsApp Desktop, the local server can send a confirmed WhatsApp message by itself.

## Run it yourself
Requirements: Node.js 20.12+ and a Claude API key (or a free Gemini key for testing).
```bash
git clone https://github.com/shefilvhora545-art/partner-voice-assistant.git
cd partner-voice-assistant
npm install
cp .env.example .env      # paste ANTHROPIC_API_KEY (and/or GEMINI_API_KEY)
npm start                 # open http://localhost:3000 in Google Chrome
```
Deploy: `vercel deploy --prod` and add the same key(s) as Vercel environment variables.

## Tech
Vanilla HTML/CSS/JS (no framework), Web Speech API, Screen Wake Lock API, Node.js, Vercel serverless functions, Anthropic SDK (`@anthropic-ai/sdk`, structured JSON output) with Google Gemini as a free fallback.

## Honest limits
- A website can't press the final **Call/Send** button inside another app or unlock the phone – the phone requires one tap there (on a PC with WhatsApp Desktop, Partner can send by itself).
- Scheduled messages need Partner open (the screen is kept awake in night mode).
- Voice recognition quality depends on Chrome's speech engine; Gujarati works best on Android.

## License
[MIT](LICENSE) © 2026 Shefil Vhora

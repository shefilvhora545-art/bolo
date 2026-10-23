# Devpost submission – copy & paste

## Project name
Bolo – a voice assistant for people who can't use a smartphone screen

## Elevator pitch (one line)
An Alexa+-style voice assistant that lets elders and people who can't read use their phone just by speaking Gujarati, Hindi or English – it calls the right relative, sends wishes at midnight, spots scam SMS and calls for help.

## Track / mini challenges
- Primary track: **Alexa+** (simulated Alexa+ experience)
- Mini challenge: **Open Source**

## Try it out (links)
- Live app: https://bolo-voice-assistant.vercel.app
- Code: https://github.com/shefilvhora545-art/bolo

## Built with
javascript, html5, css3, node.js, vercel, web-speech-api, claude-api, anthropic-sdk, gemini-api, screen-wake-lock-api

---

## Project description (About the project)

### Inspiration
In my family, elders own smartphones but can't really use them. The screen is in English, the text is small, and calling *"Anish kaka"* means scrolling through contacts – and we have two Anish kakas, one in Nadiad and one in Ahmedabad. Voice assistants don't understand how Indian families talk ("mara kaka", "Nadiad vala") and they never ask before doing something risky. Meanwhile elders are the main targets of KYC and "digital arrest" scam messages. I wanted an Alexa+-style assistant that works for people who **cannot use the screen at all**.

### What it does
Bolo is a voice-first assistant in **Gujarati, Hindi, English and 18 more languages**. You tap anywhere – or turn on **hands-free** and just say *"Bolo, …"* – and talk:
- **Calls the right person:** "મારા અનીશ કાકા ને કોલ લગાવ" → *"There are two Anish kakas – Nadiad or Ahmedabad?"* → calls the right one, and **learns** the choice for next time. It understands Indian family words (kaka, mama, fai, masi, bhai, ben, chacha, bua…) and places ("Nadiad vala").
- **Messages & email by voice:** writes WhatsApp/SMS messages and formal emails, reads them back and waits for a spoken *"ha / yes"*.
- **Midnight birthday wishes:** "Tomorrow is my sister's birthday, wish her at 12 AM" → writes a warm wish, schedules it, and at exactly 00:00 asks once more and sends it on WhatsApp. It also reminds you proactively: *"Tomorrow is Rahul's birthday – shall I schedule a wish?"*
- **Many tasks in one sentence:** "Remind me at 8 to take my medicine and call Shad bhai" does both, in a safe order.
- **Scam shield:** reads any SMS aloud in simple language and warns *"This is a fraud – don't click, don't share OTP"*.
- **SOS:** "मदद! मैं गिर गई हूँ" immediately calls the emergency contact and prepares a WhatsApp with the live location.
- **Memory & reminders:** remembers facts, birthdays and preferences; speaks reminders aloud.
- **Code mode:** "make me a calculator website" → working code with a live preview.

**Smart safety:** easy tasks just happen; anything that sends a message waits for a spoken "yes"; hard tasks (scheduled messages, unknown email addresses, several recipients) get a full read-back; SOS never waits. These rules are enforced by the app itself, not only by the AI.

### How I built it
- **Front end:** vanilla HTML/CSS/JS, designed for no-screen use: the whole screen is one talk button, everything is spoken back (Web Speech API), vibration feedback, and a big "tap anywhere" screen only when the phone requires a tap. An Echo-style light ring shows listening / thinking / speaking.
- **Brain:** a Vercel serverless function sends the sentence plus the user's contacts, memory, time and safety mode to the AI and gets back **structured JSON** (reply, action, contact, message, schedule time, follow-up task, learned preference). Bolo supports Claude (`claude-opus-5-5` via the Anthropic SDK) as the main model and a free Google Gemini key as an automatic fallback, so it never stops answering. The live demo runs on Claude; if Claude is ever unavailable, the same request automatically goes to Gemini. I built the whole project with Claude Code as my coding partner.
- **Actions:** `tel:`, WhatsApp, `mailto:`, `sms:` links, an on-device scheduler with Screen Wake Lock for midnight messages, and a local PC helper that sends a confirmed WhatsApp through WhatsApp Desktop by itself.
- **Privacy:** contacts and memory stay in the user's browser; only the current request goes to the AI.

### Challenges I ran into
- I planned the Fire TV track first, but the Vega SDK and Vega Virtual Device don't support Windows or WSL, so I moved to the Alexa+ track with a simulated Alexa+ experience.
- Mobile browsers block opening other apps without a fresh tap, so I built a "try automatically, otherwise one full-screen tap" flow.
- Getting reliable JSON from the free model (it sometimes echoed the schema or repeated the object) – solved with a response schema, validation and model fallback.
- Vercel auto-detected my browser script as a Node server – fixed with explicit project settings.
- My first API credit payment looked declined, so I designed a provider switch: Claude when available, Gemini as an automatic fallback.

### Accomplishments that I'm proud of
- The *"which Anish kaka?"* moment works in Gujarati, Hindi and English – and Bolo remembers the answer.
- A complete flow from one spoken sentence to a real phone action, with safety confirmations that elders can answer by voice.
- Built, tested (17+ end-to-end voice commands) and deployed in one evening.

### What I learned
How to design for users who can't read a screen (spoken confirmations, one giant button, no menus), how to get structured actions from LLMs reliably, and how much Indian family language matters for real usability.

### What's next for Bolo
A native Android app with Accessibility permissions (truly hands-free sending, no final tap), an Alexa+ skill / MCP server so it runs on real Echo devices, more Indian languages, UPI payments with voice PIN safety, and a family dashboard so children can help their parents remotely.

---

## Product feedback (required)
**Which developer tools, APIs and SDKs did you use and for what?**
- Anthropic Claude API + `@anthropic-ai/sdk` (Node): main AI brain with structured JSON output (`output_config.format`).
- Google Gemini API (REST): free fallback model.
- Web Speech API (speech recognition + speech synthesis), Screen Wake Lock API.
- Vercel (hosting + serverless functions), GitHub.
- Amazon Vega SDK documentation (evaluated for the Fire TV track).

**What worked well?** The Alexa+ track's "simulated experience" option made it possible to build on Windows with any AI tool. Claude's structured outputs made it easy to turn speech into reliable actions. Web Speech API gives Gujarati and Hindi recognition for free in Chrome.

**What needs work?** The Vega SDK / Vega Virtual Device has no Windows or WSL support, which blocks many student developers (most use Windows). An official Alexa+ web simulator template would help. Paying for API credits with Indian cards was difficult.

**Onboarding experience (zero to hello world):** Alexa+ simulated path: fast (minutes). Fire TV path: blocked on Windows before hello world.

**Would you build with these devices and services again?** Yes – voice-first assistants are exactly what elders in India need, and I'd love to bring Bolo to real Echo devices next.

**Feature requests:**
1. Windows support for the Vega Virtual Device – Critical (most students in India use Windows).
2. Official Alexa+ web simulator template – Important.
3. Indian payment methods (UPI) for developer services – Nice-to-have.

## Friction log entries
See `FRICTION_LOG.md` in the repo: https://github.com/shefilvhora545-art/bolo/blob/main/FRICTION_LOG.md

## Open Source mini challenge
- Contribution URL / project repository URL: https://github.com/shefilvhora545-art/bolo
- GitHub username: shefilvhora545-art
- Description: Bolo is a new MIT-licensed open-source project created during the hackathon – a voice-first assistant for elders and people who can't read, with Indian-family-aware contact resolution, app-enforced safety confirmations and a provider-agnostic AI layer (Claude with Gemini fallback). Anyone can fork it and deploy their own in minutes.

---

# Demo video script (under 3 minutes)
Record on your **phone** (Android screen recorder with **microphone ON**) using the live link, or on the PC with **Win + Alt + R**. Speak clearly; keep it under 2:50.

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Bolo home screen | "Millions of elders in India own a smartphone but can't use it – the screen is in English and every task needs many taps. This is **Bolo** – an Alexa+-style voice assistant. They just speak." |
| 0:20–0:50 | Tap → say **"મારા અનીશ કાકા ને કોલ લગાવ"** → Bolo asks Nadiad or Ahmedabad → say **"નડિયાદ વાળા"** → dialer opens | "We have two Anish kakas. Bolo asks which one – and next time it remembers." |
| 0:50–1:20 | English: **"Tomorrow is my sister Priya's birthday, send her a wish at 12 AM"** → read-back → say **"Yes"** → scheduled card | "One sentence. Bolo writes the wish, reads it back, and at exactly midnight asks once more and sends it on WhatsApp." |
| 1:20–1:45 | Hindi: **"रमेश मामा को व्हाट्सएप करो कि मैं 5 बजे आऊंगा"** → "हाँ या ना?" → say **"हाँ"** | "Anything that sends a message waits for a spoken yes – safe for elders." |
| 1:45–2:10 | 📋 Read a message → paste the fake SBI KYC SMS → Bolo warns FRAUD | "Elders are the main targets of scam SMS. Bolo reads it aloud and warns them." |
| 2:10–2:30 | Turn on 🎙 Hands-free → say **"Bolo, remind me at 8 to take medicine and call Shad bhai"** | "Hands-free: no tapping at all – and two tasks from one sentence." |
| 2:30–2:50 | SOS button / closing screen with the GitHub link | "Bolo works in Gujarati, Hindi, English and 18 more languages, is built with Claude, and is open source. Bolo – just speak." |

Upload to **YouTube** (Visibility: **Public** or **Unlisted**, no copyrighted music) and paste the link in Devpost.

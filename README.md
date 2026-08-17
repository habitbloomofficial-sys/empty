# JARVIS

A personal AI assistant: a floating 3D orb, a voice, and a brain that can read
your email and send WhatsApp messages for you.

- **Brain** — OpenAI (chat + tool calling)
- **Voice** — ElevenLabs text-to-speech, played back with a live waveform driving the orb
- **Ears** — your browser's built-in speech recognition (Chrome/Edge)
- **Email** — Gmail, via your own Google OAuth app
- **WhatsApp** — Twilio's WhatsApp API
- **Interface** — Next.js + Tailwind + react-three-fiber, light-blue glass theme

## 1. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## 2. Configuration

All secrets live in `.env.local` (never committed — see `.gitignore`). Copy
`.env.example` if you're starting fresh:

```bash
cp .env.example .env.local
```

### OpenAI (required — this is JARVIS's brain)

Set `OPENAI_API_KEY`. Optionally set `OPENAI_MODEL` (defaults to `gpt-4o`).

### ElevenLabs (required for spoken replies)

Set `ELEVENLABS_API_KEY`. JARVIS defaults to the "Adam" premade voice; set
`ELEVENLABS_VOICE_ID` to use a different one (open Settings in the app, or
call `GET /api/voices`, to see the voices available on your account).

### Gmail (optional — lets JARVIS read/search/send email)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable the **Gmail API**, and configure an OAuth consent screen
   (External is fine; add yourself as a test user).
2. Create an **OAuth client ID** of type "Web application". Add
   `http://localhost:3000/api/gmail/callback` as an authorized redirect URI.
3. Put the client ID/secret in `.env.local` as `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`.
4. Start the app, open **Settings**, and click **Connect Gmail**. The
   resulting token is stored locally in `data/gmail-token.json` (gitignored)
   — it never leaves your machine.

### WhatsApp (optional — lets JARVIS send WhatsApp messages)

Easiest path is Twilio's WhatsApp sandbox:

1. Create a free [Twilio](https://www.twilio.com/) account and open the
   WhatsApp Sandbox under Messaging.
2. From your own WhatsApp, send the sandbox's "join <code>" message to the
   sandbox number to opt your number in.
3. Put your Account SID/Auth Token in `.env.local` as `TWILIO_ACCOUNT_SID` /
   `TWILIO_AUTH_TOKEN`, and the sandbox number as `TWILIO_WHATSAPP_FROM`
   (e.g. `whatsapp:+14155238886`).
4. Optionally set `TWILIO_WHATSAPP_TO_DEFAULT` to your own number so you can
   just say "text this to me" without specifying a number.

For production use beyond the sandbox, apply for the
[WhatsApp Business Platform](https://www.twilio.com/whatsapp) through Twilio
or Meta directly.

## 3. Using it

- Type in the input bar, or tap the mic and speak — JARVIS answers out loud
  and in the transcript panel (chat bubble icon, bottom right).
- Ask things like *"any new emails from Sarah?"*, *"draft a reply saying I'll
  be there at 6"*, or *"send Mom a WhatsApp saying I'm running late"*.
- JARVIS will show you exactly what it's about to send before sending
  anything, unless you've already dictated the exact wording.
- The Settings panel (gear icon, top right) shows what's connected and what
  still needs configuring.

## Architecture

```
src/
  app/
    api/
      chat/          OpenAI chat + tool-calling loop
      tts/            ElevenLabs text-to-speech
      voices/         list available ElevenLabs voices
      status/          which integrations are configured
      gmail/auth/       start Google OAuth
      gmail/callback/  finish Google OAuth, store token
      whatsapp/send/   direct WhatsApp send (used by the tool + testable directly)
    page.tsx, layout.tsx, globals.css
  components/         Orb (3D), chat UI, settings, top bar
  hooks/               speech recognition, TTS playback + amplitude analysis
  lib/                 OpenAI/ElevenLabs/Gmail/WhatsApp clients, tool definitions, system prompt
```

Security notes:

- No secret is ever sent to the browser — all provider calls happen in API
  route handlers on the server.
- `.env.local` and `data/` (the local Gmail token store) are gitignored.
- If any API key was ever pasted somewhere outside your own `.env.local`
  (a chat, a ticket, a screenshot), treat it as compromised and rotate it.

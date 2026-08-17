# JARVIS

A personal AI assistant: a floating 3D orb, a voice, and a brain that can read
your email and send WhatsApp messages for you.

- **Brain** — OpenAI or Gemini (chat + tool calling — pick either)
- **Voice** — ElevenLabs text-to-speech, played back with a live waveform driving the orb
- **Ears** — your voice, recorded in the browser and transcribed server-side
  (works in every browser), with the built-in Web Speech API as a fallback
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

**You don't have to edit any files.** Open the app, click the gear icon in the
top right, and paste your keys straight into the Settings panel. They're saved
to `data/settings.json` on your machine (gitignored, owner-readable only) and
take effect immediately — no server restart.

If you'd rather use environment variables, every setting can also live in
`.env.local` under the same name — copy `.env.example` to get started. Anything
you save in the Settings panel takes precedence over the matching env var.

### AI brain (required — pick OpenAI or Gemini, you only need one)

In **Settings → AI brain**, choose Gemini or OpenAI and paste the key.

**Gemini** is the easy option — get a free key at
[Google AI Studio](https://aistudio.google.com/apikey). JARVIS talks to it
through Google's OpenAI-compatible endpoint, so the same chat and tool-calling
code (email, WhatsApp) works unchanged on either provider.

Env equivalents: `GEMINI_API_KEY` / `OPENAI_API_KEY`, with optional
`GEMINI_MODEL` (default `gemini-2.5-flash`) and `OPENAI_MODEL` (default
`gpt-4o`). If both keys are set, `AI_PROVIDER=openai|gemini` breaks the tie.

### ElevenLabs (required for spoken replies — and recommended for the mic)

Paste your key in **Settings → ElevenLabs voice**. JARVIS defaults to the
"Adam" premade voice; set a different voice ID there (or call
`GET /api/voices`) to see what's on your account.

The same key also powers **speech-to-text**, which is how the microphone works
in browsers without the Web Speech API — and it auto-detects the language you
speak, so you don't have to match your browser's locale. An OpenAI key works
for this too (Whisper). Without either, JARVIS falls back to Chrome/Edge's
built-in recognition.

Env equivalents: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`.

### Gmail (optional — lets JARVIS read/search/send email)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable the **Gmail API**, and configure an OAuth consent screen
   (External is fine; add yourself as a test user).
2. Create an **OAuth client ID** of type "Web application". Add
   `http://localhost:3000/api/gmail/callback` as an authorized redirect URI.
3. Paste the client ID and secret into **Settings → Gmail** and click Save.
4. Click **Connect Gmail**. The resulting token is stored locally in
   `data/gmail-token.json` (gitignored) — it never leaves your machine.

Env equivalents: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`.

### WhatsApp (optional — lets JARVIS send WhatsApp messages)

Easiest path is Twilio's WhatsApp sandbox:

1. Create a free [Twilio](https://www.twilio.com/) account and open the
   WhatsApp Sandbox under Messaging.
2. From your own WhatsApp, send the sandbox's "join <code>" message to the
   sandbox number to opt your number in.
3. Paste your Account SID and Auth Token into **Settings → WhatsApp**, with the
   sandbox number as "Send from" (e.g. `whatsapp:+14155238886`).
4. Optionally set a default recipient — your own number — so you can just say
   "text this to me" without specifying a number.

Env equivalents: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO_DEFAULT`.

For production use beyond the sandbox, apply for the
[WhatsApp Business Platform](https://www.twilio.com/whatsapp) through Twilio
or Meta directly.

## 3. Using it

- Type in the input bar, or tap the mic and speak — the orb and the mic button
  pulse with your voice so you can see it's hearing you, and JARVIS sends
  automatically once you stop talking (tap the mic again to send immediately).
  He answers out loud and in the transcript panel (chat bubble icon, bottom
  right).
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
      chat/            AI chat + tool-calling loop (OpenAI or Gemini)
      tts/             ElevenLabs text-to-speech
      transcribe/      speech-to-text for recorded mic audio
      voices/          list available ElevenLabs voices
      status/          which integrations are configured
      settings/        read (masked) + save API keys from the Settings panel
      gmail/auth/      start Google OAuth
      gmail/callback/  finish Google OAuth, store token
      whatsapp/send/   direct WhatsApp send (used by the tool + testable directly)
    page.tsx, layout.tsx, globals.css
  components/          Orb (3D), chat UI, settings, top bar
  hooks/               voice input (record + transcribe), TTS playback + amplitude analysis
  lib/                 AI/ElevenLabs/Gmail/WhatsApp clients, settings store, tools, system prompt
```

Security notes:

- No secret is ever sent to the browser — all provider calls happen in API
  route handlers on the server, and `GET /api/settings` returns only a masked
  hint (`••••abcd`), never a full key.
- `.env.local` and `data/` (the settings store and Gmail token) are gitignored;
  `data/settings.json` is written owner-readable only (mode 0600).
- If any API key was ever pasted somewhere outside your own `.env.local`
  (a chat, a ticket, a screenshot), treat it as compromised and rotate it.

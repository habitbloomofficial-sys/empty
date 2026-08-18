# JARVIS

A personal AI assistant: a floating 3D orb, a voice, and a brain that can read
your email and send WhatsApp messages for you.

- **Brain** — OpenAI or Gemini (chat + tool calling — pick either)
- **Voice** — ElevenLabs text-to-speech, played back with a live waveform driving the orb
- **Ears** — your voice, recorded in the browser and transcribed server-side
  (works in every browser), with the built-in Web Speech API as a fallback
- **Email** — Gmail, via your own Google OAuth app
- **WhatsApp** — Twilio's WhatsApp API
- **Music** — opens the Spotify desktop app on your machine
- **Interface** — Next.js + Tailwind + react-three-fiber, light-blue glass theme

## 1. Install and run

```bash
npm install
npm run fast
```

Open http://localhost:3000.

`npm run fast` builds once and then serves — use it for everyday use. `npm run
dev` exists for editing code: it recompiles each page and route the first time
you hit it, which on Windows can add tens of seconds to your first request and
makes JARVIS feel far slower than he is.

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
`GEMINI_MODEL` and `OPENAI_MODEL` (default `gpt-4o`). If both keys are set,
`AI_PROVIDER=openai|gemini` breaks the tie.

Leave `GEMINI_MODEL` unset unless you want a specific model. Google retires
Gemini models on its own schedule and answers requests for a retired one with
a 404 naming its replacement — JARVIS reads that, switches to the named model,
and carries on, so an unset value keeps working without a code change. Pinning
a model opts out of that until you change it.

### ElevenLabs (required for spoken replies — and recommended for the mic)

Paste your key in **Settings → ElevenLabs voice**. JARVIS defaults to the
"Adam" premade voice; set a different voice ID there (or call
`GET /api/voices`) to see what's on your account.

The same key also powers **speech-to-text**. So does a Gemini or OpenAI key —
transcription tries each configured provider in turn, so any one working key
is enough to make the microphone work.

If ElevenLabs is unavailable, JARVIS speaks with the voice built into your
operating system instead. Less characterful, but never mute.

Env equivalents: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`.

**If ElevenLabs rejects a key you know is correct:** it's almost never the key
itself. ElevenLabs answers several different problems with the same 401, and
the usual culprit is a **restricted** key — one created with a hand-picked set
of permissions. Edit the key in ElevenLabs (profile → API Keys) and enable
Text to Speech, Speech to Text, and Voices, or give it access to all
endpoints. The other common causes are an account flagged for "unusual
activity" (free tier behind a VPN) and an exhausted monthly quota. JARVIS
names whichever one it is rather than blaming the key.

### Gmail (optional — lets JARVIS read/search/send email)

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project (any name).
2. **APIs & Services → Library**, search for **Gmail API**, and click Enable.
   Nothing works until this is done.
3. **APIs & Services → OAuth consent screen**. Choose **External**, fill in the
   app name and your own email, and under **Audience** add your own Gmail
   address as a **test user**. Leaving the app in Testing is fine and expected
   — Google only requires verification to publish an app to other people.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**. Under **Authorized redirect URIs**, add the exact
   URI shown in JARVIS's Settings → Gmail panel (there's a Copy button):
   `http://localhost:3000/api/gmail/callback`.
5. Copy the client ID and secret into **Settings → Gmail** in JARVIS and click
   **Save**, then **Connect Gmail** and accept every checkbox Google offers.

The token is stored in `data/gmail-token.json` (gitignored, mode 0600) and
never leaves your machine. If anything goes wrong, JARVIS shows Google's actual
reason rather than a generic failure — `redirect_uri_mismatch` means step 4
doesn't match character for character, and "app is blocked" or an access
warning usually means step 3's test user is missing.

**Declined a permission by mistake?** Scopes are fixed at consent time, so
granting one later means running the flow again: click **Disconnect**, then
**Connect Gmail**.

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

### Spotify (no setup needed)

Ask JARVIS to "open Spotify", or "put on some Bowie", and the desktop app opens
— with a search already run, if you named something. He opens the app and shows
results; pressing play is still yours. Playback control would need the Spotify
Web API and an account authorization, which this doesn't use.

This works because JARVIS runs on your own machine. What it can do is
deliberately tiny: open Spotify, optionally with a search. There is no general
"run a command" ability behind it, no shell is involved, and anything you say
is percent-encoded down to a known-safe alphabet before it reaches the
operating system. Turn it off in **Settings → Desktop apps** if you'd rather he
couldn't.

Env equivalent: `DESKTOP_CONTROL=off`.

## 3. Using it

- Type in the input bar, or tap the mic and speak — the orb and the mic button
  pulse with your voice so you can see it's hearing you, and JARVIS sends
  automatically once you stop talking (tap the mic again to send immediately).
  He answers out loud and in the transcript panel (chat bubble icon, bottom
  right).
- Ask things like *"any new emails from Sarah?"*, *"draft a reply saying I'll
  be there at 6"*, *"send Mom a WhatsApp saying I'm running late"*, or
  *"open Spotify"*.
- JARVIS will show you exactly what it's about to send before sending
  anything, unless you've already dictated the exact wording.
- The Settings panel (gear icon, top right) shows what's connected and what
  still needs configuring.

### If a reply feels slow

Each assistant message in the transcript carries a small breakdown — how long
he spent hearing you, thinking, running tools, and starting to speak. That
turns "it feels slow" into a stage you can point at.

What each stage responds to:

- **thought** — Gemini reasons before answering, which is wasted effort on
  conversational replies. JARVIS asks for low effort by default; set
  `GEMINI_REASONING_EFFORT` to `none` to remove it entirely, or `medium` /
  `high` if you'd rather have the deliberation.
- **spoke** — time until the first audio. ElevenLabs audio is streamed and
  played as it arrives rather than downloaded whole, and the default voice
  model is `eleven_flash_v2_5`. Set `ELEVENLABS_MODEL_ID=eleven_turbo_v2_5`
  for a richer voice at the cost of some latency.
- **anything, on the very first message** — you're probably on `npm run dev`.
  Use `npm run fast`.

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
      gmail/auth/       start Google OAuth
      gmail/callback/   finish Google OAuth, store token
      gmail/disconnect/ forget the stored Gmail token
      whatsapp/send/   direct WhatsApp send (used by the tool + testable directly)
    page.tsx, layout.tsx, globals.css
  components/          Orb (3D), chat UI, settings, top bar
  hooks/               voice input (record + transcribe), TTS playback + amplitude analysis
  lib/                 AI/ElevenLabs/Gmail/WhatsApp/desktop clients, settings store, tools, prompt
```

Security notes:

- No secret is ever sent to the browser — all provider calls happen in API
  route handlers on the server, and `GET /api/settings` returns only a masked
  hint (`••••abcd`), never a full key.
- The server binds to `127.0.0.1`, so nothing on your network can reach JARVIS
  — it answers only to the machine it runs on.
- Opening Spotify is the only desktop action that exists, it takes no path or
  command from the conversation, and it spawns no shell.
- `.env.local` and `data/` (the settings store and Gmail token) are gitignored;
  `data/settings.json` is written owner-readable only (mode 0600).
- If any API key was ever pasted somewhere outside your own `.env.local`
  (a chat, a ticket, a screenshot), treat it as compromised and rotate it.

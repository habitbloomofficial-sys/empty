# JARVIS

A personal AI assistant: a floating 3D orb, a voice, and a brain that can read
your email and send WhatsApp messages for you.

- **Brain** — Gemini, OpenRouter, or OpenAI (chat + tool calling — pick one)
- **Voice** — ElevenLabs text-to-speech, played back with a live waveform driving the orb
- **Ears** — say "Hey JARVIS" and he listens; your voice is recorded in the
  browser and transcribed server-side, so it works in every browser
- **Email** — Gmail, via your own Google OAuth app
- **WhatsApp** — Twilio's WhatsApp API
- **Music & web** — opens and closes Spotify and Discord, and opens any website
- **YouTube** — subscribers, views, and how your recent uploads are performing
- **Files** — finds things in your own folders and opens them
- **Hologram v3** — drop in a picture and see it projected as a rotating 3D hologram
- **Memory** — remembers things about you between sessions
- **Interface** — Next.js + Tailwind + react-three-fiber, light-blue glass theme

## 1. Install and run

Double-click **START-JARVIS.bat** (Windows) or run **./start-jarvis.sh** (macOS
and Linux). The first run installs what's needed and prepares the app; after
that it starts in a couple of seconds and opens your browser on its own.
Closing the window shuts JARVIS down.

Or, from a terminal:

```bash
npm install
npm run fast
```

Open http://localhost:3000.

`npm run fast` builds once and then serves — use it for everyday use. `npm run
dev` exists for editing code: it recompiles each page and route the first time
you hit it, which on Windows can add tens of seconds to your first request and
makes JARVIS feel far slower than he is.

### JARVIS is yours, and doesn't need anything to stay running

Nothing here calls Anthropic, and nothing here needs Claude, Claude Code, or
any subscription to them. Claude Code was the tool used to *write* this; it has
no part in *running* it. The whole thing is an ordinary Node.js app in a folder
on your computer, and it keeps working whether or not that tool is ever opened
again — check `package.json` if you want to see for yourself: the dependencies
are Next.js, React, three.js, the OpenAI SDK, googleapis, and Twilio. No
Anthropic anything.

What JARVIS does need is:

- **Node.js**, installed once from [nodejs.org](https://nodejs.org/en/download).
- **This folder**, wherever you keep it. Move it, back it up, copy it to another
  machine — it's self-contained.
- **Your own API keys**, which you already have. They live in `data/settings.json`
  inside this folder, on your computer only. That file is never committed to git
  and never leaves the machine.
- **An internet connection**, because Gemini, OpenRouter, ElevenLabs and Gmail
  are online services. Those are your accounts, billed to you, unrelated to any
  subscription used to build this.

**To start it without a terminal**, right-click `START-JARVIS.bat` → *Send to* →
*Desktop (create shortcut)*. Rename the shortcut to JARVIS, and give it an icon
via right-click → Properties → Change Icon if you like.

**To start it automatically when you log in**, press `Win`+`R`, type
`shell:startup`, press Enter, and drop a shortcut to `START-JARVIS.bat` into the
folder that opens.

**To keep it up to date**, run `git pull` and then double-click
`REBUILD-JARVIS.bat`. Your settings and memories live in `data/` and are left
alone by a rebuild. If you'd rather stop pulling changes entirely, that's fine
too — the copy you have keeps working exactly as it is.

## 2. Configuration

**You don't have to edit any files.** Open the app, click the gear icon in the
top right, and paste your keys straight into the Settings panel. They're saved
to `data/settings.json` on your machine (gitignored, owner-readable only) and
take effect immediately — no server restart.

If you'd rather use environment variables, every setting can also live in
`.env.local` under the same name — copy `.env.example` to get started. Anything
you save in the Settings panel takes precedence over the matching env var.

### AI brain (required — pick one of three, you only need one)

In **Settings → AI brain**, choose a provider and paste the key.

**Gemini** is the easy option — a free key from
[Google AI Studio](https://aistudio.google.com/apikey).

**OpenRouter** is the one to use if Gemini feels not quite sharp enough. One
key reaches most of the frontier models — Claude, GPT, Gemini Pro and the rest
— and you pick which from a dropdown. That list is fetched live from your own
account rather than written into this code, so it can't go stale, and it's
narrowed to models that can call tools, since JARVIS needs those to open apps
and read email. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).

**OpenAI** works directly too, with your own `sk-` key.

All three speak the same OpenAI-compatible protocol, so every feature works
identically whichever you choose.

Replies are capped at 2000 tokens. Left uncapped, providers assume the model's
own maximum — 16k on many OpenRouter models — and OpenRouter refuses a request
outright if your balance couldn't cover a reply that long, even when the actual
answer is one sentence. If it ever refuses anyway, JARVIS reads the figure it
says you can afford and asks again within it. Raise or lower the cap with
`MAX_TOKENS`.

Env equivalents: `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY`,
with optional `GEMINI_MODEL`, `OPENROUTER_MODEL` and `OPENAI_MODEL`. If several
keys are set, `AI_PROVIDER=openai|gemini|openrouter` breaks the tie.

Leave `GEMINI_MODEL` unset unless you want a specific model. Google retires
Gemini models on its own schedule and answers requests for a retired one with
a 404 naming its replacement — JARVIS reads that, switches to the named model,
and carries on, so an unset value keeps working without a code change. Pinning
a model opts out of that until you change it.

### ElevenLabs (required for spoken replies — and recommended for the mic)

Paste your key in **Settings → ElevenLabs voice**. The **Voice** dropdown
underneath lists the voices on your own account, fetched live, so there is no
id to type or get wrong — pick one and press **Hear it** to audition it before
saving. A voice the list doesn't know about can still be set by hand via
"Paste a voice ID instead…", which accepts a bare id, a share link, or a
copied `Voice ID: …` line.

**Using a voice from the ElevenLabs Voice Library.** A voice id is only a
name, not a licence — pasting one doesn't grant access to a voice your account
doesn't have. Open the voice in the Voice Library and click **Add to my
voices** first; it then appears in the dropdown and works like any other. Two
things can stop that: some library voices are restricted to paid plans and
can't be added on the free tier, and **every** generation spends characters
from your monthly quota whichever voice makes it — a free voice is not free to
speak. JARVIS says which of the two it hit rather than falling silent.

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

### Memory (no setup needed)

JARVIS keeps what he learns about you between sessions — names of people in
your life, preferences, how you like things done, ongoing projects. He saves
these himself as they come up, in one short sentence each, and they're included
in every conversation from then on. Ask him to forget something and he will.

**Settings → Memory** lists everything he's holding, with a Forget button on
each and a Forget everything below them.

It's kept in `data/memory.json` (gitignored, mode 0600) — plain sentences in a
file you can read, not embeddings in a database. Nothing leaves your machine,
and there's no account or API key involved. The store sits behind one module,
so a hosted memory service can be added later without touching anything else.

Two details worth knowing: restating a fact refreshes it rather than
duplicating it, and the better-written version is kept — speech arrives without
capitals, so "his sister is called maja" won't overwrite "His sister is called
Maja." The oldest, least-mentioned memories fall off first once there are 200.

### Hologram v3 (no setup needed)

A projector built into JARVIS. Say *"open Hologram v3"*, or click the pyramid
icon in the top bar, then drop a picture in — drag it, paste it, or browse for
it — and it's projected as a hologram you can drag to look around.

Three projections: **Particles** (suspended motes of light), **Volume** (solid
projected relief) and **Lattice** (a wireframe scan). Depth, resolution, glow,
and how much of the photograph's own colour survives are all adjustable, and
depth can be inverted for backlit shots.

The depth is *estimated from the picture itself* — lit surfaces are treated as
nearer, saturated colour as more likely to be the subject, and the frame's
centre as nearer than its corners, all smoothed so texture doesn't become
relief. It's an interpretation, not a measurement: a real depth model would
mean shipping hundreds of megabytes of weights, and this runs instantly on any
machine. Dark parts of a picture project as nothing at all, which is what lets
the subject float free of its background.

### Apps and websites (no setup needed)

JARVIS runs on your own machine, so he can open things on it:

- *"open Spotify"* / *"put on some Bowie"* — the desktop app, on a search if you
  named something. He opens it; pressing play is still yours. Actually starting
  playback would need the Spotify Web API and an account authorization, which
  this doesn't use.
- *"open Discord"*, *"close Spotify"*, *"quit Discord"* — Spotify and Discord can
  both be opened and closed. Closing asks politely first and then insists, since
  Discord treats a close as "minimise to tray".
- *"open YouTube"* / *"search YouTube for lo-fi beats"* — the site, or its search
  results.
- *"open bbc.co.uk"* — any ordinary website by name or address. Sites open in a
  browser window of their own rather than as another tab in whatever you had
  open; ask for a tab and you'll get one.
- *"look up how tall the Eiffel Tower is"* — a web search.

Named sites land on the right search page: youtube, google, maps, gmail, drive,
calendar, wikipedia, github, reddit, x, linkedin, netflix, imdb, amazon,
spotify, chatgpt, claude, dr, translate. Anything else works by address.

**What this can and can't do.** Open or close Spotify and Discord, and open an
ordinary `http`/`https` page. The apps are a fixed table — nothing from a
conversation ever becomes an executable path or a process name. No shell is ever spawned, arguments are passed as
an array rather than a command line, and search text is percent-encoded to a
known-safe alphabet first.

Addresses are parsed and checked before anything is opened. Non-web schemes are
refused outright — `file:` reads your disk, `javascript:` and `data:` execute in
the browser, and Windows resolves things like `ms-msdt:` and `search-ms:`
through registered handlers that have been used to run code. Links to your own
machine or local network are refused too, so nothing can be aimed at your
router's admin page or at JARVIS's own API.

One habit worth knowing about, since JARVIS reads your email: he is told to open
only sites *you* have asked for. A link inside an email is information to report
to you, never an instruction to follow — if a message tries to get him to visit
something, he should mention it rather than act on it.

Turn the whole capability off in **Settings → Apps & websites**.

Env equivalent: `DESKTOP_CONTROL=off`.

### YouTube (optional — lets JARVIS report on your channel)

Ask *"how's the channel doing?"*, *"how did my last video do?"*, or *"what's my
best upload this month?"* and he'll go and look.

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   and enable **YouTube Data API v3**. It's free — 10,000 units a day, and a
   full check-in costs about three.
2. **APIs & Services → Credentials → Create credentials → API key.**
3. If you set restrictions on the key, use **IP addresses** or none. An
   HTTP-referrer restriction will not work: JARVIS calls YouTube from your
   computer, not from a web page.
4. Paste it into **Settings → YouTube**, along with your channel — the @handle,
   the channel URL, or the channel ID, whichever you have. He confirms the
   channel by name so you can see he found the right one.

Already have a Gemini key? Leave the YouTube key blank and he'll try it. It
works if YouTube Data API v3 is enabled on the same Google project, and he says
so plainly if it isn't.

**What he can see:** subscribers, total views, video count, and per-video views,
likes and comments for recent uploads — the public numbers, the same ones on
your channel page. YouTube itself rounds subscriber counts above a thousand, so
he says when a figure is approximate. Watch time, impressions and click-through
are Analytics-API data that needs an owner login, and he doesn't have it.

Env equivalents: `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL`.

### Files (no setup needed)

Ask *"where's my tax return?"*, *"find the invoice from March"*, *"what did I
download yesterday?"* — and then *"open it"*.

He searches by the words in a file's name and reports the path, folder, size and
last-changed date of what he finds, best match first. Ties break towards the
file you touched most recently, which is almost always the one you meant. You
can narrow by folder (*"in Downloads"*) or by type (*"the PDF"*, *"that video"*).

**Where he can look.** Your Desktop, Documents, Downloads, Pictures, Videos and
Music, plus the OneDrive versions of those if OneDrive has taken them over. Add
more in **Settings → Files** — full paths separated by semicolons. Everything
outside that list is invisible to him: not filtered out of the results, never
visited.

**What this can and can't do.** It finds files and opens them; it does not read
what is inside them. A file can only be opened if it was found under one of the
folders above, so a path that came from anywhere else — including one the model
invented — is refused. Symlinks are never followed, which is the one way a
search that starts inside your Documents could otherwise end up somewhere else.
System and dependency folders (`node_modules`, `AppData`, `Windows`, dotfolders)
are skipped, and a search gives up after six seconds rather than grinding
through a whole disk — when it does, he tells you the answer may be incomplete
instead of claiming there's nothing there.

File search follows the same switch as apps and websites: turn off **Settings →
Apps & websites** and it goes with it.

Env equivalent: `FILE_SEARCH_ROOTS=D:\Projects;E:\Archive`.

## 3. Using it

- **He greets you when you open him**, alternating between two lines so it
  isn't the same every time. Browsers refuse to play audio until you've
  interacted with a page, so on a cold open he may ask you to click once
  first — after that the browser remembers and he just speaks.
- **Say "Hey JARVIS"** and he starts listening; no button needed. Say it with
  the request attached — *"Hey JARVIS, open YouTube"* — and he acts on it
  straight away rather than waiting for you to repeat yourself. The ear icon
  beside the microphone turns it off.
- Or type in the input bar, or tap the mic and speak — the orb and the mic button
  pulse with your voice so you can see it's hearing you, and JARVIS sends
  automatically once you stop talking (tap the mic again to send immediately).
  He answers out loud and in the transcript panel (chat bubble icon, bottom
  right).
- Ask things like *"any new emails from Sarah?"*, *"draft a reply saying I'll
  be there at 6"*, *"send Mom a WhatsApp saying I'm running late"*, or
  *"open Spotify"*, or *"search YouTube for lo-fi beats"*.
- JARVIS will show you exactly what it's about to send before sending
  anything, unless you've already dictated the exact wording.
- The Settings panel (gear icon, top right) shows what's connected and what
  still needs configuring.

### About the wake word

Listening for a name all day has to be cheap, so it uses the browser's own
speech recognition purely as a trigger — nothing of ours is uploaded, and it
costs nothing. Once woken, the accurate pipeline takes over and transcribes
what you actually said. It needs Chrome or Edge; elsewhere the microphone
button still works.

It's matched forgivingly on purpose. Across a room "hey JARVIS" comes back as
"hey Travis" or "hi Jervis" as often as not, so near-misses of the name count —
but only near the start of a sentence, so mentioning him mid-conversation
doesn't set him off. He also stops listening for his name while he's speaking,
so he can't wake himself.

### If a reply feels slow

Each assistant message in the transcript carries a small breakdown — how long
he spent hearing you, thinking, running tools, and starting to speak. That
turns "it feels slow" into a stage you can point at.

What each stage responds to:

Replies stream, so text appears as it's written and JARVIS starts speaking on
the first finished sentence rather than after the last one.

He also talks on a clock of his own rather than the model's. Nothing can be
spoken until the model produces its first token, and thinking produces none at
all — so if half a second passes in silence he says something himself, and says
something again if it drags on. And if a turn ends having done something but
said nothing, he reports the action in his own words rather than leaving it
silent. When he runs an
action, it shows in the transcript the moment it happens — the wait you see
after that is only the closing sentence being written.

- **thought** — Gemini reasons before answering, and all of it happens before a
  single token appears, so it is silence you sit through. JARVIS asks for none
  of it by default, since deciding to open Spotify needs no deliberation. Set
  `GEMINI_REASONING_EFFORT` to `low`, `medium` or `high` if you'd rather have
  considered answers than quick ones.
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
      models/          models available on your OpenRouter key, tool-capable only
      memory/          what JARVIS remembers about you, and forgetting it
      gmail/auth/       start Google OAuth
      gmail/callback/   finish Google OAuth, store token
      gmail/disconnect/ forget the stored Gmail token
      whatsapp/send/   direct WhatsApp send (used by the tool + testable directly)
    page.tsx, layout.tsx, globals.css
  components/          Orb (3D), Hologram v3 (3D), chat UI, settings, top bar
  hooks/               voice input (record + transcribe), TTS playback + amplitude analysis
  lib/                 AI/ElevenLabs/Gmail/WhatsApp/desktop clients, persistent memory,
                       depth estimation, speech chunking, settings store, tools, prompt
```

Security notes:

- No secret is ever sent to the browser — all provider calls happen in API
  route handlers on the server, and `GET /api/settings` returns only a masked
  hint (`••••abcd`), never a full key.
- The server binds to `127.0.0.1`, so nothing on your network can reach JARVIS
  — it answers only to the machine it runs on.
- Opening and closing Spotify and Discord, and opening an http(s) page, are the
  only desktop actions that exist. Which processes may be terminated is a fixed
  table in the code. No shell is spawned, no path or command comes from the conversation,
  and addresses are validated before use — non-web schemes (`file:`,
  `javascript:`, `data:`, Windows handlers like `ms-msdt:`) and anything on
  localhost or your local network are refused.
- `.env.local` and `data/` (settings, Gmail token, and memories) are gitignored;
  `data/settings.json` is written owner-readable only (mode 0600).
- If any API key was ever pasted somewhere outside your own `.env.local`
  (a chat, a ticket, a screenshot), treat it as compromised and rotate it.

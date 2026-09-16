# Jarvis — working notes

This is a Next.js 16 app (App Router, TypeScript, Tailwind v4) that runs a
personal assistant called Jarvis on the owner's own machine. **The owner is on
Windows.** There are macOS launchers in the repository from a spell on a
MacBook; leave them, but write new tooling for Windows first.

Useful commands:

```
npm run dev            # http://127.0.0.1:3000
npm run verify         # every file, of every kind — run this before pushing
npx tsc --noEmit       # types only
npx eslint             # lint only
npm run build          # what START-JARVIS.bat runs. Test THIS, not --turbopack.
```

`npm run verify` is the one that matters. TypeScript is two thirds of the files
and none of the ones that have actually broken: the launcher is a `.bat`, the
screen guide is Python, the phone is one enormous `.html`. It checks all of
them — parses, compiles, lints, and reads each for the mistakes its own
language makes — plus the batch traps that cannot be tested from Linux at all:
LF line endings, a `goto` with no label, and a variable set and read inside the
same parenthesised block.

Settings and secrets live in `data/` (gitignored). Documents Jarvis writes go to
`Documents/Jarvis/…`.

**One project per folder.** This repository has more than one branch in it —
Jarvis on `claude/jarvis-email-whatsapp-agent-ro2zrn`, and a B2B webshop on
`claude/b2b-webshop-access-code-vnlqfy`. They are different projects that
happen to share a remote. Working on both in the same folder leaves files from
one sitting in the other, and because `tsconfig` compiles everything under
`src/`, the stray files are type-checked as though they belonged — producing a
wall of "cannot find module" naming files this branch has never contained.
`npm run verify` now catches exactly that, and so does the launcher.

It happened again, worse: a whole second checkout at `empty\empty\`, with its
own `package.json` and its own `src/`. `tsconfig` compiled `**/*.ts`, so every
file in it was type-checked as part of Jarvis and the build died with fifty
`TS2307`s naming a project this branch has never contained. **`tsconfig` is now
scoped to `src/` plus `next.config.ts`**, so nothing outside `src/` can break
the build at all. Strays *inside* `src/` still can, which is what the stray
check is for.

---

## The launchers, and which copy is running

**He is called Jarvis.** He was Axis for a while; that name is gone from the
code, and the only places it survives are deliberate: the six `START-AXIS…`
forwarders, and `"axis"` in the wake-word alias list, because nobody unlearns a
name in a day. Note that `Axis` is ALSO the geometry type in `section.ts` and
`stress.ts` (`"x" | "y" | "z"`) — those two files were excluded from the rename
and must stay that way.

There are six real `.bat` files plus six forwarders under the old names.
`START-JARVIS.bat` is the one he uses;
`REBUILD-JARVIS.bat` is the big hammer; `START-JARVIS-PHONE.bat` and
`START-JARVIS-ANYWHERE.bat` serve him elsewhere; `CHECK-JARVIS.bat` answers a
question rather than doing anything; `FIX-JARVIS.bat` unsticks a blocked pull.

**Every one of them prints a version stamp**, and `npm run verify` fails if one
doesn't, or if they disagree with each other:

```
rem LAUNCHER VERSION 2026-09-01.3 - printed so it is obvious which copy is running.
echo   launcher 2026-09-01.3
```

Bump all twelve together when a launcher changes — the forwarders are stamped too.

This exists because of a day lost to a bug that was already fixed. The repaired
`REBUILD-JARVIS.bat` was on GitHub; the broken one was on his machine. He kept
quoting a sentence back that no longer existed in the pushed file, and neither
of us could see which copy he was running — so every symptom pointed at the fix
being wrong rather than absent. **When he reports a launcher misbehaving, the
first question is the stamp, not the symptom.** A pushed fix that hasn't been
pulled looks exactly like a fix that didn't work.

`CHECK-JARVIS.bat` is the whole answer on one screen: folder, branch, commit, how
many commits behind GitHub, the stamp in each launcher, stray files under
`src\`, a second project nested in the folder, and node/npm versions — written
to `data\last-check.log` so it can be sent rather than retyped. It reads and
reports; it installs nothing and changes nothing.

### The blocked pull

This is the one that cost the most days, so it is worth knowing by heart:

```
error: Your local changes to the following files would be overwritten by merge:
        package-lock.json
        package.json
Aborting
```

**When git says that, the pull does nothing.** Every fix stays on GitHub, the
broken copy stays in his folder, and rerunning the launcher reruns the same
broken copy. `npm` rewrites both files whenever it installs anything, so a
stray `npm install` is enough to cause it — he never edited them on purpose.

It is indistinguishable, from the outside, from a fix that didn't work. That is
what made it expensive: every symptom pointed at the code.

`FIX-JARVIS.bat` handles it — `git stash push` on just those two files, then
`git pull`. **Stash, never checkout:** his edits are kept and recoverable with
`git stash pop`, because throwing away work he didn't know he had is not a
repair. It shows the plan and waits for a keypress before touching anything.

`START-JARVIS.bat` and `REBUILD-JARVIS.bat` both test for this state now and stop
early, rather than spending five minutes rebuilding a copy that cannot be
fixed by rebuilding. `REBUILD-JARVIS.bat` also removes `node_modules` outright —
`npm install` alone will not repair an install that no longer matches the lock
file, which is what "could not find a declaration file for module X" means.

---

## What he can do to the computer

Three capabilities beyond opening one page at a time, all on the same
`DESKTOP_CONTROL` switch:

- **`open_tabs`** — several pages in ONE new window, one browser launch. Six
  pages come up in about a second. Calling `open_website` six times instead is
  slower and scatters them across six windows. Capped at 15.
- **Workspaces** — a named set of tabs, saved in `data/workspaces.json`.
  "Save these as my morning", then "open my morning". Name matching is
  deliberately loose: "my morning setup" finds `Morning`.
- **Window control** (`src/lib/windowControl.ts`) — focus by name, tile side by
  side or stacked, cascade, minimise all, restore all.

Two things are absent **by construction**, and `npm run verify` fails if either
comes back:

- **Nothing closes a window.** A window holds unsaved work, a wrong guess about
  which one he meant destroys it silently, and there is no undo. Opening and
  arranging are recoverable; closing is not.
- **Nothing writes to Shopify.** `src/lib/shopify.ts` has no mutation in it —
  no refund, no cancellation, no price change, no fulfilment. "Check my store"
  is what was asked for, and a mistake in a file with a write in it costs a
  customer's money. If he wants Jarvis to change the shop, that is a separate
  decision made out loud, not a capability that arrives quietly beside reading
  the order list.

Window titles come from web pages, emails and file names — attacker-shaped
text. They reach PowerShell through an **environment variable**, read back as
data, never interpolated into a script. `focus_window` matches in TypeScript
over a list PowerShell already returned, so the search text never enters a
shell at all.

### Shopify

`SHOPIFY_STORE` + `SHOPIFY_TOKEN` in Settings. The token is an Admin API access
token from a custom app (`shpat_…`), needing only `read_orders`,
`read_products`, `read_customers`. Only the `myshopify.com` host authenticates,
so `storeHost()` reduces whatever he pasted to that and **refuses a custom
domain** rather than guessing.

---

## Running the code, not just reading it

`scripts/behaviour.mjs`, check 15 of `npm run verify`.

Everything else in `verify` reads the code — tsc proves the types agree, eslint
the style, the build that it compiles — and **not one of them runs a line**.
Every bug that has actually reached him passed all three and then quietly did
the wrong thing: end caps facing inward, a torus inside out, a 34mm gap that
came out 38mm.

`scripts/tsresolve.mjs` lets plain `node` import the real `src/` modules
(extensionless imports, and the `@/` alias), so the suite tests the shipping
code rather than a copy of its logic.

**Add a case whenever something breaks in a way nothing caught**, and prove the
case fails before trusting it — two of the checks in there were written wrong
the first time and passed anyway.

**`systemPrompt.ts` is one enormous template literal.** A backtick anywhere in
added prose ends the string and the file stops parsing. Write tool names in
"double quotes", never in `backticks`. This has cost time twice.

---

## Teaching, plans, and the telephone

- **Exam and revision help gives the ANSWER.** Not a hint, not "what do you
  think" — he is an adult under time pressure. Answer in one line, then the
  rule that produces it, then the trap the question was built around. Work
  every step when it is worked; if he got it wrong, say *where* ("the sign
  flipped at line three"), not that it is wrong. Say plainly when uncertain —
  a confident wrong answer in revision gets learned and repeated in the exam.
- **A learning plan is a PDF**, made with `create_document` kind `guide`. Real
  numbered steps, one a day, each a specific thing to DO. A fortnight is
  fourteen entries; three bullets and "repeat daily" is not a plan.
- **`call_me_with_update`** rings his own phone, reads a message aloud twice,
  and hangs up — nothing is dialled afterwards. Only when he has asked to be
  told. It must say the answer itself, aloud, in sentences; a call announcing
  that an update exists has wasted the call. Capped at
  `MAX_SPOKEN_UPDATE` characters and shares the one-minute call cooldown.

## The PDF writer

`src/lib/pdf.ts`, **no dependency**. Not pride — every dependency has to survive
an `npm install` on his machine, and the last one that didn't cost a fortnight
of "Failed to type check" with the fix unreachable on GitHub. A PDF that needs
nothing installed works the moment he pulls.

It is less magic than it sounds: a PDF is objects, a table of their byte
offsets, and a trailer pointing at the table. The fourteen standard fonts need
no embedding. The only real work is the Helvetica width tables, which are what
let a line be measured before it is drawn.

Two things that broke and are now checked:

- **The xref offsets.** Every entry is a byte offset; one wrong and a reader
  opens nothing. `behaviour.mjs` re-derives them and follows each.
- **WinAnsi encoding.** The file is one byte per character, and an em dash is
  not latin1 — written naively it becomes a *hole in the sentence*, exactly
  where the sentence turns. Same for the bullet glyph. `escapePdf` maps them.

## A bug worth remembering

`create_document`'s dispatch copied `heading`, `paragraphs` and `bullets` out of
the model's arguments and stopped — while the schema declared `layout` and
`figures`, the prompt described them at length, and `documents.ts` read them.
They were chosen correctly and thrown away one line before use. **Every deck
came out as plain bullets and no chart was ever drawn**, which is the opposite
of what he asked for, and nothing said so.

The lesson generalises: a field is not wired up because it exists in the schema
and in the writer. Something has to carry it between them, and nothing type-
checks that gap — the dispatch built a fresh object literal, so the missing
fields were simply `undefined`, which is legal. `behaviour.mjs` now runs
`executeTool` end to end and reads the written file.

---

## Knowing when he is talking to you

`src/lib/addressed.ts`. The complaint was that saying "Hey Jarvis" before every
sentence is maddening; the failure mode on the other side is an assistant that
answers the television.

So the name is no longer a gate, it is one signal among several. What counts is
the **shape** of the sentence — an instruction, or a question aimed at a second
person — against the shapes that are plainly not for him: talking *about* him,
talking to someone else in the room, reported speech, a filler word, or a long
shapeless run of speech with no request in it.

The other half is that **a conversation stays open**. Within
`CONVERSATION_WINDOW_MS` of the last exchange the bar drops, which is what lets
"no, the other one" work without his name.

Three modes, in Settings: `name` (the old behaviour), `smart` (default), `open`
(answers the television sometimes). Standby always means name-only.

**The subtle one:** saying his name is not the same as speaking to him.
"Jarvis is really good at this" begins with the name and is a remark to someone
else — answering it is the most embarrassing thing an assistant can do, because
it proves it was listening and understood nothing. `isAboutHim()` looks at what
follows the linking verb: a pointing word (that/this/it/there) means a question
to him, anything else means a remark about him.

## Studying, rather than searching

`src/lib/research.ts`. One search is not research. Four things make the
difference, and each is a function worth reading:

- `queryVariants` — **several phrasings**, because one phrasing finds one
  corner of the web. At `deep` one variant deliberately hunts for criticism.
- `spreadAcrossSites` — **at most one page per domain** on the first pass. Five
  results from one site is one source wearing five hats, and they will agree
  with each other whether or not they are right.
- `relevantPassages` — **reads the pages**. A search snippet is written to be
  clicked.
- `findConflicts` — **reports disagreement rather than resolving it**. Picking
  one figure and stating it confidently is how a research tool launders a guess
  into a fact.

It does not write the answer. It numbers and quotes, and the model cites `[1]`.

## Engineering: what to change, not just whether it holds

**`src/lib/printing.ts` is the important one.** A printed part is a stack of
welded layers, and the weld is about **half** the strength of the plastic. The
same bracket holds roughly twice as much printed on edge as printed flat. Any
calculation that ignores this is wrong in the *dangerous* direction — the part
looks like it has a factor of two when it has one.

`stress.ts` now takes an `orientation`, and an unstated one is treated as the
common weak case rather than the best one. Two failure modes it also checks:

- **Shear at the root.** Bending stress falls as a part gets shorter; shear does
  not. A bending-only check therefore calls exactly the stubby parts safe that
  aren't.
- **An abrupt change of section.** Section analysis averages across each cut, so
  a shoulder reads as two safe sections with nothing wrong between them. Found
  geometrically, reported as a multiplier to respect — not applied silently,
  because the true figure depends on a fillet radius the mesh does not know.

`src/lib/engineer.ts` solves for the fix and ranks it **by what it costs him**:
free (turn it round in the slicer), cheap (thicker, more infill), costly (buy
aluminium). Thickness goes as the *square root* of the improvement wanted,
because the modulus goes as thickness squared.

## Acting unasked

`src/lib/initiative.ts` — **the most dangerous file here**, and not for a
security reason. A wrong action cannot be ignored: it has already opened the
tab, already interrupted, already been wrong out loud.

Every gate is set against acting: off by default, only for things matching
`interests.ts` above a bar a generic viral video cannot reach, only something
newer than `FRESH_HOURS`, at most once per `COOLDOWN_MS`, never the same thing
twice, never on standby, never mid-conversation. Opening a page takes a
markedly higher score than merely mentioning one.

And one rule that is not a gate: **whatever it does, it says**. An action taken
silently is indistinguishable from a bug.

`interests.ts` learns from what he asks for and opens, weighting two-word
phrases far above single words — "grand theft" matching is evidence, "trailer"
matching is not. Recency decays with a three-week half-life, so an old
enthusiasm fades instead of being brought up forever.

---

## Fast browser opening, and a typo tolerance

`src/lib/desktop.ts` used to rebuild the FULL candidate list — every path for
every browser it knows about — and re-scan the filesystem for each one, on
**every single page opened**: one site, one tab of a batch, one saved
workspace. `resolvedBrowser()` now resolves it once, keeps it in memory for the
life of the server, and backs it with `data/.browser-path.json` so a restart
isn't cold either. Self-healing both ways: a changed `BROWSER` setting is
caught by `forSetting` before the stale answer is used, and a cached browser
that got uninstalled or moved is caught by one `existsSync` and triggers an
immediate rescan. Proven in `behaviour.mjs` by mocking a Windows layout and
literally counting `fs.existsSync` calls — warm has to do fewer than cold.

`src/lib/stringMatch.ts` holds a shared edit-distance function, now upgraded to
treat **swapping two adjacent letters as one edit rather than two** — the
single most common way anyone actually mistypes a word ("gmial", "form" for
"from"). `findWebsite` in `websites.ts` uses it as a last-resort stage: "youtub",
"netlfix", "gmial" all land on the real site. Off by default for a URL passed
in as `url` — correcting the label on an address he actually typed would show
him the wrong site's name for a page that still opens exactly as given.

While testing that stage, found and fixed a small pre-existing bug in the
containment match above it: a short generic word ("the", "app") could be
swallowed as a substring of some long unrelated alias — "the" is literally
inside the squashed "discord in the browser". Fixed by requiring the candidate
be at least 4 letters before it's allowed to match by being *contained in*
something longer; a real short site name being *found inside* a longer sentence
("hbo" in "put hbo on") is a different, safe direction and was left alone.

---

## Who he is, and the jobs he does

**`src/lib/profile.ts` stores his BIRTH DATE and derives the age.** Writing
down "13" is writing down something that is wrong within a year and wrong
*silently* — he would be sixteen and be spoken to as a thirteen-year-old with
nothing anywhere to explain it. `age()` also refuses to count the birthday
before it happens, which is the one day a year it would be most embarrassing
to get wrong.

The facts he gave (born 2013-02-12, Christian, building a Shopify dropshipping
store, loves a side hustle, wants to learn engineering) are a **`SEED` in the
code**, not just a file in `data/`. `data/` is gitignored — correctly, it holds
his keys — so anything that only lives there does not survive a new machine or
a `git clean`. The seed is consulted only when no profile file exists, so
anything he corrects stays corrected.

**`src/lib/skills.ts` holds two different things on purpose:**

- **Briefs** — what a competent practitioner in a field already knows, shipped
  in code. Opinionated by design: *"the hook is the first two seconds and
  nearly all of your result is decided there"* is knowledge; *"test different
  creatives"* is filler. A `behaviour.mjs` check enforces a minimum length on
  every line precisely to keep slogans out.
- **Notes** — what *he* has said about *his* work in that field, plus running
  jokes, in `data/skills.json`, **filed by field**. One pile of remembered
  facts gets less useful as it grows; a pile per field gets more useful. His
  notes are appended *last* in `skillContext()` so they read as the override —
  he knows his supplier's shipping times and the brief does not.

The dropshipping brief carries one fact deliberately: Shopify and every payment
processor require the account holder to be a **legal adult**. That is what gets
stores closed and payouts frozen, and it is checked by a test so it cannot be
edited away by accident.

## The camera

`src/lib/vision.ts`, `/api/see`, `CameraPanel.tsx`, and the phone.

Three rules, and they are about whose camera it is rather than about code:

- **One frame, asked for.** Nothing opens a stream, watches, or runs on a
  timer. An assistant that can see continuously is a different and much larger
  thing than one that can be *shown* something.
- **Nothing is kept.** The frame goes to the model and is gone — never written
  to disk, never added to history. There is no folder of pictures of his room
  to leak, because there is no folder. Tested by asserting `vision.ts` contains
  no write call at all.
- **The stream is stopped on every exit path**, including `pagehide`. A
  `getUserMedia` stream left running keeps the camera light on after the window
  has gone, which is the thing that makes people tape over the lens.

The prompt forbids opening it for any reason he has not just asked for. The
**phone** uses `capture="environment"` — the native camera app — rather than a
custom preview: better quality, familiar, and it cannot leave a stream running.
`/api/see` needs no auth code of its own because `proxy.ts` already gates every
`/api/*` route when the request comes from the internet.

## Keys, and checking them

`verify.ts` checks a key against the real provider the moment it is pasted, and
`isVerifiableKey` decides which ones. **`checkHonchoKey()` existed and was wired
to nothing** — so a wrong Honcho key looked exactly like a working one until
someone noticed he had no long memory. It is now registered like every other
key and its result is shown on the Settings button.

The Honcho workspace ids still say `"axis"`. **They must keep saying it** —
they are identifiers, not labels, and everything Honcho has reasoned about over
months is filed under them. Renaming would silently start a second, empty
workspace and leave the real one unread, which looks exactly like an assistant
that has forgotten him.

## The Claude API, guarded

He runs on his own Claude API key, so `behaviour.mjs` now guards the request
shape directly. `budget_tokens` was **removed** on Opus 5 — it is a hard 400 on
every turn, not a deprecation warning — as are `temperature`, `top_p` and
`top_k`, and assistant prefill. The checks assert none of them appear in
`anthropicBrain.ts`, that `effort` sits inside `output_config`, that a
`refusal` stop reason is handled (it arrives as a normal 200 with nothing
useful in it), and that the model id is a real current one with no date suffix
— a dated id like `claude-opus-5-20260401` is a training-data habit and is not
a valid model.

---

## Screen guide

`screen-guide/guide.py` has two jobs:

```
python screen-guide/guide.py shot
python screen-guide/guide.py point 51.9 13.4 "Address bar"
```

`shot` captures the whole screen to `screen-guide/latest.png`. `point` takes an
x and a y **as percentages** plus a short label, draws a big red-orange arrow
with a white outline whose **tip lands exactly on that spot**, puts the label in
a dark pill near the tail, saves `screen-guide/pointed.png` and opens it.

### Standing rule — pointing at things

Whenever the owner asks **"where do I click to …"** or **"show me where … is"**,
or any question of that shape:

1. Run `shot`.
2. **Look at the screenshot with your own eyes** — actually read the image. Do
   not guess coordinates from memory of what the application usually looks like.
3. Find the exact control he means.
4. Run `point` with its coordinates and a **2–4 word label**.
5. Answer in **one short line**, like a butler: "Right there, sir."

Say the same line out loud with `voice.py say` (see Voice, below).

If you genuinely cannot find the control in the screenshot, say so in one line
and ask which window he means. A confident arrow pointing at the wrong thing is
worse than a question.

---

## Careful hands

Ground rules, and they are not negotiable:

- You drive only when I say "take over and ..." followed by a task.
- Before touching anything: take a screenshot, show me a short plan of 3-6
  steps, and wait for my "go".
- One step at a time: screenshot, look, act, then tell me what you did in one
  short line.
- The moment I type "stop", you stop with your hands in your lap.
- Hard refusals, no exceptions: anything involving payments, card or bank
  details, passwords, deleting files, or sending any message without showing me
  the exact text first.

### Notes on those rules

"Take over and …" is the only phrase that starts it. Not "could you", not "go
ahead", not a task described in the same message as something else. If the
phrase is absent, describe what you would do and stop.

"Stop" ends the current turn immediately: no finishing the click that was in
flight, no "just this last step". Acknowledge in one line and wait.

The hard refusals are about the whole action, not the words. Reading a password
field, clicking a "Pay now" button, emptying a Recycle Bin, hitting Send on a
message he has not read — all refused, whatever the phrasing, and refused in a
sentence rather than a lecture. Offer the nearest safe thing instead: fill the
message and leave it unsent, open the payment page and hand back the keyboard.

Two of these are enforced in code rather than only promised: `hands.py` has no
delete operation at all, and `type_text` refuses a string shaped like a card
number. That is a guard rail against the mistake, not a boundary against an
attacker — the judgement above is what actually holds.

### The tool

`screen-guide/hands.py`, driving Windows through `SendInput` in `user32.dll`.
Nothing to install and no permission dialog: it is part of Windows.

```
python screen-guide/hands.py where            # where the pointer is now
python screen-guide/hands.py move 51.9 13.4
python screen-guide/hands.py click 51.9 13.4
python screen-guide/hands.py double 5.0 8.4
python screen-guide/hands.py right 5.0 8.4
python screen-guide/hands.py type "Jarvis was here."
python screen-guide/hands.py key win
python screen-guide/hands.py key ctrl+n
python screen-guide/hands.py scroll -3
```

Coordinates are percentages, the same units `guide.py` uses, so a position read
off a screenshot goes straight into a click with nothing to convert.

Typing sends Unicode characters rather than key positions, so it is correct on a
Danish keyboard as well as a US one.

---

## Voice

`screen-guide/voice.py`, speaking through Windows SAPI.

```
python screen-guide/voice.py audition             # hear them, keep the best
python screen-guide/voice.py voices
python screen-guide/voice.py pick "Microsoft George"
python screen-guide/voice.py say "Right there, sir."
python screen-guide/voice.py quiet
python screen-guide/voice.py narrate
python screen-guide/voice.py status
```

### Standing rule — speaking

**Whenever you guide or drive, say each short line out loud** as well as
writing it:

```
python screen-guide/voice.py say "Clicking Compose, sir."
```

One sentence. Not the plan, not the explanation, not the caveat — the single
line you just wrote in the chat. "Right there, sir." "Clicking Compose, sir."
"Done — your note is saved, sir."

- **"quiet"** — work silently. Keep writing the short lines; stop speaking them.
- **"narrate"** — the voice comes back.

Quiet mode is remembered in `screen-guide/voice.json`, so it survives closing
the terminal. `voice.py say` checks it itself and stays silent when it should,
which means there is one place that decides and no way to forget.

---

## The assistant's own voice

Jarvis is an English butler: impeccably polite, unflappable, razor-witted. That
lives in `src/lib/systemPrompt.ts` and `src/lib/address.ts` (the `HUMOUR`
setting is the dial: `dry`, `playful`, `off`).

Three rules from that prompt are worth remembering when editing it:

- **"sir" occasionally, not every sentence.** Once a message is plenty.
- **One genuinely funny line beats three bland ones**, and no joke at all when
  something actually matters.
- **Never read the screen back to him.** One good sentence, then the facts he
  asked for.

The boot greeting is `bootGreeting()` in `src/lib/greeting.ts` — the time of day
and the **real** count of what he is holding. Never invent that number.

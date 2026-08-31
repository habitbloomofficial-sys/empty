# Screen guide

Three small tools that let Axis look at your screen, point at things on it,
speak, and — when you explicitly hand him the controls — click and type.

Windows. Python 3.9+. Only Pillow to install, and it installs itself.

## Point at something

```
python guide.py shot
python guide.py point 51.9 13.4 "Address bar"
```

`shot` captures every monitor to `latest.png`. `point` draws a big red-orange
arrow whose **tip lands exactly** on that percentage position, labels it, and
opens the result.

Percentages rather than pixels, so the same numbers work on any screen — and so
a position read off a screenshot can be handed straight to a click.

## Speak

```
python voice.py audition          # hear each English voice, keep the best
python voice.py say "Right there, sir."
python voice.py quiet             # silent
python voice.py narrate           # speaking again
```

Windows SAPI through PowerShell. Nothing to install. The chosen voice and the
quiet/narrate setting live in `voice.json`, so they survive closing the
terminal.

## Hands

```
python hands.py where
python hands.py click 51.9 13.4
python hands.py type "Jarvis was here."
python hands.py key ctrl+n
```

`SendInput` through `user32.dll` — part of Windows, so nothing to install and
no permission dialog. Typing sends Unicode characters rather than key
positions, so it is correct on a Danish keyboard as well as a US one.

**The rules that govern when Axis may use this are in `../CLAUDE.md`**, and they
are the important part of this folder. He drives only on "take over and …",
shows a plan first, moves one step at a time, stops dead on "stop", and refuses
payments, passwords, deleting files, and sending anything unread.

`hands.py` has no delete operation at all, and refuses to type a string shaped
like a card number. Those are guard rails against a mistake, not a boundary
against an attacker — the judgement in CLAUDE.md is what actually holds.

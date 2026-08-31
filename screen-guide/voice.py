#!/usr/bin/env python3
"""The voice: one short spoken line at a time, in a butler's accent.

    python voice.py voices              list the English voices on this machine
    python voice.py audition            say a line in each of them, in turn
    python voice.py pick "Microsoft George"
    python voice.py say "Right there, sir."
    python voice.py quiet               stop speaking
    python voice.py narrate             start again
    python voice.py status

macOS has `say`; Windows has SAPI, reached through PowerShell's
System.Speech.Synthesis. Same idea, different door. Nothing to install: the
assembly is part of .NET on every Windows since 7.

The chosen voice and whether to speak at all are kept in voice.json beside this
file, so "quiet" survives closing the terminal — a mute that forgets itself the
moment you look away is not a mute.
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "voice.json"
IS_WINDOWS = platform.system() == "Windows"

# Which installed voices sound most like a butler, best first. British male
# above British female above anything American, because that is the brief; a
# name not on this list still works, it simply is not preferred.
BUTLER_ORDER = [
    "george",    # Microsoft George — British male, the closest thing Windows has
    "ryan",      # Microsoft Ryan — British male, newer and cleaner
    "thomas",    # Microsoft Thomas — British male
    "oliver",
    "daniel",    # macOS British male, if this ever runs there
    "hazel",     # Microsoft Hazel — British female
    "susan",
    "sonia",
    "libby",
    "david",     # American male, a distant fallback
    "mark",
]

SAMPLE = "Good evening, sir. Dinner is served, and the wine has been decanted."


def read_state() -> dict:
    try:
        return json.loads(STATE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2), "utf-8")


def powershell(script: str, timeout: int = 60) -> subprocess.CompletedProcess:
    """Run a PowerShell snippet and hand back the result.

    -NoProfile because a user's profile can print a banner that would end up
    parsed as a voice name, and takes a second to load on top.
    """
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def list_voices() -> list[str]:
    """Every English voice installed on this machine."""
    if not IS_WINDOWS:
        if platform.system() == "Darwin":
            result = subprocess.run(["say", "-v", "?"], capture_output=True, text=True)
            return [
                line.split()[0]
                for line in result.stdout.splitlines()
                if re.search(r"\ben_", line)
            ]
        return []

    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.GetInstalledVoices() | "
        "Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en*' } | "
        "ForEach-Object { $_.VoiceInfo.Name }"
    )
    result = powershell(script)
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def most_butler_like(voices: list[str]) -> str | None:
    """Pick the one that sounds most like a butler.

    Ranked by name against a list that runs British male first. Anything not on
    the list still sorts after everything that is, so a machine with only
    unfamiliar voices still gets an answer rather than nothing.
    """
    if not voices:
        return None

    def rank(name: str) -> tuple[int, int, str]:
        lowered = name.lower()
        for index, wanted in enumerate(BUTLER_ORDER):
            if wanted in lowered:
                # A British voice that also says so in its name wins ties.
                return (0, index, lowered)
        british = 0 if ("gb" in lowered or "british" in lowered or "uk" in lowered) else 1
        return (1, british, lowered)

    return sorted(voices, key=rank)[0]


def chosen_voice() -> str | None:
    state = read_state()
    if state.get("voice"):
        return state["voice"]

    # Nothing picked yet: choose the best available and remember it, so the
    # first spoken line already sounds right.
    picked = most_butler_like(list_voices())
    if picked:
        state["voice"] = picked
        write_state(state)
    return picked


def speaking() -> bool:
    return read_state().get("speaking", True) is not False


def speak(text: str, voice: str | None = None, force: bool = False) -> bool:
    """Say one line. Returns False when nothing was said.

    Quiet mode is checked here rather than by every caller, so there is one
    place that decides and no way to forget.
    """
    if not force and not speaking():
        return False
    if not text.strip():
        return False

    name = voice or chosen_voice()
    if not IS_WINDOWS:
        if platform.system() == "Darwin":
            subprocess.run(["say"] + (["-v", name] if name else []) + [text], check=False)
            return True
        print(f'(no voice on {platform.system()}) {text}', file=sys.stderr)
        return False

    # Single-quoted PowerShell string with '' for a literal quote: this is the
    # one place text from a conversation reaches a shell, so it is escaped
    # rather than interpolated.
    safe = text.replace("'", "''")
    select = f"$s.SelectVoice('{name}'); " if name else ""
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"{select}"
        # A shade slower than default: a butler does not gabble.
        "$s.Rate = -1; "
        f"$s.Speak('{safe}')"
    )
    result = powershell(script, timeout=90)
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        return False
    return True


def audition() -> int:
    voices = list_voices()
    if not voices:
        print("No English voices found on this machine.", file=sys.stderr)
        return 1

    best = most_butler_like(voices)
    print(f"{len(voices)} English voices. Auditioning each, best guess first.\n")
    for name in sorted(voices, key=lambda v: (v != best, v)):
        marker = "  <- my pick" if name == best else ""
        print(f"  {name}{marker}")
        speak(SAMPLE, voice=name, force=True)

    state = read_state()
    state["voice"] = best
    write_state(state)
    print(f'\nUsing "{best}" from now on. Change it with: python voice.py pick "Some Voice"')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speak one short line, like a butler.")
    jobs = parser.add_subparsers(dest="job", required=True)

    jobs.add_parser("voices", help="list the English voices installed")
    jobs.add_parser("audition", help="hear each one, then keep the most butler-like")
    jobs.add_parser("quiet", help="stop speaking")
    jobs.add_parser("narrate", help="start speaking again")
    jobs.add_parser("status", help="which voice, and whether it is speaking")

    pick = jobs.add_parser("pick", help="use this voice from now on")
    pick.add_argument("voice")

    line = jobs.add_parser("say", help="say one line")
    line.add_argument("text")
    line.add_argument("--force", action="store_true", help="speak even in quiet mode")

    args = parser.parse_args(argv)

    if args.job == "voices":
        voices = list_voices()
        if not voices:
            print("No English voices found.", file=sys.stderr)
            return 1
        best = most_butler_like(voices)
        for name in voices:
            print(f"{name}{'  <- most butler-like' if name == best else ''}")
        return 0

    if args.job == "audition":
        return audition()

    if args.job == "pick":
        state = read_state()
        state["voice"] = args.voice
        write_state(state)
        print(f'Voice set to "{args.voice}".')
        speak("Very good, sir.", force=True)
        return 0

    if args.job in {"quiet", "narrate"}:
        state = read_state()
        state["speaking"] = args.job == "narrate"
        write_state(state)
        if args.job == "narrate":
            speak("Narrating again, sir.")
            print("Narrating.")
        else:
            print("Quiet.")
        return 0

    if args.job == "status":
        state = read_state()
        print(f"voice: {state.get('voice') or '(not chosen yet)'}")
        print(f"mode:  {'narrate' if speaking() else 'quiet'}")
        return 0

    if args.job == "say":
        said = speak(args.text, force=args.force)
        if not said and not args.force:
            print("(quiet mode — not spoken)")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Careful hands: move the mouse, click, and type, on Windows.

    python hands.py where
    python hands.py move 51.9 13.4
    python hands.py click 51.9 13.4
    python hands.py double 5.0 8.4
    python hands.py right 5.0 8.4
    python hands.py type "Jarvis was here."
    python hands.py key win
    python hands.py key ctrl+n
    python hands.py scroll -3

Coordinates are percentages of the screen, the same as guide.py, so a position
read off a screenshot can be handed straight to a click without converting
anything. That is the whole reason they match: the eye and the hand should use
one set of numbers.

WHY ctypes AND NOT A LIBRARY. This uses SendInput through user32.dll, which is
in Windows itself. Nothing to pip install, nothing to grant permission to, and
no third-party package sitting in the path between a language model and a
mouse. SendInput rather than the older mouse_event because it is the call that
still works against modern applications.

WHAT IT WILL NOT DO. The refusals in CLAUDE.md are the real ones and they are
about judgement, not syntax. But two of them can be enforced here rather than
merely promised, and are: this file has no way to delete anything, and typing
refuses a string that looks like a card number. That is not a security boundary
— anything driving this could type the digits one at a time — it is a guard
rail against the mistake, not against an attacker.
"""

from __future__ import annotations

import argparse
import ctypes
import platform
import re
import sys
import time
from ctypes import wintypes

IS_WINDOWS = platform.system() == "Windows"

if not IS_WINDOWS:
    # Imported for its argument parsing on other systems (the tests do this),
    # but nothing here will move a real mouse.
    user32 = None
else:
    user32 = ctypes.WinDLL("user32", use_last_error=True)


# --- the SendInput structures ------------------------------------------------
# Laid out to match Windows' own headers. Getting a field width wrong here does
# not fail loudly; it moves the mouse somewhere unexpected, which is worse.

ULONG_PTR = ctypes.POINTER(wintypes.ULONG)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", _INPUTunion)]


INPUT_MOUSE = 0
INPUT_KEYBOARD = 1

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_VIRTUALDESK = 0x4000

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79

# The keys worth naming. Anything not here can be typed as text instead.
KEYS = {
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B,
    "space": 0x20, "backspace": 0x08, "delete": 0x2E, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28, "left": 0x25,
    "right": 0x27, "win": 0x5B, "ctrl": 0x11, "control": 0x11, "alt": 0x12,
    "shift": 0x10, "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f5": 0x74,
    "f6": 0x75, "f11": 0x7A, "f12": 0x7B,
}
MODIFIERS = {"ctrl": 0x11, "control": 0x11, "alt": 0x12, "shift": 0x10, "win": 0x5B}


def require_windows() -> None:
    if not IS_WINDOWS:
        raise SystemExit(
            f"hands.py drives Windows, and this is {platform.system()}. "
            "Nothing was moved."
        )


def virtual_screen() -> tuple[int, int, int, int]:
    """The whole desktop across every monitor: left, top, width, height.

    The virtual desktop rather than the primary monitor, because a second
    screen to the left of the first has negative coordinates and a click aimed
    with the primary screen's origin lands on the wrong monitor.
    """
    require_windows()
    return (
        user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_CYVIRTUALSCREEN),
    )


def to_absolute(x_percent: float, y_percent: float) -> tuple[int, int]:
    """Percentages to the 0..65535 grid SendInput wants.

    Windows takes absolute mouse positions as a fraction of 65535 rather than
    in pixels, which is convenient here: percentages convert directly, and the
    result is the same whatever the resolution.
    """
    for name, value in (("x", x_percent), ("y", y_percent)):
        if not 0 <= value <= 100:
            raise SystemExit(f"{name} should be a percentage between 0 and 100, not {value}.")
    # 65535 maps to the far edge, so the last pixel is 65535 and not 65536.
    return round(x_percent / 100 * 65535), round(y_percent / 100 * 65535)


def send(*inputs: INPUT) -> None:
    require_windows()
    count = len(inputs)
    array = (INPUT * count)(*inputs)
    sent = user32.SendInput(count, ctypes.byref(array), ctypes.sizeof(INPUT))
    if sent != count:
        raise SystemExit(
            f"Windows accepted {sent} of {count} events "
            f"(error {ctypes.get_last_error()}). Nothing further was sent."
        )


def mouse_input(flags: int, x: int = 0, y: int = 0, data: int = 0) -> INPUT:
    return INPUT(
        type=INPUT_MOUSE,
        union=_INPUTunion(mi=MOUSEINPUT(dx=x, dy=y, mouseData=data, dwFlags=flags, time=0, dwExtraInfo=None)),
    )


def key_input(code: int, up: bool = False) -> INPUT:
    return INPUT(
        type=INPUT_KEYBOARD,
        union=_INPUTunion(ki=KEYBDINPUT(wVk=code, wScan=0, dwFlags=KEYEVENTF_KEYUP if up else 0, time=0, dwExtraInfo=None)),
    )


def char_input(character: str, up: bool = False) -> INPUT:
    """One character, by its Unicode value rather than by a key code.

    This is what makes typing work on any keyboard layout: sending the letter
    itself instead of "the key where Q is on a US keyboard", which on a Danish
    layout is a different letter entirely.
    """
    flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
    return INPUT(
        type=INPUT_KEYBOARD,
        union=_INPUTunion(ki=KEYBDINPUT(wVk=0, wScan=ord(character), dwFlags=flags, time=0, dwExtraInfo=None)),
    )


# --- the operations ----------------------------------------------------------


def move(x_percent: float, y_percent: float) -> None:
    x, y = to_absolute(x_percent, y_percent)
    send(mouse_input(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, x, y))


def click(x_percent: float | None = None, y_percent: float | None = None, button: str = "left", times: int = 1) -> None:
    if x_percent is not None and y_percent is not None:
        move(x_percent, y_percent)
        # A short settle before pressing: some applications track the pointer
        # and a click in the same instant as the move lands on what was under
        # the cursor before it moved.
        time.sleep(0.12)

    down = MOUSEEVENTF_RIGHTDOWN if button == "right" else MOUSEEVENTF_LEFTDOWN
    up = MOUSEEVENTF_RIGHTUP if button == "right" else MOUSEEVENTF_LEFTUP
    for i in range(times):
        send(mouse_input(down), mouse_input(up))
        if i + 1 < times:
            # Inside the double-click interval Windows expects.
            time.sleep(0.08)


def scroll(notches: int) -> None:
    send(mouse_input(MOUSEEVENTF_WHEEL, data=ctypes.c_int32(notches * 120).value & 0xFFFFFFFF))


# Sixteen or more digits with optional separators, which is what a card number
# looks like and almost nothing else does.
CARD_LIKE = re.compile(r"(?:\d[ -]?){15,}\d")


def looks_like_a_card(text: str) -> bool:
    return bool(CARD_LIKE.search(text))


def type_text(text: str, per_char: float = 0.012) -> None:
    """Type a string, one character at a time.

    Refuses anything shaped like a card number. That is a guard rail rather
    than a security boundary — nothing stops the digits being sent one call at
    a time — but the mistake it prevents is a real one and the cost of the
    check is nothing.
    """
    if looks_like_a_card(text):
        raise SystemExit(
            "That contains something shaped like a card number, and I don't type those. "
            "If it is genuinely not, break it up or type it yourself."
        )
    require_windows()
    for character in text:
        if character == "\n":
            send(key_input(KEYS["enter"]), key_input(KEYS["enter"], up=True))
        else:
            send(char_input(character), char_input(character, up=True))
        time.sleep(per_char)


def press(combination: str) -> None:
    """A key, or a combination like ctrl+n."""
    parts = [part.strip().lower() for part in combination.split("+") if part.strip()]
    if not parts:
        raise SystemExit("Which key, sir?")

    *modifier_names, key_name = parts
    for name in modifier_names:
        if name not in MODIFIERS:
            raise SystemExit(f'"{name}" is not a modifier I know. Try ctrl, alt, shift or win.')
    if key_name in KEYS:
        code = KEYS[key_name]
    elif len(key_name) == 1:
        # A letter or digit: its uppercase ASCII value is its virtual key code.
        code = ord(key_name.upper())
    else:
        raise SystemExit(f'I don\'t know a key called "{key_name}".')

    modifiers = [MODIFIERS[name] for name in modifier_names]
    require_windows()
    send(*[key_input(m) for m in modifiers], key_input(code))
    send(key_input(code, up=True), *[key_input(m, up=True) for m in reversed(modifiers)])


def where() -> str:
    """Where the pointer is now, as pixels and as a percentage."""
    require_windows()
    point = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(point))
    left, top, width, height = virtual_screen()
    x_percent = (point.x - left) / width * 100 if width else 0
    y_percent = (point.y - top) / height * 100 if height else 0
    return f"{point.x},{point.y} px  ({x_percent:.1f}%, {y_percent:.1f}%)  screen {width}x{height}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Move the mouse, click and type on Windows.")
    jobs = parser.add_subparsers(dest="job", required=True)

    for name, help_text in (
        ("move", "move the pointer"),
        ("click", "left click"),
        ("double", "double click"),
        ("right", "right click"),
    ):
        job = jobs.add_parser(name, help=help_text)
        job.add_argument("x", type=float, nargs="?", help="across, as a percentage")
        job.add_argument("y", type=float, nargs="?", help="down, as a percentage")

    typing = jobs.add_parser("type", help="type a string")
    typing.add_argument("text")

    keying = jobs.add_parser("key", help='a key or combination, like "ctrl+n"')
    keying.add_argument("combination")

    wheel = jobs.add_parser("scroll", help="wheel notches; negative is down")
    wheel.add_argument("notches", type=int)

    jobs.add_parser("where", help="where the pointer is now")

    args = parser.parse_args(argv)

    if args.job == "where":
        print(where())
    elif args.job == "move":
        move(args.x, args.y)
        print(f"Pointer at {args.x}%, {args.y}%.")
    elif args.job in {"click", "double", "right"}:
        click(args.x, args.y, button="right" if args.job == "right" else "left",
              times=2 if args.job == "double" else 1)
        print(f"{args.job.capitalize()} at {args.x}%, {args.y}%." if args.x is not None else f"{args.job.capitalize()}ed.")
    elif args.job == "type":
        type_text(args.text)
        print(f"Typed {len(args.text)} characters.")
    elif args.job == "key":
        press(args.combination)
        print(f"Pressed {args.combination}.")
    elif args.job == "scroll":
        scroll(args.notches)
        print(f"Scrolled {args.notches}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

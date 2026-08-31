#!/usr/bin/env python3
"""Screen guide: take a picture of the screen, and point at something on it.

Two jobs, one file.

    python guide.py shot
    python guide.py point 12.5 96.2 "Recycle Bin"

`shot` captures the whole screen to screen-guide/latest.png. `point` draws a
big red-orange arrow on that capture whose TIP lands exactly on the given
percentage position, puts a short label in a dark pill near the tail, saves it
as screen-guide/pointed.png, and opens it.

Why percentages rather than pixels: the person reading the screenshot and the
person drawing on it may be looking at different resolutions, and a percentage
survives that. It also means the arrow can be aimed straight off a description
of where something is in the frame.

Windows first, because that is what this machine is. macOS and Linux work too
where the same call exists — Pillow's ImageGrab covers Windows and macOS, and
Linux falls back to whatever screenshot tool is installed.

Standard library, plus Pillow. If Pillow is missing it is installed on first
run rather than being reported as an error, because "pip install Pillow" is not
a useful thing to be told by a tool that could simply do it.
"""

from __future__ import annotations

import argparse
import math
import os
import platform
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LATEST = HERE / "latest.png"
POINTED = HERE / "pointed.png"

# The arrow, in colours that survive any wallpaper. Red-orange reads as
# "look here" on light and dark alike, and the white outline is what keeps it
# visible against a red-orange button.
ARROW_FILL = (255, 78, 24)
ARROW_EDGE = (255, 255, 255)
PILL_FILL = (17, 20, 28)
PILL_TEXT = (255, 255, 255)


def ensure_pillow():
    """Import Pillow, installing it first if it is not there."""
    try:
        from PIL import Image, ImageDraw, ImageFont  # noqa: F401

        return
    except ImportError:
        pass

    print("Pillow isn't installed. Installing it now…", file=sys.stderr)
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "Pillow"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # A failed install is worth showing in full: it is nearly always a
        # missing pip or a locked-down Python, and both are fixable once seen.
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(
            "Couldn't install Pillow automatically. Try: "
            f'"{sys.executable}" -m pip install Pillow'
        )
    print("Pillow installed.", file=sys.stderr)


# --------------------------------------------------------------------------- shot


def capture(target: Path) -> Path:
    """Grab the whole screen, every monitor, to `target`."""
    ensure_pillow()
    from PIL import ImageGrab

    system = platform.system()
    try:
        # all_screens is Windows-only in Pillow and raises elsewhere, so it is
        # asked for rather than assumed.
        image = ImageGrab.grab(all_screens=True) if system == "Windows" else ImageGrab.grab()
    except TypeError:
        image = ImageGrab.grab()
    except OSError as error:
        if system == "Linux":
            raise SystemExit(
                "Couldn't capture the screen. On Linux, Pillow needs one of "
                "`gnome-screenshot`, `scrot` or `spectacle` installed."
            ) from error
        raise

    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    return target


# -------------------------------------------------------------------------- point


def load_font(size: int):
    """A readable font, whatever this machine happens to have."""
    from PIL import ImageFont

    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    # Better a small default than no label at all.
    return ImageFont.load_default()


def arrow_points(tip: tuple[float, float], tail: tuple[float, float], width: float):
    """The seven corners of an arrow from `tail` to `tip`.

    Built from the tip backwards, which is the whole point of the exercise: the
    tip is the thing that has to be exactly right, and everything else hangs
    off it.
    """
    tx, ty = tip
    ax, ay = tail

    dx, dy = tx - ax, ty - ay
    length = math.hypot(dx, dy) or 1.0
    # Unit vector along the shaft, and the one at right angles to it.
    ux, uy = dx / length, dy / length
    px, py = -uy, ux

    head_len = min(width * 2.6, length * 0.6)
    head_half = width * 1.55
    shaft_half = width * 0.44

    # Where the head meets the shaft.
    hx, hy = tx - ux * head_len, ty - uy * head_len

    return [
        (tx, ty),
        (hx + px * head_half, hy + py * head_half),
        (hx + px * shaft_half, hy + py * shaft_half),
        (ax + px * shaft_half, ay + py * shaft_half),
        (ax - px * shaft_half, ay - py * shaft_half),
        (hx - px * shaft_half, hy - py * shaft_half),
        (hx - px * head_half, hy - py * head_half),
    ]


def choose_tail(tip: tuple[float, float], size: tuple[int, int], reach: float):
    """Where the arrow comes from.

    It approaches from whichever side has the most room, so the arrow lies over
    empty screen rather than over the thing it is pointing at. Pointing at
    something in the top-left with an arrow that covers the top-left is a way of
    hiding the answer.
    """
    width, height = size
    tx, ty = tip
    dx = 1.0 if tx < width * 0.5 else -1.0
    dy = 1.0 if ty < height * 0.45 else -1.0

    # 35 degrees off horizontal: steep enough to look deliberate, shallow
    # enough that the label beside the tail stays on screen.
    ax = tx + dx * reach * math.cos(math.radians(35))
    ay = ty + dy * reach * math.sin(math.radians(35))

    # Keep the tail on the image, with room for the pill.
    ax = max(reach * 0.15, min(width - reach * 0.15, ax))
    ay = max(reach * 0.12, min(height - reach * 0.12, ay))
    return ax, ay


def point(x_percent: float, y_percent: float, label: str, source: Path, target: Path) -> Path:
    ensure_pillow()
    from PIL import Image, ImageDraw

    if not source.exists():
        raise SystemExit(f"There is no screenshot at {source}. Run `shot` first.")
    for name, value in (("x", x_percent), ("y", y_percent)):
        if not 0 <= value <= 100:
            raise SystemExit(f"{name} should be a percentage between 0 and 100, not {value}.")

    image = Image.open(source).convert("RGB")
    width, height = image.size
    draw = ImageDraw.Draw(image)

    # The tip. This is the number that matters; everything else is decoration.
    tip = (width * x_percent / 100.0, height * y_percent / 100.0)

    # Sized off the screen, so it looks the same on a laptop and a 4K monitor.
    scale = min(width, height)
    stroke = max(3, round(scale * 0.005))
    shaft = max(14, round(scale * 0.023))
    reach = max(110, round(scale * 0.22))

    tail = choose_tail(tip, image.size, reach)
    body = arrow_points(tip, tail, shaft)

    # White first and wider, then the fill on top: an outline drawn this way
    # survives being over a button of exactly the same colour.
    draw.polygon(body, fill=ARROW_EDGE)
    draw.line(body + [body[0]], fill=ARROW_EDGE, width=stroke * 3, joint="curve")
    draw.polygon(body, fill=ARROW_FILL)
    draw.line(body + [body[0]], fill=ARROW_FILL, width=1, joint="curve")

    # A ring at the tip, so the exact spot is unmistakable even at a glance.
    ring = shaft * 0.9
    draw.ellipse(
        [tip[0] - ring, tip[1] - ring, tip[0] + ring, tip[1] + ring],
        outline=ARROW_EDGE,
        width=max(2, stroke),
    )

    if label:
        font = load_font(max(15, round(scale * 0.026)))
        left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
        text_w, text_h = right - left, bottom - top
        pad_x, pad_y = round(text_h * 0.85), round(text_h * 0.55)

        # Beside the tail, on the far side from the tip, so it never covers the
        # thing being pointed at.
        away = 1 if tail[0] >= tip[0] else -1
        cx = tail[0] + away * (text_w / 2 + pad_x + shaft)
        cy = tail[1]

        half_w, half_h = text_w / 2 + pad_x, text_h / 2 + pad_y
        cx = max(half_w + 8, min(width - half_w - 8, cx))
        cy = max(half_h + 8, min(height - half_h - 8, cy))

        box = [cx - half_w, cy - half_h, cx + half_w, cy + half_h]
        radius = round(half_h * 0.85)
        draw.rounded_rectangle(box, radius=radius, fill=PILL_FILL, outline=ARROW_EDGE, width=max(2, stroke - 1))
        draw.text((cx - text_w / 2 - left, cy - text_h / 2 - top), label, font=font, fill=PILL_TEXT)

    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    return target


def open_file(path: Path) -> None:
    """Show it, using whatever this machine opens pictures with."""
    system = platform.system()
    try:
        if system == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]  # Windows only
        elif system == "Darwin":
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except OSError as error:
        # Not being able to open a viewer is not a failure of the drawing.
        print(f"(Couldn't open a viewer: {error})", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Take a screenshot, and point at things on it.")
    jobs = parser.add_subparsers(dest="job", required=True)

    shot = jobs.add_parser("shot", help="capture the whole screen to latest.png")
    shot.add_argument("--out", type=Path, default=LATEST)

    aim = jobs.add_parser("point", help="draw an arrow on latest.png and open it")
    aim.add_argument("x", type=float, help="across, as a percentage of the width")
    aim.add_argument("y", type=float, help="down, as a percentage of the height")
    aim.add_argument("label", nargs="?", default="", help="two to four words")
    aim.add_argument("--in", dest="source", type=Path, default=LATEST)
    aim.add_argument("--out", type=Path, default=POINTED)
    aim.add_argument("--no-open", action="store_true", help="write the file without showing it")

    args = parser.parse_args(argv)

    if args.job == "shot":
        print(capture(args.out))
        return 0

    written = point(args.x, args.y, args.label, args.source, args.out)
    if not args.no_open:
        open_file(written)
    print(written)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

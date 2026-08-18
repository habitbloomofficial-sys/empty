import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getSetting } from "./settings";

// JARVIS runs on your own machine, so he can open desktop apps on it. That is
// also why this file is deliberately narrow: the model can ask for exactly the
// actions enumerated here and nothing else. There is no "run this command"
// path, no shell, and no way for text from a conversation to become an
// argument that isn't first encoded down to a known-safe alphabet.

const run = promisify(execFile);

/** After encoding, a launch target may contain only these characters. */
const SAFE_URI = /^[A-Za-z0-9:%._~-]+$/;

export function isDesktopControlEnabled(): boolean {
  // On by default: the only thing it can do is open Spotify.
  return (getSetting("DESKTOP_CONTROL") ?? "on").toLowerCase() !== "off";
}

/**
 * Percent-encode everything outside the RFC 3986 unreserved set. Stricter than
 * encodeURIComponent, which leaves !*'() intact — characters that mean
 * something to a Windows command interpreter.
 */
function strictEncode(value: string): string {
  return Array.from(Buffer.from(value, "utf-8"))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-_.~]/.test(char)
        ? char
        : `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    })
    .join("");
}

async function openUri(uri: string): Promise<void> {
  if (!SAFE_URI.test(uri)) {
    throw new Error("Refusing to open that — it isn't a recognised Spotify link.");
  }

  // execFile, never exec: arguments are passed as an array and no shell is
  // spawned to reinterpret them.
  if (process.platform === "win32") {
    await run("cmd.exe", ["/c", "start", "", uri]);
  } else if (process.platform === "darwin") {
    await run("open", [uri]);
  } else {
    await run("xdg-open", [uri]);
  }
}

/** Known install locations, tried if the spotify: protocol isn't registered. */
function spotifyExecutables(): string[] {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles;
    return [
      appData ? path.join(appData, "Spotify", "Spotify.exe") : "",
      programFiles ? path.join(programFiles, "Spotify", "Spotify.exe") : "",
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return ["/Applications/Spotify.app"];
  }
  return ["/usr/bin/spotify", "/snap/bin/spotify", "/var/lib/flatpak/exports/bin/com.spotify.Client"];
}

async function launchInstalledSpotify(): Promise<boolean> {
  for (const candidate of spotifyExecutables()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      if (process.platform === "darwin") {
        await run("open", ["-a", candidate]);
      } else {
        // Detached so Spotify outlives the request that started it.
        const child = execFile(candidate, [], { windowsHide: false });
        child.unref();
      }
      return true;
    } catch {
      // Try the next location.
    }
  }
  return false;
}

export interface OpenSpotifyResult {
  opened: boolean;
  query?: string;
  note: string;
}

/**
 * Open the Spotify desktop app, optionally landing on a search. Playback isn't
 * started — the `spotify:` protocol can navigate the app but not press play,
 * which needs the Spotify Web API and an account authorization.
 */
export async function openSpotify(query?: string): Promise<OpenSpotifyResult> {
  if (!isDesktopControlEnabled()) {
    throw new Error(
      "Opening desktop apps is switched off, sir — enable it in Settings if you'd like it back."
    );
  }

  const trimmed = query?.trim();
  const uri = trimmed ? `spotify:search:${strictEncode(trimmed)}` : "spotify:";

  try {
    await openUri(uri);
  } catch {
    // The protocol handler can be missing if Spotify was installed oddly.
    const launched = await launchInstalledSpotify();
    if (!launched) {
      throw new Error(
        "I couldn't find Spotify on this machine, sir — is the desktop app installed?"
      );
    }
    return {
      opened: true,
      query: trimmed,
      note: "Opened Spotify. I couldn't jump to a search — the spotify: link handler isn't registered.",
    };
  }

  return {
    opened: true,
    query: trimmed,
    note: trimmed
      ? `Opened Spotify with a search for "${trimmed}". Press play on whichever result you want.`
      : "Opened Spotify.",
  };
}

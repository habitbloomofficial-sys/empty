// Which of his machines he is on.
//
// It matters for more than a label. On a phone he is probably not at his desk,
// so opening Spotify or a folder on the computer is either useless or actively
// confusing — those things happen on the machine Axis is running on, not on
// the one he is holding. And "we were on the computer this morning" is the
// kind of detail that makes a memory feel like a memory.
//
// Pure: a user-agent string in, a description out.

export type DeviceKind = "phone" | "tablet" | "computer";

export interface Device {
  kind: DeviceKind;
  /** Said out loud: "your phone", "this computer". */
  label: string;
  /** True when Axis is being used from somewhere other than the machine he runs on. */
  remote: boolean;
}

/**
 * Read the device from a user-agent string.
 *
 * Deliberately coarse. Precise device detection is a losing game — every
 * browser lies, and iPads have claimed to be desktops since 2019 — but phone
 * versus not is decided by a handful of tokens that have been stable for
 * years, and that is the whole of what is needed here.
 */
export function describeDevice(userAgent: string | null | undefined, isLocal = false): Device {
  const ua = (userAgent ?? "").toLowerCase();

  // Order matters: an Android tablet says "android" without "mobile", and an
  // iPad on modern iOS says "macintosh" while a phone never does.
  const isTablet =
    /ipad/.test(ua) ||
    (/android/.test(ua) && !/mobile/.test(ua)) ||
    /tablet|playbook|silk/.test(ua);

  const isPhone =
    !isTablet &&
    (/iphone|ipod/.test(ua) ||
      (/android/.test(ua) && /mobile/.test(ua)) ||
      /windows phone|blackberry|bb10|opera mini|iemobile/.test(ua));

  if (isPhone) return { kind: "phone", label: "your phone", remote: !isLocal };
  if (isTablet) return { kind: "tablet", label: "your tablet", remote: !isLocal };
  return {
    kind: "computer",
    label: isLocal ? "this computer" : "your computer",
    remote: !isLocal,
  };
}

/**
 * Whether the request came from the machine Axis is running on.
 *
 * Anything arriving over the network is a second device by definition, and
 * loopback is the only address that is not.
 */
export function isLoopback(address: string | null | undefined): boolean {
  if (!address) return false;
  const clean = address.replace(/^::ffff:/, "").trim();
  return clean === "127.0.0.1" || clean === "::1" || clean === "localhost";
}

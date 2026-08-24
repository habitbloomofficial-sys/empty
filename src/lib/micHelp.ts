// Telling someone how to unblock the microphone, on the device they're holding.
//
// "Click the padlock in the address bar" is good advice on a computer and
// useless on a phone — where there is no padlock worth tapping, and none at all
// once Axis is installed to the home screen and running without a browser bar.
// Being told to do something that isn't there reads as the app being broken.

export type MicSurface = "computer" | "ios" | "android";

/** Which set of instructions applies, from the browser's own description of itself. */
export function micSurface(userAgent: string | undefined, standalone = false): MicSurface {
  const ua = (userAgent ?? "").toLowerCase();
  // iPadOS reports itself as a Mac, so the touch check is what separates them.
  if (/iphone|ipod/.test(ua) || (/ipad/.test(ua) && !standalone)) return "ios";
  if (/\bipad\b/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "computer";
}

/**
 * Where the permission actually lives on each device.
 *
 * The installed-app case is the one worth spelling out: a home-screen Axis has
 * no address bar, so the setting is in the phone's own settings rather than
 * anywhere in the app.
 */
export function micInstructions(surface: MicSurface, installed: boolean): string {
  if (surface === "ios") {
    return installed
      ? "Open the iPhone Settings app, find Axis in the list, and turn Microphone on."
      : "Tap the ᴀA button at the left of the address bar, choose Website Settings, and set Microphone to Allow.";
  }
  if (surface === "android") {
    return installed
      ? "Press and hold the Axis icon, tap App info, then Permissions, and allow the Microphone."
      : "Tap the padlock at the left of the address bar, then Permissions, and allow the Microphone.";
  }
  return "Click the padlock at the left of the address bar, set Microphone to Allow, then reload the page.";
}

/** Whether the page is running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
}

/** The whole sentence, for wherever the microphone was refused. */
export function micBlockedMessage(lead = "Microphone access is blocked, sir."): string {
  const agent = typeof navigator === "undefined" ? undefined : navigator.userAgent;
  const installed = isInstalled();
  return `${lead} ${micInstructions(micSurface(agent, installed), installed)}`;
}

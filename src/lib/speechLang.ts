import { getSetting } from "./settings";

// Which language the browser listens in.
//
// This was navigator.language, which is the browser's *interface* language and
// has nothing to do with what you speak to Axis. On a Danish Mac that means
// Chrome's recogniser is asked for Danish, and Danish speech-to-text will never
// return the token "axis" — it returns Danish words that happen to sound
// similar. The wake word then appears broken while every part of it works: the
// name simply never arrives.
//
// So the language is a setting, and its default is English, because his name is
// an English word and the commands he understands are English.

/** The default. His name is English; so, by default, is the listening. */
const DEFAULT_LANG = "en-GB";

/**
 * What to hand the speech recogniser.
 *
 * "auto" means follow the browser, for anyone who genuinely does speak to him
 * in the language their browser is set to. It is not the default precisely
 * because it is the setting that silently breaks the wake word.
 */
export function speechLanguage(browserLanguage?: string): string {
  const configured = getSetting("SPEECH_LANG")?.trim();
  if (!configured || configured === "auto") {
    return configured === "auto" ? browserLanguage || DEFAULT_LANG : DEFAULT_LANG;
  }
  // A tag like en-GB, da-DK, de-DE. Anything else is ignored rather than
  // handed to the browser, which throws on a malformed one.
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(configured) ? configured : DEFAULT_LANG;
}

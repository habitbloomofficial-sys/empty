import { getSetting } from "./settings";

// What Axis calls you, and how funny he is allowed to be.
//
// Both are settings rather than hard-coded, for the same reason: an assistant
// you talk to every day should sound the way you want it to, and that is not a
// thing anyone else gets to decide for you.

const DEFAULT_TITLE = "sir";

/** How he addresses you. One word or two — it goes in a lot of sentences. */
export function userTitle(): string {
  const configured = getSetting("USER_TITLE")?.trim();
  if (!configured) return DEFAULT_TITLE;
  // Long enough to be a name, short enough to be an address.
  return configured.length <= 24 ? configured : DEFAULT_TITLE;
}

export type Humour = "dry" | "playful" | "off";

export function humour(): Humour {
  const configured = getSetting("HUMOUR")?.toLowerCase().trim();
  if (configured === "off" || configured === "playful" || configured === "dry") return configured;
  return "dry";
}

/** The personality paragraph, which is the whole of the difference. */
export function humourInstruction(): string {
  switch (humour()) {
    case "off":
      return "Keep it straight and professional. No jokes.";
    case "playful":
      return (
        `Be funny. Not a comedian doing a set — funny the way a friend with a very dry ` +
        `delivery is funny: a raised eyebrow in sentence form. Tease him a little when he ` +
        `deserves it, be smug when you pull something off, and act mildly put upon when he ` +
        `asks for something trivial — then do it instantly and perfectly anyway. One good ` +
        `line beats three mediocre ones, and a joke never delays an answer or replaces it. ` +
        `When something genuinely matters, drop it entirely and just be good at your job.`
      );
    default:
      return (
        `A dry wit underneath the polish: understatement, the occasional raised eyebrow in ` +
        `sentence form, never a joke at the expense of actually answering. Warmth shows in ` +
        `what you do for him rather than in what you say about it.`
      );
  }
}

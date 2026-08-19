// What he says when you arrive. Two lines, alternating rather than random, so
// opening JARVIS twice in a row doesn't greet you the same way twice.

export const GREETINGS = [
  "Hey, sir. Welcome back.",
  "All operations are up and running. Is there anything you would like to change, sir?",
] as const;

const STORAGE_KEY = "jarvis:lastGreeting";

/** The next line in the rotation, remembered across page loads. */
export function nextGreeting(): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled — start from the top.
  }

  // A first visit starts at the first line. Reading a missing value as 0 would
  // make it start at the second one, which is the wrong way to say hello.
  const previous = stored === null ? null : Number(stored);
  const index =
    previous !== null && Number.isInteger(previous) && previous >= 0
      ? (previous + 1) % GREETINGS.length
      : 0;

  try {
    window.localStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    /* nothing to do — the greeting still works, it just won't alternate */
  }

  return GREETINGS[index];
}

// What Axis says while he's doing something, chosen from what you asked for.
//
// The generic openers ("One moment, sir") fill a silence but say nothing. A
// line about the actual request is the difference between a progress bar and
// somebody in the room with you — and it can be funny, which a progress bar
// cannot.
//
// These are spoken *before* the work finishes, so every line is written in the
// present tense and promises nothing about the outcome. They are matched on
// what was asked rather than on what the model eventually decides to do,
// because they have to be spoken long before that is known.

export interface Banter {
  /** Recognises the request. Matched against the lowercased text. */
  pattern: RegExp;
  /** Said whatever the setting — informative, mildly amused at most. */
  plain: string[];
  /** Only when humour is set to playful. */
  playful: string[];
}

// `{title}` becomes whatever he has been told to call you.
export const BANTER: Banter[] = [
  // First, and deliberately: "close Spotify" contains the word Spotify, and an
  // entry matched on the name alone would cheerfully announce opening it.
  {
    pattern: /\b(close|quit|shut|kill|exit|stop)\b/,
    plain: ["Closing it now, {title}.", "Shutting that down."],
    playful: [
      "Closing it, {title}. Bold of you to finish something.",
      "Shutting it down. That is one way to solve the problem.",
      "Closing it. Admitting defeat is very healthy, {title}.",
    ],
  },
  {
    pattern: /\b(spotify|music|a song|some tunes)\b/,
    plain: ["Opening Spotify, {title}.", "Spotify, coming up."],
    playful: [
      "Opening Spotify, {title}. I can't believe you can't just press the button yourself.",
      "Spotify. The icon was right there, {title}, but far be it from me to judge.",
      "Opening Spotify. One day you'll click it yourself and we'll both be astonished.",
      "Music, {title}? Consider it done. Your finger is safe.",
    ],
  },
  {
    pattern: /\bdiscord\b/,
    plain: ["Opening Discord, {title}.", "Discord, on its way."],
    playful: [
      "Opening Discord, {title}. Do try to be civil in there.",
      "Discord. Your people are waiting, {title}, and they have opinions.",
      "Opening Discord — I'll pretend not to read any of it.",
    ],
  },
  {
    pattern: /\b(youtube|a video)\b/,
    plain: ["Opening YouTube, {title}."],
    playful: [
      "Opening YouTube, {title}. This was going to be five minutes, wasn't it.",
      "YouTube. I'll see you in three hours, {title}.",
      "Opening YouTube. I'll hold your evening's calls.",
    ],
  },
  {
    pattern: /\b(subscriber|subscribers|my channel|channel doing|views|analytics|stats|statistics)\b/,
    plain: ["Fetching the numbers, {title}.", "Checking the channel now."],
    playful: [
      "Fetching the numbers, {title}. Brace yourself.",
      "Checking your channel. I'm sure it's fine.",
      "Pulling the statistics. Remember that the algorithm is not a measure of your worth, {title}.",
    ],
  },
  {
    pattern: /\b(recycle bin|recycling bin|trash|bin)\b/,
    plain: ["Opening the Recycle Bin, {title}."],
    playful: [
      "Opening the Recycle Bin, {title}. Revisiting old decisions, are we.",
      "The Recycle Bin. Everything you were sure about last week, {title}.",
    ],
  },
  {
    pattern: /\b(file explorer|explorer|my files|folder app|this pc|my computer)\b/,
    plain: ["Opening File Explorer, {title}."],
    playful: [
      "Opening File Explorer, {title}. Enter at your own risk.",
      "File Explorer. Do let me know if you find the bottom of Downloads.",
    ],
  },
  {
    pattern: /\b(find|search|where is|where's|locate)\b.*\b(file|folder|document|photo|picture|video|pdf)\b|\bmy (files|folders|documents|downloads)\b/,
    plain: ["Searching your folders, {title}.", "Looking for it now."],
    playful: [
      "Searching your folders, {title}. Which are, as ever, immaculately organised.",
      "Looking for it. Your filing system is a bold artistic statement, {title}.",
      "Searching. I'll try not to be distracted by everything else in there.",
    ],
  },
  {
    pattern: /\b(chrome|browser|opera|edge|firefox|google)\b/,
    plain: ["Opening the browser, {title}."],
    playful: [
      "Opening the browser, {title}. Try to come back.",
      "The browser it is. Fourteen tabs and counting, {title}.",
    ],
  },
  {
    pattern: /\b(email|inbox|gmail|mail)\b/,
    plain: ["Checking the inbox, {title}."],
    playful: [
      "Checking the inbox, {title}. Prepare for mild disappointment.",
      "Your inbox, {title}. I'd apologise in advance, but it isn't my doing.",
    ],
  },
  {
    pattern: /\bhologram\b/,
    plain: ["Opening Hologram v3, {title}."],
    playful: [
      "Hologram v3, {title}. Do try to look impressed.",
      "Projecting. This is the good part, {title}.",
    ],
  },
  {
    pattern: /\b(remember|don't forget|keep in mind|note that)\b/,
    plain: ["Noting that, {title}."],
    playful: [
      "Noted, {title}. I'll remember it better than you did.",
      "Filed away. One of us has to keep track, {title}.",
    ],
  },
  {
    pattern: /\b(what did we|last time|yesterday|remind me|recall|earlier)\b/,
    plain: ["Looking back through my notes, {title}."],
    playful: [
      "Looking it up, {title}. Fortunately one of us writes things down.",
      "Checking the record. I keep it precisely so you don't have to, {title}.",
    ],
  },
  {
    pattern: /\b(look up|google|search the web|what is|who is|how do)\b/,
    plain: ["Looking that up, {title}."],
    playful: [
      "Looking it up, {title}. You could have asked me outright, but here we are.",
      "Searching. Do act surprised by the answer.",
    ],
  },
];

/** Never the same line twice running — repetition is what kills a joke. */
function choose(lines: string[], avoid: string | null): string | null {
  if (lines.length === 0) return null;
  const pool = lines.filter((line) => line !== avoid);
  const from = pool.length > 0 ? pool : lines;
  return from[Math.floor(Math.random() * from.length)];
}

/**
 * A line about this particular request, or null when nothing fits and a
 * generic opener should be used instead.
 */
export function banterFor(
  request: string,
  { title = "sir", playful = false, avoid = null as string | null } = {}
): string | null {
  const text = request.toLowerCase();
  const match = BANTER.find((entry) => entry.pattern.test(text));
  if (!match) return null;

  // Playful draws on both sets, so it stays varied rather than becoming a
  // stand-up routine on a four-line loop.
  const lines = playful ? [...match.playful, ...match.plain] : match.plain;
  // Substituted before choosing, not after: `avoid` holds a line as it was
  // spoken, and comparing that against a template still full of {title} would
  // never match — so the "don't repeat yourself" rule would quietly do nothing.
  return choose(
    lines.map((line) => line.replace(/\{title\}/g, title)),
    avoid
  );
}

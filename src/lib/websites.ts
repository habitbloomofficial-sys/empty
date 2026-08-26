// Knowing a website when you hear one.
//
// "Open OneDrive", "pull up Google Docs", "go to chat GPT" — said out loud,
// through a transcriber, with whatever words happen to surround it. Three
// things have to work for that to land:
//
//   the directory   enough sites that the answer is usually in here
//   the aliases     what people actually call them, not what they are called
//   the matching    tolerant of spaces, filler and near misses
//
// The middle one does the most work. Nobody says "chatgpt" — they say "chat
// GPT", and a transcriber writes it as two words. Nobody says "docs.google.com".
// So every entry carries the spoken forms alongside the real name.

export interface Website {
  /** Canonical id, and the first thing matched against. */
  key: string;
  /** What he calls it back to you. */
  name: string;
  home: string;
  /** Prefix for a search within the site, where the site has one. */
  search?: string;
  /** What people say instead. */
  aliases?: string[];
}

// Ordered roughly by how often someone asks. Order matters only for ties.
export const WEBSITES: Website[] = [
  // --- search and reference ---
  { key: "google", name: "Google", home: "https://www.google.com", search: "https://www.google.com/search?q=" },
  { key: "wikipedia", name: "Wikipedia", home: "https://en.wikipedia.org", search: "https://en.wikipedia.org/w/index.php?search=", aliases: ["wiki"] },
  { key: "bing", name: "Bing", home: "https://www.bing.com", search: "https://www.bing.com/search?q=" },
  { key: "duckduckgo", name: "DuckDuckGo", home: "https://duckduckgo.com", search: "https://duckduckgo.com/?q=", aliases: ["duck duck go", "ddg"] },
  { key: "translate", name: "Google Translate", home: "https://translate.google.com", search: "https://translate.google.com/?text=", aliases: ["google translate"] },
  { key: "maps", name: "Google Maps", home: "https://www.google.com/maps", search: "https://www.google.com/maps/search/", aliases: ["google maps"] },
  { key: "stackoverflow", name: "Stack Overflow", home: "https://stackoverflow.com", search: "https://stackoverflow.com/search?q=", aliases: ["stack overflow"] },
  { key: "weather", name: "the weather", home: "https://weather.com", aliases: ["weather.com", "the weather"] },

  // --- AI ---
  { key: "chatgpt", name: "ChatGPT", home: "https://chatgpt.com", aliases: ["chat gpt", "gpt", "openai", "open ai"] },
  { key: "claude", name: "Claude", home: "https://claude.ai", aliases: ["claude ai", "anthropic"] },
  { key: "gemini", name: "Gemini", home: "https://gemini.google.com", aliases: ["google gemini", "bard"] },
  { key: "copilot", name: "Copilot", home: "https://copilot.microsoft.com", aliases: ["microsoft copilot", "bing chat"] },
  { key: "perplexity", name: "Perplexity", home: "https://www.perplexity.ai" },
  { key: "huggingface", name: "Hugging Face", home: "https://huggingface.co", aliases: ["hugging face"] },

  // --- Google's own ---
  { key: "gmail", name: "Gmail", home: "https://mail.google.com", aliases: ["google mail", "my email", "my inbox"] },
  { key: "googledrive", name: "Google Drive", home: "https://drive.google.com", aliases: ["drive", "google drive", "my drive"] },
  { key: "googledocs", name: "Google Docs", home: "https://docs.google.com", aliases: ["docs", "google docs", "google document"] },
  { key: "googlesheets", name: "Google Sheets", home: "https://sheets.google.com", aliases: ["sheets", "google sheets", "google spreadsheet"] },
  { key: "googleslides", name: "Google Slides", home: "https://slides.google.com", aliases: ["slides", "google slides"] },
  { key: "googlecalendar", name: "Google Calendar", home: "https://calendar.google.com", aliases: ["calendar", "google calendar", "my calendar"] },
  { key: "googlephotos", name: "Google Photos", home: "https://photos.google.com", aliases: ["photos", "google photos"] },
  { key: "googlemeet", name: "Google Meet", home: "https://meet.google.com", aliases: ["meet", "google meet"] },
  { key: "googlekeep", name: "Google Keep", home: "https://keep.google.com", aliases: ["keep", "google keep"] },
  { key: "googleclassroom", name: "Google Classroom", home: "https://classroom.google.com", aliases: ["classroom", "google classroom"] },

  // --- Microsoft's own ---
  { key: "onedrive", name: "OneDrive", home: "https://onedrive.live.com", aliases: ["one drive", "my onedrive"] },
  { key: "outlook", name: "Outlook", home: "https://outlook.live.com", aliases: ["outlook mail", "hotmail"] },
  { key: "office", name: "Microsoft 365", home: "https://www.office.com", aliases: ["office", "office 365", "microsoft office", "microsoft 365"] },
  { key: "teams", name: "Microsoft Teams", home: "https://teams.microsoft.com", aliases: ["teams", "microsoft teams"] },
  { key: "wordonline", name: "Word online", home: "https://www.office.com/launch/word", aliases: ["word online", "microsoft word online"] },
  { key: "excelonline", name: "Excel online", home: "https://www.office.com/launch/excel", aliases: ["excel online"] },

  // --- Apple ---
  { key: "icloud", name: "iCloud", home: "https://www.icloud.com", aliases: ["i cloud", "apple icloud"] },
  { key: "applemusic", name: "Apple Music", home: "https://music.apple.com", aliases: ["apple music"] },

  // --- video and music ---
  { key: "youtube", name: "YouTube", home: "https://www.youtube.com", search: "https://www.youtube.com/results?search_query=", aliases: ["you tube"] },
  { key: "netflix", name: "Netflix", home: "https://www.netflix.com", search: "https://www.netflix.com/search?q=" },
  { key: "spotify", name: "Spotify", home: "https://open.spotify.com", search: "https://open.spotify.com/search/", aliases: ["spotify web", "spotify online"] },
  { key: "soundcloud", name: "SoundCloud", home: "https://soundcloud.com", search: "https://soundcloud.com/search?q=", aliases: ["sound cloud"] },
  { key: "twitch", name: "Twitch", home: "https://www.twitch.tv", search: "https://www.twitch.tv/search?term=" },
  { key: "disneyplus", name: "Disney+", home: "https://www.disneyplus.com", aliases: ["disney plus", "disney"] },
  { key: "primevideo", name: "Prime Video", home: "https://www.primevideo.com", aliases: ["prime video", "amazon prime"] },
  { key: "hbomax", name: "HBO Max", home: "https://www.max.com", aliases: ["hbo", "hbo max", "max"] },
  { key: "vimeo", name: "Vimeo", home: "https://vimeo.com" },
  { key: "imdb", name: "IMDb", home: "https://www.imdb.com", search: "https://www.imdb.com/find/?q=", aliases: ["im db"] },

  // --- social ---
  { key: "facebook", name: "Facebook", home: "https://www.facebook.com", aliases: ["fb"] },
  { key: "instagram", name: "Instagram", home: "https://www.instagram.com", aliases: ["insta", "ig"] },
  { key: "tiktok", name: "TikTok", home: "https://www.tiktok.com", aliases: ["tik tok"] },
  { key: "x", name: "X", home: "https://x.com", search: "https://x.com/search?q=", aliases: ["twitter", "x twitter"] },
  { key: "reddit", name: "Reddit", home: "https://www.reddit.com", search: "https://www.reddit.com/search/?q=" },
  { key: "linkedin", name: "LinkedIn", home: "https://www.linkedin.com", search: "https://www.linkedin.com/search/results/all/?keywords=", aliases: ["linked in"] },
  { key: "snapchat", name: "Snapchat", home: "https://web.snapchat.com", aliases: ["snap", "snap chat"] },
  { key: "pinterest", name: "Pinterest", home: "https://www.pinterest.com" },
  { key: "whatsappweb", name: "WhatsApp Web", home: "https://web.whatsapp.com", aliases: ["whatsapp web", "whatsapp online"] },
  { key: "discordweb", name: "Discord in the browser", home: "https://discord.com/app", aliases: ["discord web", "discord online"] },
  { key: "telegram", name: "Telegram", home: "https://web.telegram.org", aliases: ["telegram web"] },

  // --- work and making things ---
  { key: "github", name: "GitHub", home: "https://github.com", search: "https://github.com/search?q=", aliases: ["git hub"] },
  { key: "notion", name: "Notion", home: "https://www.notion.so" },
  { key: "figma", name: "Figma", home: "https://www.figma.com" },
  { key: "canva", name: "Canva", home: "https://www.canva.com" },
  { key: "dropbox", name: "Dropbox", home: "https://www.dropbox.com", aliases: ["drop box"] },
  { key: "trello", name: "Trello", home: "https://trello.com" },
  { key: "slack", name: "Slack", home: "https://app.slack.com" },
  { key: "zoom", name: "Zoom", home: "https://zoom.us" },
  { key: "chatgptcode", name: "Replit", home: "https://replit.com", aliases: ["replit"] },

  // --- shopping and life ---
  { key: "amazon", name: "Amazon", home: "https://www.amazon.com", search: "https://www.amazon.com/s?k=" },
  { key: "ebay", name: "eBay", home: "https://www.ebay.com", search: "https://www.ebay.com/sch/i.html?_nkw=", aliases: ["e bay"] },
  { key: "booking", name: "Booking.com", home: "https://www.booking.com", aliases: ["booking com", "booking"] },
  { key: "airbnb", name: "Airbnb", home: "https://www.airbnb.com", aliases: ["air bnb"] },
  { key: "skyscanner", name: "Skyscanner", home: "https://www.skyscanner.net", aliases: ["sky scanner"] },
  { key: "googleflights", name: "Google Flights", home: "https://www.google.com/travel/flights", aliases: ["flights", "google flights"] },

  // --- games ---
  { key: "steam", name: "Steam", home: "https://store.steampowered.com", search: "https://store.steampowered.com/search/?term=", aliases: ["steam store"] },
  { key: "epicgames", name: "the Epic Games Store", home: "https://store.epicgames.com", aliases: ["epic games", "epic"] },
  { key: "roblox", name: "Roblox", home: "https://www.roblox.com" },
  { key: "minecraft", name: "Minecraft", home: "https://www.minecraft.net" },

  // --- news ---
  { key: "bbc", name: "BBC News", home: "https://www.bbc.com/news", aliases: ["bbc news"] },
  { key: "cnn", name: "CNN", home: "https://edition.cnn.com" },
  { key: "dr", name: "DR", home: "https://www.dr.dk", aliases: ["dr dk", "danmarks radio"] },
  { key: "tv2", name: "TV 2", home: "https://nyheder.tv2.dk", aliases: ["tv 2", "tv2 nyheder"] },
  { key: "guardian", name: "The Guardian", home: "https://www.theguardian.com", aliases: ["the guardian"] },

  // --- learning ---
  { key: "duolingo", name: "Duolingo", home: "https://www.duolingo.com", aliases: ["duo lingo"] },
  { key: "khanacademy", name: "Khan Academy", home: "https://www.khanacademy.org", aliases: ["khan academy"] },
  { key: "coursera", name: "Coursera", home: "https://www.coursera.org" },
];

/** Words that surround a site name without identifying it. */
const FILLER = new Set([
  "open", "go", "to", "the", "a", "my", "please", "up", "pull", "show", "me",
  "on", "in", "browser", "website", "site", "web", "page", "online", "dot",
  "com", "www", "http", "https", "visit", "launch", "bring",
]);

/** Everything down to letters and numbers, with the words kept apart. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The same, with the spaces closed up: "chat gpt" and "chatgpt" as one thing. */
function squash(text: string): string {
  return normalise(text).replace(/ /g, "");
}

/** What is left after the packaging is taken off. */
function meaningful(text: string): string {
  return normalise(text)
    .split(" ")
    .filter((word) => word && !FILLER.has(word))
    .join(" ");
}

/**
 * The same again with the words in alphabetical order.
 *
 * Addresses put the words the other way round from speech: someone says
 * "Google Docs" and the site lives at docs.google.com. Sorting both sides
 * makes those the same string, so a URL is recognised as the thing it is
 * rather than being answered by whichever half matched first — which, for
 * docs.google.com, was Google.
 */
function sorted(text: string): string {
  return normalise(text).split(" ").filter(Boolean).sort().join("");
}

/** Everything a site answers to, squashed for comparison. */
function handles(site: Website): string[] {
  return [site.key, site.name, ...(site.aliases ?? [])].map(squash);
}

function sortedHandles(site: Website): string[] {
  return [site.key, site.name, ...(site.aliases ?? [])].map(sorted);
}

/**
 * Find the site he meant.
 *
 * Squashing spaces out of both sides is what makes speech work: the
 * transcriber writes "chat gpt", "one drive", "you tube" and "sound cloud" as
 * two words each, and the site is called the other thing. Filler is stripped
 * first, so "can you open the Wikipedia website" comes down to "wikipedia".
 *
 * Longer names win ties, because they are the more specific answer: "google
 * docs" must not be answered by Google.
 */
export function findWebsite(query: string): Website | null {
  const asked = squash(query);
  const trimmed = squash(meaningful(query));
  if (!asked && !trimmed) return null;

  const candidates = [trimmed, asked].filter(Boolean);

  // An exact handle beats everything, and is checked for both forms.
  for (const wanted of candidates) {
    const exact = WEBSITES.filter((site) => handles(site).includes(wanted));
    if (exact.length > 0) {
      return exact.sort((a, b) => b.key.length - a.key.length)[0];
    }
  }

  // The same words in another order.
  for (const form of [sorted(meaningful(query)), sorted(query)]) {
    if (!form) continue;
    const reordered = WEBSITES.filter((site) => sortedHandles(site).includes(form));
    if (reordered.length > 0) {
      return reordered.sort((a, b) => b.key.length - a.key.length)[0];
    }
  }

  // Then a handle contained in what he said, or the other way round. Longest
  // handle first, so "google docs" is never answered by "google".
  for (const wanted of candidates) {
    const partial = WEBSITES.map((site) => {
      const best = handles(site)
        .filter((handle) => handle.length >= 3 && (wanted.includes(handle) || handle.includes(wanted)))
        .sort((a, b) => b.length - a.length)[0];
      return best ? { site, handle: best } : null;
    }).filter((match): match is { site: Website; handle: string } => match !== null);

    if (partial.length > 0) {
      return partial.sort((a, b) => b.handle.length - a.handle.length)[0].site;
    }
  }

  return null;
}

/** Does this look like an address rather than a name? */
export function looksLikeDomain(text: string): boolean {
  const trimmed = text.trim().toLowerCase().replace(/^https?:\/\//, "");
  // A dot with something on both sides, and a plausible suffix.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/.test(trimmed) && /\.[a-z]{2,}(\/|$)/.test(trimmed);
}

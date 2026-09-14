import { matchesInterests, type InterestMatch } from "./interests";
import { isYouTubeConfigured, trendingNow, type FoundVideo } from "./youtube";

// What the world is talking about, filtered down to the part he cares about.
//
// "Trending" on its own is noise — it is mostly music videos, football and
// whatever a television programme did last night. What makes it worth
// interrupting for is the intersection with what he has actually been asking
// about: a new trailer for a game he has looked up nine times is news; the same
// trailer for a game he has never mentioned is an advertisement.
//
// So nothing here decides to speak. It gathers, scores against interests.ts,
// and hands back a ranked list with the reason attached. Whether to say
// anything at all is initiative.ts's problem, and it is deliberately a
// different file.

export interface TrendingItem extends FoundVideo {
  /** Views, where YouTube gave them. */
  views: number | null;
  match: InterestMatch;
  /** Hours since it went up, when known. */
  ageHours: number | null;
}

export function isTrendingAvailable(): boolean {
  return isYouTubeConfigured();
}

function hoursSince(published: string | null): number | null {
  if (!published) return null;
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return null;
  return (Date.now() - at) / 3_600_000;
}

export interface TrendingParams {
  /** Two-letter region. His own, not YouTube's default. */
  region?: string;
  limit?: number;
  /** Only things that look like something he cares about. */
  matchingOnly?: boolean;
}

export async function trending(params: TrendingParams = {}): Promise<TrendingItem[]> {
  const found = await trendingNow(params.region ?? "DK", Math.min(params.limit ?? 25, 50));

  const scored: TrendingItem[] = found.map((video) => ({
    ...video,
    views: video.views ?? null,
    ageHours: hoursSince(video.publishedAt),
    match: matchesInterests(`${video.title} ${video.channel} ${video.description ?? ""}`),
  }));

  const wanted = params.matchingOnly ? scored.filter((item) => item.match.matched) : scored;

  // Interest first, then freshness. A thing he cares about from yesterday beats
  // a thing he cares about from last week, but both beat a viral cat.
  return wanted.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9);
  });
}

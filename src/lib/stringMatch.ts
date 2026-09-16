// One small thing shared by two places that both forgive a near miss: the
// wake word, which has to survive a microphone, and a site name, which has to
// survive a typo or a transcriber's best guess at a word it doesn't know.
//
// Kept here rather than duplicated in each, because an edit-distance
// implementation is exactly the kind of thing that quietly drifts into two
// slightly different bugs if it is written twice.

/**
 * Levenshtein distance, with one addition: swapping two ADJACENT letters
 * counts as a single edit rather than two.
 *
 * That single case — "gmial" for "gmail", "form" for "from" — is the single
 * most common way a fast typist or a distracted thumb misspells a word, far
 * more common than a plain substitution. Plain Levenshtein charges it two
 * edits (delete + insert, or two substitutions) and so a typo budget tight
 * enough to keep short words safe rejects the typo most people actually make.
 * This is the standard "optimal string alignment" variant: only a single
 * adjacent swap is cheap, not an arbitrary rearrangement, which is what stops
 * it from forgiving too much.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  // Two previous rows are kept, not one, because a transposition looks two
  // rows back — at where both letters existed before either was touched.
  let twoAgo = new Array<number>(cols).fill(0);
  let previous = Array.from({ length: cols }, (_, j) => j);
  let current = new Array<number>(cols).fill(0);

  for (let i = 1; i < rows; i++) {
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoAgo[j - 2] + 1);
      }
      current[j] = value;
    }
    [twoAgo, previous, current] = [previous, current, twoAgo];
  }

  return previous[cols - 1];
}

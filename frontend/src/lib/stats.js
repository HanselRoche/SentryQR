/**
 * Pure counting helpers for the stat strips.
 *
 * Nothing here fetches. Every page feeds in rows it has already loaded, so the
 * tiles cost no extra requests — there is no aggregate endpoint on the server.
 */

/** `countBy(rows, 'decision')` -> { GRANT: 4, DENY: 11 } */
export function countBy(rows, key) {
  const counts = {};
  for (const row of rows ?? []) {
    const value = typeof key === 'function' ? key(row) : row[key];
    if (value === null || value === undefined) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** Grant/deny split for anything carrying a `decision` field. */
export function decisionSplit(rows) {
  const total = rows?.length ?? 0;
  const grants = (rows ?? []).filter((row) => row.decision === 'GRANT').length;
  const denials = total - grants;

  return {
    total,
    grants,
    denials,
    // Whole percent — these are demo-scale counts, decimals would imply precision
    // the sample size does not have.
    rate: total === 0 ? 0 : Math.round((grants / total) * 100),
  };
}

/**
 * Most frequent values of `key`, largest first, as [{ code, count }].
 * `limit` caps the bars so a chart stays readable.
 */
export function topBy(rows, key, limit = 8) {
  return Object.entries(countBy(rows, key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => ({ code, count }));
}

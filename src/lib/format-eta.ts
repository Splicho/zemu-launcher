/**
 * Format an ETA (in seconds) as a short human-readable string.
 *
 *   < 60s      → "42s"
 *   < 60min    → "5m 32s"  (drops seconds when on a whole minute)
 *   < 24h      → "1h 12m"  (drops minutes when on a whole hour)
 *   ≥ 24h      → "24h+"
 *
 * Returns '' for non-finite or negative inputs so callers can use the
 * empty string as "don't show anything".
 */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds >= 24 * 60 * 60) return '24h+'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`
}

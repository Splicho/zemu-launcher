/**
 * Format a byte count for display in the UI. Uses binary (1024-based)
 * units — matches the convention Windows/macOS/Linux file managers
 * use when reporting folder sizes.
 *
 *   formatBytes(0)              -> "0 B"
 *   formatBytes(512)            -> "512 B"
 *   formatBytes(1536)           -> "1.5 KB"
 *   formatBytes(1024 ** 3)      -> "1.00 GB"
 *   formatBytes(20 * 1024 ** 3) -> "20.0 GB"
 *
 * Two significant digits above 1 MB keeps the readout short without
 * hiding meaningful size differences below the gigabyte threshold.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  // GB and above get one decimal; KB/MB get two so sub-MB files
  // don't round to "1 KB".
  const digits = unitIndex >= 2 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}
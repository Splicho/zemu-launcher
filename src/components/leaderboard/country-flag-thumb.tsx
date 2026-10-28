import { useState } from 'react'

/**
 * Flag CDN URL for an ISO 3166-1 alpha-2 code.
 *
 * `flagsapi.com` is the primary source (the flat 64px style the rest of the
 * launcher uses), but it has no `EU` entry — it answers 500 — so the
 * European Union flag comes from `flagcdn.com`, which serves the EU flag
 * under the same two-letter code.
 */
function flagUrlFor(code: string): string {
  const upper = code.toUpperCase()
  if (upper === 'EU') return 'https://flagcdn.com/w40/eu.png'
  return `https://flagsapi.com/${upper}/flat/64.png`
}

/** Secondary source, used when the primary one fails for a code. */
function fallbackFlagUrl(code: string): string {
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`
}

export function CountryFlagThumb({
  code,
  size = 16,
  className,
}: {
  code: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const w = size
  const h = Math.round((size * 2) / 3)

  return (
    <img
      src={failed ? fallbackFlagUrl(code) : flagUrlFor(code)}
      width={w * 2}
      height={h * 2}
      alt=""
      aria-hidden
      loading="lazy"
      onError={() => setFailed(true)}
      className={['inline-block shrink-0 rounded-sm object-cover', className].filter(Boolean).join(' ')}
      style={{ width: w, height: h }}
    />
  )
}

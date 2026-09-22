/** ISO 3166-1 alpha-2 country code, e.g. "SE". */
function flagUrlFor(code: string): string {
  return `https://flagcdn.com/w80/${code.toLowerCase()}.png`
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
  const w = size
  const h = Math.round((size * 2) / 3)
  return (
    <img
      src={flagUrlFor(code)}
      width={w * 2}
      height={h * 2}
      alt=""
      aria-hidden
      loading="lazy"
      className={['inline-block shrink-0 rounded-sm object-cover', className].filter(Boolean).join(' ')}
      style={{ width: w, height: h }}
    />
  )
}

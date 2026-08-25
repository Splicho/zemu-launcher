import { useHashRouter } from '@/hooks/use-hash'

export type NewsCardProps = {
  slug: string
  category: string
  coverImageUrl: string | null
  coverImageAlt: string
  publishedAt: string
  title: string
  excerpt: string
  className?: string
  compact?: boolean
}

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function NewsCard({
  slug,
  category,
  coverImageUrl,
  coverImageAlt,
  publishedAt,
  title,
  excerpt,
  className,
  compact,
}: NewsCardProps) {
  const { navigate } = useHashRouter()

  return (
    <button
      type="button"
      onClick={() => navigate(`/news/${slug}`)}
      className={[
        'group relative flex flex-col gap-3 overflow-hidden rounded-[1.25rem] p-3 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="pointer-events-none absolute inset-0 scale-95 rounded-[1.25rem] bg-muted opacity-0 transition duration-300 ease-out group-hover:scale-100 group-hover:opacity-100" />

      {coverImageUrl ? (
        <img
          alt={coverImageAlt}
          src={coverImageUrl}
          loading="eager"
          className={[
            'relative z-10 w-full rounded-2xl object-cover transition duration-300 group-hover:brightness-125',
            compact ? 'h-36' : 'h-64 rounded-3xl',
          ].join(' ')}
        />
      ) : (
        <div className={compact ? 'flex h-36 items-center justify-center rounded-2xl bg-muted/40 text-sm' : 'flex h-64 w-full items-center justify-center overflow-hidden rounded-3xl bg-muted/40 text-sm'}>
          No cover image
        </div>
      )}

      <p className="relative flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold uppercase">{category}</span>
        <span
          aria-hidden
          className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50"
        />
        <span className="font-normal normal-case">
          {formatPublishedAt(publishedAt)}
        </span>
      </p>

      <h2 className={compact ? 'relative text-base font-semibold leading-snug line-clamp-2' : 'relative text-2xl leading-tight font-semibold'}>
        {title}
      </h2>
      <p className={compact ? 'relative text-xs leading-5 line-clamp-2' : 'relative text-sm leading-6'}>{excerpt}</p>
    </button>
  )
}

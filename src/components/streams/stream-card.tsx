import { useTranslation } from 'react-i18next'
import { Eye } from '@/components/icons'
import type { StreamInfo } from '@/api/streams'

type StreamCardProps = {
  stream: StreamInfo
}

/**
 * Single live-stream tile. Matches the zemu-website streams card:
 * 16:9 thumbnail with a glass-effect overlay showing avatar, streamer,
 * title (2-line clamp), and viewer count.
 *
 * The whole card is a link to the platform's watch URL.
 */
export function StreamCard({ stream }: StreamCardProps) {
  const { t } = useTranslation()

  return (
    <a
      href={stream.stream_url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-video overflow-hidden rounded-xl bg-muted"
    >
      <img
        src={stream.thumbnail_url}
        alt={stream.title}
        className="absolute inset-0 h-full w-full object-cover transition-[filter,transform] duration-300 group-hover:brightness-110"
      />
      <div
        className="absolute inset-x-0 bottom-0 pt-12 backdrop-blur-md"
        style={{
          backgroundImage:
            'linear-gradient(to top, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.3) 60%, rgba(0, 0, 0, 0.05) 100%)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          maskImage: 'linear-gradient(to top, black 0%, black 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 55%, transparent 100%)',
        }}
      >
        <div className="flex min-h-[5.75rem] flex-col gap-1 px-4 py-3">
          <div className="flex items-center gap-1.5">
            {stream.profile_image_url ? (
              <img
                src={stream.profile_image_url}
                alt={`${stream.user_name} avatar`}
                className="h-5 w-5 shrink-0 rounded-full"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[10px] font-semibold text-white"
              >
                {stream.user_name.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="truncate text-sm font-semibold text-white">{stream.user_name}</p>
          </div>
          <p className="line-clamp-2 text-sm leading-snug text-white/80">{stream.title}</p>
        </div>
      </div>
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-red-500 px-1.5 py-0.5 text-xs font-medium text-white">
        {t('streams.liveBadge')}
      </span>
      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-white/30 bg-accent px-2 py-0.5 text-xs font-medium text-white">
        <Eye className="h-3.5 w-3.5 text-red-500" />
        {stream.viewer_count.toLocaleString()}
      </span>
    </a>
  )
}

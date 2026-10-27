import { useTranslation } from 'react-i18next'

import { AccountAvatarMenu } from '@/components/account-avatar-menu'
import { useHash } from '@/hooks/use-hash'
import { cn } from '@/lib/utils'

/**
 * Top navigation — new launcher UI.
 *
 * Its own row, directly under the window bar (which now keeps to
 * itself): a three-column grid of `[spacer | links | account menu]`.
 * The links stay optically centred because both gutters are `1fr`, and
 * the account menu (compact avatar trigger) is pinned hard right where
 * the sidebar's footer used to hold it.
 *
 * The six destinations mirror the old sidebar exactly, so routing is
 * unchanged: each link is still a plain `#/path` anchor and the hash
 * router in `main-app.tsx` picks it up.
 *
 * Assets live in `public/icon/navbar/` (20px brand-red glyphs). They
 * ship dark-on-light, so:
 *   - active   → full opacity, label in `foreground`, `nav-line.png`
 *                underline under the whole item
 *   - inactive → dimmed, label in `muted-foreground`, label lifts on
 *                hover
 * and `dark:brightness-*` lifts the maroon enough to read on the dark
 * surface without swapping the assets out.
 *
 * The underline asset is `public/icon/navbar/nav-line.png` (78×3 brush
 * line), stretched to the item width and kept at its native 3px height.
 */
interface NavItem {
  key: string
  labelKey: string
  path: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', labelKey: 'nav.home', path: '/home', icon: '/icon/navbar/Home.png' },
  { key: 'news', labelKey: 'nav.news', path: '/news', icon: '/icon/navbar/News.png' },
  { key: 'servers', labelKey: 'nav.servers', path: '/servers', icon: '/icon/navbar/Servers.png' },
  { key: 'streams', labelKey: 'nav.streams', path: '/streams', icon: '/icon/navbar/Streams.png' },
  {
    key: 'leaderboard',
    labelKey: 'nav.leaderboard',
    path: '/leaderboard',
    icon: '/icon/navbar/Leaderboard.png',
  },
  { key: 'clans', labelKey: 'nav.clans', path: '/clans', icon: '/icon/navbar/Clans.png' },
]

export function Navbar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const hash = useHash()

  // `#/` is the landing route, which `main-app.tsx` currently resolves
  // to the home page — highlight Home there as well.
  const current = hash === null ? null : hash === '/' ? '/home' : hash

  return (
    // `1fr auto 1fr` keeps the link group optically centred whatever the
    // account menu's width is — the two equal gutters absorb it, so the
    // nav doesn't drift left as the avatar/label changes.
    <nav
      className={cn(
        'grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5',
        className,
      )}
    >
      <span aria-hidden="true" />
      <ul className="flex items-center justify-center gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            current === item.path || (current?.startsWith(`${item.path}/`) ?? false)

          return (
            <li key={item.key}>
              <a
                href={`#${item.path}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-9 items-center gap-2 px-3',
                  'text-sm font-medium transition-colors duration-150 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <img
                  src={item.icon}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className={cn(
                    'size-5 object-contain',
                    'transition-opacity duration-150',
                    'dark:brightness-[2.2]',
                    isActive ? 'opacity-100' : 'opacity-45 group-hover:opacity-80',
                  )}
                />
                <span className="whitespace-nowrap">{t(item.labelKey)}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-3 bottom-0 h-[3px] bg-center bg-no-repeat dark:brightness-[2.2]"
                    style={{
                      backgroundImage: 'url(/icon/navbar/nav-line.png)',
                      backgroundSize: '100% 3px',
                    }}
                  />
                )}
              </a>
            </li>
          )
        })}
      </ul>
      {/* Account menu, hard right. */}
      <div className="flex items-center justify-end">
        <AccountAvatarMenu />
      </div>
    </nav>
  )
}

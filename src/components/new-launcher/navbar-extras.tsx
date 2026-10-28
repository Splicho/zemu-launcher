import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'

import { DiscordFilled, Twitch, Twitter, YouTube } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Where the Help item points. */
const HELP_URL = 'https://help.zemu.uk'

/** Official ZEmu channels. */
const SOCIAL_LINKS = [
  { label: 'Discord', href: 'https://discord.gg/h1z1kotk', Icon: DiscordFilled },
  { label: 'X', href: 'https://x.com/H1Z1ZEMU', Icon: Twitter },
  { label: 'YouTube', href: 'https://www.youtube.com/@ZEmuKOTK', Icon: YouTube },
  { label: 'Twitch', href: 'https://www.twitch.tv/h1z1zemu', Icon: Twitch },
] as const

/**
 * Nav-item chrome, shared with the route links in `navbar.tsx` so the new
 * entries line up with Home/News/etc. `active` is always false here — these
 * are actions, not routes, so they never get the underline.
 */
const ITEM_CLASS =
  'group relative flex h-9 items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

/**
 * Open a URL in the OS browser. `plugin-opener` is the same path the notice
 * banner uses: external links must never navigate the launcher webview away
 * from the app.
 */
async function openExternal(href: string) {
  try {
    await openUrl(href)
  } catch (error) {
    toast.error(String(error))
  }
}

/** "Socialize" nav entry with the social-links dropdown. */
export function SocializeMenu() {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(ITEM_CLASS, 'gap-2')}>
          <img src="/icon/navbar/Socialize.png" alt="" aria-hidden draggable={false} className="size-5 shrink-0 object-contain opacity-45 transition-opacity duration-150 group-hover:opacity-80 dark:brightness-[2.2]" />
          <span className="whitespace-nowrap">{t('nav.socialize')}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="min-w-44">
        {SOCIAL_LINKS.map(({ label, href, Icon }) => (
          <DropdownMenuItem
            key={href}
            className="gap-2"
            onSelect={() => void openExternal(href)}
          >
            <Icon className="size-4 shrink-0" />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Help" nav entry — opens the help site in the browser. */
export function HelpLink() {
  const { t } = useTranslation()

  return (
    <button type="button" className={ITEM_CLASS} onClick={() => void openExternal(HELP_URL)}>
      <img src="/icon/navbar/Help.png" alt="" aria-hidden draggable={false} className="size-5 shrink-0 object-contain opacity-45 transition-opacity duration-150 group-hover:opacity-80 dark:brightness-[2.2]" />
      <span className="whitespace-nowrap">{t('nav.help')}</span>
    </button>
  )
}



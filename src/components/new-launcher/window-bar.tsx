import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'

import { LAUNCHER_CONFIG } from '@/config/launcher'
import { cn } from '@/lib/utils'

/**
 * In-window window bar — new launcher UI.
 *
 * Unlike the old `TitleBar`, this one is *inside* the launcher window:
 * it sits inset from the window edge, aligned with the page gutters,
 * and draws no container of its own — no border, no fill, no rounded
 * panel. Just the brand mark on the left and the controls on the
 * right, floating on whatever the page paints behind them. That keeps
 * it working over the flat background and over background artwork
 * without a surface that would have to adapt to both.
 *
 * Layout:
 *   [Z logo]                                   [_][□][×]
 *
 * - Left: the window-bar brand mark (`public/logo/window-bar-logo.png`).
 * - Right: the window controls, drawn from the new PNG set in
 *   `public/icon/window-controls/`. Those glyphs are a flat dark gray
 *   (#404040) intended for a light surface, so they're flipped with
 *   `dark:invert` — the assets themselves stay untouched.
 * - The whole bar is the OS drag handle (`data-tauri-drag-region`).
 *   Children that are purely decorative get `pointer-events-none` so
 *   the drag target is always the bar itself; the buttons deliberately
 *   don't, so their clicks land.
 *
 * There is no "restore" glyph in the icon set yet, so the maximize
 * button keeps the maximize icon while maximized — only its label
 * flips. Drop a `Restore.png` next to the others and it can be wired
 * into `icon` below.
 *
 * The window is frameless (`decorations(false)`), so everything the OS
 * would normally draw lives here.
 */
export function WindowBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)

  // Track maximize state via window events so the labels stay honest,
  // and seed the initial value in case the OS restored a maximized
  // window.
  useEffect(() => {
    let unlistenMaximize: (() => void) | undefined
    let unlistenUnmaximize: (() => void) | undefined
    let cancelled = false

    const setup = async () => {
      // Everything here is best-effort: `getCurrentWindow()` throws
      // outside a Tauri webview (browser previews), and a throw inside
      // this effect would unmount the whole launcher tree. Losing the
      // maximize label is not worth that.
      try {
        const window = getCurrentWindow()
        const maximized = await invoke<boolean>('window_is_maximized')
        if (!cancelled) setIsMaximized(maximized)

        unlistenMaximize = await window.listen('tauri://maximize', () => {
          if (!cancelled) setIsMaximized(true)
        })
        unlistenUnmaximize = await window.listen('tauri://unmaximize', () => {
          if (!cancelled) setIsMaximized(false)
        })
      } catch {
        // Not running inside Tauri, or the window APIs rejected — leave
        // the controls in their default state.
      }
    }

    void setup()

    return () => {
      cancelled = true
      unlistenMaximize?.()
      unlistenUnmaximize?.()
    }
  }, [])

  return (
    // The drag region is the *whole* bar, not just the logo/control
    // groups. Tauri only starts a drag when the element under the
    // pointer carries `data-tauri-drag-region`, so the attribute sits on
    // this root (full width × full height) and the padding moved inside
    // it — previously the outer `p-3` wrapper and the gaps around the
    // 16px-tall inner row were dead zones, which read as "the middle of
    // the bar isn't draggable". The window-control buttons deliberately
    // keep no attribute so their clicks land.
    <div
      data-tauri-drag-region
      className={cn(
        'flex h-10 shrink-0 select-none items-center justify-between gap-3 px-3',
        className,
      )}
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center">
        <img
          src="/logo/window-bar-logo.png"
          alt={LAUNCHER_CONFIG.name}
          draggable={false}
          className="pointer-events-none size-5 object-contain"
        />
      </div>

      <div data-tauri-drag-region className="flex items-center gap-0.5">
        <ControlButton
          label={t('common.minimize')}
          icon="/icon/window-controls/Minimize.png"
          iconClassName="w-[9px]"
          onClick={() => void invoke('window_minimize')}
        />
        <ControlButton
          label={isMaximized ? t('common.restore') : t('common.maximize')}
          icon="/icon/window-controls/Maximize.png"
          iconClassName="w-[9px]"
          onClick={() => void invoke('window_maximize')}
        />
        <ControlButton
          label={t('common.close')}
          icon="/icon/window-controls/Exit.png"
          iconClassName="w-[9px]"
          onClick={() => void invoke('window_close')}
        />
      </div>
    </div>
  )
}

function ControlButton({
  icon,
  label,
  onClick,
  iconClassName,
}: {
  icon: string
  label: string
  onClick: () => void
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'group/control grid size-7 place-items-center rounded-lg',
        'transition-colors duration-150 ease-out',
        'hover:bg-foreground/[0.07] active:bg-foreground/[0.11]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
      )}
    >
      {/* PNG glyphs ship at 9px — render them at 1x so they stay crisp
          instead of being resampled up. */}
      <img
        src={icon}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn(
          'pointer-events-none opacity-60 transition-opacity duration-150',
          'dark:invert group-hover/control:opacity-100',
          iconClassName,
        )}
      />
    </button>
  )
}

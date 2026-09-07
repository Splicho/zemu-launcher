import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WindowClose, WindowMaximize, WindowMinimize, WindowRestore } from '@/components/icons'
import { LAUNCHER_CONFIG } from '@/config/launcher'

/**
 * Custom window title bar — sits at the very top of the main window.
 *
 * The main window is frameless (`decorations: false` in
 * `tauri.conf.json`) so we have to draw every chrome affordance
 * ourselves. Mirrors the abyssal-gate launcher's `WindowBar`:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ [icon] ZEmu Launcher v0.1.0            [_]    [×] │
 *   └────────────────────────────────────────────────────┘
 *
 * - `h-8` muted bar with a 1px bottom border — visually identical
 *   to abyssal-gate so the two launchers feel like one product.
 * - The left cluster (icon + title) is the OS drag handle via
 *   `data-tauri-drag-region`; the right cluster (min / max / close)
 *   sits *outside* the drag region so its full-width click areas
 *   always receive their `click` events, never a drag.
 * - Minimize and maximize/restore toggle the window; close exits.
 *   The main window is locked at a fixed 1280×800 when not maximized
 *   (see `tauri.conf.json`).
 *
 * The Rust commands `window_minimize` / `window_maximize` / `window_close`
 * are already wired up in `src-tauri/src/commands.rs`, so we just invoke them.
 */
export function TitleBar() {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)

  // Track maximize state via window events so the icon flips between
  // maximize and restore glyphs. Also query the initial value on mount
  // so the correct glyph is shown if the OS restores the last session
  // as a maximized window.
  useEffect(() => {
    let unlistenMax: (() => void) | undefined
    let unlistenUnmax: (() => void) | undefined
    let cancelled = false

    const setup = async () => {
      const win = getCurrentWindow()
      // Seed initial state (handles OS session restore).
      try {
        const maximized = await invoke<boolean>('window_is_maximized')
        if (!cancelled) setIsMaximized(maximized)
      } catch {
        // Non-fatal — leave as false.
      }
      unlistenMax = await win.listen('tauri://maximize', () => {
        if (!cancelled) setIsMaximized(true)
      })
      unlistenUnmax = await win.listen('tauri://unmaximize', () => {
        if (!cancelled) setIsMaximized(false)
      })
    }

    void setup()

    return () => {
      cancelled = true
      unlistenMax?.()
      unlistenUnmax?.()
    }
  }, [])

  const handleMinimize = () => {
    void invoke('window_minimize')
  }

  const handleMaximize = () => {
    void invoke('window_maximize')
  }

  const handleClose = () => {
    void invoke('window_close')
  }

  return (
    <div className="relative flex h-8 items-center border-b border-border bg-muted select-none">
      {/* Draggable region — left cluster. `flex-1` so it eats all the
          slack, leaving the right cluster sized exactly to its
          contents (three w-12 buttons = 144px). */}
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center gap-2 pl-3"
      >
        <img
          src="../assets/icon/app-icon.ico"
          alt={LAUNCHER_CONFIG.name}
          className="pointer-events-none h-4 w-4"
        />
        <span className="pointer-events-none text-sm font-medium text-muted-foreground">
          {LAUNCHER_CONFIG.name} v{LAUNCHER_CONFIG.version}
        </span>
      </div>

      {/* Window controls on the right. Full-height, w-12 each —
          same hit area as abyssal-gate. `relative z-10` keeps them
          above any future decorative layer in the bar. */}
      <div className="relative z-10 flex h-full items-center">
        <button
          type="button"
          onClick={handleMinimize}
          aria-label={t('common.minimize')}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-muted-foreground/10"
        >
          <WindowMinimize size={16} />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          aria-label={isMaximized ? t('common.restore') : t('common.maximize')}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-muted-foreground/10"
        >
          {isMaximized ? <WindowRestore size={16} /> : <WindowMaximize size={16} />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('common.close')}
          className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <WindowClose size={16} />
        </button>
      </div>
    </div>
  )
}
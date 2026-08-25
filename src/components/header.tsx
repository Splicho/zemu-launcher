import { AccountDropdown } from '@/components/account-dropdown'
import { LAUNCHER_CONFIG } from '@/config/launcher'

/**
 * Top bar of the home screen.
 *
 * Two slots:
 *   - left  → app icon (re-using the same `./assets/icon/app-icon.ico`
 *             path the login screen already loads from, so dev/prod
 *             both resolve it the same way)
 *   - right → account dropdown (avatar trigger + sign-out item)
 *
 * The bar itself is intentionally minimal — just a flex row with
 * padding, no border or background. The home page sets the window's
 * `bg-background`, so the header floats on top of it.
 */
export function Header() {
  return (
    <header className="flex shrink-0 items-center justify-between px-8 py-5">
      <img
        src="./assets/icon/zemu-logo.png"
        alt={LAUNCHER_CONFIG.name}
        className="h-8 w-8"
      />
      <AccountDropdown />
    </header>
  )
}
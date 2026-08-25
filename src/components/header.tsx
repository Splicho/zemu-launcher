import { AccountDropdown } from '@/components/account-dropdown'

/**
 * Secondary top bar of the home screen.
 *
 * Sits directly below `TitleBar` (which is the OS chrome row at the
 * very top of the window). Holds only one slot:
 *   - right → account dropdown (avatar trigger + sign-out item)
 *
 * The launcher logo lives in the sidebar. Intentionally minimal —
 * no border or background, just a flex row with padding. The home
 * page sets the window's `bg-background`, so this floats on top of
 * it.
 */
export function Header() {
  return (
    <header className="flex shrink-0 items-center justify-end px-8 py-3">
      <AccountDropdown />
    </header>
  )
}
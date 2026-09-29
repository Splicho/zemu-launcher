import { AccountDropdown } from '@/components/account-dropdown'

/**
 * Secondary top bar of the home screen.
 *
 * Sits directly below `TitleBar` (which is the OS chrome row at the
 * very top of the window). Holds one slot, right-aligned:
 *   - account dropdown (avatar trigger + sign-out item)
 *
 * The launcher logo lives in the sidebar. Intentionally minimal —
 * no border or background, just a flex row with padding. The home
 * page sets the window's `bg-background`, so this floats on top of
 * it.
 *
 * History: this row used to host a `ServerStatusDropdown` to the
 * left of the account chip. The live player-count read-out moved
 * to the dedicated `ServersPage` (`#/servers`), so the header
 * stayed simpler and stops showing the same data in two places.
 */
export function Header() {
  return (
    <header className="flex shrink-0 items-center justify-end gap-2 px-8 py-3">
      <AccountDropdown />
    </header>
  )
}

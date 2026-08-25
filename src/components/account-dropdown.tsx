import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/contexts/auth-context'

/**
 * Account dropdown anchored to the user's avatar.
 *
 * The trigger is the avatar only (no name, no chevron — the spec asked
 * for the bare minimum). Inside the dropdown we show:
 *   - header label with the display name + email (the info that's
 *     useful at a glance when confirming which account is signed in)
 *   - a single "Sign out" action that calls `useAuth().logout()`
 *
 * The avatar falls back to the first letter of the display name when
 * the provider didn't ship an image URL, which is the common case for
 * the credentials login path.
 */
export function AccountDropdown() {
  const { token, logout } = useAuthContext()

  const displayName =
    token?.displayName ?? token?.username ?? token?.email ?? '?'

  const fallback = (displayName[0] ?? '?').toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar size="default">
            {token?.image && <AvatarImage src={token.image} alt={displayName} />}
            <AvatarFallback>{fallback}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{displayName}</span>
          {token?.email && (
            <span className="text-xs font-normal text-muted-foreground">
              {token.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthContext } from '@/contexts/auth-context'

/**
 * Account dropdown anchored to the user's avatar.
 *
 * The trigger is the avatar only (no name, no chevron). Inside the
 * dropdown: a single "Sign out" action that calls `useAuth().logout()`.
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
          <AvatarRoot size="default">
            {token?.image && <AvatarImg src={token.image} alt={displayName} />}
            <AvatarFallbackText>{fallback}</AvatarFallbackText>
          </AvatarRoot>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="min-w-40">
        <DropdownMenuItem onSelect={() => logout()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Avatar components (inline — AccountDropdown is the only consumer) ──

function AvatarRoot({
  size = 'default',
  children,
}: {
  size?: 'default' | 'sm' | 'lg'
  children: React.ReactNode
}) {
  const sizeClasses = {
    default: 'h-8 w-8',
    sm: 'h-6 w-6',
    lg: 'h-10 w-10',
  }[size]
  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted ${sizeClasses}`}
    >
      {children}
    </div>
  )
}

function AvatarImg({
  src,
  alt,
}: {
  src?: string
  alt?: string
}) {
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt ?? ''}
      className="aspect-square h-full w-full object-cover"
    />
  )
}

function AvatarFallbackText({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-primary/10 text-xs font-medium uppercase text-primary">
      {children}
    </span>
  )
}

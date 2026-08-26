import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from './ui/spinner'

interface SteamLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (credentials: {
    username: string
    password: string
    guardCode: string | null
  }) => Promise<void>
  initialUsername?: string
  submitting?: boolean
  requiresGuard?: boolean
  canUseMobileApproval?: boolean
  errorMessage?: string | null
}

/**
 * Steam sign-in dialog.
 *
 *   * Username — pre-filled when the user has signed in before.
 *   * Password — never persisted.
 *   * Steam Guard code — shown when Steam demands 2FA.
 *
 * When `canUseMobileApproval` is true we hint that the user can also
 * approve on their Steam mobile app instead of typing a code.
 *
 * On submit, the parent's `onSubmit` handler performs the actual
 * `steamroom-client` login. If Steam returns `NeedsMobileConfirm` the
 * backend blocks on `wait_for_confirmation` — the dialog just shows
 * "Connecting…" while the user approves on their phone.
 */
export function SteamLoginDialog({
  open,
  onOpenChange,
  onSubmit,
  initialUsername,
  submitting,
  requiresGuard,
  canUseMobileApproval,
  errorMessage,
}: SteamLoginDialogProps) {
  const [username, setUsername] = useState(initialUsername ?? '')
  const [password, setPassword] = useState('')
  const [guardCode, setGuardCode] = useState('')

  // Reset transient fields when the dialog closes.
  useEffect(() => {
    if (!open) {
      setPassword('')
      setGuardCode('')
    }
  }, [open])

  useEffect(() => {
    if (initialUsername && !username) {
      setUsername(initialUsername)
    }
  }, [initialUsername, username])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!username || !password) return

      await onSubmit({
        username,
        password,
        guardCode: guardCode.trim() ? guardCode.trim() : null,
      })
    },
    [guardCode, onSubmit, password, username]
  )

  const canSubmit = username.length > 0 && password.length > 0 && !submitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to Steam</DialogTitle>
          <DialogDescription>
            Sign in to download H1Z1: KotK from Steam. Your password is never
            stored, only a long-lived refresh token is kept on this machine.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="steam-username">Steam account name</Label>
            <Input
              id="steam-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="your_steam_login"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="steam-password">Password</Label>
            <Input
              id="steam-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          {requiresGuard ? (
            <div className="space-y-2">
              <Label htmlFor="steam-guard">Steam Guard code</Label>
              <Input
                id="steam-guard"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={guardCode}
                onChange={(e) => setGuardCode(e.target.value)}
                placeholder="5-character code from your authenticator"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                {canUseMobileApproval
                  ? 'Enter the code from your Steam authenticator, or approve the sign-in on your Steam mobile app.'
                  : 'Enter the code from your Steam authenticator.'}
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter className="-mx-4 -mb-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  Connecting…
                </span>
              ) : (
                'Sign in'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
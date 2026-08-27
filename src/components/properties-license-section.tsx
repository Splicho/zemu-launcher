/**
 * Right-pane body for the License rail entry. Drives off the
 * `LicenseStatus` exposed by `useLicense`:
 *
 *   - `bound`    → table row shows the live key + "Active"
 *   - `other-pc` → table row shows the cached key + "Active" (the
 *                  key is still valid, it's just bound elsewhere);
 *                  admin-only banner appears below the form. If the
 *                  last revalidate returned `revoked`, the status
 *                  flips to "Revoked".
 *   - `unbound`  → table renders its empty-state row (no record);
 *                  redeem form sits above
 *   - `unknown`  → same as `unbound` until the first check resolves
 *
 * Status transitions while the user is on the tab (redeem /
 * revalidate / initial mount) are handled by `useLicense` — this
 * component is pure render.
 */

import { useId, useMemo, useState } from 'react'

import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  autoFormatLicenseKeyInput,
  formatLicenseKey,
  normalizeLicenseKey,
} from '@/lib/license'
import type { LicenseFailure, LicenseRecord, LicenseStatus } from '@/hooks/use-license'

/**
 * Union of all fail reasons the UI might render a message for.
 * Redeem and revalidate now share the same failure set
 * (`not_found` / `revoked` / `already_bound` / `unreachable`);
 * we keep the union explicit so a future server-side addition
 * surfaces here as a type error.
 */
type UiFailureReason = LicenseFailure

interface LicenseSectionProps {
  status: LicenseStatus
  record: LicenseRecord | null
  redeemError: LicenseFailure | null
  revalidateError: LicenseFailure | null
  isBinding: boolean
  onRedeem: (
    rawKey: string,
  ) => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
  onRevalidate: () => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
}

// The Status column reflects the *key's own state* (Active / Revoked),
// not whether it's bound to this PC — binding is communicated by the
// admin-only banner below the form. We fall back to the last revalidate
// outcome so a key that the server just revoked is flagged even before
// the local record has been cleared. When there's no record yet, the
// table renders its empty-state row instead of a status cell.
function keyStatusLabel(
  record: LicenseRecord | null,
  status: LicenseStatus,
  revalidateError: LicenseFailure | null,
): string {
  if (!record) return ''
  if (revalidateError === 'revoked') return 'Revoked'
  if (status === 'binding') return 'Checking…'
  return 'Active'
}

function StatusBadge({ statusLabel }: { statusLabel: string }) {
  if (statusLabel === 'Active') {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
        Active
      </span>
    )
  }
  if (statusLabel === 'Revoked') {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
        Revoked
      </span>
    )
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
      {statusLabel}
    </span>
  )
}

export function LicenseSection({
  status,
  record,
  redeemError,
  revalidateError,
  isBinding,
  onRedeem,
  onRevalidate,
}: LicenseSectionProps) {
  // Format the cached key for display. When there's no record,
  // the table renders its empty state instead.
  const formattedKey = useMemo(
    () => (record ? formatLicenseKey(record.licenseKey) : null),
    [record],
  )

  // We always render the form + table together. When no record
  // exists yet, the table shows the empty-state row; the form
  // remains available above it so the user can redeem.
  return (
    <div className="space-y-6">
      <RedeemForm
        redeemError={redeemError}
        isSubmitting={isBinding}
        onSubmit={onRedeem}
        onRevalidate={onRevalidate}
      />

      <Separator />

      <Card>
        <CardHeader className="px-6">
          <CardTitle className="uppercase tracking-wide">Account key</CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account key</TableHead>
                <TableHead className="w-0 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {record ? (
                <TableRow>
                  <TableCell className="font-mono text-xs">
                    {formattedKey}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <StatusBadge statusLabel={keyStatusLabel(record, status, revalidateError)} />
                  </TableCell>
                </TableRow>
              ) : status === 'binding' ? (
                <TableRow>
                  <TableCell className="py-4">
                    <Skeleton className="h-3 w-48" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-3 w-12" />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="py-6 text-center text-xs text-muted-foreground"
                  >
                    No account keys redeemed yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Table status cell handles all revalidate feedback (Active / Revoked / Checking…); no supplementary alert needed. */}
    </div>
  )
}

function RedeemForm({
  redeemError,
  isSubmitting,
  onSubmit,
  onRevalidate,
}: {
  redeemError: LicenseFailure | null
  isSubmitting: boolean
  onSubmit: (
    rawKey: string,
  ) => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
  onRevalidate: () => Promise<{ ok: true } | { ok: false; failure: LicenseFailure }>
}) {
  const [value, setValue] = useState('')
  const inputId = useId()

  // `value` holds the *displayed* formatted string. We derive the
  // raw (no dashes) key for submission so we don't ship hyphens to
  // the server.
  const { raw, valid } = useMemo(() => normalizeLicenseKey(value), [value])

  // If a redeem attempt fails, we keep the user's input intact so they
  // can edit instead of re-typing. The promise resolves to the raw
  // result so the parent can still drive state (bound/unbound).
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || isSubmitting) return
    // Await revalidate first so we get the fresh failure for the toast message.
    const submitResult = await onSubmit(raw)
    let revalidateResult: { ok: true } | { ok: false; failure: LicenseFailure }
    if (submitResult.ok) {
      revalidateResult = await onRevalidate()
    } else {
      revalidateResult = submitResult
    }
    if (revalidateResult.ok) {
      toast.success('Key redeemed.')
    } else {
      toast.error(redeemErrorMessage(revalidateResult.failure))
    }
  }

  const errorMessage = redeemError
    ? redeemErrorMessage(redeemError)
    : null

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={inputId}>Account key</Label>
        <Input
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          value={value}
          onChange={(event) => {
            setValue(autoFormatLicenseKeyInput(event.target.value))
          }}
          disabled={isSubmitting}
          className="font-mono tracking-wider"
          aria-invalid={errorMessage ? true : undefined}
        />
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full!">
        <Button type="submit" variant="gradient" disabled={!valid || isSubmitting} className="w-full!">
          Redeem
        </Button>
      </div>
    </form>
  )
}

function redeemErrorMessage(reason: UiFailureReason): string {
  switch (reason) {
    case 'not_found':
      return 'This account key was not found. Please try again.'
    case 'revoked':
      return 'This account key has been revoked.'
    case 'already_bound':
      return 'This account key is bound to a different machine.'
    case 'unreachable':
      return "Couldn't reach the account key server."
  }
}

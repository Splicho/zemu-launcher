import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, ChevronDown, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatAppError, type AppErrorPayload } from '@/lib/app-errors'
import { cn } from '@/lib/utils'

interface ErrorCardProps {
  /** Structured error from Rust — see `src-tauri/src/errors.rs`. */
  error: AppErrorPayload
  /**
   * Recovery actions rendered under the description. The caller owns the
   * wording and the handler because the right action depends on context
   * (sign out here, change folder there, retry the download elsewhere).
   */
  actions?: ReactNode
  className?: string
}

/**
 * Localized, actionable error card for backend failures.
 *
 * Renders three layers so every audience is covered:
 *
 *   1. **Title + description** — localized copy keyed by the stable error
 *      code (`errors.<code>.title` / `.description`). This is the fix for
 *      players seeing `depot access denied: depot 433851`.
 *   2. **Actions** — supplied by the caller (retry / use another account /
 *      open the store page).
 *   3. **Technical details** — collapsed by default: the error code chip
 *      (greppable, askable over Discord) plus the untouched Rust chain,
 *      with a copy button for bug reports.
 *
 * The code chip stays visible even when collapsed so support can identify
 * the failure from a screenshot alone.
 */
export function ErrorCard({ error, actions, className }: ErrorCardProps) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const formatted = formatAppError(t, error)

  const copyDetails = useCallback(async () => {
    // Include the code and the localized title so a pasted report is
    // readable without the screenshot, then the raw chain for diagnosis.
    const text = `[${error.code}] ${formatted.title}\n\n${error.detail}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the details are still selectable below */
    }
  }, [error.code, error.detail, formatted.title])

  return (
    <div
      className={cn(
        'rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm',
        className,
      )}
      role="alert"
    >
      <div className="flex gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-destructive">{formatted.title}</p>
          {formatted.description ? (
            <p className="text-foreground/80">{formatted.description}</p>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap justify-end gap-2 pt-2">{actions}</div>
          ) : null}
        </div>
      </div>

      <Collapsible
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        className="mt-3 border-t border-destructive/20 pt-2"
      >
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform',
                  detailsOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
              {t('errors.actions.details')}
            </Button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1.5">
            <code className="select-all rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {error.code}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                void copyDetails()
              }}
              aria-label={
                copied ? t('errors.actions.copied') : t('errors.actions.copy')
              }
              className="shrink-0"
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {error.detail || formatted.title}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

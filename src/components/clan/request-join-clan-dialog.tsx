'use client'

import * as React from 'react'
import { Send, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

import { useRequestJoinClan } from '@/hooks/use-clan'
import { httpFetch } from '@/lib/http-fetch'
import { getClanJoinFormUrl } from '@/lib/clan'
import type { ClanProfile, JoinQuestion } from '@/lib/clan'

type JoinFormPayload = {
  isPrivate: boolean
  joinQuestions: JoinQuestion[]
}

/**
 * `Request to join` dialog on the public clan profile page.
 *
 * Mirrors the website's
 * `apps/web/app/clans/[slug]/components/request-join-clan-dialog.tsx`
 * but adapted for the launcher:
 *
 *   - On open we lazily `GET /v1/clans/<slug>/join-form` so the
 *     question schema reflects the clan's current `join_questions`
 *     exactly. The launcher carries no SSR'd page tree to bake the
 *     schema into, so we fetch on demand the same way the website
 *     does.
 *   - Private clans render an invite-only empty state — matches
 *     the web app's `@workspace/ui/components/empty` Empty.
 *   - Inline validation gates Submit until every required
 *     question has a non-empty trimmed answer and every answer ≤
 *     its `maxLength`.
 *   - Submit calls the launcher's `useRequestJoinClan` mutation
 *     (which forwards to `POST /v1/clans/:slug/request-join`).
 *
 * `clan` is still passed in for the header copy + initial
 * private-clan guess; if the join-form endpoint then re-confirms
 * `isPrivate: true` we render the invite-only state without
 * relying on the tooltip's value.
 */
export function RequestJoinClanDialog({
  slug,
  clanName,
  clan,
  open,
  onOpenChange,
}: {
  slug: string
  clanName: string
  clan: ClanProfile
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const requestJoin = useRequestJoinClan(slug)
  const [form, setForm] = React.useState<JoinFormPayload | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [answers, setAnswers] = React.useState<Record<string, string>>({})
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  // Re-fetch the join form every time the dialog opens so the
  // schema reflects the clan's current questions. A re-open
  // shouldn't keep stale state.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadError(null)
    setLoading(true)
    setForm(null)
    setAnswers({})
    setErrors({})
    void (async () => {
      try {
        const res = await httpFetch(getClanJoinFormUrl(slug), { headers: { Accept: 'application/json' } })
        if (cancelled) return
        if (res.status === 404 || res.status === 204) {
          // Clan is gone or the join-form endpoint declined
          // without a body — surface the invite-only empty state
          // so the dialog can fail closed without crashing.
          setForm({ isPrivate: true, joinQuestions: [] })
          return
        }
        if (!res.ok) {
          setLoadError("We couldn't load the application form. Try again.")
          return
        }
        const data = (await res.json()) as unknown
        const parsed = parseJoinFormPayload(data)
        if (!parsed.success) {
          setLoadError('The application form is unavailable right now.')
          return
        }
        setForm(parsed.data)
      } catch {
        if (!cancelled) {
          setLoadError("We couldn't load the application form. Try again.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, slug])

  function validate(): boolean {
    if (!form) return false
    const next: Record<string, string> = {}
    for (const q of form.joinQuestions) {
      const trimmed = (answers[q.id] ?? '').trim()
      if (trimmed.length === 0) {
        if (q.required) {
          next[q.id] = 'This field is required.'
        }
        continue
      }
      const maxLength = q.maxLength ?? (q.type === 'textarea' ? 1000 : 200)
      if (trimmed.length > maxLength) {
        next[q.id] = `Must be at most ${maxLength} characters.`
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!form) return
    if (!validate()) return
    try {
      await requestJoin.mutateAsync(answers)
      toast.success(`Application sent to ${clanName}`)
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not submit application', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const joinQuestions = form?.joinQuestions ?? []
  const isPrivate = form?.isPrivate ?? Boolean(clan.isPrivate)
  const hasQuestions = joinQuestions.length > 0
  const pending = requestJoin.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Request to join {clanName}</DialogTitle>
          <DialogDescription>
            {hasQuestions
              ? "Tell the leadership a bit about yourself. They'll review your application and let you in if it's a fit."
              : "Send a request to the clan leadership. They'll review it and let you in if it's a fit."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-border bg-accent/40 p-6 text-center">
            <p className="text-base font-medium text-foreground">
              Couldn&apos;t load the form
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          </div>
        ) : isPrivate ? (
          <div className="rounded-lg border border-border bg-accent/40 p-6 text-center">
            <p className="text-base font-medium text-foreground">
              This clan is invite-only
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask a member to send you an invite — direct applications are
              disabled.
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {joinQuestions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={answers[q.id] ?? ''}
                error={errors[q.id]}
                onChange={(value) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: value }))
                }
                onClearError={() =>
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next[q.id]
                    return next
                  })
                }
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || loading || !!loadError || isPrivate}
          >
            {pending ? (
              <Spinner className="size-4" />
            ) : hasQuestions ? (
              <Send className="size-4" />
            ) : (
              <UserPlus className="size-4" />
            )}
            {pending ? 'Sending…' : 'Send application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QuestionField({
  question,
  value,
  error,
  onChange,
  onClearError,
}: {
  question: JoinQuestion
  value: string
  error: string | undefined
  onChange: (next: string) => void
  onClearError: () => void
}) {
  const maxLength = question.maxLength ?? (question.type === 'textarea' ? 1000 : 200)
  const inputId = `rq-${question.id}`

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {question.label}
        {question.required ? (
          <span className="ml-1 text-destructive">*</span>
        ) : null}
      </Label>
      {question.type === 'textarea' ? (
        <Textarea
          id={inputId}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            if (error) onClearError()
          }}
          placeholder={question.placeholder ?? undefined}
          maxLength={maxLength}
          rows={4}
          aria-invalid={error ? true : undefined}
        />
      ) : (
        <Input
          id={inputId}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            if (error) onClearError()
          }}
          placeholder={question.placeholder ?? undefined}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
        />
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={error ? 'text-destructive' : 'text-muted-foreground'}>
          {error ?? (question.required ? 'Required' : 'Optional')}
        </span>
        <span className="shrink-0 tabular-nums">
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  )
}

/**
 * Validate the `GET /v1/clans/:slug/join-form` response shape.
 * Mirrors the website's `joinFormPayloadSchema` so a regression
 * surfaces here as a typed error and the dialog falls back to the
 * generic "form is unavailable" toast.
 */
function parseJoinFormPayload(
  data: unknown,
):
  | { success: true; data: JoinFormPayload }
  | { success: false } {
  if (
    data !== null &&
    typeof data === 'object' &&
    'isPrivate' in data &&
    'joinQuestions' in data &&
    typeof (data as { isPrivate: unknown }).isPrivate === 'boolean' &&
    Array.isArray((data as { joinQuestions: unknown }).joinQuestions)
  ) {
    return { success: true, data: data as JoinFormPayload }
  }
  return { success: false }
}

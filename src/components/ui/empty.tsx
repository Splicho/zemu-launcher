import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Empty-state shell. Mirrors the radix-nova `Empty` shape from the
 * website's `@workspace/ui`. Centered icon + title + description +
 * actions stack — used by the manage page's tabs when they have
 * nothing to render (no members matching the search, no pending
 * invites, etc.).
 *
 * Slots:
 *   - `data-slot="empty"`              — root container
 *   - `data-slot="empty-header"`       — icon + title + description
 *   - `data-slot="empty-media"`        — icon wrapper (or `img`)
 *   - `empty-title`                    — title
 *   - `empty-description`              — description
 *   - `data-slot="empty-content"`      — actions / footer
 *
 * Style notes:
 *   - Uses Tailwind tokens (`border`, `dashed`, `muted-foreground`)
 *     so a future theme swap doesn't need to touch the component.
 *   - The dashed border + 8/12 sizing matches the website's
 *     existing empty patterns.
 */
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-h-[120px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center",
        className,
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className,
      )}
      {...props}
    />
  )
}

function EmptyMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "icon" | "image"
}) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        variant === "image" && "size-auto overflow-hidden rounded-none bg-transparent",
        className,
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="empty-title"
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm flex-col items-center gap-2 text-center text-sm",
        className,
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
}

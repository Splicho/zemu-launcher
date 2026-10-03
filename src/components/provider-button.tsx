import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Login-screen provider button. Renders as a dark glass slab that sits
 * on top of the rotating game screenshots, with a brand-colored icon
 * tile on the left. On hover/focus the brand color sweeps in from the
 * left edge; `active` keeps it filled (used for the email button while
 * its form is expanded).
 *
 * The brand color is passed through the `--brand` CSS variable so every
 * layer (edge strip, tile, sweep, focus ring) stays in sync.
 */
export function ProviderButton({
  brand,
  icon,
  label,
  hint,
  active = false,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<'button'>, 'children'> & {
  brand: string
  icon: React.ReactNode
  label: string
  /** Small trailing note, e.g. "Last used". */
  hint?: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      style={{ '--brand': brand, ...style } as React.CSSProperties}
      className={cn(
        'group/provider relative flex h-14 w-full items-center gap-4 overflow-hidden rounded-md border border-white/10 bg-black/40 pr-4 pl-2 text-left text-white backdrop-blur-md',
        'transition-[border-color,transform] duration-200 ease-out',
        'hover:border-[color-mix(in_oklch,var(--brand)_60%,transparent)] data-active:border-[color-mix(in_oklch,var(--brand)_60%,transparent)]',
        'active:scale-[0.99]',
        'outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-50',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        className,
      )}
      {...props}
    >
      {/* Brand edge strip — always visible so each option is
          identifiable at a glance even before hover. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] bg-[var(--brand)]"
      />
      {/* Brand sweep. Scales in from the left edge on hover/focus. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 origin-left scale-x-0 bg-[linear-gradient(90deg,color-mix(in_oklch,var(--brand)_80%,transparent)_0%,color-mix(in_oklch,var(--brand)_25%,transparent)_100%)]',
          'transition-transform duration-300 ease-out motion-reduce:transition-none',
          'group-hover/provider:scale-x-100 group-focus-visible/provider:scale-x-100 group-data-active/provider:scale-x-100',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative grid size-10 shrink-0 place-items-center rounded-sm bg-[var(--brand)] shadow-[0_0_24px_-6px_var(--brand)] [&_svg]:size-5',
          'transition-colors duration-300 group-hover/provider:bg-white/15 group-data-active/provider:bg-white/15',
        )}
      >
        {icon}
      </span>
      <span className="relative min-w-0 flex-1 truncate text-[15px] font-medium">
        {label}
      </span>
      {hint ? (
        <span className="relative shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80">
          {hint}
        </span>
      ) : null}
    </button>
  )
}

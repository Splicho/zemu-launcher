import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * shadcn radix-nova Button, extended with the three OAuth variants the
 * launcher auth screen needs: `discord`, `steam`, `email`. Each one
 * pulls its brand color from the `--oauth` CSS variable (set via
 * `style={{ '--oauth': OAUTH_BRAND_COLORS[variant] }}` below) and
 * relies on the `[data-variant="oauth"]:hover/:active` rule in
 * `index.css` to darken the background via `--oauth-hover`.
 *
 * The base CVA + Button body is verbatim from the shadcn CLI's
 * `radix-nova` style — we only add OAuth variants and the brand-color
 * style binding.
 */
const buttonVariants = cva(
    "group/button relative inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background,background-color,background-image,box-shadow] duration-150 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
      variants: {
        variant: {
          default: "bg-primary text-foreground hover:bg-primary/80",
          outline:
            "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
          secondary:
            "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
          ghost:
            "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
          destructive:
            "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
          link: "text-primary underline-offset-4 hover:underline",
          gradient:
            "relative rounded-lg overflow-hidden bg-[linear-gradient(to_top,oklch(0.5_0.16_29.11)_0%,var(--primary)_100%)] text-foreground shadow-[0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1),inset_0_1px_0_oklch(1_0_0/0.15)] hover:bg-[linear-gradient(to_top,oklch(0.45_0.16_29.11)_0%,oklch(0.32_0.14_29.11)_100%)] active:bg-[linear-gradient(to_top,oklch(0.42_0.16_29.11)_0%,oklch(0.29_0.14_29.11)_100%)]",
          ring: "inset_0_1px_0_oklch(1_0_0/0.15)] relative overflow-visible bg-[linear-gradient(to_top,oklch(0.5_0.16_29.11)_0%,var(--primary)_100%)] text-foreground before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:[box-shadow:0_0_0_0_transparent,0_0_0_0_transparent] before:transition-[box-shadow] before:duration-200 before:ease-out hover:bg-[linear-gradient(to_top,oklch(0.45_0.16_29.11)_0%,oklch(0.32_0.14_29.11)_100%)] focus-visible:ring-0 focus-visible:before:[box-shadow:0_0_0_2px_var(--background),0_0_0_4px_oklch(0.708_0_0)] active:bg-[linear-gradient(to_top,oklch(0.42_0.16_29.11)_0%,oklch(0.29_0.14_29.11)_100%)] active:before:[box-shadow:0_0_0_2px_var(--background),0_0_0_4px_oklch(0.708_0_0)] active:before:duration-100",
          oauth:
            "h-12! rounded-xl bg-[var(--oauth)] text-base font-normal text-white hover:bg-[var(--oauth-hover,var(--oauth))] active:bg-[var(--oauth-hover,var(--oauth))] [&_[data-slot=spinner]]:!text-white/80",
        discord:
          "bg-[#5865F2] text-white hover:bg-[#4752C4] shadow-[0_2px_8px_0_rgba(88,101,242,0.15)] border-t border-t-white/40 active:ring-2 active:ring-[#5865F2] active:ring-offset-3 active:ring-offset-background focus-visible:ring-1 focus-visible:ring-[#5865F2] focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        steam:
          "bg-[#1B2838] text-white hover:bg-[#14202E] shadow-[0_2px_8px_0_rgba(27,40,56,0.25)] border-t border-t-white/20 active:ring-2 active:ring-[#1B2838] active:ring-offset-3 active:ring-offset-background focus-visible:ring-1 focus-visible:ring-[#1B2838] focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        email:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-[0_2px_8px_0_rgba(0,0,0,0.05)] border-t border-t-white/20 active:ring-2 active:ring-ring active:ring-offset-3 active:ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Brand colors for each OAuth provider. Fed into `--oauth` on the
// rendered element so the global hover/active rule can darken them.
// Keep these in sync with the abyssal-gate launcher's auth buttons.
const OAUTH_BRAND_COLORS = {
  discord: "oklch(0.4852 0.1873 271.05)", // Discord blurple (#5865F2)
  steam: "oklch(0.278 0.039 257.85)", // Steam navy (#1B2838)
  email: "oklch(0.269 0 0)", // Neutral slate-900-ish
} as const

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  style,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  // Inject --oauth for the OAuth variants so the global hover rule can
  // darken them. We override the data-variant for these three to the
  // literal string "oauth" so the index.css selector matches.
  const isOauth = variant === "discord" || variant === "steam" || variant === "email"
  const oauthStyle = isOauth
    ? ({ "--oauth": OAUTH_BRAND_COLORS[variant as keyof typeof OAUTH_BRAND_COLORS], ...style } as React.CSSProperties)
    : style

  return (
    <Comp
      data-slot="button"
      data-variant={isOauth ? "oauth" : variant}
      data-size={size}
      style={oauthStyle}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
/**
 * Brand icons for the auth screen's OAuth buttons. Plain inline SVG so
 * we don't pull in a full icon pack — these are the only two the
 * launcher auth flow actually supports (Discord + Steam).
 *
 * Each icon takes `size` (default 20) and `className` for color/spacing.
 * `DiscordFilled` is the solid Discord mark (white on brand blurple);
 * `Steam` is the wordmark + ring in white. Both render at any size via
 * the `size` prop.
 */

import * as React from 'react'

interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number
}

export function Home({ size = 20, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
	<path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 11.99v2.51c0 3.3 0 4.95 1.025 5.975S6.7 21.5 10 21.5h4c3.3 0 4.95 0 5.975-1.025S21 17.8 21 14.5v-2.51c0-1.682 0-2.522-.356-3.25s-1.02-1.244-2.346-2.276l-2-1.555C14.233 3.303 13.2 2.5 12 2.5s-2.233.803-4.298 2.409l-2 1.555C4.375 7.496 3.712 8.012 3.356 8.74S3 10.308 3 11.99M16 17H8"></path>
</svg>
  )
}

export function DiscordFilled({ size = 20, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
	<path fill="currentColor" d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.6 18.6 0 0 0-5.487 0a12 12 0 0 0-.617-1.23A.08.08 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.1.1 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055a20 20 0 0 0 5.993 2.98a.08.08 0 0 0 .084-.026a14 14 0 0 0 1.226-1.963a.074.074 0 0 0-.041-.104a13 13 0 0 1-1.872-.878a.075.075 0 0 1-.008-.125q.19-.14.372-.287a.08.08 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.08.08 0 0 1 .079.009q.18.148.372.288a.075.075 0 0 1-.006.125q-.895.515-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.08.08 0 0 0 .084.028a20 20 0 0 0 6.002-2.981a.08.08 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028M8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38c0-1.312.956-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.956 2.38-2.157 2.38m7.975 0c-1.183 0-2.157-1.069-2.157-2.38c0-1.312.955-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.946 2.38-2.157 2.38"></path>
</svg>
  )
}

export function Steam({ size = 20, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" {...props}>
	<g fill="currentColor">
		<path d="M.329 10.333A8.01 8.01 0 0 0 7.99 16C12.414 16 16 12.418 16 8s-3.586-8-8.009-8A8.006 8.006 0 0 0 0 7.468l.003.006l4.304 1.769A2.2 2.2 0 0 1 5.62 8.88l1.96-2.844l-.001-.04a3.046 3.046 0 0 1 3.042-3.043a3.046 3.046 0 0 1 3.042 3.043a3.047 3.047 0 0 1-3.111 3.044l-2.804 2a2.223 2.223 0 0 1-3.075 2.11a2.22 2.22 0 0 1-1.312-1.568L.33 10.333Z"></path>
		<path d="M4.868 12.683a1.715 1.715 0 0 0 1.318-3.165a1.7 1.7 0 0 0-1.263-.02l1.023.424a1.261 1.261 0 1 1-.97 2.33l-.99-.41a1.7 1.7 0 0 0 .882.84Zm3.726-6.687a2.03 2.03 0 0 0 2.027 2.029a2.03 2.03 0 0 0 2.027-2.029a2.03 2.03 0 0 0-2.027-2.027a2.03 2.03 0 0 0-2.027 2.027m2.03-1.527a1.524 1.524 0 1 1-.002 3.048a1.524 1.524 0 0 1 .002-3.048"></path>
	</g>
</svg>
  )
}

export function Mail({ size = 20, ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 36 36" {...props}>
    <path fill="currentColor" d="M32.33 6a2 2 0 0 0-.41 0h-28a2 2 0 0 0-.53.08l14.45 14.39Z" className="clr-i-solid clr-i-solid-path-1"></path>
    <path fill="currentColor" d="m33.81 7.39l-14.56 14.5a2 2 0 0 1-2.82 0L2 7.5a2 2 0 0 0-.07.5v20a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V8a2 2 0 0 0-.12-.61M5.3 28H3.91v-1.43l7.27-7.21l1.41 1.41Zm26.61 0h-1.4l-7.29-7.23l1.41-1.41l7.27 7.21Z" className="clr-i-solid clr-i-solid-path-2"></path>
    <path fill="none" d="M0 0h36v36H0z"></path>
  </svg>
  )
}

export function AlertTriangle({ size = 20, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
	<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
		<path d="M13.925 21h-3.85c-4.63 0-6.945 0-7.799-1.506c-.853-1.506.331-3.503 2.7-7.495L6.9 8.753C9.176 4.918 10.313 3 12 3s2.824 1.918 5.1 5.753L19.023 12c2.369 3.992 3.553 5.989 2.7 7.495C20.87 21 18.555 21 13.924 21M12 17v-4"></path>
		<path d="M12 9.25h.125m.125 0a.25.25 0 1 0-.5 0a.25.25 0 0 0 .5 0"></path>
	</g>
</svg>
  )
}

/**
 * Window-chrome icons used by the custom title bar.
 *
 * Inline SVGs (instead of pulling in an icon pack) to match the
 * abyssal-gate launcher's icon set verbatim — visual parity between
 * the two launcher shells matters here.
 *
 * Only `WindowMinimize` and `WindowClose` are rendered today (the
 * main window is locked at a fixed size; maximize is intentionally
 * absent). `WindowMaximize` / `WindowRestore` are kept for parity so
 * re-enabling maximize later is a one-line change.
 */
export function WindowMinimize({ size = 16, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
	<path fill="currentColor" d="M4 19h16v2H4z" strokeWidth={0.5} stroke="currentColor"></path>
</svg>
  )
}

export function WindowMaximize({ size = 16, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
	<path fill="none" stroke="currentColor" strokeWidth="2" d="M5 5h14v14H5z"></path>
</svg>
  )
}

export function WindowRestore({ size = 16, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
	<path fill="none" stroke="currentColor" strokeWidth="2" d="M8 4h10v10H4V4zm4 4v10h10V8"></path>
</svg>
  )
}

export function WindowClose({ size = 16, ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
	<path fill="currentColor" d="M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46z" strokeWidth={0.5} stroke="currentColor"></path>
</svg>
  )
}
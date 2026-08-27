
import * as React from 'react'

interface IconProps extends React.SVGAttributes<SVGSVGElement> {

  size?: number
}


export function Home({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
	<path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 11.99v2.51c0 3.3 0 4.95 1.025 5.975S6.7 21.5 10 21.5h4c3.3 0 4.95 0 5.975-1.025S21 17.8 21 14.5v-2.51c0-1.682 0-2.522-.356-3.25s-1.02-1.244-2.346-2.276l-2-1.555C14.233 3.303 13.2 2.5 12 2.5s-2.233.803-4.298 2.409l-2 1.555C4.375 7.496 3.712 8.012 3.356 8.74S3 10.308 3 11.99M16 17H8"></path>
</svg>
  )
}

export function ArrowRight({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
     
      {...props}
    >
      <path
        fill="currentColor"
        d="M4 11v2h12l-5.5 5.5l1.42 1.42L19.84 12l-7.92-7.92L10.5 5.5L16 11z"
      ></path>
    </svg>
  )
}

export function Twitch({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
     
      {...props}
    >
      <path
        fill="currentColor"
        d="M11.64 5.93h1.43v4.28h-1.43m3.93-4.28H17v4.28h-1.43M7 2L3.43 5.57v12.86h4.28V22l3.58-3.57h2.85L20.57 12V2m-1.43 9.29l-2.85 2.85h-2.86l-2.5 2.5v-2.5H7.71V3.43h11.43Z"
      ></path>
    </svg>
  )
}

export function YouTube({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
     
      {...props}
    >
      <path
        fill="currentColor"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814M9.545 15.568V8.432L15.818 12z"
      ></path>
    </svg>
  )
}

export function Socialize({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
	<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
		<path d="M8.5 3.708A2.5 2.5 0 0 0 6 8m-2.625 8.5C2.615 16.5 2 15.859 2 15.068c0-1.61 1.667-3.219 4.5-3.528m9-7.832A2.5 2.5 0 0 1 18 8m2.625 8.5c.76 0 1.375-.642 1.375-1.433c0-1.609-1.666-3.218-4.5-3.527"></path>
		<circle cx={12} cy={8.5} r={3}></circle>
		<path d="M12 14.5c-3.75 0-6 2.143-6 4.286c0 .947.672 1.714 1.5 1.714h9c.828 0 1.5-.767 1.5-1.714c0-2.143-2.25-4.286-6-4.286"></path>
	</g>
</svg>
  )
}

export function Twitter({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
     
      {...props}
    >
      <path
        fill="currentColor"
        d="M9.294 6.928L14.357 1h-1.2L8.762 6.147L5.25 1H1.2l5.31 7.784L1.2 15h1.2l4.642-5.436L10.751 15h4.05zM7.651 8.852l-.538-.775L2.832 1.91h1.843l3.454 4.977l.538.775l4.491 6.47h-1.843z"
      ></path>
    </svg>
  )
}

export function ChevronRight({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
	<path fill="currentColor" d="M12.6 12L8 7.4L9.4 6l6 6l-6 6L8 16.6z"></path>
</svg>
  )
}

export function News({ ...props }: IconProps) {
  
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
      <path d="M18 15V9c0-2.828 0-4.243-.879-5.121C16.243 3 14.828 3 12 3H8c-2.828 0-4.243 0-5.121.879C2 4.757 2 6.172 2 9v6c0 2.828 0 4.243.879 5.121C3.757 21 5.172 21 8 21h12M6 8h8m-8 4h8m-8 4h4"></path>
      <path d="M18 8h1c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v8a2 2 0 1 1-4 0z"></path>
    </g>
  </svg>
  )
}

export function Leaderboard({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.5 18c0-1.414 0-2.121.44-2.56C4.378 15 5.085 15 6.5 15H7c.943 0 1.414 0 1.707.293S9 16.057 9 17v5H3.5zM15 19c0-.943 0-1.414.293-1.707S16.057 17 17 17h.5c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v2H15zM2 22h20M9 16c0-1.414 0-2.121.44-2.56C9.878 13 10.585 13 12 13s2.121 0 2.56.44c.44.439.44 1.146.44 2.56v6H9zm3.691-13.422l.704 1.42a.87.87 0 0 0 .568.423l1.276.213c.816.137 1.008.734.42 1.323l-.992 1a.88.88 0 0 0-.208.73l.284 1.238c.224.98-.292 1.359-1.152.847l-1.196-.714a.86.86 0 0 0-.792 0l-1.196.714c-.856.512-1.376.129-1.152-.847l.284-1.238a.88.88 0 0 0-.208-.73l-.991-1c-.584-.589-.396-1.186.42-1.323l1.275-.213a.87.87 0 0 0 .564-.424l.704-1.42c.384-.77 1.008-.77 1.388 0"></path>
</svg>
  )
}

export function DiscordFilled({ ...props }: IconProps) {
  
  return (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="currentColor" d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.6 18.6 0 0 0-5.487 0a12 12 0 0 0-.617-1.23A.08.08 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.1.1 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055a20 20 0 0 0 5.993 2.98a.08.08 0 0 0 .084-.026a14 14 0 0 0 1.226-1.963a.074.074 0 0 0-.041-.104a13 13 0 0 1-1.872-.878a.075.075 0 0 1-.008-.125q.19-.14.372-.287a.08.08 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.08.08 0 0 1 .079.009q.18.148.372.288a.075.075 0 0 1-.006.125q-.895.515-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.08.08 0 0 0 .084.028a20 20 0 0 0 6.002-2.981a.08.08 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028M8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38c0-1.312.956-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.956 2.38-2.157 2.38m7.975 0c-1.183 0-2.157-1.069-2.157-2.38c0-1.312.955-2.38 2.157-2.38c1.21 0 2.176 1.077 2.157 2.38c0 1.312-.946 2.38-2.157 2.38"></path>
</svg>
  )
}


export function Steam({ ...props }: IconProps) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" {...props} >
	<g fill="currentColor">
		<path d="M.329 10.333A8.01 8.01 0 0 0 7.99 16C12.414 16 16 12.418 16 8s-3.586-8-8.009-8A8.006 8.006 0 0 0 0 7.468l.003.006l4.304 1.769A2.2 2.2 0 0 1 5.62 8.88l1.96-2.844l-.001-.04a3.046 3.046 0 0 1 3.042-3.043a3.046 3.046 0 0 1 3.042 3.043a3.047 3.047 0 0 1-3.111 3.044l-2.804 2a2.223 2.223 0 0 1-3.075 2.11a2.22 2.22 0 0 1-1.312-1.568L.33 10.333Z"></path>
		<path d="M4.868 12.683a1.715 1.715 0 0 0 1.318-3.165a1.7 1.7 0 0 0-1.263-.02l1.023.424a1.261 1.261 0 1 1-.97 2.33l-.99-.41a1.7 1.7 0 0 0 .882.84Zm3.726-6.687a2.03 2.03 0 0 0 2.027 2.029a2.03 2.03 0 0 0 2.027-2.029a2.03 2.03 0 0 0-2.027-2.027a2.03 2.03 0 0 0-2.027 2.027m2.03-1.527a1.524 1.524 0 1 1-.002 3.048a1.524 1.524 0 0 1 .002-3.048"></path>
	</g>
</svg>
  )
}

export function Mail({ ...props }: IconProps) {
  
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="1em" height="1em" {...props}>
    <path fill="currentColor" d="M32.33 6a2 2 0 0 0-.41 0h-28a2 2 0 0 0-.53.08l14.45 14.39Z" className="clr-i-solid clr-i-solid-path-1"></path>
    <path fill="currentColor" d="m33.81 7.39l-14.56 14.5a2 2 0 0 1-2.82 0L2 7.5a2 2 0 0 0-.07.5v20a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2V8a2 2 0 0 0-.12-.61M5.3 28H3.91v-1.43l7.27-7.21l1.41 1.41Zm26.61 0h-1.4l-7.29-7.23l1.41-1.41l7.27 7.21Z" className="clr-i-solid clr-i-solid-path-2"></path>
    <path fill="none" d="M0 0h36v36H0z"></path>
  </svg>
  )
}

export function AlertTriangle({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
		<path d="M13.925 21h-3.85c-4.63 0-6.945 0-7.799-1.506c-.853-1.506.331-3.503 2.7-7.495L6.9 8.753C9.176 4.918 10.313 3 12 3s2.824 1.918 5.1 5.753L19.023 12c2.369 3.992 3.553 5.989 2.7 7.495C20.87 21 18.555 21 13.924 21M12 17v-4"></path>
		<path d="M12 9.25h.125m.125 0a.25.25 0 1 0-.5 0a.25.25 0 0 0 .5 0"></path>
	</g>
</svg>
  )
}

export function Box({ ...props }: IconProps) {
    
    return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="1em" height="1em" {...props}>
	<path fill="currentColor" d="M425.7 256c-16.9 0-32.8-9-41.4-23.4L320 126l-64.2 106.6c-8.7 14.5-24.6 23.5-41.5 23.5c-4.5 0-9-.6-13.3-1.9L64 215v178c0 14.7 10 27.5 24.2 31l216.2 54.1c10.2 2.5 20.9 2.5 31 0L551.8 424c14.2-3.6 24.2-16.4 24.2-31V215l-137 39.1c-4.3 1.3-8.8 1.9-13.3 1.9m212.6-112.2L586.8 41c-3.1-6.2-9.8-9.8-16.7-8.9L320 64l91.7 152.1c3.8 6.3 11.4 9.3 18.5 7.3l197.9-56.5c9.9-2.9 14.7-13.9 10.2-23.1M53.2 41L1.7 143.8c-4.6 9.2.3 20.2 10.1 23l197.9 56.5c7.1 2 14.7-1 18.5-7.3L320 64L69.8 32.1c-6.9-.8-13.5 2.7-16.6 8.9"></path>
</svg>
    )
}

export function Eye({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
		<path d="M21.257 10.962c.474.62.474 1.457 0 2.076C19.764 14.987 16.182 19 12 19s-7.764-4.013-9.257-5.962a1.69 1.69 0 0 1 0-2.076C4.236 9.013 7.818 5 12 5s7.764 4.013 9.257 5.962"></path>
		<circle cx={12} cy={12} r={3}></circle>
	</g>
</svg>
  )
}

export function Play({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      {...props}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M18.89 12.846c-.353 1.343-2.023 2.292-5.364 4.19c-3.23 1.835-4.845 2.752-6.146 2.384a3.25 3.25 0 0 1-1.424-.841C5 17.614 5 15.743 5 12s0-5.614.956-6.579a3.25 3.25 0 0 1 1.424-.84c1.301-.37 2.916.548 6.146 2.383c3.34 1.898 5.011 2.847 5.365 4.19a3.3 3.3 0 0 1 0 1.692Z"
      ></path>
    </svg>
  )
}

export function Rewind10({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      {...props}
    >
      <path
        fill="currentColor"
        d="M4 18A12 12 0 1 0 16 6h-4V1L6 7l6 6V8h4A10 10 0 1 1 6 18Z"
      ></path>
      <path
        fill="currentColor"
        d="M19.63 22.13a2.84 2.84 0 0 1-1.28-.27a2.44 2.44 0 0 1-.89-.77a3.6 3.6 0 0 1-.52-1.25a7.7 7.7 0 0 1-.17-1.68a8 8 0 0 1 .17-1.68a3.7 3.7 0 0 1 .52-1.25a2.44 2.44 0 0 1 .89-.77a2.84 2.84 0 0 1 1.28-.27a2.44 2.44 0 0 1 2.16 1a5.23 5.23 0 0 1 .7 2.93a5.23 5.23 0 0 1-.7 2.93a2.44 2.44 0 0 1-2.16 1.08m0-1.22a1.07 1.07 0 0 0 1-.55a3.4 3.4 0 0 0 .37-1.51v-1.38a3.3 3.3 0 0 0-.29-1.5a1.23 1.23 0 0 0-2.06 0a3.3 3.3 0 0 0-.29 1.5v1.38a3.4 3.4 0 0 0 .29 1.51a1.06 1.06 0 0 0 .98.55m-9 1.09v-1.18h2v-5.19l-1.86 1l-.55-1.06l2.32-1.3H14v6.5h1.78V22Z"
      ></path>
    </svg>
  )
}
export function Forward10({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="1em"
      height="1em"  
      {...props}
    >
      <path
        fill="currentColor"
        d="M26 18A10 10 0 1 1 16 8h4v5l6-6l-6-6v5h-4a12 12 0 1 0 12 12Z"
      ></path>
      <path
        fill="currentColor"
        d="M19.63 22.13a2.84 2.84 0 0 1-1.28-.27a2.44 2.44 0 0 1-.89-.77a3.6 3.6 0 0 1-.52-1.25a7.7 7.7 0 0 1-.17-1.68a8 8 0 0 1 .17-1.68a3.7 3.7 0 0 1 .52-1.25a2.44 2.44 0 0 1 .89-.77a2.84 2.84 0 0 1 1.28-.27a2.44 2.44 0 0 1 2.16 1a5.23 5.23 0 0 1 .7 2.93a5.23 5.23 0 0 1-.7 2.93a2.44 2.44 0 0 1-2.16 1.08m0-1.22a1.07 1.07 0 0 0 1-.55a3.4 3.4 0 0 0 .37-1.51v-1.38a3.3 3.3 0 0 0-.29-1.5a1.23 1.23 0 0 0-2.06 0a3.3 3.3 0 0 0-.29 1.5v1.38a3.4 3.4 0 0 0 .29 1.51a1.06 1.06 0 0 0 .98.55m-9 1.09v-1.18h2v-5.19l-1.86 1l-.55-1.06l2.32-1.3H14v6.5h1.78V22Z"
      ></path>
    </svg>
  )
}


export function Pause({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="none" stroke="currentColor" strokeWidth={1.5} d="M4 7c0-1.414 0-2.121.44-2.56C4.878 4 5.585 4 7 4s2.121 0 2.56.44C10 4.878 10 5.585 10 7v10c0 1.414 0 2.121-.44 2.56C9.122 20 8.415 20 7 20s-2.121 0-2.56-.44C4 19.122 4 18.415 4 17zm10 0c0-1.414 0-2.121.44-2.56C14.878 4 15.585 4 17 4s2.121 0 2.56.44C20 4.878 20 5.585 20 7v10c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44s-2.121 0-2.56-.44C14 19.122 14 18.415 14 17z"></path>
</svg>
  )
}

export function Cancel({ ...props }: IconProps) {
  
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      {...props}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M6 6l12 12M18 6L6 18"
      />
    </svg>
  )
}

export function WindowMinimize({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="currentColor" d="M4 19h16v2H4z" strokeWidth={0.5} stroke="currentColor"></path>
</svg>
  )
}

export function WindowMaximize({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="none" stroke="currentColor" strokeWidth="2" d="M5 5h14v14H5z"></path>
</svg>
  )
}

export function WindowRestore({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="currentColor" d="M4 4h16v16H4zm2 2v12h12V6z"></path>
</svg>
  )
}

export function WindowClose({ ...props }: IconProps) {
  
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" {...props}>
	<path fill="currentColor" d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z"></path>
</svg>
  )
}

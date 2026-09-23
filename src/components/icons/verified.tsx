import type { SVGProps } from 'react'

/**
 * Staff-verified badge — a shield with a checkmark, drawn at the
 * 256×256 viewBox the source asset uses. The fill is a yellow →
 * orange linear gradient (preserved from the source SVG) so the
 * badge stays distinct from the monochrome icons in the launcher —
 * `currentColor` would have muted it down to whatever the parent
 * text colour is, which is exactly what we *don't* want for a
 * trust signal.
 *
 * Mirrors `@workspace/ui/components/icon#Verified` on the
 * website (same gradient stops, same viewBox) so the launcher's
 * clan pages match the website's badge 1:1.
 *
 * The gradient id is preserved from the source SVG. Browsers
 * resolve `url(#…)` to the first matching id in the document, so
 * rendering many of these on one page will all reference the same
 * gradient stop — which is fine here because every instance uses
 * the identical stops and coordinates.
 */
export function Verified(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 256 256"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M41.1281 74.2402C41.3201 83.9554 36.0337 97.0882 29.1601 103.949C22.7819 110.333 19.1992 118.989 19.1992 128.013C19.1992 137.037 22.7819 145.693 29.1601 152.077C35.9441 158.835 40.9361 170.56 41.1281 180.135C41.3073 188.608 44.6225 197.031 51.0865 203.482C57.0502 209.458 65.0281 212.995 73.4609 213.402C83.5857 213.914 96.8465 219.802 104.014 226.97C110.398 233.344 119.051 236.924 128.072 236.924C137.093 236.924 145.746 233.344 152.13 226.97C159.298 219.802 172.558 213.914 182.683 213.402C191.116 212.995 199.094 209.458 205.058 203.482C211.275 197.273 214.84 188.894 215.003 180.109C215.195 170.56 220.123 158.912 226.894 152.154C233.297 145.772 236.902 137.107 236.916 128.067C236.931 119.027 233.353 110.352 226.971 103.949C220.11 97.101 214.811 83.9554 215.016 74.253C215.112 69.6721 214.28 65.1191 212.568 60.8689C210.857 56.6186 208.302 52.7592 205.058 49.5234C201.696 46.1524 197.661 43.527 193.218 41.8178C188.774 40.1087 184.02 39.3542 179.266 39.6034C170.126 40.0642 158.594 35.6354 152.13 29.1586C145.745 22.7805 137.09 19.1978 128.066 19.1978C119.041 19.1978 110.386 22.7805 104.002 29.1586C97.5505 35.6226 86.0049 40.0642 76.8657 39.6034C72.1133 39.356 67.362 40.1114 62.9206 41.8205C58.4792 43.5296 54.4472 46.1541 51.0865 49.5234C47.844 52.7577 45.29 56.615 43.5785 60.863C41.867 65.1109 41.0334 69.6614 41.1281 74.2402ZM166.926 84.813C168.397 85.6288 169.692 86.7263 170.738 88.0428C171.784 89.3592 172.56 90.8689 173.023 92.4855C173.485 94.102 173.624 95.7939 173.433 97.4644C173.241 99.1348 172.722 100.751 171.906 102.221L136.475 165.991C135.558 167.727 134.252 169.23 132.661 170.381C130.348 172.054 127.542 172.907 124.69 172.802C121.837 172.698 119.101 171.643 116.917 169.805L81.6017 141.555C80.2889 140.505 79.1959 139.206 78.385 137.733C77.5742 136.26 77.0614 134.642 76.876 132.971C76.6906 131.299 76.8362 129.608 77.3044 127.993C77.7726 126.378 78.5543 124.871 79.6049 123.559C80.6555 122.246 81.9543 121.153 83.4273 120.342C84.9003 119.531 86.5186 119.018 88.1897 118.833C89.8609 118.648 91.5522 118.793 93.1671 119.261C94.782 119.73 96.2889 120.511 97.6017 121.562L121.32 140.544L149.518 89.7794C150.335 88.3103 151.434 87.0164 152.751 85.9717C154.068 84.927 155.577 84.1519 157.194 83.6907C158.81 83.2295 160.502 83.0913 162.172 83.2839C163.842 83.4764 165.457 83.996 166.926 84.813Z"
        fill="url(#paint0_linear_launcher_verified_)"
      />
      <defs>
        <linearGradient
          id="paint0_linear_launcher_verified_"
          x1="53.5"
          y1="49.5"
          x2="210.5"
          y2="206.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFD884"></stop>
          <stop offset="1" stopColor="#FFA526"></stop>
        </linearGradient>
      </defs>
    </svg>
  )
}

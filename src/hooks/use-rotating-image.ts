import { useEffect, useState } from 'react'

/**
 * Returns one entry of `images`, advancing to the next every
 * `intervalMs` and wrapping around. A single-entry list never changes.
 */
export function useRotatingImage<T extends string>(
  images: readonly T[],
  intervalMs: number,
): T {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (images.length < 2) return
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % images.length)
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [images.length, intervalMs])

  return images[index % images.length]
}

import { createContext, useContext, useEffect } from 'react'

/**
 * Lets a page supply `MainLayout`'s full-window backdrop image at
 * runtime — e.g. the play page's screenshot rotation, or a
 * clan's cover, which is only known after a fetch.
 * `MainLayout` owns the state and provides the setter.
 */
const PageBackgroundContext = createContext<(src: string | null) => void>(
  () => {},
)

export const PageBackgroundProvider = PageBackgroundContext.Provider

/**
 * Shows `src` as the layout backdrop while the calling page is mounted
 * (or until `src` changes). Pass `null` to show none.
 */
export function usePageBackground(src: string | null) {
  const setBackground = useContext(PageBackgroundContext)
  useEffect(() => {
    setBackground(src)
    return () => setBackground(null)
  }, [src, setBackground])
}

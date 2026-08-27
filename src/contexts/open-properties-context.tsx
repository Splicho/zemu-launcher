/**
 * Tiny context exposing the "open Properties at section X" action.
 *
 * Why this exists: `AppSidebar` owns the `PropertiesModal` because
 * the sidebar is what mounts it (next to the "Properties…" context
 * menu entry). The "License required" primary button lives in
 * `GameActionButton` (rendered by `PlayHeader`), which is a sibling
 * of `AppSidebar` inside `MainLayout`. Without a context, the
 * "License required" click handler would have to be plumbed down
 * through `MainLayout -> PlayHeader -> GameActionButton`.
 *
 * Instead, `AppSidebar` registers the handler once at mount, and any
 * deeply-nested component can call `usePropertiesModalOpener()` to
 * open the modal pinned to a given section.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'

export type OpenProperties = (section?: 'install' | 'license') => void

const OpenPropertiesContext = createContext<OpenProperties | null>(null)

export function OpenPropertiesProvider({
  open,
  children,
}: {
  open: OpenProperties
  children: ReactNode
}) {
  // `open` is wrapped in useMemo only to avoid re-rendering consumers
  // every time the parent re-renders with a new function reference.
  // In practice `AppSidebar` wraps its own callback in `useCallback`
  // already, so this is belt-and-suspenders.
  const value = useMemo(() => open, [open])
  return (
    <OpenPropertiesContext.Provider value={value}>
      {children}
    </OpenPropertiesContext.Provider>
  )
}

export function usePropertiesModalOpener(): OpenProperties {
  const opener = useContext(OpenPropertiesContext)
  if (!opener) {
    throw new Error(
      'usePropertiesModalOpener must be used inside <OpenPropertiesProvider>',
    )
  }
  return opener
}
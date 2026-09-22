import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SortableHeader({
  label,
  align = 'left',
  sorted = false,
  onToggle,
  className,
}: {
  label: string
  align?: 'left' | 'center' | 'right'
  sorted?: false | 'asc' | 'desc'
  onToggle?: (event: unknown) => void
  className?: string
}) {
  const SortIcon =
    sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-sort={
        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-1 tracking-wide uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        align === 'right' && 'w-full justify-end',
        align === 'center' && 'w-full justify-center',
        className,
      )}
    >
      <span>{label}</span>
      <SortIcon
        aria-hidden
        className={cn(
          'size-3.5 shrink-0',
          sorted ? 'text-foreground' : 'text-foreground/40',
        )}
      />
    </button>
  )
}

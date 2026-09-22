import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

const COLUMNS = 9
const ROWS = 8

export default function LeaderboardSkeleton() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-foreground/10 bg-background">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: COLUMNS }).map((_, i) => (
              <TableHead
                key={i}
                className="tracking-wide uppercase text-foreground/70"
              >
                <Skeleton className="h-4 w-24" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: ROWS }).map((_, rowIdx) => (
            <TableRow key={rowIdx}>
              {Array.from({ length: COLUMNS }).map((_, colIdx) => (
                <TableCell key={colIdx}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

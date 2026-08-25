import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface CircularProgressProps {
  progress: number
  size?: number
  strokeWidth?: number
}

export function CircularProgress({ progress, size = 48, strokeWidth = 4 }: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (progress / 100) * circumference

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.3 }}
        strokeLinecap="round"
        className="text-green-500"
      />
    </svg>
  )
}

interface UpdateProgressProps {
  progress: number
  label?: string
}

export function UpdateProgress({ progress, label }: UpdateProgressProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <CircularProgress progress={progress} size={48} strokeWidth={4} />
      {label && (
        <motion.span
          key={label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-muted-foreground"
        >
          {label}
        </motion.span>
      )}
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

/**
 * Kills-per-match area chart.
 *
 * Deliberately its own module so the player Overview tab can pull it in with
 * `React.lazy`: recharts (+ d3) is the heaviest dependency in the app and is
 * only needed once a profile with matches is opened, so it lives in an async
 * chunk instead of the startup bundle.
 */
export default function PlayerKillsChart({
  data,
}: {
  data: Array<{ match: number; kills: number }>
}) {
  const { t } = useTranslation()

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="player-kills-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7a0101" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#7a0101" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="currentColor" strokeOpacity={0.08} vertical={false} />
        <XAxis
          dataKey="match"
          tickFormatter={(value: number) => `#${value}`}
          stroke="currentColor"
          strokeOpacity={0.35}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          stroke="currentColor"
          strokeOpacity={0.35}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(label) => t('player.stats.matchNumber', { number: String(label) })}
          formatter={(value) => [String(value), t('player.stats.kills')]}
        />
        <Area
          type="monotone"
          dataKey="kills"
          stroke="#9c0b0b"
          strokeWidth={1.5}
          fill="url(#player-kills-fill)"
          dot={false}
          activeDot={{ r: 3, fill: '#9c0b0b' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { useMemo } from 'react';

export default function RunningRateTrendChart({ data, theme, onLineClick, height = 240 }) {
  const isDark = theme?.isDark !== false && theme?.id !== 'light';
  const textColor = theme?.text || (isDark ? '#e2e8f0' : '#1e293b');
  const dimColor = theme?.textDim || (isDark ? '#94a3b8' : '#64748b');
  const gridColor = isDark ? '#475569' : '#cbd5e1';
  const axisColor = isDark ? '#64748b' : '#94a3b8';
  const bgColor = isDark ? (theme?.surface || '#0f172a') : '#ffffff';

  const slots = data?.slots || [];
  const lines = data?.lines || [];

  // Build recharts data: [{slot:'14:00-15:00', 'Line CNC': 64.3, ...}, ...]
  const chartData = useMemo(() => slots.map((slot, i) => {
    const point = { slot: slot.split('-')[0] }; // show only start time on axis
    lines.forEach((ln) => {
      point[ln.name] = ln.hourly_pct?.[i] ?? null;
    });
    return point;
  }), [slots, lines]);

  if (!slots.length || !lines.length) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: dimColor, fontSize: 13 }}>
        {slots.length === 0 ? 'Shift not started yet' : 'No lines configured'}
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: bgColor,
        border: `1px solid ${gridColor}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 700, color: textColor, marginBottom: 4 }}>{label}</div>
        {payload.map((p) => (
          <div key={p.dataKey} style={{ color: p.color, fontWeight: 600 }}>
            {p.dataKey}: {p.value != null ? `${p.value}%` : '—'}
          </div>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height} minWidth={0}>
      <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 4" stroke={gridColor} strokeOpacity={0.7} />
        <XAxis
          dataKey="slot"
          tick={{ fill: dimColor, fontSize: 11, fontWeight: 600 }}
          axisLine={{ stroke: axisColor, strokeWidth: 1.5 }}
          tickLine={{ stroke: axisColor, strokeWidth: 1 }}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fill: dimColor, fontSize: 11, fontWeight: 600 }}
          axisLine={{ stroke: axisColor, strokeWidth: 1.5 }}
          tickLine={{ stroke: axisColor, strokeWidth: 1 }}
          width={42}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, fontWeight: 700, color: textColor, paddingTop: 4 }}
          onClick={(e) => {
            const ln = lines.find((l) => l.name === e.dataKey);
            if (ln) onLineClick?.(ln);
          }}
        />
        <ReferenceLine y={100} stroke={gridColor} strokeDasharray="4 4" strokeOpacity={0.4} />
        {lines.map((ln) => (
          <Line
            key={ln.id}
            type="monotone"
            dataKey={ln.name}
            stroke={ln.color}
            strokeWidth={2.5}
            dot={{ r: 4, fill: ln.color, strokeWidth: 1.5, stroke: bgColor }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: bgColor }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

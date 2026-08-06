/** Percentage → heatmap color bands for overview charts. */
export function heatMapColor(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  if (v < 25) return '#ef4444'; // red
  if (v < 50) return '#0ea5e9'; // blue
  if (v < 80) return '#eab308'; // yellow
  return '#10b981'; // green
}

export function heatMapSoftBg(pct) {
  return `${heatMapColor(pct)}33`;
}

export const HEAT_MAP_LEGEND = [
  { label: '0–25%', color: '#ef4444' },
  { label: '25–50%', color: '#0ea5e9' },
  { label: '50–80%', color: '#eab308' },
  { label: '>80%', color: '#10b981' },
];

/** Distinct palette so each production line gets a unique chart color. */
export const LINE_SERIES_COLORS = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#f87171', // red
  '#84cc16', // lime
  '#818cf8', // indigo
  '#e879f9', // fuchsia
  '#2dd4bf', // teal
  '#c084fc', // purple
  '#4ade80', // green
  '#facc15', // yellow
  '#60a5fa', // blue
];

export function seriesColor(index) {
  const i = Math.abs(Number(index) || 0);
  return LINE_SERIES_COLORS[i % LINE_SERIES_COLORS.length];
}

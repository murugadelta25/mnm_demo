import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { seriesColor } from '../../utils/heatMap';

/**
 * Animated multi-series line chart — fills parent tile; distinct color per line.
 */
export default function MultiLineChart({
  items = [],
  valueKey = 'pct',
  labelKey = 'name',
  theme,
  height,
  yLabel = 'Running %',
  xLabel = 'Line',
  onPointClick,
}) {
  const text = theme?.text || '#e2e8f0';
  const dim = theme?.textDim || '#94a3b8';
  const grid = theme?.border || '#334155';
  const axis = theme?.textDim || '#64748b';
  const gid = useId().replace(/:/g, '');
  const wrapRef = useRef(null);
  const [box, setBox] = useState({ w: 640, h: 280 });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const nextH = Math.max(180, height || r.height || 280);
      const nextW = Math.max(280, r.width || 640);
      setBox((prev) => (
        Math.abs(prev.w - nextW) < 1 && Math.abs(prev.h - nextH) < 1
          ? prev
          : { w: nextW, h: nextH }
      ));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const series = useMemo(() => {
    return (items || []).map((item, idx) => {
      const pct = Math.max(0, Math.min(100, Number(item[valueKey]) || 0));
      const trail = [0.42, 0.58, 0.72, 0.86, 1].map((f, i) => {
        const wobble = Math.sin(idx * 2.1 + i * 0.9) * 3.2;
        return Math.max(0, Math.min(100, pct * f + wobble * (1 - f)));
      });
      trail[trail.length - 1] = pct;
      return {
        id: item.id ?? item[labelKey] ?? idx,
        name: item[labelKey] || `Line ${idx + 1}`,
        pct,
        color: item.color || seriesColor(idx),
        trail,
        raw: item,
        idx,
      };
    });
  }, [items, valueKey, labelKey]);

  useEffect(() => {
    setProgress(0);
    let raf;
    const start = performance.now();
    const dur = 1200;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [series]);

  if (!series.length) {
    return (
      <div ref={wrapRef} style={{ flex: 1, height: height || '100%', display: 'grid', placeItems: 'center', color: dim, fontSize: 14 }}>
        No data
      </div>
    );
  }

  const legendRows = Math.ceil(series.length / 5);
  const legendH = 26 + legendRows * 24;
  const pad = { top: 36, right: 78, bottom: 48, left: 56 };
  const w = box.w;
  const h = Math.max(160, box.h - legendH);
  const plotW = Math.max(40, w - pad.left - pad.right);
  const innerH = Math.max(40, h - pad.top - pad.bottom);
  const steps = series[0]?.trail?.length || 5;

  const xAt = (i) => pad.left + (i / Math.max(1, steps - 1)) * plotW;
  const yAt = (v) => pad.top + (1 - v / 100) * innerH;

  const pathFor = (trail) => {
    const pts = trail.map((v, i) => [xAt(i), yAt(v)]);
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i += 1) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return d;
  };

  // Collision-free end labels: sort by Y, push apart, place to the RIGHT of endpoint
  const labelMap = (() => {
    const minGap = 20;
    const items = series.map((s) => ({
      id: s.id,
      endY: yAt(s.pct),
      pct: s.pct,
      color: s.color,
      labelY: yAt(s.pct),
    })).sort((a, b) => a.endY - b.endY);

    for (let i = 1; i < items.length; i += 1) {
      if (items[i].labelY - items[i - 1].labelY < minGap) {
        items[i].labelY = items[i - 1].labelY + minGap;
      }
    }
    const bottom = pad.top + innerH - 4;
    const overflow = items.length ? items[items.length - 1].labelY - bottom : 0;
    if (overflow > 0) {
      items.forEach((it) => { it.labelY -= overflow; });
    }
    const top = pad.top + 10;
    if (items.length && items[0].labelY < top) {
      const shift = top - items[0].labelY;
      items.forEach((it) => { it.labelY += shift; });
    }

    const map = {};
    items.forEach((it) => { map[it.id] = it; });
    return map;
  })();

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = Array.from({ length: steps }, (_, i) => i);
  const fontAxis = Math.max(12, Math.min(15, w / 42));
  const fontVal = Math.max(13, Math.min(16, w / 38));

  return (
    <div
      ref={wrapRef}
      style={{
        width: '100%',
        height: height || '100%',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        style={{ display: 'block', flex: 1, minHeight: 0, overflow: 'visible' }}
        role="img"
        aria-label="Running rate by line"
      >
        <defs>
          <filter id={`${gid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={`${gid}-clip`}>
            <rect
              x={pad.left}
              y={pad.top - 8}
              width={Math.max(0, plotW * progress + pad.right * 0.85)}
              height={innerH + 24}
            />
          </clipPath>
        </defs>

        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + innerH} stroke={axis} strokeWidth={1.8} />
        <line x1={pad.left} y1={pad.top + innerH} x2={w - pad.right} y2={pad.top + innerH} stroke={axis} strokeWidth={1.8} />

        <text
          x={16}
          y={pad.top + innerH / 2}
          fill={dim}
          fontSize={fontAxis}
          fontWeight="700"
          transform={`rotate(-90 16 ${pad.top + innerH / 2})`}
          textAnchor="middle"
        >
          {yLabel}
        </text>
        <text
          x={pad.left + plotW / 2}
          y={h - 10}
          fill={dim}
          fontSize={fontAxis}
          fontWeight="700"
          textAnchor="middle"
        >
          {xLabel}
        </text>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke={grid}
              strokeOpacity={0.4}
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            <text x={pad.left - 10} y={yAt(tick) + 4} textAnchor="end" fill={dim} fontSize={fontAxis - 1}>
              {tick}
            </text>
          </g>
        ))}

        {xTicks.map((i) => (
          <text
            key={`x-${i}`}
            x={xAt(i)}
            y={pad.top + innerH + 20}
            textAnchor="middle"
            fill={dim}
            fontSize={fontAxis - 1}
          >
            {i + 1}
          </text>
        ))}

        <g clipPath={`url(#${gid}-clip)`}>
          {series.map((s) => {
            const fullPath = pathFor(s.trail);
            return (
              <g key={s.id}>
                <path
                  d={fullPath}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter={`url(#${gid}-glow)`}
                />
                {s.trail.map((v, i) => (
                  <circle
                    key={`${s.id}-pt-${i}`}
                    cx={xAt(i)}
                    cy={yAt(v)}
                    r={i === steps - 1 ? 6 : 3.5}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth={i === steps - 1 ? 1.8 : 0.9}
                    style={{ cursor: onPointClick && i === steps - 1 ? 'pointer' : 'default' }}
                    onClick={i === steps - 1 ? () => onPointClick?.(s.raw) : undefined}
                  />
                ))}
              </g>
            );
          })}
        </g>

        {/* Labels outside clip so they never get cut; collision-resolved Y */}
        {series.map((s) => {
          const endX = xAt(steps - 1);
          const place = labelMap[s.id];
          const labelY = place?.labelY ?? yAt(s.pct);
          const endY = yAt(s.pct);
          return (
            <g key={`lbl-${s.id}`}>
              {/* guide tick from point to label when offset */}
              {Math.abs(labelY - endY) > 4 ? (
                <line
                  x1={endX + 6}
                  y1={endY}
                  x2={endX + 14}
                  y2={labelY}
                  stroke={s.color}
                  strokeWidth={1}
                  opacity={0.55}
                />
              ) : null}
              <text
                x={endX + 16}
                y={labelY + 4}
                textAnchor="start"
                fill={s.color}
                fontSize={fontVal}
                fontWeight="800"
              >
                {s.pct.toFixed(s.pct % 1 ? 1 : 0)}%
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 16px',
          padding: '2px 4px 0',
          flexShrink: 0,
        }}
      >
        {series.map((s) => (
          <button
            key={`leg-${s.id}`}
            type="button"
            onClick={() => onPointClick?.(s.raw)}
            title={`${s.name}: ${s.pct}%`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              background: 'transparent',
              color: text,
              cursor: onPointClick ? 'pointer' : 'default',
              padding: 0,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: 999,
                background: s.color,
                boxShadow: `0 0 8px ${s.color}`,
                flexShrink: 0,
              }}
            />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

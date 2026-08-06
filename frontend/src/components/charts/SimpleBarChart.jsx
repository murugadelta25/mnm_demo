import { useEffect, useState } from 'react';
import { heatMapColor, HEAT_MAP_LEGEND } from '../../utils/heatMap';

/** Horizontal or vertical bar chart with grow-in animation. */
export default function SimpleBarChart({
  items = [],
  valueKey = 'pct',
  labelKey = 'name',
  color = '#0ea5e9',
  trackColor = '#e5e7eb',
  theme,
  height = 220,
  orientation = 'horizontal',
  heatMap = false,
  showLegend = false,
  showQty = false,
  /** Cap for bar fill. Default 100. Pass "auto" to scale from data max. */
  max: maxProp = 100,
  /** Shown after the value (default '%'). */
  valueSuffix = '%',
  yLabel = 'Achievement %',
  xLabel = 'Line',
  onBarClick,
}) {
  const text = theme?.text || '#111';
  const dim = theme?.textDim || '#6b7280';
  const dataMax = items.reduce((m, it) => Math.max(m, Number(it[valueKey]) || 0), 0);
  const max = maxProp === 'auto'
    ? Math.max(1, dataMax)
    : Math.max(1, Number(maxProp) || 100);
  const suffix = valueSuffix;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [items]);

  if (!items.length) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', color: dim, fontSize: 13 }}>
        No data
      </div>
    );
  }

  if (orientation === 'vertical') {
    const yTicks = maxProp === 'auto'
      ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 10) / 10)
      : [0, 25, 50, 75, 100];
    return (
      <div style={{
        height: height || '100%',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxSizing: 'border-box',
      }}>
        {showLegend ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', justifyContent: 'flex-end' }}>
            {HEAT_MAP_LEGEND.map((item) => (
              <span
                key={item.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: text,
                }}
              >
                <span style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: item.color,
                  boxShadow: `0 0 6px ${item.color}`,
                }}
                />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}

        <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 8 }}>
          <div style={{
            width: 42,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingBottom: showQty ? 52 : 28,
            paddingTop: 22,
            position: 'relative',
          }}>
            <span style={{
              position: 'absolute',
              left: 0,
              top: '45%',
              transform: 'rotate(-90deg) translateX(-50%)',
              transformOrigin: 'left center',
              fontSize: 13,
              fontWeight: 700,
              color: dim,
              whiteSpace: 'nowrap',
            }}>
              {yLabel}
            </span>
            {[...yTicks].reverse().map((tick) => (
              <span key={tick} style={{ fontSize: 12, color: dim, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {tick}
              </span>
            ))}
          </div>

          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-around',
            gap: 8,
            borderLeft: `1.5px solid ${dim}66`,
            borderBottom: `1.5px solid ${dim}66`,
            paddingTop: 4,
            minWidth: 0,
            position: 'relative',
          }}>
            {items.map((item, idx) => {
              const raw = Math.max(0, Number(item[valueKey]) || 0);
              const capped = Math.max(0, Math.min(max, raw));
              const barPct = Math.max(0, Math.min(100, (capped / max) * 100));
              const label = item[labelKey] || `Item ${idx + 1}`;
              const fill = heatMap ? heatMapColor(Math.min(100, barPct)) : (item.color || color);
              const actual = Number(item.actual ?? 0) || 0;
              const planned = Number(item.planned ?? 0) || 0;
              const qtyLabel = `${actual} / ${planned}`;
              const valueLabel = `${capped.toFixed(capped % 1 ? 1 : 0)}${suffix}`;
              return (
                <button
                  key={item.id ?? label}
                  type="button"
                  onClick={() => onBarClick?.(item)}
                  title={showQty ? `${label}: ${valueLabel} (${qtyLabel} qty)` : `${label}: ${valueLabel}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    maxWidth: 120,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 4,
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: onBarClick ? 'pointer' : 'default',
                    color: text,
                    zIndex: 1,
                  }}
                >
                  <span style={{
                    fontSize: 14,
                    fontWeight: 800,
                    color: fill,
                    fontVariantNumeric: 'tabular-nums',
                    textShadow: `0 0 10px ${fill}66`,
                  }}>
                    {valueLabel}
                  </span>
                  <div
                    style={{
                      width: '72%',
                      maxWidth: 52,
                      flex: 1,
                      minHeight: 64,
                      borderRadius: 10,
                      background: trackColor,
                      display: 'flex',
                      alignItems: 'flex-end',
                      overflow: 'hidden',
                      boxShadow: `inset 0 0 0 1px ${fill}33`,
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: ready ? `${barPct}%` : '0%',
                        borderRadius: 10,
                        background: `linear-gradient(180deg, ${fill} 0%, ${fill}aa 70%, ${fill}88 100%)`,
                        boxShadow: ready && barPct > 0
                          ? `0 0 16px ${fill}88, 0 0 4px ${fill}`
                          : 'none',
                        transition: 'height 1.05s cubic-bezier(0.16, 1, 0.3, 1)',
                        transitionDelay: `${idx * 100}ms`,
                        animation: ready && barPct > 0 ? `barPulse ${1.8 + idx * 0.15}s ease-in-out infinite` : undefined,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                      color: text,
                      lineHeight: 1.2,
                    }}
                  >
                    {label}
                  </span>
                  {showQty ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: dim,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.2,
                        marginBottom: 2,
                      }}
                      title={`Actual ${actual} / Planned ${planned}`}
                    >
                      {qtyLabel}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: dim }}>
          {showQty ? `${xLabel} · Actual / Planned qty` : xLabel}
        </div>

        <style>{`
          @keyframes barPulse {
            0%, 100% { filter: brightness(1); }
            50% { filter: brightness(1.18); }
          }
        `}</style>
      </div>
    );
  }

  const barH = Math.max(18, Math.min(28, (height - 24) / Math.max(items.length, 1) - 8));

  return (
    <div style={{ height, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
      {items.map((item, idx) => {
        const raw = Math.max(0, Number(item[valueKey]) || 0);
        const capped = Math.max(0, Math.min(max, raw));
        const barPct = Math.max(0, Math.min(100, (capped / max) * 100));
        const label = item[labelKey] || `Item ${idx + 1}`;
        const actual = Number(item.actual ?? 0) || 0;
        const planned = Number(item.planned ?? 0) || 0;
        const valueLabel = `${capped.toFixed(capped % 1 ? 1 : 0)}${suffix}`;
        return (
          <button
            key={item.id ?? label}
            type="button"
            onClick={() => onBarClick?.(item)}
            title={showQty ? `${label}: ${valueLabel} (${actual} / ${planned} qty)` : `${label}: ${valueLabel}`}
            style={{
              display: 'grid',
              gridTemplateColumns: showQty
                ? 'minmax(72px, 24%) 1fr 72px 64px'
                : 'minmax(72px, 28%) 1fr 64px',
              alignItems: 'center',
              gap: 8,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: onBarClick ? 'pointer' : 'default',
              textAlign: 'left',
              color: text,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={label}
            >
              {label}
            </span>
            <div
              style={{
                height: barH,
                borderRadius: 6,
                background: trackColor,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: ready ? `${barPct}%` : '0%',
                  height: '100%',
                  borderRadius: 6,
                  background: item.color || color,
                  transition: 'width 0.75s cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${idx * 60}ms`,
                }}
              />
            </div>
            {showQty ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: dim, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {actual}/{planned}
              </span>
            ) : null}
            <span style={{ fontSize: 12, fontWeight: 700, color: dim, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {valueLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';

/**
 * Grouped bar chart: per category (e.g. station) shows Planned vs Actual qty.
 * Value labels sit on top of each bar (no % header).
 * items: [{ id, name, planned, actual }]
 */
export default function PlannedActualBarChart({
  items = [],
  theme,
  height = '100%',
  plannedColor,
  actualColor,
  trackColor,
  xLabel = 'Station',
  yLabel = 'Qty',
  onBarClick,
}) {
  const text = theme?.text || '#111';
  const dim = theme?.textDim || '#6b7280';
  const plannedFill = plannedColor || '#a855f7';
  const actualFill = actualColor || '#22d3ee';
  const track = trackColor || (theme?.surface2 || '#e5e7eb');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [items]);

  const maxQty = useMemo(() => {
    let m = 0;
    for (const it of items) {
      m = Math.max(m, Number(it.planned) || 0, Number(it.actual) || 0);
    }
    return m > 0 ? m : 1;
  }, [items]);

  const yTicks = useMemo(() => {
    const step = maxQty / 4;
    return [0, 1, 2, 3, 4].map((i) => Math.round(step * i));
  }, [maxQty]);

  if (!items.length) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center', color: dim, fontSize: 13 }}>
        No station plan data
      </div>
    );
  }

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
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 14,
        flexWrap: 'wrap',
        paddingRight: 4,
      }}>
        {[
          { label: 'Planned', color: plannedFill },
          { label: 'Actual', color: actualFill },
        ].map((leg) => (
          <span key={leg.label} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            color: text,
          }}>
            <span style={{
              width: 11,
              height: 11,
              borderRadius: 3,
              background: leg.color,
            }}
            />
            {leg.label}
          </span>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 8 }}>
        <div style={{
          width: 42,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 28,
          paddingTop: 22,
          position: 'relative',
        }}>
          <span style={{
            position: 'absolute',
            left: 0,
            top: '42%',
            transform: 'rotate(-90deg) translateX(-50%)',
            transformOrigin: 'left center',
            fontSize: 12,
            fontWeight: 700,
            color: dim,
            whiteSpace: 'nowrap',
          }}>
            {yLabel}
          </span>
          {[...yTicks].reverse().map((tick) => (
            <span key={tick} style={{
              fontSize: 11,
              color: dim,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}>
              {tick}
            </span>
          ))}
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-around',
          gap: 10,
          borderLeft: `1.5px solid ${dim}66`,
          borderBottom: `1.5px solid ${dim}66`,
          paddingTop: 4,
          minWidth: 0,
        }}>
          {items.map((item, idx) => {
            const planned = Math.max(0, Math.round(Number(item.planned) || 0));
            const actual = Math.max(0, Math.round(Number(item.actual) || 0));
            const plannedH = (planned / maxQty) * 100;
            const actualH = (actual / maxQty) * 100;
            const pct = planned > 0 ? Math.round((100 * actual) / planned) : 0;
            const label = item.name || `Station ${idx + 1}`;
            const bars = [
              { key: 'planned', h: plannedH, fill: plannedFill, val: planned, label: 'Planned' },
              { key: 'actual', h: actualH, fill: actualFill, val: actual, label: 'Actual' },
            ];
            return (
              <button
                key={item.id ?? label}
                type="button"
                onClick={() => onBarClick?.(item)}
                title={`${label}: Actual ${actual} / Planned ${planned} (${pct}%)`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: 140,
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
                }}
              >
                <div style={{
                  flex: 1,
                  minHeight: 88,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                  gap: 5,
                }}>
                  {bars.map((bar, bi) => (
                    <div
                      key={bar.key}
                      style={{
                        width: '40%',
                        maxWidth: 32,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 2,
                      }}
                      title={`${bar.label}: ${bar.val}`}
                    >
                      <span style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: bar.fill,
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                      }}>
                        {bar.val}
                      </span>
                      <div style={{
                        width: '100%',
                        flex: 1,
                        minHeight: 48,
                        borderRadius: 8,
                        background: track,
                        display: 'flex',
                        alignItems: 'flex-end',
                        overflow: 'hidden',
                        boxShadow: `inset 0 0 0 1px ${bar.fill}33`,
                      }}>
                        <div style={{
                          width: '100%',
                          height: ready ? `${bar.h}%` : '0%',
                          borderRadius: 8,
                          background: `linear-gradient(180deg, ${bar.fill} 0%, ${bar.fill}aa 100%)`,
                          transition: 'height 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
                          transitionDelay: `${idx * 80 + bi * 40}ms`,
                        }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                  color: text,
                  lineHeight: 1.15,
                }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: dim }}>
        {xLabel}
      </div>
    </div>
  );
}

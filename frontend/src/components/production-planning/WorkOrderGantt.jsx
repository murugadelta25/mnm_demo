import { useMemo } from 'react';

const GANTT_COLORS = {
  schedule: '#64748b',
  running: '#0ea5e9',
  completed: '#10b981',
  delay: '#ef4444',
  estimate: '#38bdf8',
  exact: '#22d3ee',
};

function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1, 1);
}

export default function WorkOrderGantt({ t, overview, expandedIds, onToggleExpand, onViewTrackRecord }) {
  const { date_from, date_to, today, items } = overview || { items: [] };
  const totalDays = useMemo(() => daysBetween(date_from, date_to), [date_from, date_to]);

  const dayLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(date_from);
      d.setDate(d.getDate() + i);
      labels.push({
        date: d.toISOString().split('T')[0],
        day: d.getDate(),
        month: d.toLocaleString('en', { month: 'short' }),
      });
    }
    return labels;
  }, [date_from, totalDays]);

  const todayOffset = useMemo(() => {
    const idx = dayLabels.findIndex((d) => d.date === today);
    return idx >= 0 ? ((idx + 0.5) / totalDays) * 100 : null;
  }, [dayLabels, today, totalDays]);

  const barStyle = (start, end, status) => {
    const startIdx = dayLabels.findIndex((d) => d.date >= start);
    const endIdx = dayLabels.findIndex((d) => d.date >= end);
    const s = startIdx >= 0 ? startIdx : 0;
    const e = endIdx >= 0 ? endIdx : totalDays - 1;
    const left = (s / totalDays) * 100;
    const width = Math.max(((e - s + 1) / totalDays) * 100, 2);
    return {
      left: `${left}%`,
      width: `${width}%`,
      background: GANTT_COLORS[status] || GANTT_COLORS.schedule,
    };
  };

  const statusBadge = (status) => {
    const colors = {
      draft: '#64748b', in_progress: '#0ea5e9', completed: '#10b981', cancelled: '#ef4444',
    };
    const labels = {
      draft: 'Draft', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled',
    };
    return (
      <span style={{
        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
        background: (colors[status] || '#64748b') + '22',
        color: colors[status] || '#64748b',
      }}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden', minHeight: 280 }}>
      {/* Left table */}
      <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${t.border}`, background: t.surface2 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '28px 1fr', gap: 4, padding: '10px 8px',
          borderBottom: `1px solid ${t.border}`, fontSize: 11, color: t.textDim, fontWeight: 600,
        }}>
          <span />
          <span>Work Order Infos</span>
        </div>
        {items.map((wo) => (
          <div key={wo.id} style={{ borderBottom: `1px solid ${t.border}` }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '28px 1fr', gap: 4, padding: '10px 8px', alignItems: 'center',
              cursor: 'pointer', fontSize: 12,
            }} onClick={() => onViewTrackRecord?.(wo.id) ?? onToggleExpand?.(wo.id)}>
              <span style={{ color: t.accent }} onClick={(e) => { e.stopPropagation(); onToggleExpand?.(wo.id); }}>
                {expandedIds?.has(wo.id) ? '▼' : '▶'}
              </span>
              <div>
                <div style={{ color: t.text, fontWeight: 600 }}>{wo.work_order_no}</div>
                <div style={{ color: t.textMuted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {wo.part_label}
                </div>
              </div>
            </div>
            <div style={{ padding: '0 8px 8px 36px', fontSize: 11 }}>
              {statusBadge(wo.status)}
              <div style={{ color: t.textMuted, marginTop: 4 }}>
                {wo.complete_pct}% ({wo.completed_qty} / {wo.target_qty})
              </div>
              <div style={{ color: t.textDim }}>Remaining: {wo.remaining_qty} pcs</div>
            </div>
            {expandedIds?.has(wo.id) && wo.plans?.map((p) => (
              <div key={p.id} style={{ padding: '4px 8px 4px 44px', fontSize: 11, color: t.textMuted, borderTop: `1px dashed ${t.border}` }}>
                {p.plan_date} · {p.machine_name || `Stn ${p.station_no}`} · {p.actual_qty}/{p.planned_qty}
              </div>
            ))}
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: t.textFaint, fontSize: 13 }}>No work orders in range</div>
        )}
      </div>

      {/* Gantt timeline */}
      <div style={{ flex: 1, overflowX: 'auto', position: 'relative' }}>
        <div style={{ minWidth: Math.max(totalDays * 28, 400) }}>
          {/* Header */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.surface2, position: 'sticky', top: 0, zIndex: 2 }}>
            {dayLabels.map((d, i) => (
              <div key={d.date} style={{
                flex: 1, minWidth: 28, textAlign: 'center', padding: '4px 0', fontSize: 10, color: t.textDim,
                borderLeft: i > 0 && d.day === 1 ? `2px solid ${t.border}` : `1px solid ${t.border}`,
              }}>
                {d.day === 1 || i === 0 ? <div style={{ fontWeight: 600, color: t.textMuted }}>{d.month}</div> : null}
                <div>{d.day}</div>
              </div>
            ))}
          </div>

          {/* Bars */}
          {items.map((wo) => (
            <div key={wo.id} style={{ position: 'relative', height: expandedIds?.has(wo.id) ? 56 + (wo.plans?.length || 0) * 22 : 56, borderBottom: `1px solid ${t.border}` }}>
              <div style={{ position: 'absolute', top: 16, left: 0, right: 0, height: 20, padding: '0 2px' }}>
                <div style={{
                  position: 'absolute', height: '100%', borderRadius: 4, opacity: 0.9,
                  ...barStyle(wo.bar_start, wo.bar_end, wo.gantt_status),
                }} title={`${wo.work_order_no}: ${wo.bar_start} → ${wo.bar_end}`} />
              </div>
              {expandedIds?.has(wo.id) && wo.segments?.map((seg, i) => (
                <div key={seg.plan_id} style={{ position: 'absolute', top: 38 + i * 22, left: 0, right: 0, height: 16, padding: '0 2px' }}>
                  <div style={{
                    position: 'absolute', height: '100%', borderRadius: 3, opacity: 0.85,
                    ...barStyle(seg.start, seg.end, seg.status),
                  }} title={`${seg.machine_name || 'Plan'}: ${seg.actual_qty}/${seg.planned_qty}`} />
                </div>
              ))}
            </div>
          ))}

          {/* Today line */}
          {todayOffset != null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: `${todayOffset}%`, width: 2,
              background: '#ef4444', zIndex: 3, pointerEvents: 'none',
            }} title={`Today: ${today}`} />
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, padding: '8px 12px', fontSize: 11, color: t.textMuted, flexWrap: 'wrap' }}>
          {Object.entries({ Schedule: 'schedule', Running: 'running', Completed: 'completed', Delay: 'delay' }).map(([label, key]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 8, borderRadius: 2, background: GANTT_COLORS[key] }} />
              {label}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 2, height: 12, background: '#ef4444' }} /> Current
          </span>
        </div>
      </div>
    </div>
  );
}

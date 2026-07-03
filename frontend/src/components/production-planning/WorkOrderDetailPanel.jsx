import { surfaceClass } from '../../themes/tileHelpers';

export default function WorkOrderDetailPanel({ t, detail, loading, onClose, upcomingPlans, scheduleOnly }) {
  if (!loading && !detail) return null;

  const table = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
  const th = {
    padding: '9px 8px', background: t.surface2, color: t.textDim, textAlign: 'left', whiteSpace: 'nowrap',
  };
  const td = {
    padding: '8px', borderBottom: `1px solid ${t.border}`, color: t.textMuted, whiteSpace: 'nowrap',
  };

  return (
    <div className={surfaceClass(t)} style={{ borderRadius: 10, padding: 20, marginTop: 16 }}>
      {loading && !detail && (
        <p style={{ color: t.textMuted, fontSize: 13, margin: 0 }}>Loading track record…</p>
      )}
      {detail && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h4 style={{ color: t.accent, margin: 0, fontSize: 14, fontWeight: 600 }}>
              {detail.work_order?.work_order_no} — Details
            </h4>
            {onClose && (
              <button type="button" onClick={onClose}
                style={{ background: 'none', border: 'none', color: t.textDim, cursor: 'pointer' }}>✕</button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Target', value: detail.work_order?.target_qty, color: '#0ea5e9' },
              { label: 'Completed', value: detail.summary?.completed_qty, color: '#10b981' },
              { label: 'Remaining', value: detail.summary?.remaining_qty, color: '#f59e0b' },
              { label: 'Planned', value: detail.summary?.planned_qty, color: '#8b5cf6' },
              { label: 'Complete %', value: `${detail.summary?.complete_pct}%`, color: t.brand },
            ].map((k) => (
              <div key={k.label} style={{ background: t.surface2, borderRadius: 8, padding: 10, borderTop: `3px solid ${k.color}` }}>
                <div style={{ color: k.color, fontWeight: 700, fontSize: 16 }}>{k.value}</div>
                <div style={{ color: t.textMuted, fontSize: 10 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
            <div><strong>Part:</strong> {detail.work_order?.model_variant || detail.work_order?.part_no || '—'}</div>
            <div><strong>Period:</strong> {detail.work_order?.start_date || '—'} → {detail.work_order?.end_date || '—'}</div>
            {detail.work_order?.description && <div><strong>Description:</strong> {detail.work_order.description}</div>}
            {detail.work_order?.spares_tools?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong>Spares / Tools:</strong>
                {detail.work_order.spares_tools.map((s, i) => (
                  <div key={i}>· {s.name}{s.qty != null ? ` — ${s.qty} ${s.unit || 'pcs'}` : ''}</div>
                ))}
              </div>
            )}
          </div>

          {(scheduleOnly && !upcomingPlans?.length) && (
            <div style={{
              marginBottom: 16, padding: 12, borderRadius: 8,
              background: '#8b5cf622', border: `1px solid ${t.border}`,
              fontSize: 12, color: t.textMuted,
            }}>
              <strong style={{ color: '#8b5cf6' }}>Future work order — no production plans yet</strong>
              <div style={{ marginTop: 6 }}>
                Scheduled period: {scheduleOnly.start || '—'} → {scheduleOnly.end || '—'}
              </div>
              <div>Target qty: {scheduleOnly.target_qty} · Unplanned: {scheduleOnly.unplanned_qty} pcs</div>
              <div style={{ marginTop: 4, color: t.textDim }}>
                Link this work order when creating production plans in Production Planning.
              </div>
            </div>
          )}

          {(upcomingPlans?.length > 0) && (
            <>
              <h5 style={{ color: '#8b5cf6', fontSize: 13, margin: '0 0 8px' }}>Upcoming Planned Runs</h5>
              <div style={{ overflowX: 'auto', maxHeight: 280, marginBottom: 16 }}>
                <table style={table}>
                  <thead>
                    <tr>
                      {['Date', 'Shift', 'Machine', 'Operation', 'Planned', 'Remaining', 'Status'].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingPlans.map((p) => (
                      <tr key={p.id || `${p.plan_date}-${p.shift}-${p.machine_name}`}>
                        <td style={td}>{p.plan_date}</td>
                        <td style={td}>{p.shift}</td>
                        <td style={td}>{p.machine_name || `Stn ${p.station_no}`}</td>
                        <td style={td}>{p.current_operation} → {p.next_operation}</td>
                        <td style={td}>{p.planned_qty}</td>
                        <td style={td}>{Math.max((p.planned_qty || 0) - (p.actual_qty || 0), 0)}</td>
                        <td style={td}>{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h5 style={{ color: t.accent, fontSize: 13, margin: '0 0 8px' }}>Production Track Record</h5>
          <div style={{ overflowX: 'auto', maxHeight: 360 }}>
            <table style={table}>
              <thead>
                <tr>
                  {['Date', 'Shift', 'Machine', 'Planned', 'Actual', '%', 'Status'].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(detail.records || []).map((r) => (
                  <tr key={r.plan_id}>
                    <td style={td}>{r.run_date}</td>
                    <td style={td}>{r.shift}</td>
                    <td style={td}>{r.machine_name}</td>
                    <td style={td}>{r.planned_qty}</td>
                    <td style={td}>{r.actual_qty}</td>
                    <td style={td}>{r.complete_pct}%</td>
                    <td style={td}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!detail.records?.length && (
              <p style={{ color: t.textFaint, fontSize: 12, textAlign: 'center', padding: 16 }}>No linked production runs yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

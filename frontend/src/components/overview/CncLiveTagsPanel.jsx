/**
 * CNC live tags panel (Delta NC510 / Edge LO) — classic Equipment Overview only.
 * Independent of ServoPressEquipmentView / Modbus telemetry.
 */
export default function CncLiveTagsPanel({ cncLive, theme: t, isDark }) {
  const available = Boolean(cncLive?.available);
  const groups = Array.isArray(cncLive?.groups) ? cncLive.groups : [];
  const tags = Array.isArray(cncLive?.tags) ? cncLive.tags : [];
  const derived = cncLive?.derived_status;

  const fmt = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  };

  return (
    <section
      style={{
        borderRadius: 12,
        border: `1px solid ${t.border}`,
        background: t.surface || t.bg,
        marginTop: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '12px 14px',
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: t.text }}>
          CNC Live Tags
          {cncLive?.tag_count != null ? (
            <span style={{ marginLeft: 8, fontWeight: 600, color: t.textDim, fontSize: 12 }}>
              · {cncLive.tag_count} tags
            </span>
          ) : null}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: t.textDim }}>
          {derived ? (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 700,
                textTransform: 'uppercase',
                fontSize: 11,
                background: isDark ? '#334155' : '#e2e8f0',
                color: t.text,
              }}
            >
              StatusCode → {derived}
            </span>
          ) : null}
          {cncLive?.updated_at ? <span>Updated {cncLive.updated_at}</span> : null}
          {!available ? <span style={{ color: '#f59e0b' }}>No live snapshot yet</span> : null}
        </div>
      </div>

      {!available || !tags.length ? (
        <div style={{ padding: 20, color: t.textDim, fontSize: 13 }}>
          Waiting for Node-RED CNC flow (Edge LO tags → POST /api/machines/{'{id}'}/cnc-live).
          Status continues via PATCH /status from StatusCode.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14, padding: 14 }}>
          {(groups.length ? groups : [{ id: 'all', label: 'Tags', tags }]).map((g) => (
            <div key={g.id || g.label}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: t.textDim,
                  marginBottom: 8,
                }}
              >
                {g.label}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 8,
                }}
              >
                {(g.tags || []).map((tag) => (
                  <div
                    key={tag.name}
                    style={{
                      border: `1px solid ${t.border}`,
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: isDark ? (t.surface2 || '#1e293b') : '#f8fafc',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: t.textDim,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={tag.name}
                    >
                      {tag.name}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 15,
                        fontWeight: 700,
                        color: t.text,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmt(tag.value)}
                      {tag.unit ? (
                        <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: t.textDim }}>
                          {tag.unit}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

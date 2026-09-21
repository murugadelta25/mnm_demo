import { useEffect, useState } from 'react';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

export default function FmmsAssetMonitoring() {
  const { theme: t } = useTheme();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/fmms/monitoring');
      setRecords(data || []);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const alertCount = records.filter((r) => r.alert_triggered).length;

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="Real-time Asset Monitoring" onRefresh={load} />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Live sensor data and threshold alerts for registered assets.
      </p>

      {msg && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, textTransform: 'uppercase' }}>Readings</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.accent, marginTop: 4 }}>{records.length}</div>
          <div style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>Latest window</div>
        </div>
        <div className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, textTransform: 'uppercase' }}>Active Alerts</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: alertCount ? '#ef4444' : '#22c55e', marginTop: 4 }}>{alertCount}</div>
          <div style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>Threshold breach</div>
        </div>
      </div>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Asset ID</th>
                  <th style={thStyle(t)}>Parameter</th>
                  <th style={thStyle(t)}>Value</th>
                  <th style={thStyle(t)}>Unit</th>
                  <th style={thStyle(t)}>Alert</th>
                  <th style={thStyle(t)}>Recorded At</th>
                </tr>
              </thead>
              <tbody>
                {records.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{m.asset_id}</td>
                    <td style={tdStyle(t)}>{m.parameter}</td>
                    <td style={tdStyle(t)}>{m.value}</td>
                    <td style={tdStyle(t)}>{m.unit || '—'}</td>
                    <td style={tdStyle(t)}>
                      {m.alert_triggered
                        ? <FmmsBadge t={t} tone="critical">YES</FmmsBadge>
                        : <FmmsBadge t={t} tone="neutral">—</FmmsBadge>}
                    </td>
                    <td style={tdStyle(t)}>{m.recorded_at || '—'}</td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No monitoring data yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

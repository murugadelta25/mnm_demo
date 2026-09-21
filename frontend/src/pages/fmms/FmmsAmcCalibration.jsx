import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { ServiceStatusStyles, ServiceStatusBadge, getServiceDueStatus, ServiceAlertChips } from './serviceStatus';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

export default function FmmsAmcCalibration() {
  const { theme: t } = useTheme();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data }, dash] = await Promise.all([
        api.get('/api/fmms/assets', { params: { equipment_only: true, page: 1, page_size: 100 } }),
        api.get('/api/fmms/dashboard'),
      ]);
      setAssets(data?.items || data || []);
      setKpi(dash.data);
    } catch {
      setAssets([]);
      setKpi(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const compliance = kpi?.calibration_compliance_pct ?? null;

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <ServiceStatusStyles />
      <PageHeader
        title="AMC & Calibration Management"
        onRefresh={load}
        extra={<Link to="/taco-fmms/dashboard" style={{ ...linkBtn(t) }}>TACO Calibration Hub</Link>}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Time-based scheduling with alert thresholds · CAL-01/02/06 covered · CAL-03 compliance KPI below
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi t={t} label="Calibration Compliance %" value={compliance != null ? `${compliance}%` : '—'} color={compliance != null && compliance >= 95 ? '#22c55e' : '#f59e0b'} hint="CAL-03 / MGT-02" />
        <Kpi t={t} label="On Track" value={String(kpi?.calibration_on_track ?? '—')} color="#22c55e" hint="Within schedule" />
        <Kpi t={t} label="Due Soon" value={String(kpi?.calibration_due_soon ?? '—')} color="#f59e0b" hint="Alert window" />
        <Kpi t={t} label="Overdue" value={String(kpi?.calibration_overdue ?? '—')} color="#ef4444" hint="CAL-02 action" />
      </div>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>3D Status</th>
                  <th style={thStyle(t)}>Asset / Instrument</th>
                  <th style={thStyle(t)}>BU</th>
                  <th style={thStyle(t)}>Tracking Mode</th>
                  <th style={thStyle(t)}>Schedule</th>
                  <th style={thStyle(t)}>Next Threshold</th>
                  <th style={thStyle(t)}>Alert Window</th>
                  <th style={thStyle(t)}>Auto WO Trigger</th>
                  <th style={thStyle(t)}>Status Text</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const svc = getServiceDueStatus(a.next_service_date, a.alert_before_days);
                  return (
                    <tr key={a.id}>
                      <td style={tdStyle(t)}><ServiceStatusBadge status={svc} size={14} /></td>
                      <td style={tdStyle(t)}>
                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11, color: t.textFaint }}>{a.asset_code}</div>
                      </td>
                      <td style={tdStyle(t)}>{a.business_unit || a.department || '—'}</td>
                      <td style={tdStyle(t)}>Time-Based</td>
                      <td style={tdStyle(t)}>{a.schedule_type === 'pm' ? 'PM' : 'Calibration'}</td>
                      <td style={tdStyle(t)}>{a.next_service_date || '—'}</td>
                      <td style={tdStyle(t)}>{a.alert_before_days ?? 5} day(s)</td>
                      <td style={tdStyle(t)}><FmmsBadge t={t} tone="ok">Enabled (Auto)</FmmsBadge></td>
                      <td style={tdStyle(t)}><ServiceAlertChips status={svc} /></td>
                    </tr>
                  );
                })}
                {assets.length === 0 && (
                  <tr><td colSpan={9} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No scheduled assets. Add assets with next service dates in Asset Management.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ t, label, value, color, hint }) {
  return (
    <div className={surfaceClass(t)} style={cardStyle(t)}>
      <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function linkBtn(t) {
  return {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };
}

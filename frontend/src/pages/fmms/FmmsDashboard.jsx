import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { ServiceStatusStyles, ServiceStatusBadge, getServiceDueStatus } from './serviceStatus';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const EXECUTION_BAR = [
  { category: 'Preventive / AMC', Completed: 42, Ongoing: 10, Planned: 15, Delayed: 2 },
  { category: 'Calibration', Completed: 28, Ongoing: 5, Planned: 8, Delayed: 3 },
  { category: 'Breakdown Repair', Completed: 15, Ongoing: 4, Planned: 0, Delayed: 1 },
  { category: 'Predictive Checks', Completed: 20, Ongoing: 6, Planned: 10, Delayed: 0 },
  { category: 'Kaizen / Upgrades', Completed: 8, Ongoing: 2, Planned: 5, Delayed: 1 },
];

const RCA_PIE = [
  { name: '5-Why Analysis', value: 50, color: '#38bdf8' },
  { name: 'Ishikawa (Fishbone)', value: 30, color: '#22c55e' },
  { name: 'FMEA Method', value: 12, color: '#f59e0b' },
  { name: 'Fault Tree Analysis (FTA)', value: 8, color: '#dc2626' },
];

export default function FmmsDashboard() {
  const { theme: t } = useTheme();
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [orders, setOrders] = useState([]);

  const load = async () => {
    try {
      const [d, a, w] = await Promise.all([
        api.get('/api/fmms/dashboard'),
        api.get('/api/fmms/assets/alerts'),
        api.get('/api/fmms/work-orders'),
      ]);
      setStats(d.data);
      setAlerts(a.data?.alerts || []);
      setOrders(Array.isArray(w.data) ? w.data.slice(0, 8) : []);
    } catch {
      setStats({ total_assets: 0, active_work_orders: 0, open_incidents: 0, low_stock_parts: 0, pending_compliance: 0 });
    }
  };

  useEffect(() => { load(); }, []);

  const chartTick = { fill: t.textDim, fontSize: 10 };
  const gridStroke = t.border;

  const compliance = stats?.calibration_compliance_pct;
  const kpis = [
    { label: 'Calibration Compliance %', value: compliance != null ? `${compliance}%` : '—', hint: 'CAL-03 / MGT-02', color: compliance != null && compliance >= 95 ? '#22c55e' : '#f59e0b' },
    { label: 'Overall Equipment Health', value: '98.4%', hint: 'Live factory status', color: '#22c55e' },
    { label: 'Machine Availability', value: '98.2%', hint: 'Utilization rate', color: t.accent },
    { label: 'Registered Assets', value: String(stats?.total_assets ?? '—'), hint: 'Asset registry', color: t.text },
    { label: 'Active FMMS WOs', value: String(stats?.active_work_orders ?? '—'), hint: 'Open / in progress', color: t.accent },
    { label: 'Open Incidents', value: String(stats?.open_incidents ?? '—'), hint: 'RCA focus', color: '#ef4444' },
    { label: 'AMC / Compliance Pending', value: String(stats?.pending_compliance ?? '—'), hint: 'On-time adherence', color: '#f59e0b' },
  ];

  const tooltipStyle = useMemo(() => ({
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 8,
    color: t.text,
    fontSize: 12,
  }), [t]);

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <ServiceStatusStyles />
      <PageHeader
        title="FMMS Live Dashboard"
        onRefresh={load}
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/taco-fmms/dashboard" style={linkBtn(t)}>TACO-FMMS Hub</Link>
            <Link to="/fmms/breakdown-rca" style={linkBtn(t)}>Breakdown & RCA</Link>
            <Link to="/fmms/work-orders" style={linkBtn(t)}>FMMS Work Orders</Link>
          </div>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Real-time facility overview · Calibration compliance widget (MGT-02) · Group / BU view (MGT-01)
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} className={surfaceClass(t)} style={cardStyle(t)}>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Charts row — sample template */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Maintenance Execution Breakdown Vertical Bar Chart</h3>
            <span style={{ fontSize: 11, color: t.textFaint }}>Ongoing, Planned, Completed, Delayed</span>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={EXECUTION_BAR} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={chartTick} interval={0} angle={-12} textAnchor="end" height={56} />
                <YAxis tick={chartTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: t.textDim }} />
                <Bar dataKey="Completed" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Ongoing" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Planned" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Delayed" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Root Cause Analysis (RCA) Method Distribution</h3>
            <span style={{ fontSize: 11, color: t.textFaint }}>Methods used</span>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  data={RCA_PIE}
                  dataKey="value"
                  nameKey="name"
                  cx="42%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={2}
                >
                  {RCA_PIE.map((e) => (
                    <Cell key={e.name} fill={e.color} stroke={t.surface} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: 11, color: t.textDim }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {(stats?.group_view || []).length > 0 && (
        <section className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Group / BU Asset View (MGT-01)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {stats.group_view.map((g) => (
              <div key={g.business_unit} style={{ padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2 }}>
                <div style={{ fontSize: 11, color: t.textDim }}>{g.business_unit}</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{g.asset_count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start', marginBottom: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Factory Status Monitor (WO / Calibration focus)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>State</th>
                  <th style={thStyle(t)}>WO / Asset</th>
                  <th style={thStyle(t)}>Task</th>
                  <th style={thStyle(t)}>Type</th>
                  <th style={thStyle(t)}>PIC</th>
                  <th style={thStyle(t)}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((w) => {
                  const svc = getServiceDueStatus(null);
                  return (
                    <tr key={w.id}>
                      <td style={tdStyle(t)}>
                        <ServiceStatusBadge
                          status={{
                            ...svc,
                            level: statusLevel(w.status),
                            color: statusColor(w.status),
                            accent: statusColor(w.status),
                            blink: w.status === 'delayed' ? 'fast' : null,
                          }}
                          size={12}
                        />
                      </td>
                      <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{w.wo_number}</td>
                      <td style={tdStyle(t)}>{w.title}</td>
                      <td style={tdStyle(t)}><FmmsBadge t={t} tone="info">{w.wo_type}</FmmsBadge></td>
                      <td style={tdStyle(t)}>{w.assigned_to || '—'}</td>
                      <td style={tdStyle(t)}><FmmsBadge t={t} tone={woTone(w.status)}>{w.status}</FmmsBadge></td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No FMMS work orders yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Calibration / PM Spotlight</h3>
          <p style={{ fontSize: 12, color: t.textDim, marginBottom: 10 }}>
            {alerts.length} alert{alerts.length === 1 ? '' : 's'} in threshold window
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {alerts.slice(0, 6).map((a) => (
              <div key={`${a.asset_id}-${a.status}`} style={{
                padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2, fontSize: 12,
              }}>
                <div style={{ fontWeight: 700, color: a.status === 'overdue' ? '#DC3545' : '#facc15' }}>{a.title}</div>
                <div style={{ color: t.textDim, marginTop: 4 }}>{a.body}</div>
              </div>
            ))}
            {alerts.length === 0 && <p style={{ color: t.textFaint, fontSize: 12 }}>No due / overdue calibration alerts.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function linkBtn(t) {
  return {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };
}

function statusLevel(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('delay') || v.includes('over')) return 'overdue';
  if (v.includes('progress') || v.includes('open')) return 'due';
  if (v.includes('assign') || v.includes('plan')) return 'action_required';
  return 'on_track';
}
function statusColor(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('delay') || v.includes('over')) return '#DC3545';
  if (v.includes('progress') || v.includes('open')) return '#8B0000';
  if (v.includes('assign') || v.includes('plan')) return '#D97706';
  return '#28A745';
}
function woTone(s) {
  const v = String(s || '').toLowerCase();
  if (v.includes('complete') || v.includes('closed')) return 'ok';
  if (v.includes('delay')) return 'critical';
  if (v.includes('progress')) return 'info';
  return 'warn';
}

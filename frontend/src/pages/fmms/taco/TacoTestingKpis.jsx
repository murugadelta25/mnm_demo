import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle } from '../fmmsUi';

export default function TacoTestingKpis() {
  const { theme: t } = useTheme();
  const [data, setData] = useState(null);
  const [dash, setDash] = useState(null);

  const load = async () => {
    try {
      const [k, d] = await Promise.all([
        api.get('/api/fmms/taco/testing-kpis'),
        api.get('/api/fmms/taco/dashboard'),
      ]);
      setData(k.data);
      setDash(d.data);
    } catch {
      setData(null);
      setDash(null);
    }
  };
  useEffect(() => { load(); }, []);

  const chartTick = { fill: t.textDim, fontSize: 10 };
  const tooltipStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 12 };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="Testing KPIs & Cost Savings" onRefresh={load} />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        TEST-12 monthly testing KPIs · TEST-13 / MGT-05 savings analytics · Month {data?.month || '—'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Kpi t={t} label="Testing Requests" value={String(data?.total_requests ?? '—')} color="#38bdf8" />
        <Kpi t={t} label="Completed" value={String(data?.completed ?? '—')} color="#22c55e" />
        <Kpi t={t} label="Cross-BU Shares" value={String(data?.cross_bu_shares ?? '—')} color="#a78bfa" />
        <Kpi t={t} label="Est. Savings ₹" value={data ? Number(data.estimated_savings_inr).toLocaleString('en-IN') : '—'} color="#22c55e" />
        <Kpi t={t} label="Utilization %" value={data ? `${data.overall_utilization_pct}%` : '—'} color={t.accent} />
        <Kpi t={t} label="Vendor Rating" value={String(dash?.vendor_avg_rating ?? '—')} color="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Requests by BU</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data?.by_bu || []} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid stroke={t.border} strokeDasharray="3 3" />
                <XAxis dataKey="business_unit" tick={chartTick} interval={0} angle={-18} textAnchor="end" height={56} />
                <YAxis tick={chartTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="requests" name="Requests" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="cross_bu" name="Cross-BU" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>BU Detail</h3>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Business Unit</th>
                <th style={thStyle(t)}>Requests</th>
                <th style={thStyle(t)}>Cross-BU</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_bu || []).map((r) => (
                <tr key={r.business_unit}>
                  <td style={tdStyle(t)}>{r.business_unit}</td>
                  <td style={tdStyle(t)}>{r.requests}</td>
                  <td style={tdStyle(t)}>{r.cross_bu}</td>
                </tr>
              ))}
              {(!data?.by_bu || data.by_bu.length === 0) && (
                <tr><td colSpan={3} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No KPI rows yet</td></tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: t.textFaint, marginTop: 10 }}>
            Savings model: ₹8,000 avoided external lab cost per cross-BU share (illustrative).
          </p>
        </section>
      </div>
    </div>
  );
}

function Kpi({ t, label, value, color }) {
  return (
    <div className={surfaceClass(t)} style={cardStyle(t)}>
      <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

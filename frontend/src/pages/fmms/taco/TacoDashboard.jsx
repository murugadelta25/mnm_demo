import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from '../fmmsUi';

export default function TacoDashboard() {
  const { theme: t } = useTheme();
  const [data, setData] = useState(null);

  const load = async () => {
    try {
      const { data: d } = await api.get('/api/fmms/taco/dashboard');
      setData(d);
    } catch {
      setData(null);
    }
  };
  useEffect(() => { load(); }, []);

  const kpis = [
    { label: 'Calibration Compliance', value: data ? `${data.calibration_compliance_pct}%` : '—', hint: 'MGT-02', color: '#22c55e' },
    { label: 'Equipment Utilization', value: data ? `${data.equipment_utilization_pct}%` : '—', hint: 'MGT-03', color: t.accent },
    { label: 'Testing Requests Open', value: String(data?.testing_requests_open ?? '—'), hint: 'MGT-04', color: '#38bdf8' },
    { label: 'Cost Savings (₹)', value: data ? data.cost_savings_inr.toLocaleString('en-IN') : '—', hint: 'MGT-05', color: '#22c55e' },
    { label: 'Vendor Avg Rating', value: String(data?.vendor_avg_rating ?? '—'), hint: 'MGT-06', color: '#f59e0b' },
    { label: 'Cross-BU Bookings', value: String(data?.cross_bu_bookings ?? '—'), hint: 'MGT-07', color: '#a78bfa' },
  ];

  const chartTick = { fill: t.textDim, fontSize: 10 };
  const tooltipStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 12 };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="TACO-FMMS Management Dashboard"
        onRefresh={load}
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/taco-fmms/vendors" style={linkBtn(t)}>Vendors</Link>
            <Link to="/taco-fmms/booking" style={linkBtn(t)}>Booking</Link>
            <Link to="/taco-fmms/testing-kpis" style={linkBtn(t)}>KPIs & Savings</Link>
          </div>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        TATA AutoComp group view (MGT-01) · Calibration, testing, vendor & savings KPIs
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>BU Summary — Assets / Utilization / Cost</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={data?.bu_summary || []} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid stroke={t.border} strokeDasharray="3 3" />
                <XAxis dataKey="business_unit" tick={chartTick} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={chartTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="avg_utilization" name="Util %" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="equipment_count" name="Equipment" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Group Monitoring Snapshot</h3>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>BU</th>
                <th style={thStyle(t)}>Eqpt</th>
                <th style={thStyle(t)}>Util %</th>
                <th style={thStyle(t)}>Cal Cost ₹</th>
                <th style={thStyle(t)}>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {(data?.bu_summary || []).map((r) => (
                <tr key={r.business_unit}>
                  <td style={tdStyle(t)}>{r.business_unit}</td>
                  <td style={tdStyle(t)}>{r.equipment_count}</td>
                  <td style={tdStyle(t)}>{r.avg_utilization}%</td>
                  <td style={tdStyle(t)}>{Number(r.calibration_cost).toLocaleString('en-IN')}</td>
                  <td style={tdStyle(t)}><FmmsBadge t={t} tone="info">{r.open_bookings}</FmmsBadge></td>
                </tr>
              ))}
              {(!data?.bu_summary || data.bu_summary.length === 0) && (
                <tr><td colSpan={5} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No BU data yet</td></tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: t.textFaint, marginTop: 10 }}>
            Month cal cost ₹{Number(data?.month_calibration_cost || 0).toLocaleString('en-IN')} · Prev ₹{Number(data?.prev_month_calibration_cost || 0).toLocaleString('en-IN')} · Approved vendors {data?.approved_vendors ?? '—'}
          </p>
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

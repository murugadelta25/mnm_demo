import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle } from '../fmmsUi';

export default function TacoCalibrationCost() {
  const { theme: t } = useTheme();
  const [data, setData] = useState({ items: [], by_bu: [], group_total: 0 });
  const [bu, setBu] = useState('');

  const load = async () => {
    try {
      const params = {};
      if (bu) params.business_unit = bu;
      const { data: d } = await api.get('/api/fmms/taco/calibration-costs', { params });
      setData(d || { items: [], by_bu: [], group_total: 0 });
    } catch {
      setData({ items: [], by_bu: [], group_total: 0 });
    }
  };
  useEffect(() => { load(); }, [bu]);

  const chartTick = { fill: t.textDim, fontSize: 10 };
  const tooltipStyle = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 12 };
  const inp = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13 };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Calibration Cost Analytics"
        onRefresh={load}
        extra={(
          <select style={inp} value={bu} onChange={(e) => setBu(e.target.value)}>
            <option value="">All BUs</option>
            {['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'].map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        CAL-12 cost tracking · CAL-13 BU & group summary · Group total ₹{Number(data.group_total || 0).toLocaleString('en-IN')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Group / BU Cost Summary</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data.by_bu || []} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid stroke={t.border} strokeDasharray="3 3" />
                <XAxis dataKey="business_unit" tick={chartTick} interval={0} angle={-18} textAnchor="end" height={56} />
                <YAxis tick={chartTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="total_cost" name="₹ Cost" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>BU Totals</h3>
          <table style={tableWrap(t)}>
            <thead>
              <tr><th style={thStyle(t)}>Business Unit</th><th style={thStyle(t)}>Total ₹</th></tr>
            </thead>
            <tbody>
              {(data.by_bu || []).map((r) => (
                <tr key={r.business_unit}>
                  <td style={tdStyle(t)}>{r.business_unit}</td>
                  <td style={tdStyle(t)}>₹{Number(r.total_cost).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Cost Line Items</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Month</th><th style={thStyle(t)}>BU</th><th style={thStyle(t)}>Asset</th>
                <th style={thStyle(t)}>Vendor</th><th style={thStyle(t)}>Type</th><th style={thStyle(t)}>Amount ₹</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle(t)}>{c.period_month}</td>
                  <td style={tdStyle(t)}>{c.business_unit}</td>
                  <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{c.asset_code || '—'}</td>
                  <td style={tdStyle(t)}>{c.vendor_name || '—'}</td>
                  <td style={tdStyle(t)}>{c.cost_type}</td>
                  <td style={tdStyle(t)}>₹{Number(c.cost_amount).toLocaleString('en-IN')}</td>
                </tr>
              ))}
              {(data.items || []).length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No cost records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

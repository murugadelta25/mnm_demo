import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from '../fmmsUi';

export default function TacoTestingEquipment() {
  const { theme: t } = useTheme();
  const [items, setItems] = useState([]);
  const [util, setUtil] = useState(null);
  const [bu, setBu] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    try {
      const params = {};
      if (bu) params.business_unit = bu;
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      const [eq, u] = await Promise.all([
        api.get('/api/fmms/taco/testing-equipment', { params }),
        api.get('/api/fmms/taco/utilization'),
      ]);
      setItems(eq.data || []);
      setUtil(u.data);
    } catch {
      setItems([]);
      setUtil(null);
    }
  };
  useEffect(() => { load(); }, [bu, status]);

  const inp = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13 };
  const statusTone = (s) => {
    if (s === 'available') return 'ok';
    if (s === 'booked') return 'info';
    if (s === 'calibration' || s === 'maintenance') return 'warn';
    return 'neutral';
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Testing Equipment Repository & Availability"
        onRefresh={load}
        extra={<Link to="/taco-fmms/booking" style={linkBtn(t)}>Open Booking Portal</Link>}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        TEST-01 BU repository · TEST-02 search · TEST-03 availability · TEST-04 / TEST-11 utilization & sharing
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700 }}>OVERALL UTILIZATION</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.accent }}>{util?.overall_utilization_pct ?? '—'}%</div>
        </div>
        {(util?.by_bu || []).slice(0, 5).map((b) => (
          <div key={b.business_unit} className={surfaceClass(t)} style={cardStyle(t)}>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700 }}>{b.business_unit}</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{b.avg_utilization_pct}%</div>
            <div style={{ fontSize: 11, color: t.textFaint }}>{b.available} avail / {b.booked} booked</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={{ ...inp, minWidth: 200, flex: 1 }} placeholder="Search code, name, type, location…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select style={inp} value={bu} onChange={(e) => setBu(e.target.value)}>
          <option value="">All BUs</option>
          {['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select style={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="booked">Booked</option>
          <option value="calibration">Calibration</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <button type="button" onClick={load} style={{ ...inp, cursor: 'pointer', fontWeight: 600 }}>Search</button>
      </div>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Code</th><th style={thStyle(t)}>Equipment</th><th style={thStyle(t)}>Owning BU</th>
                <th style={thStyle(t)}>Location</th><th style={thStyle(t)}>Status</th><th style={thStyle(t)}>Util %</th>
                <th style={thStyle(t)}>Shareable</th><th style={thStyle(t)}>Slots/Day</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{e.equipment_code}</td>
                  <td style={tdStyle(t)}>
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    <div style={{ fontSize: 11, color: t.textFaint }}>{e.equipment_type}</div>
                  </td>
                  <td style={tdStyle(t)}>{e.owning_bu}</td>
                  <td style={tdStyle(t)}>{e.location || '—'}</td>
                  <td style={tdStyle(t)}><FmmsBadge t={t} tone={statusTone(e.status)}>{e.status}</FmmsBadge></td>
                  <td style={tdStyle(t)}>{e.utilization_pct}%</td>
                  <td style={tdStyle(t)}>{e.shareable ? 'Yes' : 'No'}</td>
                  <td style={tdStyle(t)}>{e.capacity_slots_per_day}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No testing equipment found</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function linkBtn(t) {
  return {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };
}

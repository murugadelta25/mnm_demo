import { useEffect, useState } from 'react';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { ServiceStatusStyles } from './serviceStatus';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const WO_TYPES = [
  { value: 'preventive', label: 'Preventive / AMC' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'corrective', label: 'Breakdown' },
  { value: 'predictive', label: 'Predictive (Thermal / Earth Testing)' },
  { value: 'emergency', label: 'Upgradation / Kaizen' },
];

const EMPTY = {
  title: '', priority: 'medium', wo_type: 'preventive', description: '', assigned_to: '', sor_ref: '',
};

export default function FmmsWorkOrders() {
  const { theme: t } = useTheme();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState('');

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '8px 16px', background: t.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/fmms/work-orders');
      setOrders(data || []);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/api/fmms/work-orders', {
        title: form.title,
        priority: form.priority,
        wo_type: form.wo_type,
        description: [form.description, form.sor_ref ? `SOR/Ringi: ${form.sor_ref}` : ''].filter(Boolean).join('\n'),
        assigned_to: form.assigned_to,
      });
      setForm(EMPTY);
      setMsg('✅ FMMS work order created');
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <ServiceStatusStyles />
      <PageHeader title="FMMS Work Order " onRefresh={load} />
      {msg && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Work Order Tracking Control</h3>
          {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableWrap(t)}>
                <thead>
                  <tr>
                    <th style={thStyle(t)}>WO ID</th>
                    <th style={thStyle(t)}>Type</th>
                    <th style={thStyle(t)}>Task / Asset</th>
                    <th style={thStyle(t)}>PIC</th>
                    <th style={thStyle(t)}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((w) => (
                    <tr key={w.id}>
                      <td style={{ ...tdStyle(t), fontWeight: 700 }}>{w.wo_number}</td>
                      <td style={tdStyle(t)}>{WO_TYPES.find((x) => x.value === w.wo_type)?.label || w.wo_type}</td>
                      <td style={tdStyle(t)}>{w.title}</td>
                      <td style={tdStyle(t)}>{w.assigned_to ? `PIC: ${w.assigned_to}` : '—'}</td>
                      <td style={tdStyle(t)}>
                        <FmmsBadge t={t} tone={w.status === 'completed' ? 'ok' : w.status === 'in_progress' ? 'info' : 'warn'}>
                          {w.status}
                        </FmmsBadge>
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No FMMS work orders yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Work Order Creation</h3>
          <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
            <label style={fieldLabel(t)}>
              Work Order Type
              <select style={inp} value={form.wo_type} onChange={(e) => setForm({ ...form, wo_type: e.target.value })}>
                {WO_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={fieldLabel(t)}>
              Title / Task *
              <input style={inp} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Dyno Motor Overheating Repair" />
            </label>
            <label style={fieldLabel(t)}>
              Assign PIC Allocation
              <input style={inp} value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} placeholder="Select PIC lead…" />
            </label>
            <label style={fieldLabel(t)}>
              Priority
              <select style={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label style={fieldLabel(t)}>
              SOR / Ringi Approval Mapping
              <input style={inp} value={form.sor_ref} onChange={(e) => setForm({ ...form, sor_ref: e.target.value })} placeholder="RNG-2026-8821 / SOR-2026-0412 / None" />
            </label>
            <label style={fieldLabel(t)}>
              Description
              <textarea style={{ ...inp, minHeight: 70 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <button type="submit" style={{ ...btnPrimary, width: '100%' }}>Create Work Order</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function fieldLabel(t) {
  return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: t.textDim, fontWeight: 600 };
}

import { useEffect, useState } from 'react';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from '../fmmsUi';

const STAGES = ['notify', 'pickup', 'at_lab', 'return', 'closed'];

export default function TacoVendorWorkflow() {
  const { theme: t } = useTheme();
  const [rows, setRows] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    asset_code: '', asset_name: '', business_unit: 'Interior Systems', vendor_id: '',
    pickup_date: '', expected_return: '', estimated_cost: 0, remarks: '',
  });

  const load = async () => {
    try {
      const [w, v] = await Promise.all([
        api.get('/api/fmms/taco/workflows'),
        api.get('/api/fmms/taco/vendors', { params: { status: 'approved' } }),
      ]);
      setRows(w.data || []);
      setVendors(v.data || []);
    } catch {
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    await api.post('/api/fmms/taco/workflows', {
      ...form,
      vendor_id: Number(form.vendor_id),
      estimated_cost: Number(form.estimated_cost || 0),
      pickup_date: form.pickup_date || null,
      expected_return: form.expected_return || null,
    });
    setShowForm(false);
    load();
  };

  const advance = async (id, stage) => {
    await api.patch(`/api/fmms/taco/workflows/${id}`, { stage });
    load();
  };

  const tone = (stage) => {
    if (stage === 'closed') return 'ok';
    if (stage === 'notify') return 'info';
    if (stage === 'return') return 'warn';
    return 'neutral';
  };

  const inp = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box' };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Vendor Notification & Pickup Workflow"
        onRefresh={load}
        extra={<button type="button" onClick={() => setShowForm(!showForm)} style={btn(t)}>{showForm ? 'Cancel' : '+ Notify Vendor'}</button>}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        CAL-07 auto notify · CAL-08 pickup → lab → return execution
      </p>

      {showForm && (
        <form onSubmit={create} className={surfaceClass(t)} style={{ ...cardStyle(t), display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
          <label style={lab(t)}>Asset Code *<input required style={inp} value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} /></label>
          <label style={lab(t)}>Asset Name<input style={inp} value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} /></label>
          <label style={lab(t)}>
            BU
            <select style={inp} value={form.business_unit} onChange={(e) => setForm({ ...form, business_unit: e.target.value })}>
              {['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'].map((bu) => <option key={bu}>{bu}</option>)}
            </select>
          </label>
          <label style={lab(t)}>
            Vendor *
            <select required style={inp} value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
              <option value="">Select…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label style={lab(t)}>Pickup Date<input type="date" style={inp} value={form.pickup_date} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} /></label>
          <label style={lab(t)}>Expected Return<input type="date" style={inp} value={form.expected_return} onChange={(e) => setForm({ ...form, expected_return: e.target.value })} /></label>
          <label style={lab(t)}>Est. Cost ₹<input type="number" style={inp} value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} /></label>
          <button type="submit" style={{ ...btn(t), alignSelf: 'end' }}>Create & Notify</button>
        </form>
      )}

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Workflow</th><th style={thStyle(t)}>Asset</th><th style={thStyle(t)}>BU</th>
                <th style={thStyle(t)}>Vendor</th><th style={thStyle(t)}>Stage</th><th style={thStyle(t)}>Pickup / Return</th>
                <th style={thStyle(t)}>Cost ₹</th><th style={thStyle(t)}>Advance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const idx = STAGES.indexOf(w.stage);
                const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
                return (
                  <tr key={w.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{w.workflow_number}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ fontWeight: 600 }}>{w.asset_name}</div>
                      <div style={{ fontSize: 11, color: t.textFaint }}>{w.asset_code}</div>
                    </td>
                    <td style={tdStyle(t)}>{w.business_unit || '—'}</td>
                    <td style={tdStyle(t)}>{w.vendor_name}</td>
                    <td style={tdStyle(t)}><FmmsBadge t={t} tone={tone(w.stage)}>{w.stage}</FmmsBadge></td>
                    <td style={tdStyle(t)}>{w.pickup_date || '—'} → {w.expected_return || '—'}</td>
                    <td style={tdStyle(t)}>{Number(w.actual_cost || w.estimated_cost || 0).toLocaleString('en-IN')}</td>
                    <td style={tdStyle(t)}>
                      {w.stage !== 'closed' && (
                        <button type="button" style={{ ...btn(t), padding: '4px 10px', fontSize: 11 }} onClick={() => advance(w.id, next)}>
                          → {next}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No vendor workflows yet</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function lab(t) { return { fontSize: 11, color: t.textDim, display: 'flex', flexDirection: 'column', gap: 4 }; }
function btn(t) {
  return {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    border: `1px solid ${t.accent}`, background: t.accent, color: '#fff',
  };
}

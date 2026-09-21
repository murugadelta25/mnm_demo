import { useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const SEED = [
  { ref: 'RNG-2026-8821', title: 'Hydraulic Power Unit Retrofit', cost: '₹1,250,000', authority: 'Plant Head / FM Directorship', status: 'Approved' },
  { ref: 'SOR-2026-0412', title: 'Centrifugal Chiller Overhaul (Vendor)', cost: '₹480,000', authority: 'Maintenance Head', status: 'Approved' },
  { ref: 'RNG-2026-9055', title: 'Vibration Diagnostic Sensor Upgrade', cost: '₹320,000', authority: 'Finance Committee', status: 'Under Review' },
];

export default function FmmsRingiSor() {
  const { theme: t } = useTheme();
  const [rows, setRows] = useState(SEED);
  const [form, setForm] = useState({ doc_type: 'Ringi Note', asset_id: '', amount: '', justification: '' });
  const [msg, setMsg] = useState('');

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '8px 16px', background: t.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, width: '100%',
  };

  const submit = (e) => {
    e.preventDefault();
    const ref = `${form.doc_type.startsWith('SOR') ? 'SOR' : 'RNG'}-2026-${String(9000 + rows.length).slice(-4)}`;
    setRows((p) => [{
      ref,
      title: form.justification.slice(0, 60) || form.asset_id || 'New proposal',
      cost: form.amount ? `₹${Number(form.amount).toLocaleString('en-IN')}` : '—',
      authority: 'Pending assignment',
      status: 'Under Review',
    }, ...p]);
    setForm({ doc_type: 'Ringi Note', asset_id: '', amount: '', justification: '' });
    setMsg('✅ Approval proposal submitted (local workspace — wire to backend when Ringi API is ready)');
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="Ringi / SOR Approvals" />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Financial and operational justification approvals linked with FMMS work orders and procurement.
      </p>
      {msg && <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Ringi & SOR Approval Tracking</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Ringi/SOR Ref</th>
                  <th style={thStyle(t)}>Title / Objective</th>
                  <th style={thStyle(t)}>Estimated Cost</th>
                  <th style={thStyle(t)}>Approval Authority</th>
                  <th style={thStyle(t)}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ref}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{r.ref}</td>
                    <td style={tdStyle(t)}>{r.title}</td>
                    <td style={tdStyle(t)}>{r.cost}</td>
                    <td style={tdStyle(t)}>{r.authority}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={r.status === 'Approved' ? 'ok' : 'warn'}>{r.status}</FmmsBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Initiate New Ringi / SOR</h3>
          <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
            <label style={lab(t)}>Document Type
              <select style={inp} value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>
                <option>Ringi Note (Capital Expenditure / Major Overhaul)</option>
                <option>SOR - Statement of Requirement (Operational Service)</option>
              </select>
            </label>
            <label style={lab(t)}>Target Asset ID
              <input style={inp} value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })} placeholder="e.g. LOC1-B10B-LAB1-EQ01" />
            </label>
            <label style={lab(t)}>Estimated Amount (INR)
              <input style={inp} type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label style={lab(t)}>Justification / Scope
              <textarea style={{ ...inp, minHeight: 80 }} required value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} />
            </label>
            <button type="submit" style={btnPrimary}>Submit Approval Proposal</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function lab(t) {
  return { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: t.textDim, fontWeight: 600 };
}

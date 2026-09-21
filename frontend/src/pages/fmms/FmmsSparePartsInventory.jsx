import { useState, useEffect } from 'react';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

export default function FmmsSparePartsInventory() {
  const { theme: t } = useTheme();
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    part_code: '', name: '', category: '', location: '',
    quantity_on_hand: 0, reorder_level: 0, supplier: '',
  });
  const [msg, setMsg] = useState('');

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '8px 16px', background: t.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  };
  const btnSecondary = {
    padding: '8px 16px', background: t.surface2, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/fmms/spare-parts');
      setParts(data || []);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/fmms/spare-parts', {
        ...form,
        quantity_on_hand: Number(form.quantity_on_hand),
        reorder_level: Number(form.reorder_level),
      });
      setShowForm(false);
      setForm({
        part_code: '', name: '', category: '', location: '',
        quantity_on_hand: 0, reorder_level: 0, supplier: '',
      });
      setMsg('✅ Spare part saved');
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Spares Master"
        onRefresh={load}
        extra={(
          <button type="button" style={btnPrimary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add Spare Part'}
          </button>
        )}
      />
      {msg && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className={surfaceClass(t)} style={{ ...cardStyle(t), display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <input style={inp} placeholder="Part Code *" required value={form.part_code} onChange={(e) => setForm({ ...form, part_code: e.target.value })} />
          <input style={inp} placeholder="Name *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input style={inp} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input style={inp} placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <input style={inp} placeholder="Qty On Hand" type="number" value={form.quantity_on_hand} onChange={(e) => setForm({ ...form, quantity_on_hand: e.target.value })} />
          <input style={inp} placeholder="Reorder Level" type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
          <input style={inp} placeholder="Supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button type="button" style={btnSecondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" style={btnPrimary}>Save</button>
          </div>
        </form>
      )}

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Code</th>
                <th style={thStyle(t)}>Name</th>
                <th style={thStyle(t)}>Category</th>
                <th style={thStyle(t)}>Qty</th>
                <th style={thStyle(t)}>Reorder</th>
                <th style={thStyle(t)}>Status</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const low = Number(p.quantity_on_hand) <= Number(p.reorder_level);
                return (
                  <tr key={p.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{p.part_code}</td>
                    <td style={tdStyle(t)}>{p.name}</td>
                    <td style={tdStyle(t)}>{p.category || '—'}</td>
                    <td style={tdStyle(t)}>{p.quantity_on_hand}</td>
                    <td style={tdStyle(t)}>{p.reorder_level}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={low ? 'warn' : 'ok'}>{low ? 'Reorder' : (p.status || 'OK')}</FmmsBadge>
                    </td>
                  </tr>
                );
              })}
              {parts.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No spare parts registered</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

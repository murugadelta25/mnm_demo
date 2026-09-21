import { useEffect, useState } from 'react';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge, formatHistoryDate } from './fmmsUi';

const EMPTY = { regulation_name: '', compliance_type: '', status: 'pending', due_date: '', auditor: '' };

const STATUS_TONE = {
  compliant: 'ok',
  non_compliant: 'critical',
  pending: 'warn',
  expired: 'critical',
};

export default function FmmsCompliance() {
  const { theme: t } = useTheme();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
  const btnSecondary = {
    padding: '8px 16px', background: t.surface2, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/fmms/compliance');
      setRecords(data || []);
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
      await api.post('/api/fmms/compliance', { ...form, due_date: form.due_date || null });
      setShowForm(false);
      setForm(EMPTY);
      setMsg('✅ Compliance record saved');
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Compliance Management"
        onRefresh={load}
        extra={(
          <button type="button" style={btnPrimary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add Compliance Record'}
          </button>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Track regulatory, safety, and quality compliance obligations with due dates and auditors.
      </p>

      {msg && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className={surfaceClass(t)}
          style={{ ...cardStyle(t), display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}
        >
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Regulation Name *</div>
            <input style={inp} required value={form.regulation_name} onChange={(e) => setForm({ ...form, regulation_name: e.target.value })} placeholder="Regulation / standard" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Compliance Type</div>
            <select style={inp} value={form.compliance_type} onChange={(e) => setForm({ ...form, compliance_type: e.target.value })}>
              <option value="">Select type…</option>
              <option value="safety">Safety</option>
              <option value="environmental">Environmental</option>
              <option value="quality">Quality</option>
              <option value="regulatory">Regulatory</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Due Date</div>
            <input style={inp} type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Auditor</div>
            <input style={inp} value={form.auditor} onChange={(e) => setForm({ ...form, auditor: e.target.value })} placeholder="Auditor name" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Status</div>
            <select style={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="compliant">Compliant</option>
              <option value="non_compliant">Non-compliant</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button type="button" style={btnSecondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" style={btnPrimary}>Save</button>
          </div>
        </form>
      )}

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Regulation</th>
                  <th style={thStyle(t)}>Type</th>
                  <th style={thStyle(t)}>Status</th>
                  <th style={thStyle(t)}>Due Date</th>
                  <th style={thStyle(t)}>Auditor</th>
                </tr>
              </thead>
              <tbody>
                {records.map((c) => (
                  <tr key={c.id}>
                    <td style={tdStyle(t)}>{c.regulation_name}</td>
                    <td style={tdStyle(t)}>{c.compliance_type || '—'}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={STATUS_TONE[c.status] || 'neutral'}>{c.status}</FmmsBadge>
                    </td>
                    <td style={tdStyle(t)}>{formatHistoryDate(c.due_date)}</td>
                    <td style={tdStyle(t)}>{c.auditor || '—'}</td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No compliance records yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

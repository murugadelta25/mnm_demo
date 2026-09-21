import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const EMPTY = { work_order_id: '', pic_user: '', role: 'lead', remarks: '' };

export default function FmmsPicAssignment() {
  const { theme: t } = useTheme();
  const [assignments, setAssignments] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [technicians, setTechnicians] = useState([]);
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
  const linkBtn = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, w, tech] = await Promise.all([
        api.get('/api/fmms/pic-assignments'),
        api.get('/api/fmms/work-orders').catch(() => ({ data: [] })),
        api.get('/api/fmms/pic-technicians', { params: { active_only: true } }).catch(() => ({ data: [] })),
      ]);
      setAssignments(a.data || []);
      setWorkOrders(Array.isArray(w.data) ? w.data : (w.data?.items || []));
      setTechnicians(tech.data || []);
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
      await api.post('/api/fmms/pic-assignments', {
        ...form,
        work_order_id: Number(form.work_order_id),
      });
      setShowForm(false);
      setForm(EMPTY);
      setMsg('✅ PIC assigned');
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="PIC (Person In Charge) Assignment"
        onRefresh={load}
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/fmms/pic-master" style={linkBtn}>PIC Allocation Master</Link>
            <button type="button" style={btnPrimary} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Assign PIC'}
            </button>
          </div>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Assign lead / support PIC to FMMS work orders from the technician master. Manage technicians in PIC Allocation Master.
      </p>

      {msg && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className={surfaceClass(t)}
          style={{ ...cardStyle(t), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}
        >
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Work Order *</div>
            <select style={inp} required value={form.work_order_id} onChange={(e) => setForm({ ...form, work_order_id: e.target.value })}>
              <option value="">Select work order…</option>
              {workOrders.map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.wo_number || `WO-${wo.id}`} — {wo.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>PIC User *</div>
            <select style={inp} required value={form.pic_user} onChange={(e) => setForm({ ...form, pic_user: e.target.value })}>
              <option value="">Select technician…</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.employee_code}>
                  {tech.employee_code} — {tech.name}{tech.craft ? ` (${tech.craft})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Role</div>
            <select style={inp} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="lead">Lead</option>
              <option value="support">Support</option>
              <option value="specialist">Specialist</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Remarks</div>
            <input style={inp} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Optional remarks" />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button type="button" style={btnSecondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" style={btnPrimary}>Assign</button>
          </div>
        </form>
      )}

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>WO ID</th>
                  <th style={thStyle(t)}>PIC User</th>
                  <th style={thStyle(t)}>Role</th>
                  <th style={thStyle(t)}>Status</th>
                  <th style={thStyle(t)}>Assigned Date</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td style={tdStyle(t)}>{a.work_order_id}</td>
                    <td style={tdStyle(t)}>{a.pic_user}</td>
                    <td style={tdStyle(t)}>{a.role}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={a.status === 'completed' ? 'ok' : 'info'}>{a.status}</FmmsBadge>
                    </td>
                    <td style={tdStyle(t)}>{a.assigned_date || '—'}</td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No PIC assignments yet</td>
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

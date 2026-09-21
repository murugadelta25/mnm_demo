import { useEffect, useState } from 'react';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const EMPTY = { title: '', severity: 'medium', incident_type: '', description: '', reported_by: '', assigned_to: '' };

const SEV_TONE = { low: 'ok', medium: 'info', high: 'warn', critical: 'critical' };

/** Roles allowed to delete incidents (matches backend require_role). */
const DELETE_ROLES = ['admin', 'superadmin', 'site_admin', 'supervisor', 'maintenance'];

export default function FmmsIncidentTracking() {
  const { theme: t } = useTheme();
  const { user } = useAuth();
  const canDelete = DELETE_ROLES.includes(user?.role);
  const [incidents, setIncidents] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const [deletingId, setDeletingId] = useState(null);

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
  const btnDanger = {
    ...btnPrimary, background: '#dc2626',
  };
  const btnDelete = {
    padding: '4px 10px', background: 'transparent', color: '#ef4444',
    border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  };

  const load = async () => {
    setLoading(true);
    try {
      const [inc, tech] = await Promise.all([
        api.get('/api/fmms/incidents'),
        api.get('/api/fmms/pic-technicians', { params: { active_only: true } }).catch(() => ({ data: [] })),
      ]);
      setIncidents(inc.data || []);
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
      await api.post('/api/fmms/incidents', form);
      setShowForm(false);
      setForm(EMPTY);
      setMsg('✅ Incident reported');
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleDelete = async (inc) => {
    if (!canDelete || !inc?.id) return;
    if (!window.confirm(`Delete incident ${inc.incident_number} — ${inc.title}? This cannot be undone.`)) return;
    setDeletingId(inc.id);
    try {
      await api.delete(`/api/fmms/incidents/${inc.id}`);
      setMsg(`✅ Deleted ${inc.incident_number}`);
      load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Centralized Incident Tracking"
        onRefresh={load}
        extra={(
          <button type="button" style={btnPrimary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Report Incident'}
          </button>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Report and track safety, equipment, and near-miss incidents. Assign a PIC from the technician master when available.
        {canDelete ? ' Delete is available for admin / supervisor / maintenance roles.' : ''}
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
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Title *</div>
            <input style={inp} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Incident title" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Reported By</div>
            <input style={inp} value={form.reported_by} onChange={(e) => setForm({ ...form, reported_by: e.target.value })} placeholder="Reporter name" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Severity</div>
            <select style={inp} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Type</div>
            <select style={inp} value={form.incident_type} onChange={(e) => setForm({ ...form, incident_type: e.target.value })}>
              <option value="">Select type…</option>
              <option value="safety">Safety</option>
              <option value="equipment_failure">Equipment Failure</option>
              <option value="environmental">Environmental</option>
              <option value="near_miss">Near Miss</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Assign PIC</div>
            <select style={inp} value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.employee_code}>
                  {tech.employee_code} — {tech.name}{tech.craft ? ` (${tech.craft})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Description</div>
            <textarea
              style={{ ...inp, minHeight: 72, resize: 'vertical' }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe what happened…"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button type="button" style={btnSecondary} onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" style={btnDanger}>Report</button>
          </div>
        </form>
      )}

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>INC#</th>
                  <th style={thStyle(t)}>Title</th>
                  <th style={thStyle(t)}>Severity</th>
                  <th style={thStyle(t)}>Type</th>
                  <th style={thStyle(t)}>Status</th>
                  <th style={thStyle(t)}>Reported By</th>
                  <th style={thStyle(t)}>PIC</th>
                  {canDelete && <th style={thStyle(t)}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{i.incident_number}</td>
                    <td style={tdStyle(t)}>{i.title}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={SEV_TONE[i.severity] || 'neutral'}>{i.severity}</FmmsBadge>
                    </td>
                    <td style={tdStyle(t)}>{i.incident_type || '—'}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={i.status === 'resolved' || i.status === 'closed' ? 'ok' : 'info'}>{i.status}</FmmsBadge>
                    </td>
                    <td style={tdStyle(t)}>{i.reported_by || '—'}</td>
                    <td style={tdStyle(t)}>{i.assigned_to || '—'}</td>
                    {canDelete && (
                      <td style={tdStyle(t)}>
                        <button
                          type="button"
                          style={{ ...btnDelete, opacity: deletingId === i.id ? 0.6 : 1 }}
                          disabled={deletingId === i.id}
                          onClick={() => handleDelete(i)}
                        >
                          {deletingId === i.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {incidents.length === 0 && (
                  <tr>
                    <td colSpan={canDelete ? 8 : 7} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>No incidents reported</td>
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

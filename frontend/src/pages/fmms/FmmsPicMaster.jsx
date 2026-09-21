import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

const EMPTY = {
  employee_code: '',
  name: '',
  craft: 'mechanical',
  skill_level: 'senior',
  phone: '',
  email: '',
  department: '',
  is_active: true,
  linked_operator_id: '',
  notes: '',
};

const CRAFTS = ['mechanical', 'electrical', 'instrumentation', 'calibration', 'general'];
const SKILLS = ['junior', 'senior', 'specialist', 'lead'];

function apiErr(e) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join('; ');
  return e?.message || 'Request failed';
}

export default function FmmsPicMaster() {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState('directory');
  const [technicians, setTechnicians] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState({ text: '', ok: true });

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '8px 16px', background: t.accent, color: '#fff', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  };
  const btnSecondary = {
    padding: '8px 14px', background: 'transparent', color: t.accent,
    border: `1px solid ${t.accent}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
  };
  const tabBtn = (active) => ({
    padding: '8px 16px', borderRadius: 8, border: `1px solid ${active ? t.accent : t.border}`,
    background: active ? t.accent : 'transparent', color: active ? '#fff' : t.text,
    cursor: 'pointer', fontWeight: 600, fontSize: 13,
  });
  const linkBtn = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };

  const flash = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg({ text: '', ok: true }), 4000);
  };

  const loadTechs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/fmms/pic-technicians', {
        params: { active_only: !showInactive, q: q.trim() || undefined },
      });
      setTechnicians(data || []);
    } catch (e) {
      flash(apiErr(e), false);
    } finally {
      setLoading(false);
    }
  }, [showInactive, q]);

  const loadOperators = useCallback(async () => {
    try {
      const r = await api.get('/api/operators/', {
        params: { active_only: true, include_temporary: true, limit: 1000 },
      });
      setOperators(r.data?.operators || []);
    } catch {
      setOperators([]);
    }
  }, []);

  useEffect(() => { loadTechs(); }, [loadTechs]);
  useEffect(() => {
    if (tab === 'operators') {
      loadOperators();
      loadTechs();
    }
  }, [tab, loadOperators, loadTechs]);

  const resetForm = () => {
    setForm(EMPTY);
    setEditingId(null);
  };

  const startEdit = (tech) => {
    setEditingId(tech.id);
    setForm({
      employee_code: tech.employee_code || '',
      name: tech.name || '',
      craft: tech.craft || 'mechanical',
      skill_level: tech.skill_level || 'senior',
      phone: tech.phone || '',
      email: tech.email || '',
      department: tech.department || '',
      is_active: !!tech.is_active,
      linked_operator_id: tech.linked_operator_id != null ? String(tech.linked_operator_id) : '',
      notes: tech.notes || '',
    });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.employee_code.trim() || !form.name.trim()) {
      flash('Employee code and name are required', false);
      return;
    }
    const body = {
      ...form,
      linked_operator_id: form.linked_operator_id ? Number(form.linked_operator_id) : null,
      is_active: !!form.is_active,
    };
    try {
      if (editingId) {
        await api.put(`/api/fmms/pic-technicians/${editingId}`, body);
        flash('Technician updated');
      } else {
        await api.post('/api/fmms/pic-technicians', body);
        flash('Technician added');
      }
      resetForm();
      loadTechs();
    } catch (err) {
      flash(apiErr(err), false);
    }
  };

  const importOperator = async (op) => {
    try {
      await api.post('/api/fmms/pic-technicians', {
        employee_code: op.employee_code || op.username,
        name: op.name || op.employee_code,
        craft: 'general',
        skill_level: 'senior',
        is_active: true,
        linked_operator_id: op.id,
        notes: 'Imported from Operator Management',
      });
      flash(`Imported ${op.employee_code || op.name}`);
      setTab('directory');
      loadTechs();
    } catch (err) {
      flash(apiErr(err), false);
    }
  };

  const deactivate = async (tech) => {
    try {
      await api.put(`/api/fmms/pic-technicians/${tech.id}`, { is_active: !tech.is_active });
      flash(tech.is_active ? 'Technician deactivated' : 'Technician reactivated');
      loadTechs();
    } catch (err) {
      flash(apiErr(err), false);
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="PIC Allocation Master"
        onRefresh={() => (tab === 'directory' ? loadTechs() : loadOperators())}
        extra={<Link to="/fmms/pic-assignment" style={linkBtn}>PIC Assignments</Link>}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Maintain technicians available as Person In Charge for incidents, planned maintenance, and calibration.
        Import from Operator Management or add technicians directly (same pattern as Operator Directory).
      </p>

      {msg.text && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 12,
          background: msg.ok ? '#10b98122' : '#ef444422',
          color: msg.ok ? '#10b981' : '#ef4444', fontSize: 13,
        }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" style={tabBtn(tab === 'directory')} onClick={() => setTab('directory')}>Technician Directory</button>
        <button type="button" style={tabBtn(tab === 'operators')} onClick={() => setTab('operators')}>Available Operators</button>
      </div>

      {tab === 'directory' && (
        <>
          <form onSubmit={save} className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, color: t.accent }}>
              {editingId ? 'Edit Technician' : 'Add Technician'}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Employee Code *</div>
                <input style={inp} required value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} disabled={!!editingId} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Name *</div>
                <input style={inp} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Craft</div>
                <select style={inp} value={form.craft} onChange={(e) => setForm({ ...form, craft: e.target.value })}>
                  {CRAFTS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Skill Level</div>
                <select style={inp} value={form.skill_level} onChange={(e) => setForm({ ...form, skill_level: e.target.value })}>
                  {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Department</div>
                <input style={inp} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Phone</div>
                <input style={inp} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Email</div>
                <input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Active</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 34 }}>
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  Available for PIC assignment
                </label>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Notes</div>
              <input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="submit" style={btnPrimary}>{editingId ? 'Update' : 'Add Technician'}</button>
              {editingId && <button type="button" style={btnSecondary} onClick={resetForm}>Cancel Edit</button>}
            </div>
          </form>

          <section className={surfaceClass(t)} style={cardStyle(t)}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                style={{ ...inp, maxWidth: 240 }}
                placeholder="Search code / name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.textDim }}>
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
              <span style={{ fontSize: 12, color: t.textFaint }}>{technicians.length} technician(s)</span>
            </div>
            {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableWrap(t)}>
                  <thead>
                    <tr>
                      <th style={thStyle(t)}>Code</th>
                      <th style={thStyle(t)}>Name</th>
                      <th style={thStyle(t)}>Craft</th>
                      <th style={thStyle(t)}>Skill</th>
                      <th style={thStyle(t)}>Department</th>
                      <th style={thStyle(t)}>Status</th>
                      <th style={thStyle(t)}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {technicians.map((tech) => (
                      <tr key={tech.id}>
                        <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{tech.employee_code}</td>
                        <td style={tdStyle(t)}>{tech.name}</td>
                        <td style={tdStyle(t)}>{tech.craft || '—'}</td>
                        <td style={tdStyle(t)}>{tech.skill_level || '—'}</td>
                        <td style={tdStyle(t)}>{tech.department || '—'}</td>
                        <td style={tdStyle(t)}>
                          <FmmsBadge t={t} tone={tech.is_active ? 'ok' : 'neutral'}>
                            {tech.is_active ? 'Active' : 'Inactive'}
                          </FmmsBadge>
                        </td>
                        <td style={tdStyle(t)}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" style={btnSecondary} onClick={() => startEdit(tech)}>Edit</button>
                            <button type="button" style={btnSecondary} onClick={() => deactivate(tech)}>
                              {tech.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {technicians.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>
                          No technicians yet. Add them here or import from Available Operators.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'operators' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Available Operators</h3>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 12 }}>
            Shop-floor operators from Operator Management. Import into PIC Allocation Master to assign as Person In Charge.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Code</th>
                  <th style={thStyle(t)}>Name</th>
                  <th style={thStyle(t)}>Status</th>
                  <th style={thStyle(t)}>Action</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op) => {
                  const code = op.employee_code || op.username;
                  const already = technicians.some((x) => x.employee_code === code || x.linked_operator_id === op.id);
                  return (
                    <tr key={op.id}>
                      <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{code}</td>
                      <td style={tdStyle(t)}>{op.name || '—'}</td>
                      <td style={tdStyle(t)}>
                        <FmmsBadge t={t} tone={op.is_active ? 'ok' : 'neutral'}>
                          {op.is_active ? 'Active' : 'Inactive'}
                        </FmmsBadge>
                      </td>
                      <td style={tdStyle(t)}>
                        {already ? (
                          <span style={{ fontSize: 12, color: t.textFaint }}>Already in master</span>
                        ) : (
                          <button type="button" style={btnPrimary} onClick={() => importOperator(op)}>Add as PIC</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {operators.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>
                      No operators found. Add them in Operator Management first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

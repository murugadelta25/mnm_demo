import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge, formatHistoryDate } from './fmmsUi';

const MAX_MODS = 3;
const PLAN_TYPES = [
  { value: 'pm', label: 'Preventive Maintenance (PM)' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'issue', label: 'Address New Issue' },
];

/** Same sources as Asset Management add-asset form. */
const ASSET_TYPES = [
  { id: 'machine', label: 'Machine (Machine Configuration)' },
  { id: 'measuring_instrument', label: 'Measuring Instruments' },
  { id: 'quality_instrument', label: 'Quality / QA Instruments' },
  { id: 'other', label: 'Other Equipment' },
];

/**
 * Resolve asset master source for filtering (same rules as Asset Management edit).
 * Uses category first, then machine_id, then instrument-type name lists from meta.
 */
function resolveAssetType(asset, measuringSet, qualitySet) {
  if (!asset) return '';
  const cat = String(asset.category || '').trim().toLowerCase();
  if (cat === 'measuring_instrument' || cat === 'quality_instrument' || cat === 'machine' || cat === 'other') {
    return cat;
  }
  if (asset.machine_id) return 'machine';
  const mt = String(asset.machine_type || '').trim();
  if (mt && measuringSet?.has(mt)) return 'measuring_instrument';
  if (mt && qualitySet?.has(mt)) return 'quality_instrument';
  return 'other';
}

/** Load full Asset Management registry (all pages), same API as Asset Management. */
async function loadAssetManagementList() {
  const pageSize = 100;
  let page = 1;
  let pages = 1;
  const items = [];
  while (page <= pages) {
    const { data } = await api.get('/api/fmms/assets', {
      params: { equipment_only: true, page, page_size: pageSize },
    });
    if (Array.isArray(data)) {
      items.push(...data);
      break;
    }
    items.push(...(data?.items || []));
    pages = Number(data?.pages || 1);
    page += 1;
    if (page > 50) break; // safety
  }
  return items;
}

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function monthKey(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 7);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

function apiErr(e) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join('; ');
  return e?.message || 'Request failed';
}

function emptyForm(horizonStart) {
  return {
    asset_type: '',
    asset_id: '',
    plan_type: 'pm',
    title: '',
    description: '',
    pic_technician_id: '',
    planned_date: horizonStart,
    due_date: '',
    remarks: '',
  };
}

/** PM / Calibration / Issue planning panel — embedded in Planning & Resource Allocation. */
export default function PmcPlanningPanel({ t }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [horizonStart, setHorizonStart] = useState(today);
  const horizonEnd = useMemo(() => addMonths(horizonStart, 6), [horizonStart]);

  const [plans, setPlans] = useState([]);
  const [assets, setAssets] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [measuringSet, setMeasuringSet] = useState(() => new Set());
  const [qualitySet, setQualitySet] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => emptyForm(today));
  const [msg, setMsg] = useState({ text: '', ok: true });

  const months = useMemo(() => {
    const list = [];
    let cur = horizonStart.slice(0, 7);
    while (list.length < 6) {
      list.push(cur);
      const [y, m] = cur.split('-').map(Number);
      const next = new Date(y, m, 1);
      cur = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    }
    return list;
  }, [horizonStart]);

  const filteredAssets = useMemo(() => {
    if (!form.asset_type) return [];
    return assets.filter((a) => resolveAssetType(a, measuringSet, qualitySet) === form.asset_type);
  }, [assets, form.asset_type, measuringSet, qualitySet]);

  const assetTypeCounts = useMemo(() => {
    const counts = { machine: 0, measuring_instrument: 0, quality_instrument: 0, other: 0 };
    for (const a of assets) {
      const key = resolveAssetType(a, measuringSet, qualitySet);
      if (counts[key] != null) counts[key] += 1;
    }
    return counts;
  }, [assets, measuringSet, qualitySet]);

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
  const linkBtn = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };

  const flash = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg({ text: '', ok: true }), 4500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [p, assetItems, tech, metaRes] = await Promise.all([
        api.get('/api/fmms/pmc-plans', { params: { horizon_start: horizonStart, horizon_end: horizonEnd } }),
        loadAssetManagementList(),
        api.get('/api/fmms/pic-technicians', { params: { active_only: true } }),
        api.get('/api/fmms/assets/meta').catch(() => ({ data: null })),
      ]);
      setPlans(p.data || []);
      setAssets(assetItems);
      setTechnicians(tech.data || []);
      const meta = metaRes?.data;
      setMeasuringSet(new Set(meta?.measuringInstruments || []));
      setQualitySet(new Set(meta?.qualityInstruments || []));
    } catch (err) {
      flash(apiErr(err), false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [horizonStart, horizonEnd]);

  const resetForm = () => {
    setForm(emptyForm(horizonStart));
    setEditingId(null);
    setShowForm(false);
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm(horizonStart));
    setShowForm(true);
  };

  const startEdit = (plan) => {
    if ((plan.modification_count || 0) >= MAX_MODS) {
      flash(`Plan ${plan.plan_number} has reached the maximum of ${MAX_MODS} modifications`, false);
      return;
    }
    const linked = assets.find((a) => a.id === plan.asset_id);
    setEditingId(plan.id);
    setForm({
      asset_type: resolveAssetType(linked, measuringSet, qualitySet) || '',
      asset_id: String(plan.asset_id || ''),
      plan_type: plan.plan_type || 'pm',
      title: plan.title || '',
      description: plan.description || '',
      pic_technician_id: plan.pic_technician_id != null ? String(plan.pic_technician_id) : '',
      planned_date: plan.planned_date || horizonStart,
      due_date: plan.due_date || '',
      remarks: plan.remarks || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.asset_type) {
      flash('Select an asset type first', false);
      return;
    }
    if (!form.asset_id || !form.title.trim() || !form.planned_date) {
      flash('Asset, title, and planned date are required', false);
      return;
    }
    if (form.planned_date < horizonStart || form.planned_date > horizonEnd) {
      flash('Planned date must fall within the 6-month feasibility horizon', false);
      return;
    }
    const body = {
      asset_id: Number(form.asset_id),
      plan_type: form.plan_type,
      title: form.title.trim(),
      description: form.description || null,
      pic_technician_id: form.pic_technician_id ? Number(form.pic_technician_id) : null,
      planned_date: form.planned_date,
      due_date: form.due_date || null,
      remarks: form.remarks || null,
      horizon_start: horizonStart,
      horizon_end: horizonEnd,
    };
    try {
      if (editingId) {
        await api.patch(`/api/fmms/pmc-plans/${editingId}`, body);
        flash(`Plan updated (${MAX_MODS} modifications max)`);
      } else {
        await api.post('/api/fmms/pmc-plans', body);
        flash('PM/C plan scheduled');
      }
      resetForm();
      load();
    } catch (err) {
      flash(apiErr(err), false);
    }
  };

  const plansByMonth = useMemo(() => {
    const map = Object.fromEntries(months.map((m) => [m, []]));
    for (const p of plans) {
      const key = monthKey(p.planned_date);
      if (map[key]) map[key].push(p);
    }
    return map;
  }, [plans, months]);

  const typeTone = { pm: 'info', calibration: 'ok', issue: 'warn' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-start' }}>
        <p style={{ fontSize: 12, color: t.textDim, margin: 0, maxWidth: 720 }}>
          Six-month feasibility plan for Preventive Maintenance, Calibration, and new issues.
          Select an asset, assign PIC, and schedule within the horizon. Each plan may be modified at most {MAX_MODS} times.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/fmms/pic-master" style={linkBtn}>PIC Master</Link>
          <Link to="/fmms/amc-calibration" style={linkBtn}>AMC & Calibration</Link>
          <button type="button" style={btnPrimary} onClick={showForm && !editingId ? resetForm : startCreate}>
            {showForm && !editingId ? 'Cancel' : '+ Schedule Plan'}
          </button>
          <button type="button" style={btnSecondary} onClick={load}>Refresh</button>
        </div>
      </div>

      {msg.text && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 12,
          background: msg.ok ? '#10b98122' : '#ef444422',
          color: msg.ok ? '#10b981' : '#ef4444', fontSize: 13,
        }}>
          {msg.text}
        </div>
      )}

      <section className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Horizon start</div>
          <input
            style={{ ...inp, width: 180 }}
            type="date"
            value={horizonStart}
            onChange={(e) => setHorizonStart(e.target.value || today)}
          />
        </div>
        <div style={{ fontSize: 13, color: t.textDim, paddingBottom: 8 }}>
          Feasibility window: <strong style={{ color: t.text }}>{formatHistoryDate(horizonStart)}</strong>
          {' → '}
          <strong style={{ color: t.text }}>{formatHistoryDate(horizonEnd)}</strong>
          {' '}(6 months)
        </div>
      </section>

      {showForm && (
        <form onSubmit={handleSubmit} className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: t.accent }}>
            {editingId ? 'Modify Plan' : 'Schedule New Plan'}
            {editingId && (
              <span style={{ marginLeft: 10, fontSize: 12, color: t.textDim, fontWeight: 500 }}>
                (counts toward {MAX_MODS}-modification limit)
              </span>
            )}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Asset Type *</div>
              <select
                style={inp}
                required
                value={form.asset_type}
                onChange={(e) => setForm({ ...form, asset_type: e.target.value, asset_id: '' })}
              >
                <option value="">Select asset type…</option>
                {ASSET_TYPES.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} ({assetTypeCounts[opt.id] || 0})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>
                Asset *
              </div>
              <select
                style={inp}
                required
                disabled={!form.asset_type}
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
              >
                <option value="">
                  {!form.asset_type
                    ? 'Select asset type first…'
                    : filteredAssets.length === 0
                      ? 'No assets of this type in Asset Management'
                      : `Select asset (${filteredAssets.length})…`}
                </option>
                {filteredAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.name}
                    {a.machine_type ? ` (${a.machine_type})` : ''}
                    {a.location ? ` · ${a.location}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Plan Type *</div>
              <select style={inp} value={form.plan_type} onChange={(e) => setForm({ ...form, plan_type: e.target.value })}>
                {PLAN_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Assign PIC</div>
              <select style={inp} value={form.pic_technician_id} onChange={(e) => setForm({ ...form, pic_technician_id: e.target.value })}>
                <option value="">Unassigned</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.employee_code} — {tech.name}{tech.craft ? ` (${tech.craft})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Planned Date *</div>
              <input
                style={inp}
                type="date"
                required
                min={horizonStart}
                max={horizonEnd}
                value={form.planned_date}
                onChange={(e) => setForm({ ...form, planned_date: e.target.value })}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Due Date</div>
              <input
                style={inp}
                type="date"
                min={horizonStart}
                max={horizonEnd}
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Title *</div>
              <input style={inp} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Plan title" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Description / Issue Detail</div>
              <textarea
                style={{ ...inp, minHeight: 64, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Scope of PM / calibration / issue…"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 4 }}>Remarks</div>
              <input style={inp} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" style={btnSecondary} onClick={resetForm}>Cancel</button>
            <button type="submit" style={btnPrimary}>{editingId ? 'Save Modification' : 'Save Plan'}</button>
          </div>
        </form>
      )}

      <section className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>6-Month Feasibility Board</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {months.map((ym) => {
            const rows = plansByMonth[ym] || [];
            return (
              <div key={ym} style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 10, background: t.surface2 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, marginBottom: 8 }}>{monthLabel(ym)}</div>
                {rows.length === 0 && <div style={{ fontSize: 11, color: t.textFaint }}>No plans</div>}
                {rows.slice(0, 5).map((p) => (
                  <div key={p.id} style={{ fontSize: 11, marginBottom: 6, color: t.text }}>
                    <FmmsBadge t={t} tone={typeTone[p.plan_type] || 'neutral'}>{p.plan_type}</FmmsBadge>
                    <div style={{ marginTop: 4, fontWeight: 600 }}>{p.title}</div>
                    <div style={{ color: t.textFaint }}>{formatHistoryDate(p.planned_date)} · {p.pic_user || 'No PIC'}</div>
                  </div>
                ))}
                {rows.length > 5 && <div style={{ fontSize: 11, color: t.textFaint }}>+{rows.length - 5} more</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Plan Register</h3>
        {loading ? <p style={{ color: t.textDim }}>Loading…</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Plan #</th>
                  <th style={thStyle(t)}>Asset</th>
                  <th style={thStyle(t)}>Type</th>
                  <th style={thStyle(t)}>Title</th>
                  <th style={thStyle(t)}>PIC</th>
                  <th style={thStyle(t)}>Planned</th>
                  <th style={thStyle(t)}>Status</th>
                  <th style={thStyle(t)}>Mods</th>
                  <th style={thStyle(t)}>Action</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const mods = p.modification_count || 0;
                  const locked = mods >= MAX_MODS;
                  const asset = assets.find((a) => a.id === p.asset_id);
                  return (
                    <tr key={p.id}>
                      <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{p.plan_number}</td>
                      <td style={tdStyle(t)}>
                        {asset ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{asset.name}</div>
                            <div style={{ fontSize: 11, color: t.textFaint }}>{asset.asset_code}</div>
                          </>
                        ) : (p.asset_id || '—')}
                      </td>
                      <td style={tdStyle(t)}>
                        <FmmsBadge t={t} tone={typeTone[p.plan_type] || 'neutral'}>{p.plan_type}</FmmsBadge>
                      </td>
                      <td style={tdStyle(t)}>{p.title}</td>
                      <td style={tdStyle(t)}>{p.pic_user || '—'}</td>
                      <td style={tdStyle(t)}>{formatHistoryDate(p.planned_date)}</td>
                      <td style={tdStyle(t)}>
                        <FmmsBadge t={t} tone={p.status === 'completed' ? 'ok' : 'info'}>{p.status}</FmmsBadge>
                      </td>
                      <td style={tdStyle(t)}>
                        <FmmsBadge t={t} tone={locked ? 'critical' : mods > 0 ? 'warn' : 'ok'}>
                          {mods}/{MAX_MODS}
                        </FmmsBadge>
                      </td>
                      <td style={tdStyle(t)}>
                        <button
                          type="button"
                          style={{
                            ...btnSecondary,
                            opacity: locked ? 0.5 : 1,
                            cursor: locked ? 'not-allowed' : 'pointer',
                          }}
                          disabled={locked}
                          title={locked ? `Maximum ${MAX_MODS} modifications reached` : 'Modify plan'}
                          onClick={() => startEdit(p)}
                        >
                          {locked ? 'Locked' : 'Modify'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {plans.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>
                      No PM/C plans in this 6-month horizon yet
                    </td>
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

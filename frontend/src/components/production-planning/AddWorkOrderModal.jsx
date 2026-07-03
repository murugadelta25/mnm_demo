import { useState } from 'react';
import api from '../../api/client';
import { partToPlanningVariant } from '../../utils/partVariant';

const INIT = {
  work_order_no: '',
  part_id: '',
  model_variant: '',
  description: '',
  target_qty: '',
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  spares_tools: [],
};

export default function AddWorkOrderModal({ t, parts, onClose, onCreated }) {
  const [form, setForm] = useState(INIT);
  const [spareDraft, setSpareDraft] = useState({ name: '', qty: '', unit: 'pcs', notes: '' });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%',
  };

  const applyPart = (partId) => {
    const part = parts.find((p) => String(p.id) === String(partId));
    if (!part) {
      setForm((p) => ({ ...p, part_id: '', model_variant: '' }));
      return;
    }
    setForm((p) => ({
      ...p,
      part_id: String(partId),
      model_variant: partToPlanningVariant(part),
    }));
  };

  const addSpare = () => {
    if (!spareDraft.name.trim()) return;
    setForm((p) => ({
      ...p,
      spares_tools: [...p.spares_tools, { ...spareDraft, name: spareDraft.name.trim() }],
    }));
    setSpareDraft({ name: '', qty: '', unit: 'pcs', notes: '' });
  };

  const removeSpare = (idx) => {
    setForm((p) => ({
      ...p,
      spares_tools: p.spares_tools.filter((_, i) => i !== idx),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        work_order_no: form.work_order_no.trim(),
        part_id: form.part_id ? parseInt(form.part_id, 10) : null,
        model_variant: form.model_variant || null,
        description: form.description || null,
        target_qty: parseInt(form.target_qty, 10),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        spares_tools: form.spares_tools.length
          ? form.spares_tools.map((s) => ({
              name: s.name,
              qty: s.qty ? parseFloat(s.qty) : null,
              unit: s.unit || 'pcs',
              notes: s.notes || null,
            }))
          : null,
      };
      const r = await api.post('/api/work-orders/', payload);
      onCreated?.(r.data);
      onClose();
    } catch (err) {
      setMsg(err.response?.data?.detail || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: t.surface, borderRadius: 12, padding: 24, width: '100%', maxWidth: 720,
        maxHeight: '90vh', overflow: 'auto', border: `1px solid ${t.border}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: t.accent, fontSize: 16 }}>Add Work Order</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: t.textDim, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <Field label="Work Order No. *" t={t}>
              <input style={inp} required placeholder="e.g. WO-2026-07-001"
                value={form.work_order_no} onChange={(e) => setForm((p) => ({ ...p, work_order_no: e.target.value }))} />
            </Field>
            <Field label="Target Qty (pcs) *" t={t}>
              <input style={inp} type="number" min="1" required
                value={form.target_qty} onChange={(e) => setForm((p) => ({ ...p, target_qty: e.target.value }))} />
            </Field>
            <Field label="Part / Model / Variant *" t={t} wide>
              <select style={inp} value={form.part_id} onChange={(e) => applyPart(e.target.value)}>
                <option value="">— Select part —</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>{partToPlanningVariant(p)}</option>
                ))}
              </select>
            </Field>
            <Field label="Variant (override)" t={t} wide>
              <input style={inp} value={form.model_variant}
                onChange={(e) => setForm((p) => ({ ...p, model_variant: e.target.value }))} />
            </Field>
            <Field label="Period Start" t={t}>
              <input style={inp} type="date" value={form.start_date}
                onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
            </Field>
            <Field label="Period End" t={t}>
              <input style={inp} type="date" value={form.end_date}
                onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} />
            </Field>
            <Field label="Description" t={t} wide>
              <textarea style={{ ...inp, minHeight: 60 }} maxLength={255} placeholder="Optional"
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </Field>
          </div>

          <div style={{ marginTop: 16, padding: 12, background: t.surface2, borderRadius: 8 }}>
            <div style={{ color: t.textDim, fontSize: 12, marginBottom: 8 }}>
              Spares / Tools (optional)
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <input style={{ ...inp, flex: 2, minWidth: 120 }} placeholder="Name"
                value={spareDraft.name} onChange={(e) => setSpareDraft((p) => ({ ...p, name: e.target.value }))} />
              <input style={{ ...inp, width: 80 }} type="number" placeholder="Qty"
                value={spareDraft.qty} onChange={(e) => setSpareDraft((p) => ({ ...p, qty: e.target.value }))} />
              <input style={{ ...inp, width: 70 }} placeholder="Unit"
                value={spareDraft.unit} onChange={(e) => setSpareDraft((p) => ({ ...p, unit: e.target.value }))} />
              <button type="button" onClick={addSpare}
                style={{ padding: '7px 14px', background: t.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                + Add
              </button>
            </div>
            {form.spares_tools.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.textMuted, padding: '4px 0' }}>
                <span>{s.name}{s.qty ? ` — ${s.qty} ${s.unit}` : ''}{s.notes ? ` (${s.notes})` : ''}</span>
                <button type="button" onClick={() => removeSpare(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>

          {msg && <p style={{ color: '#ef4444', fontSize: 13 }}>{msg}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onClose}
              style={{ padding: '9px 20px', background: t.surface2, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ padding: '9px 28px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              {saving ? 'Saving…' : 'Add Work Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children, wide, t }) {
  return (
    <div style={{ gridColumn: wide ? 'span 2' : 'span 1', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ color: t.textDim, fontSize: 11 }}>{label}</label>
      {children}
    </div>
  );
}

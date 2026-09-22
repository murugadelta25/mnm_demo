import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';

const EMPTY_FORM = {
  item: '',
  nodered_name: '',
  nodered_aliases: '',
  modbus: '',
  eip_pn: '',
  type: 'W',
  scale: '1',
  unit: '',
  group: 'live',
  note: '',
};

/**
 * Per-profile titles and screen-group names. `groups` must match the screen labels the
 * Equipment Overview dashboard shows for the same profile, so a tag filed under
 * "Setpoints (Write)" here appears on the tab with that name there.
 */
const PROFILE_META = {
  servo_press: {
    title: 'Telemetry Tags — Servo Press (Modbus §8.4.2)',
    hint: 'Map Node-RED readings[].name to UI parameters. Choose group Live (Status Data) or Result (Pressing Result when Status* is 4–8).',
    groups: { live: 'Live Status', result: 'Pressing Result' },
  },
  servo_linear_motor: {
    title: 'Telemetry Tags — Servo Linear Motor',
    hint: 'Map Node-RED readings[].name to Live Status (read registers %MW20–%MW32) or Setpoints (write registers %MW0–%MW6).',
    groups: { live: 'Live Status', result: 'Setpoints (Write)' },
  },
  spm: {
    title: 'Telemetry Tags — SPM',
    hint: 'Map Node-RED readings[].name to Live Status / Cycle Result. Screw Driver defaults: TorqueValue, PositionValue, Result (1=OK, 2=NG).',
    groups: { live: 'Live Status', result: 'Cycle Result' },
  },
  generic_plc: {
    title: 'Telemetry Tags — PLC',
    hint: 'Map Node-RED readings[].name to Live / Result parameters for PLC machines.',
    groups: { live: 'Live Tags', result: 'Result Tags' },
  },
};

const DEFAULT_GROUP_LABELS = { live: 'Live Status', result: 'Result', other: 'Other' };

/**
 * CRUD UI for Node-RED ↔ Live Status / Pressing Result tag mapping.
 * Shown only after Config Tags is clicked for a supported machine type.
 */
export default function TelemetryTagsPanel({
  theme: t,
  canEdit,
  profileId = 'servo_press',
  onClose,
}) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const meta = PROFILE_META[profileId] || {
    title: `Telemetry Tags — ${profileId}`,
    hint: 'Map Node-RED readings[].name to UI parameters.',
  };
  const groupLabel = (g) => (meta.groups || {})[g] || DEFAULT_GROUP_LABELS[g] || g || 'Live Status';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/machines/telemetry/tags', {
        params: { profile_id: profileId },
      });
      setTags(data.tags || []);
      setMsg('');
    } catch (err) {
      setMsg('❌ Failed to load tags: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMsg('');
  };

  const openEdit = (tag) => {
    setEditId(tag.id);
    setForm({
      item: tag.item || '',
      nodered_name: tag.nodered_name || '',
      nodered_aliases: (tag.nodered_aliases || []).join(', '),
      modbus: tag.modbus || '',
      eip_pn: tag.eip_pn || '',
      type: tag.type || 'W',
      scale: String(tag.scale ?? 1),
      unit: tag.unit || '',
      group: tag.group || 'live',
      note: tag.note || '',
    });
    setShowForm(true);
    setMsg('');
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const payload = {
      item: form.item.trim(),
      nodered_name: form.nodered_name.trim() || form.item.trim(),
      nodered_aliases: form.nodered_aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      modbus: form.modbus.trim() || null,
      eip_pn: form.eip_pn.trim() || null,
      type: form.type || 'W',
      scale: Number(form.scale) || 1,
      unit: form.unit.trim(),
      group: form.group || 'live',
      note: form.note.trim(),
      profile_id: profileId,
    };
    try {
      if (editId) {
        await api.put(`/api/machines/telemetry/tags/${editId}`, payload);
        setMsg('✅ Tag updated — appears on Live / Pressing Result screens');
      } else {
        await api.post('/api/machines/telemetry/tags', payload);
        setMsg('✅ Tag added — map this Node-RED reading name in your flow');
      }
      setShowForm(false);
      setEditId(null);
      await load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const remove = async (tag) => {
    if (!canEdit) return;
    if (!window.confirm(`Delete tag "${tag.item}"? It will leave Live / Result screens.`)) return;
    try {
      await api.delete(`/api/machines/telemetry/tags/${tag.id}`);
      setMsg('✅ Tag deleted');
      await load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const filtered = tags.filter((tag) => {
    if (groupFilter === 'all') return true;
    return (tag.group || '') === groupFilter;
  });

  const s = {
    card: { background: t.surface, borderRadius: 10, padding: 20, marginBottom: 16 },
    title: { color: t.accent, margin: '0 0 6px', fontSize: 14, fontWeight: 600 },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 1.45, marginBottom: 14 },
    inp: {
      padding: '7px 10px',
      borderRadius: 6,
      border: `1px solid ${t.inpBorder}`,
      background: t.inp,
      color: t.text,
      fontSize: 13,
      width: '100%',
      boxSizing: 'border-box',
    },
    addBtn: {
      padding: '8px 16px',
      background: t.accent,
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 13,
    },
    miniBtn: {
      padding: '4px 10px',
      border: 'none',
      borderRadius: 5,
      color: '#fff',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
    },
    th: {
      padding: '8px 10px',
      background: t.surface2,
      color: t.textDim,
      textAlign: 'left',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      fontSize: 12,
    },
    td: {
      padding: '8px 10px',
      borderBottom: `1px solid ${t.border}`,
      verticalAlign: 'middle',
      fontSize: 12,
    },
    chip: (color) => ({
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 700,
      background: `${color}22`,
      color,
    }),
  };

  const groupColor = (g) => (g === 'result' ? '#8b5cf6' : g === 'other' ? '#64748b' : '#0ea5e9');

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h4 style={s.title}>{meta.title}</h4>
          <div style={s.hint}>{meta.hint}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            style={{ ...s.inp, width: 'auto', minWidth: 140 }}
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          >
            <option value="all">All groups</option>
            <option value="live">{groupLabel('live')}</option>
            <option value="result">{groupLabel('result')}</option>
            <option value="other">{groupLabel('other')}</option>
          </select>
          <button type="button" style={s.addBtn} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
          {canEdit && (
            <button type="button" style={s.addBtn} onClick={openAdd}>
              + Add Tag
            </button>
          )}
          {onClose && (
            <button
              type="button"
              style={{
                ...s.addBtn,
                background: 'transparent',
                color: t.textMuted,
                border: `1px solid ${t.border}`,
              }}
              onClick={onClose}
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div style={{ marginBottom: 12, fontSize: 13, color: msg.startsWith('❌') ? '#ef4444' : '#10b981' }}>
          {msg}
        </div>
      )}

      {showForm && canEdit && (
        <form
          onSubmit={save}
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.surface2 || t.surface,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 10, color: t.text }}>
            {editId ? 'Edit tag' : 'Add tag'} — matches manufacturer Item / Modbus / EIP columns
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <Field label="Item (UI label) *" t={t}>
              <input
                style={s.inp}
                required
                value={form.item}
                placeholder="e.g. Emergency button press"
                onChange={(e) => setForm((p) => ({ ...p, item: e.target.value }))}
              />
            </Field>
            <Field label="Node-RED reading name *" t={t}>
              <input
                style={s.inp}
                required
                value={form.nodered_name}
                placeholder="Must match readings[].name"
                onChange={(e) => setForm((p) => ({ ...p, nodered_name: e.target.value }))}
              />
            </Field>
            <Field label="Extra aliases (comma)" t={t}>
              <input
                style={s.inp}
                value={form.nodered_aliases}
                placeholder="e.g. e-stop, emergency"
                onChange={(e) => setForm((p) => ({ ...p, nodered_aliases: e.target.value }))}
              />
            </Field>
            <Field label="Screen group *" t={t}>
              <select
                style={s.inp}
                value={form.group}
                onChange={(e) => setForm((p) => ({ ...p, group: e.target.value }))}
              >
                <option value="live">{groupLabel('live')}</option>
                <option value="result">{groupLabel('result')}</option>
                <option value="other">{groupLabel('other')}</option>
              </select>
            </Field>
            <Field label="Modbus (hex)" t={t}>
              <input
                style={s.inp}
                value={form.modbus}
                placeholder="0x00C8"
                onChange={(e) => setForm((p) => ({ ...p, modbus: e.target.value }))}
              />
            </Field>
            <Field label="EIP / PN" t={t}>
              <input
                style={s.inp}
                value={form.eip_pn}
                placeholder="D200"
                onChange={(e) => setForm((p) => ({ ...p, eip_pn: e.target.value }))}
              />
            </Field>
            <Field label="Type" t={t}>
              <select
                style={s.inp}
                value={form.type}
                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
              >
                <option value="W">W (Word)</option>
                <option value="DW">DW (Double Word)</option>
              </select>
            </Field>
            <Field label="Scale" t={t}>
              <input
                style={s.inp}
                type="number"
                step="any"
                value={form.scale}
                onChange={(e) => setForm((p) => ({ ...p, scale: e.target.value }))}
              />
            </Field>
            <Field label="Unit" t={t}>
              <input
                style={s.inp}
                value={form.unit}
                placeholder="mm / kgf / s"
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
              />
            </Field>
            <Field label="Note" t={t} wide>
              <input
                style={s.inp}
                value={form.note}
                placeholder="Description from Modbus sheet"
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
              />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" style={s.addBtn}>
              {editId ? '💾 Save Tag' : '✓ Add Tag'}
            </button>
            <button
              type="button"
              style={{
                ...s.addBtn,
                background: 'transparent',
                color: t.textMuted,
                border: `1px solid ${t.border}`,
              }}
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Item', 'Node-RED name', 'Group', 'Modbus', 'EIP/PN', 'Type', 'Scale', 'Unit', 'Note', 'Actions'].map(
                (h) => (
                  <th key={h} style={s.th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...s.td, textAlign: 'center', color: t.textFaint, padding: 28 }}>
                  {loading ? 'Loading tags…' : 'No tags yet. Click "+ Add Tag" to map a Node-RED reading.'}
                </td>
              </tr>
            )}
            {filtered.map((tag) => (
              <tr key={tag.id} style={{ opacity: tag.is_enabled ? 1 : 0.55 }}>
                <td style={s.td}>
                  <div style={{ fontWeight: 600, color: t.text }}>{tag.item}</div>
                  <div style={{ color: t.textFaint, fontSize: 10 }}>{tag.tag_key}</div>
                </td>
                <td style={{ ...s.td, fontFamily: 'ui-monospace, monospace' }}>{tag.nodered_name}</td>
                <td style={s.td}>
                  <span style={s.chip(groupColor(tag.group))}>
                    {groupLabel(tag.group || 'live')}
                  </span>
                </td>
                <td style={{ ...s.td, fontFamily: 'ui-monospace, monospace' }}>{tag.modbus || '—'}</td>
                <td style={s.td}>{tag.eip_pn || '—'}</td>
                <td style={s.td}>{tag.type || '—'}</td>
                <td style={s.td}>{tag.scale}</td>
                <td style={s.td}>{tag.unit || '—'}</td>
                <td style={{ ...s.td, maxWidth: 220, color: t.textMuted }}>{tag.note || '—'}</td>
                <td style={s.td}>
                  {canEdit ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={{ ...s.miniBtn, background: t.accent }} onClick={() => openEdit(tag)}>
                        Edit
                      </button>
                      <button type="button" style={{ ...s.miniBtn, background: '#ef4444' }} onClick={() => remove(tag)}>
                        Delete
                      </button>
                    </div>
                  ) : (
                    <span style={{ color: t.textFaint }}>View only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children, t, wide }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <label style={{ color: t?.textDim, fontSize: 11, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

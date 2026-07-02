import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { pageClass } from '../themes/tileHelpers';
import { useConfig, getCurrentShift, timeToMinutes } from '../context/ConfigContext';
import PageHeader from '../components/PageHeader';
import api from '../api/client';
import { DRAFT_KEYS, loadDraft, saveDraft, clearDraft } from '../utils/formPersistence';

export { getCurrentShift, timeToMinutes };

const TIMED_BREAKS = [
  { minKey: 'lunch_break', startKey: 'lunch_start', endKey: 'lunch_end', label: 'Lunch Break' },
  { minKey: 'tea_break', startKey: 'tea_start', endKey: 'tea_end', label: 'Tea Break' },
  { minKey: 'tpm_cleaning', startKey: 'tpm_start', endKey: 'tpm_end', label: 'TPM Cleaning' },
];

const SIMPLE_BREAKS = [
  ['other_cleaning', 'Other Cleaning (min)'],
  ['management_meeting', 'Mgmt Meeting (min)'],
];

function minsBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function endFromStart(start, minutes) {
  if (!start) return '';
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + (minutes || 0);
  const nh = Math.floor((total % (24 * 60)) / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

export default function Configuration() {
  const { config: savedConfig, reload } = useConfig();
  const [config, setConfig] = useState(() => loadDraft(DRAFT_KEYS.configuration) ?? savedConfig);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const { theme: t } = useTheme();
  const s = getStyles(t);

  useEffect(() => {
    if (!loadDraft(DRAFT_KEYS.configuration)) setConfig(savedConfig);
  }, [savedConfig]);

  useEffect(() => {
    const timer = setTimeout(() => saveDraft(DRAFT_KEYS.configuration, config), 400);
    return () => clearTimeout(timer);
  }, [config]);

  const saveConfig = async () => {
    try {
      await api.put('/api/config/', { config });
      clearDraft(DRAFT_KEYS.configuration);
      reload();
      setSaved(true);
      setErr('');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to save');
    }
  };

  const updateShift = (idx, key, val) => {
    setConfig(prev => {
      const shifts = [...prev.shifts];
      shifts[idx] = { ...shifts[idx], [key]: val };
      return { ...prev, shifts };
    });
  };

  const updateBreak = (shiftId, key, val) => {
    setConfig(prev => ({
      ...prev,
      breaks: { ...prev.breaks, [shiftId]: { ...prev.breaks[shiftId], [key]: val } },
    }));
  };

  const updateTimedBreak = (shiftId, def, field, val) => {
    setConfig(prev => {
      const current = { ...(prev.breaks[shiftId] || {}) };
      if (field === 'minutes') {
        const num = Math.max(0, parseInt(val, 10) || 0);
        current[def.minKey] = num;
        if (current[def.startKey]) {
          current[def.endKey] = endFromStart(current[def.startKey], num);
        }
      } else if (field === 'start') {
        current[def.startKey] = val;
        const mins = current[def.minKey] || minsBetween(val, current[def.endKey]);
        current[def.minKey] = minsBetween(val, current[def.endKey]) || mins;
        if (!current[def.endKey] && mins) current[def.endKey] = endFromStart(val, mins);
      } else if (field === 'end') {
        current[def.endKey] = val;
        current[def.minKey] = minsBetween(current[def.startKey], val);
      }
      return { ...prev, breaks: { ...prev.breaks, [shiftId]: current } };
    });
  };

  const addShift = () => {
    const newId = String.fromCharCode(65 + config.shifts.length);
    setConfig(prev => ({
      ...prev,
      shifts: [...prev.shifts, { id: newId, name: `Shift ${newId}`, start: '00:00', end: '08:00', enabled: true }],
      breaks: {
        ...prev.breaks,
        [newId]: {
          lunch_break: 30, lunch_start: '12:00', lunch_end: '12:30',
          tea_break: 10, tea_start: '10:00', tea_end: '10:10',
          tpm_cleaning: 10, tpm_start: '11:00', tpm_end: '11:10',
          other_cleaning: 0, management_meeting: 0,
        },
      },
    }));
  };

  const deleteShift = (idx) => {
    setConfig(prev => {
      const removed = prev.shifts[idx];
      const shifts = prev.shifts.filter((_, i) => i !== idx);
      const breaks = { ...prev.breaks };
      delete breaks[removed.id];
      return { ...prev, shifts, breaks };
    });
  };

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader title="⚙  CONFIGURATION" />

      <Section title="Shift Settings">
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>{['Shift ID', 'Name', 'Start Time', 'End Time', 'Enabled', ''].map(h =>
                <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {config.shifts.map((sh, i) => (
                <tr key={i}>
                  <td style={s.td}><input style={s.inp} value={sh.id} onChange={e => updateShift(i, 'id', e.target.value)} /></td>
                  <td style={s.td}><input style={s.inp} value={sh.name} onChange={e => updateShift(i, 'name', e.target.value)} /></td>
                  <td style={s.td}><input style={s.inp} type="time" value={sh.start} onChange={e => updateShift(i, 'start', e.target.value)} /></td>
                  <td style={s.td}><input style={s.inp} type="time" value={sh.end} onChange={e => updateShift(i, 'end', e.target.value)} /></td>
                  <td style={{ ...s.td, textAlign: 'center' }}><input type="checkbox" checked={sh.enabled} onChange={e => updateShift(i, 'enabled', e.target.checked)} /></td>
                  <td style={s.td}>
                    <button onClick={() => deleteShift(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16, padding: '2px 6px' }}
                      title="Delete shift">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button style={s.addBtn} onClick={addShift}>+ Add Shift</button>
      </Section>

      <Section title="Data Validation Settings">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <label style={{ color: t.textMuted, fontSize: 13 }}>Check previous shift data for past N days:</label>
          <input style={{ ...s.inp, width: 60 }} type="number" min="1" max="30"
            value={config.checkDataDaysBack ?? 1}
            onChange={e => setConfig(prev => ({ ...prev, checkDataDaysBack: Math.max(1, parseInt(e.target.value) || 1) }))} />
          <span style={{ color: t.textDim, fontSize: 12 }}>(default: 1 day)</span>
        </div>
      </Section>

      <Section title="Default Breaks & Planned Losses per Shift">
        <p style={{ color: t.textFaint, fontSize: 12, margin: '0 0 12px' }}>
          Lunch, tea, and TPM breaks use start/end times for hourly expected output calculation.
        </p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {config.shifts.filter(sh => sh.enabled).map(sh => (
            <div key={sh.id} style={s.shiftCard}>
              <h5 style={s.shiftCardTitle}>{sh.name} ({sh.start} – {sh.end})</h5>
              {TIMED_BREAKS.map(def => (
                <div key={def.minKey} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
                  <div style={{ color: t.accent, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{def.label}</div>
                  <div style={s.timedRow}>
                    <label style={s.breakLabel}>Start</label>
                    <input style={{ ...s.inp, width: 100 }} type="time"
                      value={config.breaks[sh.id]?.[def.startKey] || ''}
                      onChange={e => updateTimedBreak(sh.id, def, 'start', e.target.value)} />
                  </div>
                  <div style={s.timedRow}>
                    <label style={s.breakLabel}>End</label>
                    <input style={{ ...s.inp, width: 100 }} type="time"
                      value={config.breaks[sh.id]?.[def.endKey] || ''}
                      onChange={e => updateTimedBreak(sh.id, def, 'end', e.target.value)} />
                  </div>
                  <div style={s.timedRow}>
                    <label style={s.breakLabel}>Duration (min)</label>
                    <input style={{ ...s.inp, width: 80 }} type="number" min="0"
                      value={config.breaks[sh.id]?.[def.minKey] ?? 0}
                      onChange={e => updateTimedBreak(sh.id, def, 'minutes', e.target.value)} />
                  </div>
                </div>
              ))}
              {SIMPLE_BREAKS.map(([key, label]) => (
                <div key={key} style={s.breakRow}>
                  <label style={s.breakLabel}>{label}</label>
                  <input style={{ ...s.inp, width: 80 }} type="number" min="0"
                    value={config.breaks[sh.id]?.[key] ?? 0}
                    onChange={e => updateBreak(sh.id, key, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                </div>
              ))}
              <div style={s.totalRow}>
                Total: <strong style={{ color: t.accent }}>
                  {[
                    ...TIMED_BREAKS.map(d => d.minKey),
                    ...SIMPLE_BREAKS.map(([k]) => k),
                  ].reduce((sum, k) => sum + (config.breaks[sh.id]?.[k] || 0), 0)} min
                </strong>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button style={s.saveBtn} onClick={saveConfig}>💾 Save Configuration</button>
        {saved && <span style={{ color: t.accent, fontSize: 13 }}>✓ Saved successfully</span>}
        {err && <span style={{ color: '#ef4444', fontSize: 13 }}>✗ {err}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ background: t.surface, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h4 style={{ color: t.accent, margin: '0 0 12px', fontSize: 14 }}>{title}</h4>
      {children}
    </div>
  );
}

function getStyles(t) {
  return {
    page: { padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 },
    th: { padding: '8px 10px', background: t.surface2, color: t.textDim, textAlign: 'left' },
    td: { padding: '6px 8px', borderBottom: `1px solid ${t.surface2}`, color: t.text },
    inp: { padding: '6px 8px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp,
           color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box' },
    addBtn: { padding: '6px 14px', background: t.surface2, color: t.textDim, border: 'none',
              borderRadius: 6, cursor: 'pointer', fontSize: 12, marginTop: 4 },
    shiftCard: { background: t.surface, borderRadius: 8, padding: 14, minWidth: 260, flex: 1 },
    shiftCardTitle: { color: t.accent, margin: '0 0 10px', fontSize: 13 },
    breakRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
    timedRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 },
    breakLabel: { color: t.textMuted, fontSize: 12, flex: 1 },
    totalRow: { color: t.textDim, fontSize: 12, marginTop: 8, borderTop: `1px solid ${t.surface2}`, paddingTop: 6 },
    saveBtn: { padding: '10px 28px', background: t.accent, color: '#fff', border: 'none',
               borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  };
}

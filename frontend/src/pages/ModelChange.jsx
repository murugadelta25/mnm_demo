import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { pageClass } from '../themes/tileHelpers';
import { useWebSocket } from '../api/useWebSocket';
import PageHeader from '../components/PageHeader';
import { formatDateTime } from '../utils/dateFormat';
import { DRAFT_KEYS } from '../utils/formPersistence';
import usePersistedState from '../hooks/usePersistedState';

const REASONS = [
  { value: 'setting_change', label: 'Setting Change' },
  { value: 'new_trial',      label: 'New Model Trial' },
  { value: 'tool_change',    label: 'Tool Change' },
  { value: 'other',          label: 'Other' },
];

const STATUS_COLOR = { pending: '#f59e0b', approved: '#0ea5e9', in_progress: '#8b5cf6', completed: '#10b981', rejected: '#ef4444' };

const today = () => new Date().toISOString().slice(0, 10);

export default function ModelChange() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const s = getStyles(t);

  const [requests, setRequests] = useState([]);
  const [machines, setMachines] = useState([]);
  const [stations, setStations]       = useState([]);
  const [msg, setMsg]           = useState('');
  const [now, setNow]           = useState(Date.now());
  const [filterStatus, setFilterStatus] = useState('active');

  const [form, setForm, { resetPersisted }] = usePersistedState(DRAFT_KEYS.modelChange, {
    station_id: '', machine_id: '', from_model: '', to_model: '',
    ideal_minutes: 60, shift: 'A', entry_date: today(), reason: 'setting_change',
  });

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const fetchData = useCallback(async () => {
    const [r, m, p] = await Promise.all([
      api.get('/api/model-change/'),
      api.get('/api/breakdown/machines'),
      api.get('/api/stations/'),
    ]);
    setRequests(r.data);
    setMachines(m.data);
    setStations(p.data);
    if (!form.station_id && p.data.length > 0) {
      setForm((prev) => ({ ...prev, station_id: prev.station_id || p.data[0].id }));
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useWebSocket(useCallback(msg => {
    if (['model_change_request','model_change_approved','model_change_completed','model_change_rejected'].includes(msg.type))
      fetchData();
  }, [fetchData]));

  const filteredMachines = form.station_id
    ? machines.filter(m => m.station_id === parseInt(form.station_id))
    : machines;

  const submit = async e => {
    e.preventDefault();
    try {
      await api.post('/api/model-change/', {
        machine_id:    parseInt(form.machine_id),
        from_model:    form.from_model,
        to_model:      form.to_model,
        ideal_minutes: parseInt(form.ideal_minutes),
        shift:         form.shift,
        entry_date:    form.entry_date,
        reason:        form.reason,
      });
      setMsg('✓ Request submitted — awaiting supervisor approval');
      setForm(p => ({ ...p, machine_id: '', from_model: '', to_model: '', ideal_minutes: 60 }));
      fetchData();
    } catch { setMsg('✗ Error submitting request'); }
  };

  const approve   = async id => { await api.patch(`/api/model-change/${id}/approve`);  fetchData(); };
  const reject    = async id => { await api.patch(`/api/model-change/${id}/reject`);   fetchData(); };
  const complete  = async id => { await api.patch(`/api/model-change/${id}/complete`); fetchData(); };

  const elapsed = start => {
    if (!start) return 0;
    const text = typeof start === 'string' ? start.trim().replace(' ', 'T') : String(start);
    return Math.max(0, Math.floor((now - new Date(text).getTime()) / 60000));
  };

  const displayed = requests.filter(r =>
    filterStatus === 'all'    ? true :
    filterStatus === 'active' ? !['completed','rejected'].includes(r.status) :
                                ['completed','rejected'].includes(r.status)
  );

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader title="MODEL / SETTING CHANGE" onRefresh={fetchData} />

      {/* Request Form */}
      {(user?.role === 'operator' || user?.role === 'supervisor' || user?.role === 'admin') && (
        <div style={s.card}>
          <h4 style={s.cardTitle}>New Change Request</h4>
          <form onSubmit={submit}>
            <div style={s.grid4}>
              {/* Row 1 */}
              <FField label="Date">
                <input style={s.inp} type="date" value={form.entry_date}
                  onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} required />
              </FField>
              <FField label="Shift">
                <select style={s.inp} value={form.shift}
                  onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                  <option value="A">Shift A</option>
                  <option value="B">Shift B</option>
                </select>
              </FField>
              <FField label="Station">
                <select style={s.inp} value={form.station_id}
                  onChange={e => setForm(p => ({ ...p, station_id: e.target.value, machine_id: '' }))} required>
                  <option value="">Select Station</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.display_name || s.name}</option>)}
                </select>
              </FField>
              <FField label="Machine">
                <select style={s.inp} value={form.machine_id}
                  onChange={e => setForm(p => ({ ...p, machine_id: e.target.value }))}
                  required disabled={!form.station_id}>
                  <option value="">Select Machine</option>
                  {filteredMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </FField>

              {/* Row 2 */}
              <FField label="Reason">
                <select style={s.inp} value={form.reason}
                  onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
                  {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </FField>
              <FField label="From Model (current)">
                <input style={s.inp} placeholder="e.g. ABC-100" value={form.from_model}
                  onChange={e => setForm(p => ({ ...p, from_model: e.target.value }))} required />
              </FField>
              <FField label="To Model (new)">
                <input style={s.inp} placeholder="e.g. XYZ-200" value={form.to_model}
                  onChange={e => setForm(p => ({ ...p, to_model: e.target.value }))} required />
              </FField>
              <FField label="Ideal Time (min)">
                <input style={s.inp} type="number" min="0" value={form.ideal_minutes}
                  onChange={e => setForm(p => ({ ...p, ideal_minutes: e.target.value }))} required />
              </FField>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              {msg && <span style={{ color: msg.startsWith('✓') ? '#10b981' : '#ef4444', fontSize: 13 }}>{msg}</span>}
              <button style={s.btn} type="submit">Submit Request</button>
            </div>
          </form>
        </div>
      )}

      {/* Requests List */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h4 style={{ ...s.cardTitle, margin: 0 }}>Change Requests ({displayed.length})</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            {['active','history','all'].map(f => (
              <button key={f} style={{ ...s.fBtn, ...(filterStatus === f ? s.fBtnActive : {}) }}
                onClick={() => setFilterStatus(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {displayed.length === 0 && <p style={{ color: t.textDim, fontSize: 13 }}>No requests found.</p>}
        <div style={s.reqGrid}>
          {displayed.map(r => {
            const el = elapsed(r.start_time);
            const isActive = ['approved','in_progress'].includes(r.status);
            const color = el > r.ideal_minutes ? '#ef4444' : '#10b981';
            const reasonLabel = REASONS.find(x => x.value === r.reason)?.label || r.reason;
            return (
              <div key={r.id} style={{ ...s.reqCard, borderLeft: `4px solid ${STATUS_COLOR[r.status]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>#{r.id} — {r.machine_name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, color: '#fff',
                                 fontWeight: 600, background: STATUS_COLOR[r.status] }}>{r.status}</span>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Tag color="#0ea5e9">{r.entry_date}</Tag>
                  <Tag color="#8b5cf6">Shift {r.shift}</Tag>
                  <Tag color="#f59e0b">{reasonLabel}</Tag>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', fontSize: 14, marginBottom: 6 }}>
                  <span style={{ color: t.textMuted }}>{r.from_model}</span>
                  <span style={{ color: t.textDim, margin: '0 8px' }}>→</span>
                  <span style={{ color: t.accent, fontWeight: 600 }}>{r.to_model}</span>
                </div>

                <div style={{ color: t.textDim, fontSize: 12, marginBottom: 8 }}>
                  ⏱ Ideal: <b>{r.ideal_minutes} min</b>
                  {r.created_at && <span style={{ marginLeft: 10 }}>📅 {formatDateTime(r.created_at)}</span>}
                </div>

                {isActive && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ color, fontSize: 22, fontWeight: 700 }}>{el} min</div>
                    {el > r.ideal_minutes && (
                      <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 600 }}>⚠ EXCEEDED by {el - r.ideal_minutes} min</span>
                    )}
                    <div style={{ height: 6, background: t.surface2, borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: color, transition: 'width 1s linear',
                                    width: `${Math.min(el / r.ideal_minutes * 100, 100)}%` }} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {r.status === 'pending' && (user?.role === 'supervisor' || user?.role === 'admin') && <>
                    <button style={{ ...s.actBtn, background: '#10b981' }} onClick={() => approve(r.id)}>✓ Approve</button>
                    <button style={{ ...s.actBtn, background: '#ef4444' }} onClick={() => reject(r.id)}>✗ Reject</button>
                  </>}
                  {r.status === 'pending' && user?.role === 'operator' && (
                    <span style={{ color: t.textDim, fontSize: 12 }}>⏳ Awaiting supervisor approval</span>
                  )}
                  {['approved','in_progress'].includes(r.status) && user?.role !== 'maintenance' && (
                    <button style={{ ...s.actBtn, background: '#8b5cf6' }} onClick={() => complete(r.id)}>✓ Mark Complete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Tag({ color, children }) {
  return (
    <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                   background: color + '22', color }}>
      {children}
    </span>
  );
}

function FField({ label, children }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ color: t.textDim, fontSize: 11 }}>{label}</label>
      {children}
    </div>
  );
}

function getStyles(t) {
  return {
    page:      { padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text },
    card:      { background: t.surface, borderRadius: 10, padding: 20, marginBottom: 16 },
    cardTitle: { color: t.accent, margin: '0 0 14px', fontSize: 14, fontWeight: 600 },
    grid4:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
    inp:       { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
                 background: t.inp, color: t.text, fontSize: 13 },
    btn:       { padding: '8px 22px', background: t.accent, color: '#fff', border: 'none',
                 borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
    reqGrid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
    reqCard:   { background: t.surface2, borderRadius: 8, padding: 14 },
    actBtn:    { padding: '5px 14px', border: 'none', borderRadius: 6, color: '#fff',
                 cursor: 'pointer', fontSize: 12, fontWeight: 600 },
    fBtn:      { padding: '5px 12px', borderRadius: 6, border: `1px solid ${t.border}`,
                 background: t.surface, color: t.textMuted, cursor: 'pointer', fontSize: 12 },
    fBtnActive:{ background: t.accent, color: '#fff', border: `1px solid ${t.accent}` },
  };
}

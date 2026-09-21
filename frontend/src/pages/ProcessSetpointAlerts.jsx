import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { pageClass, withSurfaceClass, withTileClass } from '../themes/tileHelpers';
import PageHeader from '../components/PageHeader';
import { hasRole } from '../config/accessMatrix';

/**
 * Process Setpoint Alerts — separate from classic Email Alerts (OEE / schedules).
 * Groups created here only get report_type = process_setpoint_alerts.
 * Styled for Tech Blue stack (same tokens as Email Alerts).
 */
export default function ProcessSetpointAlerts() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const s = getStyles(t);
  const isAdmin = hasRole(user?.role, 'admin');
  const [status, setStatus] = useState(null);
  const [modules, setModules] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', description: '' });
  const [newRecip, setNewRecip] = useState({ group_id: '', name: '', email: '' });

  const refresh = useCallback(async () => {
    try {
      const [st, mods] = await Promise.all([
        api.get('/api/process-setpoint-alerts/status'),
        api.get('/api/process-setpoint-alerts/modules'),
      ]);
      setStatus(st.data);
      setModules(mods.data.modules || []);
      setMsg('');
    } catch (err) {
      const code = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'Request failed';
      if (code === 502 || /timeout/i.test(String(detail))) {
        setMsg('✗ Backend not responding (502/timeout). Restart with .\\run.ps1 — ports 8010/5174 were likely hung.');
      } else {
        setMsg('✗ ' + detail);
      }
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createGroup = async (e) => {
    e.preventDefault();
    if (!newGroup.name.trim()) {
      setMsg('✗ Enter a group name');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      await api.post('/api/process-setpoint-alerts/groups', newGroup);
      setNewGroup({ name: '', description: '' });
      setMsg('✓ Process setpoint group created');
      await refresh();
    } catch (err) {
      const code = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'Create failed';
      if (code === 502 || /timeout/i.test(String(detail))) {
        setMsg('✗ Create Group failed — API gateway 502. Backend on :8010 is down or hung; run .\\run.ps1');
      } else {
        setMsg('✗ ' + detail);
      }
    } finally {
      setBusy(false);
    }
  };

  const addRecipient = async (e) => {
    e.preventDefault();
    if (!newRecip.group_id || !newRecip.email) {
      setMsg('✗ Select group and enter email');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/process-setpoint-alerts/recipients', {
        ...newRecip,
        group_id: Number(newRecip.group_id),
      });
      setNewRecip({ group_id: newRecip.group_id, name: '', email: '' });
      setMsg('✓ Recipient added');
      await refresh();
    } catch (err) {
      setMsg('✗ ' + (err?.response?.data?.detail || err?.message || 'Add failed'));
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async (id) => {
    if (!window.confirm('Delete this setpoint alert group?')) return;
    try {
      await api.delete(`/api/process-setpoint-alerts/groups/${id}`);
      setMsg('✓ Group deleted');
      refresh();
    } catch (err) {
      setMsg('✗ ' + (err?.response?.data?.detail || 'Delete failed'));
    }
  };

  const groups = status?.groups || [];
  const ok = msg.startsWith('✓');

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader
        title="PROCESS SETPOINT ALERTS"
        onRefresh={refresh}
      />
      <p style={{ margin: '-4px 0 14px', fontSize: 13, color: t.textMuted }}>
        LSL / USL breach emails by machine family (separate from Email Alerts)
      </p>

      {msg ? (
        <div style={{
          ...s.banner,
          background: ok ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
          border: `1px solid ${ok ? '#10b981' : '#ef4444'}`,
          color: ok ? '#6ee7b7' : '#fca5a5',
        }}
        >
          {msg}
        </div>
      ) : null}

      <div style={s.grid2}>
        <div className={withSurfaceClass(t, 'main', withTileClass(t))} style={s.card}>
          <h4 style={s.cardTitle}>SMTP status</h4>
          <div style={s.body}>
            From: <strong style={{ color: t.accent }}>{status?.smtp_from || '—'}</strong><br />
            Configured:{' '}
            <span style={{ color: status?.smtp_configured ? '#10b981' : '#f59e0b' }}>
              {status?.smtp_configured ? 'Yes' : 'No — save password under Alerts → Email Alerts → SMTP'}
            </span>
            <br />
            Report key: <code style={s.code}>{status?.report_type || 'process_setpoint_alerts'}</code><br />
            Active recipients: <strong style={{ color: t.text }}>{status?.recipient_count ?? 0}</strong>
          </div>
          <div style={s.infoBox}>
            <b style={{ color: t.accent }}>Setup:</b>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Email Alerts → SMTP Settings → save Gmail + App Password.</li>
              <li>Create a group below (report type is fixed to Process Setpoint Alerts).</li>
              <li>Add recipient emails to that group.</li>
              <li>Equipment Overview → Parameters → Set Limits (LSL / USL).</li>
              <li>When live value crosses a limit, the matching module emails this group.</li>
            </ol>
          </div>
        </div>

        <div className={withSurfaceClass(t, 'main', withTileClass(t))} style={s.card}>
          <h4 style={s.cardTitle}>Create setpoint group</h4>
          {!isAdmin ? (
            <div style={s.body}>Admin role required to create groups.</div>
          ) : (
            <form onSubmit={createGroup} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FField label="Group Name">
                <input
                  style={s.inp}
                  placeholder="e.g. AH PLC Setpoints"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup((p) => ({ ...p, name: e.target.value }))}
                  required
                />
              </FField>
              <FField label="Description">
                <input
                  style={s.inp}
                  placeholder="Optional description"
                  value={newGroup.description}
                  onChange={(e) => setNewGroup((p) => ({ ...p, description: e.target.value }))}
                />
              </FField>
              <button style={{ ...s.btn, opacity: busy ? 0.7 : 1 }} type="submit" disabled={busy}>
                {busy ? 'Creating…' : '+ Create Group'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className={withSurfaceClass(t, 'main', withTileClass(t))} style={s.card}>
        <h4 style={s.cardTitle}>Setpoint groups & recipients</h4>
        {groups.length === 0 ? (
          <p style={{ color: t.textMuted, margin: 0, fontSize: 13 }}>No process setpoint groups yet.</p>
        ) : (
          <div style={s.groupGrid}>
            {groups.map((g) => (
              <div key={g.id} className={withSurfaceClass(t, 'nested')} style={s.groupCard}>
                <div style={s.groupHeader}>
                  <div>
                    <strong style={{ color: t.text, fontSize: 14 }}>{g.name}</strong>
                    <span style={s.badge}>{g.count} active</span>
                  </div>
                  {isAdmin ? (
                    <button type="button" onClick={() => deleteGroup(g.id)} style={s.dangerBtn}>
                      Delete
                    </button>
                  ) : null}
                </div>
                {g.description ? (
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>{g.description}</div>
                ) : null}
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: t.textMuted }}>
                  {(g.members || []).length === 0 ? (
                    <li style={{ listStyle: 'none', marginLeft: -18, color: t.textDim }}>No recipients yet</li>
                  ) : (
                    (g.members || []).map((m) => (
                      <li key={m.id} style={{ marginBottom: 4, color: t.text }}>
                        {m.name} — <span style={{ color: t.accent }}>{m.email}</span>
                        {m.active ? '' : ' (inactive)'}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        {isAdmin && groups.length > 0 ? (
          <form onSubmit={addRecipient} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginTop: 16 }}>
            <FField label="Group">
              <select
                style={s.inp}
                value={newRecip.group_id}
                onChange={(e) => setNewRecip((p) => ({ ...p, group_id: e.target.value }))}
                required
              >
                <option value="">Select group</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </FField>
            <FField label="Name">
              <input
                style={s.inp}
                placeholder="Name"
                value={newRecip.name}
                onChange={(e) => setNewRecip((p) => ({ ...p, name: e.target.value }))}
              />
            </FField>
            <FField label="Email">
              <input
                style={{ ...s.inp, minWidth: 200 }}
                type="email"
                placeholder="email@company.com"
                value={newRecip.email}
                onChange={(e) => setNewRecip((p) => ({ ...p, email: e.target.value }))}
                required
              />
            </FField>
            <button style={{ ...s.btn, background: t.brand || '#77AF46' }} type="submit" disabled={busy}>
              Add recipient
            </button>
          </form>
        ) : null}
      </div>

      <div className={withSurfaceClass(t, 'main', withTileClass(t))} style={s.card}>
        <h4 style={s.cardTitle}>Machine-family modules</h4>
        <div style={s.moduleGrid}>
          {modules.map((m) => (
            <div key={m.module_id} className={withSurfaceClass(t, 'nested')} style={s.moduleCard}>
              <div style={{ fontWeight: 700, color: t.text, fontSize: 14 }}>{m.label}</div>
              <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>id: {m.module_id}</div>
              <div style={{ fontSize: 12, marginTop: 8, color: t.textMuted, lineHeight: 1.5 }}>{m.how}</div>
              {(m.parameters || []).length > 0 ? (
                <div style={{ fontSize: 11, marginTop: 10, color: t.accent }}>
                  Params: {(m.parameters || []).map((p) => p.label).join(', ')}
                </div>
              ) : (
                <div style={{ fontSize: 11, marginTop: 10, color: '#f59e0b' }}>
                  {m.active === false ? 'Placeholder — enable when limits are ready' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FField({ label, children }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <label style={{ color: t.labelColor || t.textDim, fontSize: 11 }}>{label}</label>
      {children}
    </div>
  );
}

function getStyles(t) {
  return {
    page: {
      padding: 20,
      background: t.contentBgImage ? 'transparent' : t.bg,
      minHeight: '100%',
      color: t.text,
      fontFamily: t.fontFamily,
    },
    banner: {
      margin: '0 0 14px',
      padding: '10px 14px',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
    },
    grid2: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 16,
      marginBottom: 4,
    },
    card: {
      background: t.surface,
      borderRadius: 10,
      padding: 20,
      marginBottom: 16,
      border: t.id === 'techBlue' ? `1px solid ${t.border}` : 'none',
    },
    cardTitle: {
      color: t.accent,
      margin: '0 0 14px',
      fontSize: 14,
      fontWeight: 600,
    },
    body: {
      fontSize: 13,
      color: t.textMuted,
      lineHeight: 1.65,
    },
    code: {
      color: t.accent,
      background: t.surface2,
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 12,
    },
    infoBox: {
      background: t.surface2,
      border: `1px solid ${t.surface2}`,
      borderRadius: 6,
      padding: '10px 14px',
      color: t.textMuted,
      fontSize: 12,
      marginTop: 12,
    },
    inp: {
      padding: '8px 10px',
      borderRadius: 6,
      border: `1px solid ${t.inpBorder || t.border}`,
      background: t.inp || t.surface2,
      color: t.text,
      fontSize: 13,
      width: '100%',
      boxSizing: 'border-box',
    },
    btn: {
      padding: '8px 20px',
      background: t.accent,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 13,
      alignSelf: 'flex-start',
    },
    dangerBtn: {
      fontSize: 12,
      color: '#fca5a5',
      background: 'rgba(239, 68, 68, 0.15)',
      border: '1px solid rgba(239, 68, 68, 0.45)',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontWeight: 600,
    },
    groupGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      gap: 12,
    },
    groupCard: {
      background: t.surface2,
      borderRadius: 8,
      padding: 14,
      border: t.id === 'techBlue' ? `1px solid rgba(34, 202, 231, 0.35)` : `1px solid ${t.border}`,
    },
    groupHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    badge: {
      marginLeft: 8,
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      background: 'rgba(34, 202, 231, 0.18)',
      color: t.accent,
    },
    moduleGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 12,
    },
    moduleCard: {
      padding: 14,
      borderRadius: 8,
      background: t.surface2,
      border: t.id === 'techBlue' ? `1px solid rgba(34, 202, 231, 0.35)` : `1px solid ${t.border}`,
    },
  };
}

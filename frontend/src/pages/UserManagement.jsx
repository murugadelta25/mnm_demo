import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { pageClass } from '../themes/tileHelpers';
import PageHeader from '../components/PageHeader';
import { PASSWORD_HINT, passwordPolicyError } from '../utils/passwordPolicy';
import { ACCESS_MATRIX, ACCESS_MATRIX_ROLES, getAccessMatrixRoleDefaults } from '../config/accessMatrix';

const ROLES = ACCESS_MATRIX_ROLES;

const ROLE_CFG = {
  superadmin:  { color: '#dc2626', label: 'Super Admin', icon: '🛡', desc: 'Full access + factory setup, data backup & archive' },
  admin:       { color: '#ef4444', label: 'Admin',       icon: '⚙', desc: 'Full access to all features except factory setup & backup' },
  supervisor:  { color: '#f59e0b', label: 'Supervisor',  icon: '📋', desc: 'Planning, data entry, QC incharge approval' },
  operator:    { color: '#0ea5e9', label: 'Operator', icon: '🔧', desc: 'Optional web/tablet login — shop-floor roster is in Operator Management' },
  maintenance: { color: '#10b981', label: 'Maintenance', icon: '🛠', desc: 'Acknowledge and resolve breakdown tickets' },
  quality:     { color: '#8b5cf6', label: 'Quality',     icon: '✓', desc: 'QC inspection sheet — inspector approval' },
};

const INIT_FORM = { username: '', password: '', role: 'supervisor' };

function PasswordInput({ value, onChange, placeholder = '', required = false, style = {} }) {
  const [visible, setVisible] = useState(false);
  const {
    minWidth: _ignoredMinWidth,
    width: styleWidth,
    maxWidth,
    margin,
    marginBottom,
    marginTop,
    marginLeft,
    marginRight,
    ...inputStyle
  } = style;
  // Password fields need more room than generic inputs (policy example + eye toggle)
  const minWidth = 280;
  const width = styleWidth ?? minWidth;
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        verticalAlign: 'top',
        minWidth,
        width,
        maxWidth,
        margin,
        marginBottom,
        marginTop,
        marginLeft,
        marginRight,
      }}
    >
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        style={{
          ...inputStyle,
          width: '100%',
          boxSizing: 'border-box',
          paddingRight: 40,
          margin: 0,
        }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? 'Hide password' : 'Show password'}
        aria-label={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          padding: 2,
          opacity: 0.7,
          zIndex: 1,
        }}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  );
}

function SectionToggle({ open, onToggle, label, count }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: open ? 14 : 0 }}>
      <h4 style={{ color: t.accent, margin: 0, fontSize: 14, fontWeight: 600 }}>
        {label}{typeof count === 'number' ? ` (${count})` : ''}
      </h4>
      <button
        type="button"
        onClick={onToggle}
        style={{
          padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
          border: `1px solid ${t.border}`, background: t.surface2, color: t.text,
        }}
      >
        {open ? 'Hide ▲' : 'Show ▼'}
      </button>
    </div>
  );
}

export default function UserManagement() {
  const { theme: t } = useTheme();
  const { user: me } = useAuth();
  const { roleAccess, reload: reloadFeatures } = useFeatureFlags();
  const [users, setUsers]       = useState([]);
  const [form, setForm]         = useState(INIT_FORM);
  const [editId, setEditId]     = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [pwForm, setPwForm]     = useState({ id: null, current: '', next: '', confirm: '' });
  const [showPwForm, setShowPwForm] = useState(false);
  const [msg, setMsg]           = useState({ text: '', ok: true });
  const [photoUploadId, setPhotoUploadId] = useState(null);
  const [showMatrix, setShowMatrix] = useState(true);
  const [showUsers, setShowUsers] = useState(true);
  const [roleFilter, setRoleFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [roleAccessEdit, setRoleAccessEdit] = useState({});
  const [roleAccessSaving, setRoleAccessSaving] = useState(false);
  const editFormRef = useRef(null);
  const addFormRef = useRef(null);

  const flash = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg({ text: '', ok: true }), 4000);
  };

  useEffect(() => {
    const defaults = getAccessMatrixRoleDefaults();
    const merged = { ...defaults, ...(roleAccess || {}) };
    // Ensure every matrix row id has a roles map
    for (const row of ACCESS_MATRIX) {
      if (!merged[row.id]) merged[row.id] = { ...row.roles };
    }
    setRoleAccessEdit(merged);
  }, [roleAccess]);

  const fetchUsers = useCallback(async () => {
    try {
      const r = await api.get('/api/users/');
      setUsers(r.data);
    } catch { flash('Failed to load users', false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    if (!showForm) return;
    const el = editId ? editFormRef.current : addFormRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [showForm, editId]);

  const openAdd = () => {
    setShowPwForm(false);
    setForm(INIT_FORM);
    setEditId(null);
    setShowForm(true);
  };

  const openEdit = (u) => {
    setShowPwForm(false);
    setForm({ username: u.username, password: '', role: u.role });
    setEditId(u.id);
    setShowForm(true);
    setShowUsers(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(INIT_FORM);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!editId || form.password) {
      const err = passwordPolicyError(form.password || '');
      if (!editId && err) { flash('❌ ' + err, false); return; }
      if (editId && form.password && err) { flash('❌ ' + err, false); return; }
    }
    try {
      if (editId) {
        const payload = {};
        if (editId !== me?.id) payload.role = form.role;
        if (form.password) payload.password = form.password;
        await api.put(`/api/users/${editId}`, payload);
        flash('✅ User updated');
      } else {
        await api.post('/api/users/', form);
        flash('✅ User created');
      }
      closeForm();
      fetchUsers();
    } catch (err) {
      flash('❌ ' + (err.response?.data?.detail || err.message), false);
    }
  };

  const deleteUser = async (id, username) => {
    if (!window.confirm(
      `Delete login user "${username}"?\n\n`
      + 'Shop-floor Operator Directory records are kept. History is unlinked from this login.\n'
      + 'Tickets raised by this user are reassigned to you.',
    )) return;
    try {
      await api.delete(`/api/users/${id}`);
      flash('✅ User deleted');
      fetchUsers();
    } catch (err) {
      const d = err.response?.data?.detail;
      const detail = typeof d === 'string' ? d : (Array.isArray(d) ? d.map((x) => x.msg || x).join('; ') : err.message);
      flash('❌ ' + detail, false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      flash('❌ New passwords do not match', false); return;
    }
    const err = passwordPolicyError(pwForm.next);
    if (err) { flash('❌ ' + err, false); return; }
    try {
      await api.post('/api/users/me/change-password', {
        current_password: pwForm.current,
        new_password: pwForm.next,
      });
      flash('✅ Password changed successfully');
      setShowPwForm(false);
      setPwForm({ id: null, current: '', next: '', confirm: '' });
    } catch (err) {
      flash('❌ ' + (err.response?.data?.detail || err.message), false);
    }
  };

  const uploadReferencePhoto = async (userId, file) => {
    if (!file) return;
    setPhotoUploadId(userId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/users/${userId}/reference-photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      flash('✅ Reference photo uploaded for mobile face verification');
      fetchUsers();
    } catch (err) {
      flash('❌ ' + (err.response?.data?.detail || err.message), false);
    } finally {
      setPhotoUploadId(null);
    }
  };

  const s = getStyles(t);
  const byRole = useMemo(() => ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r);
    return acc;
  }, {}), [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!q) return true;
      const cfg = ROLE_CFG[u.role] || {};
      return (
        String(u.id).includes(q)
        || (u.username || '').toLowerCase().includes(q)
        || (u.role || '').toLowerCase().includes(q)
        || (cfg.label || '').toLowerCase().includes(q)
      );
    });
  }, [users, roleFilter, search]);

  const selectRole = (role) => {
    setRoleFilter((prev) => (prev === role ? null : role));
    setShowUsers(true);
  };

  const toggleFeatureRole = (featureId, role) => {
    setRoleAccessEdit((prev) => {
      const current = { ...(prev[featureId] || {}) };
      current[role] = !current[role];
      const next = { ...prev, [featureId]: current };
      const row = ACCESS_MATRIX.find((r) => r.id === featureId);
      if (row?.registryId && row.registryId !== featureId) {
        next[row.registryId] = { ...current };
      }
      return next;
    });
  };

  const setRoleForAllFeatures = (role, enabled) => {
    setRoleAccessEdit((prev) => {
      const next = { ...prev };
      for (const row of ACCESS_MATRIX) {
        const current = { ...(next[row.id] || { ...row.roles }) };
        current[role] = enabled;
        next[row.id] = current;
        if (row.registryId && row.registryId !== row.id) {
          next[row.registryId] = { ...current };
        }
      }
      return next;
    });
  };

  const setAllRolesForFeature = (featureId, enabled) => {
    setRoleAccessEdit((prev) => {
      const current = { ...(prev[featureId] || {}) };
      for (const role of ROLES) current[role] = enabled;
      const next = { ...prev, [featureId]: current };
      const row = ACCESS_MATRIX.find((r) => r.id === featureId);
      if (row?.registryId && row.registryId !== featureId) {
        next[row.registryId] = { ...current };
      }
      return next;
    });
  };

  const resetRoleAccessToDefaults = () => {
    setRoleAccessEdit(getAccessMatrixRoleDefaults());
    flash('Restored default role access (click Save to apply)');
  };

  const saveRoleAccess = async () => {
    setRoleAccessSaving(true);
    try {
      const payload = {};
      for (const row of ACCESS_MATRIX) {
        if (roleAccessEdit[row.id]) payload[row.id] = roleAccessEdit[row.id];
        if (row.registryId && roleAccessEdit[row.registryId]) {
          payload[row.registryId] = roleAccessEdit[row.registryId];
        }
      }
      await api.put('/api/features/role-access', { roleAccess: payload });
      await reloadFeatures();
      flash('✅ Feature access matrix saved');
    } catch (e) {
      flash('❌ ' + (e.response?.data?.detail || e.message || 'Failed to save role access'), false);
    } finally {
      setRoleAccessSaving(false);
    }
  };

  const userFormCard = (opts = {}) => {
    const { inline = false, formRef = null } = opts;
    return (
      <div
        ref={formRef}
        style={{
          ...s.card,
          marginBottom: inline ? 0 : 16,
          marginTop: inline ? 0 : undefined,
          border: inline ? `1px solid ${t.accent}55` : undefined,
          background: inline ? t.surface2 : t.surface,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h4 style={s.cardTitle}>{editId ? '✏ Edit User' : '➕ Add New User'}</h4>
          <button type="button" style={s.closeBtn} onClick={closeForm}>✕</button>
        </div>
        <form onSubmit={save}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>Username *</label>
              <input
                style={{ ...s.inp, background: editId ? t.surface2 : t.inp }}
                value={form.username}
                required
                readOnly={!!editId}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
              <PasswordInput
                style={s.inp}
                value={form.password}
                required={!editId}
                placeholder={editId ? 'Leave blank to keep current' : 'e.g. Password@123'}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              />
              <span style={{ color: t.textFaint, fontSize: 10, maxWidth: 260 }}>{PASSWORD_HINT}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>Role *</label>
              <select
                style={{ ...s.inp, background: editId === me?.id ? t.surface2 : t.inp }}
                value={form.role}
                disabled={editId === me?.id}
                onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_CFG[r].icon} {ROLE_CFG[r].label}</option>
                ))}
              </select>
              {editId === me?.id && (
                <span style={{ color: t.textFaint, fontSize: 10 }}>Cannot change your own role</span>
              )}
            </div>
            <button style={s.submitBtn} type="submit">
              {editId ? '💾 Save Changes' : '✓ Create User'}
            </button>
            <button style={s.cancelBtn} type="button" onClick={closeForm}>Cancel</button>
          </div>

          {form.role && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, background: inline ? t.surface : t.surface2,
              borderLeft: `3px solid ${ROLE_CFG[form.role]?.color}`, fontSize: 13,
            }}
            >
              <span style={{ color: ROLE_CFG[form.role]?.color, fontWeight: 600 }}>
                {ROLE_CFG[form.role]?.icon} {ROLE_CFG[form.role]?.label}
              </span>
              <span style={{ color: t.textMuted, marginLeft: 8 }}>{ROLE_CFG[form.role]?.desc}</span>
            </div>
          )}
        </form>
      </div>
    );
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="USER MANAGEMENT" onRefresh={fetchUsers} />
      <p style={{ color: t.textMuted, fontSize: 13, marginTop: -4, marginBottom: 12 }}>
        Login accounts for web/admin roles (<code style={{ color: t.accent }}>users</code> table).
        Shop-floor operators (roster, temp staff, large headcount) use a separate{' '}
        <code style={{ color: t.accent }}>operators</code> table under{' '}
        <Link to="/operators" style={{ color: t.accent, fontWeight: 700 }}>
          Operator Management → Operator Directory
        </Link>.
      </p>
      {msg.text && (
        <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 12,
                      background: msg.ok ? '#10b98122' : '#ef444422',
                      color: msg.ok ? '#10b981' : '#ef4444', fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      {/* Role Access Summary — clickable filters */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
          <h4 style={{ ...s.cardTitle, margin: 0 }}>🔐 Role Access Summary</h4>
          <span style={{ color: t.textFaint, fontSize: 12 }}>
            Click a role to filter the user list · {users.length} login user{users.length !== 1 ? 's' : ''} total
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          <button
            type="button"
            onClick={() => { setRoleFilter(null); setShowUsers(true); }}
            style={{
              ...s.roleCard,
              textAlign: 'left',
              cursor: 'pointer',
              borderLeft: `3px solid ${t.accent}`,
              outline: roleFilter === null ? `2px solid ${t.accent}` : 'none',
              background: roleFilter === null ? `${t.accent}14` : t.surface2,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
              <span style={{ color: t.accent, fontWeight: 700, fontSize: 14, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
                All roles
              </span>
              <span style={{ background: `${t.accent}33`, color: t.accent, borderRadius: 10,
                             padding: '1px 8px', fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {users.length} user{users.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.4 }}>Show every login account</div>
          </button>
          {ROLES.map(r => {
            const cfg = ROLE_CFG[r];
            const count = byRole[r]?.length || 0;
            const active = roleFilter === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => selectRole(r)}
                style={{
                  ...s.roleCard,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderLeft: `3px solid ${cfg.color}`,
                  outline: active ? `2px solid ${cfg.color}` : 'none',
                  background: active ? `${cfg.color}18` : t.surface2,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                  <span style={{ color: cfg.color, fontWeight: 700, fontSize: 14, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <span style={{ background: cfg.color + '33', color: cfg.color, borderRadius: 10,
                                 padding: '1px 8px', fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {count} user{count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.4 }}>{cfg.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions — below Role Access Summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          type="button"
          style={s.pwBtn}
          onClick={() => {
            setShowForm(false);
            setEditId(null);
            setShowPwForm((v) => !v);
          }}
        >
          🔑 Change My Password
        </button>
        <button type="button" style={s.addBtn} onClick={openAdd}>+ Add User</button>
      </div>

      {showPwForm && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h4 style={s.cardTitle}>🔑 Change My Password ({me?.username})</h4>
            <button type="button" style={s.closeBtn} onClick={() => setShowPwForm(false)}>✕</button>
          </div>
          <form onSubmit={changePassword} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>Current Password</label>
              <PasswordInput style={s.inp} required value={pwForm.current}
                onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>New Password</label>
              <PasswordInput style={s.inp} required value={pwForm.next}
                onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))} />
              <span style={{ color: t.textFaint, fontSize: 10, maxWidth: 220 }}>{PASSWORD_HINT}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={s.label}>Confirm New Password</label>
              <PasswordInput style={s.inp} required value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
            </div>
            <button style={s.submitBtn} type="submit">Update Password</button>
          </form>
        </div>
      )}

      {/* Add form stays near the action buttons */}
      {showForm && !editId && userFormCard({ formRef: addFormRef })}

      {/* Users Table — searchable + filterable + collapsible */}
      <div style={s.card}>
        <SectionToggle
          open={showUsers}
          onToggle={() => setShowUsers((v) => !v)}
          label={roleFilter ? `${ROLE_CFG[roleFilter].icon} ${ROLE_CFG[roleFilter].label}` : 'All Users'}
          count={showUsers ? filteredUsers.length : users.length}
        />
        {showUsers && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <input
                style={{ ...s.inp, flex: 1, minWidth: 220, maxWidth: 420 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by username, role, or ID…"
                aria-label="Search users"
              />
              {roleFilter && (
                <button
                  type="button"
                  style={s.cancelBtn}
                  onClick={() => setRoleFilter(null)}
                >
                  Clear role filter
                </button>
              )}
              <span style={{ color: t.textFaint, fontSize: 12 }}>
                Showing {filteredUsers.length} of {users.length}
                {roleFilter ? ` · ${ROLE_CFG[roleFilter].label}` : ''}
                {search.trim() ? ` · “${search.trim()}”` : ''}
              </span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {['#', 'Username', 'Role', 'Face ID', 'Access Level', 'Actions'].map(h =>
                      <th key={h} style={{ ...s.th, position: 'sticky', top: 0, zIndex: 1 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: t.textFaint, padding: 32 }}>
                      No users match this search / role filter.
                    </td></tr>
                  )}
                  {filteredUsers.map(u => {
                    const cfg = ROLE_CFG[u.role] || ROLE_CFG.operator;
                    const isMe = u.username === me?.username;
                    const isEditing = showForm && editId === u.id;
                    return (
                      <Fragment key={u.id}>
                        <tr style={{ background: isEditing ? `${t.accent}18` : (isMe ? t.accent + '11' : 'transparent') }}>
                          <td style={s.td}>{u.id}</td>
                          <td style={s.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 30, height: 30, borderRadius: '50%',
                                            background: cfg.color + '33', color: cfg.color,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                                {u.username[0].toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, color: t.text }}>{u.username}</div>
                                {isMe && <div style={{ color: t.accent, fontSize: 10, fontWeight: 600 }}>YOU</div>}
                              </div>
                            </div>
                          </td>
                          <td style={s.td}>
                            <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                                           background: cfg.color + '22', color: cfg.color }}>
                              {cfg.icon} {cfg.label}
                            </span>
                          </td>
                          <td style={s.td}>
                            {u.role === 'operator' ? (
                              u.has_reference_photo ? (
                                <span style={{ color: '#10b981', fontSize: 12, fontWeight: 600 }}>✓ Master photo</span>
                              ) : (
                                <span style={{ color: '#f59e0b', fontSize: 12, fontWeight: 600 }}>Not set</span>
                              )
                            ) : (
                              <span style={{ color: t.textFaint, fontSize: 12 }}>—</span>
                            )}
                          </td>
                          <td style={s.td}>
                            <span style={{ color: t.textMuted, fontSize: 12 }}>{cfg.desc}</span>
                          </td>
                          <td style={s.td}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {u.role === 'operator' && (
                                <label style={{ ...s.miniBtn, background: '#6366f1', cursor: 'pointer', display: 'inline-block' }}>
                                  {photoUploadId === u.id ? '…' : '📷 Ref photo'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    disabled={photoUploadId === u.id}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) uploadReferencePhoto(u.id, f);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              )}
                              <button
                                type="button"
                                style={{ ...s.miniBtn, background: isEditing ? t.brand : t.accent }}
                                onClick={() => (isEditing ? closeForm() : openEdit(u))}
                              >
                                {isEditing ? '✕ Close' : '✏ Edit'}
                              </button>
                              <button
                                type="button"
                                style={{ ...s.miniBtn, background: isMe ? t.textFaint : '#ef4444',
                                         cursor: isMe ? 'not-allowed' : 'pointer' }}
                                onClick={() => !isMe && deleteUser(u.id, u.username)}
                                title={isMe ? 'Cannot delete your own account' : 'Delete user'}
                                disabled={isMe}
                              >
                                🗑 Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isEditing && (
                          <tr>
                            <td colSpan={6} style={{ ...s.td, padding: 12, background: t.surface, borderBottom: `2px solid ${t.accent}` }}>
                              {userFormCard({ inline: true, formRef: editFormRef })}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Feature Access Matrix — editable checkboxes */}
      <div style={s.card}>
        <SectionToggle
          open={showMatrix}
          onToggle={() => setShowMatrix((v) => !v)}
          label="📋 Feature Access Matrix"
        />
        {showMatrix && (
          <>
            <p style={{ color: t.textMuted, fontSize: 12, margin: '0 0 10px', lineHeight: 1.45 }}>
              Tick roles for each feature. Under each checkbox, <strong>Default</strong> shows the system baseline
              (✓ / —) as a reference. Cells that differ from default are highlighted. Column header selects a role
              for all features; row checkbox selects all roles for that feature.
            </p>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: t.textMuted }}>
                <span><strong style={{ color: t.text }}>Checkbox</strong> = current access</span>
                <span><strong style={{ color: '#10b981' }}>✓</strong> / <strong>—</strong> under it = default reference</span>
                <span style={{
                  padding: '2px 8px', borderRadius: 4,
                  background: `${t.accent}22`, border: `1px solid ${t.accent}55`,
                }}>
                  Highlighted = changed from default
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={s.cancelBtn}
                  onClick={resetRoleAccessToDefaults}
                  disabled={roleAccessSaving}
                >
                  Reset to defaults
                </button>
                <button
                  type="button"
                  style={{ ...s.submitBtn, opacity: roleAccessSaving ? 0.7 : 1 }}
                  disabled={roleAccessSaving}
                  onClick={saveRoleAccess}
                >
                  {roleAccessSaving ? 'Saving…' : 'Save access matrix'}
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Feature</th>
                    {ROLES.map((r) => {
                      const allOn = ACCESS_MATRIX.every((row) => !!roleAccessEdit[row.id]?.[r]);
                      const someOn = ACCESS_MATRIX.some((row) => !!roleAccessEdit[row.id]?.[r]);
                      return (
                        <th key={r} style={{ ...s.th, color: ROLE_CFG[r].color, textAlign: 'center' }}>
                          <label
                            style={{
                              display: 'inline-flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title={`${allOn ? 'Clear' : 'Select'} ${ROLE_CFG[r].label} for all features`}
                          >
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                              onChange={(e) => setRoleForAllFeatures(r, e.target.checked)}
                            />
                            <span>{ROLE_CFG[r].icon} {ROLE_CFG[r].label}</span>
                          </label>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_MATRIX.map((row) => {
                    const rolesMap = roleAccessEdit[row.id] || row.roles;
                    const defaults = row.roles || {};
                    const allRolesOn = ROLES.every((r) => !!rolesMap[r]);
                    const someRolesOn = ROLES.some((r) => !!rolesMap[r]);
                    return (
                      <tr key={row.id}>
                        <td style={{ ...s.td, fontWeight: 500, color: t.text }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={allRolesOn}
                              ref={(el) => { if (el) el.indeterminate = someRolesOn && !allRolesOn; }}
                              onChange={(e) => setAllRolesForFeature(row.id, e.target.checked)}
                              title="Select / clear all roles for this feature"
                            />
                            {row.feature}
                          </label>
                        </td>
                        {ROLES.map((r) => {
                          const current = !!rolesMap[r];
                          const defOn = !!defaults[r];
                          const changed = current !== defOn;
                          return (
                            <td
                              key={r}
                              style={{
                                ...s.td,
                                textAlign: 'center',
                                background: changed ? `${t.accent}18` : 'transparent',
                                verticalAlign: 'middle',
                              }}
                              title={
                                changed
                                  ? `Changed from default (${defOn ? 'on' : 'off'})`
                                  : `Default: ${defOn ? 'allowed' : 'not allowed'}`
                              }
                            >
                              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <input
                                  type="checkbox"
                                  checked={current}
                                  onChange={() => toggleFeatureRole(row.id, r)}
                                  aria-label={`${row.feature} — ${ROLE_CFG[r].label}`}
                                />
                                <span style={{
                                  fontSize: 10,
                                  lineHeight: 1.2,
                                  color: defOn ? '#10b981' : t.textFaint,
                                  fontWeight: defOn ? 700 : 500,
                                }}>
                                  {defOn ? '✓' : '—'}
                                  <span style={{ color: t.textFaint, fontWeight: 400 }}> def</span>
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function getStyles(t) {
  return {
    card:      { background: t.surface, borderRadius: 10, padding: 20, marginBottom: 16 },
    cardTitle: { color: t.accent, margin: '0 0 14px', fontSize: 14, fontWeight: 600 },
    roleCard:  { borderRadius: 8, padding: '12px 14px', border: 'none', width: '100%' },
    label:     { color: t.textDim, fontSize: 11, fontWeight: 600 },
    inp:       { padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
                 background: t.inp, color: t.text, fontSize: 13, minWidth: 160 },
    addBtn:    { padding: '8px 20px', background: t.accent, color: '#fff', border: 'none',
                 borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
    pwBtn:     { padding: '8px 16px', background: t.brand, color: '#fff', border: 'none',
                 borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
    outlineBtn:{ padding: '8px 16px', background: 'transparent', color: t.accent,
                 border: `1px solid ${t.accent}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 },
    submitBtn: { padding: '8px 22px', background: t.brand, color: '#fff', border: 'none',
                 borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 },
    cancelBtn: { padding: '8px 18px', background: 'transparent', color: t.textMuted,
                 border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 },
    closeBtn:  { background: 'none', border: 'none', color: t.textDim, cursor: 'pointer', fontSize: 18 },
    miniBtn:   { padding: '4px 10px', border: 'none', borderRadius: 5, color: '#fff',
                 cursor: 'pointer', fontSize: 12, fontWeight: 600 },
    table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:        { padding: '10px', background: t.surface2, color: t.textDim,
                 textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600 },
    td:        { padding: '10px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' },
  };
}

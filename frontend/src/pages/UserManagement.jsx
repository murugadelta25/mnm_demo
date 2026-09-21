import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { pageClass } from '../themes/tileHelpers';
import PageHeader from '../components/PageHeader';
import { PASSWORD_HINT, passwordPolicyError } from '../utils/passwordPolicy';
import { getAccessMatrixRoleDefaults, mergeAccessMatrixRoles, normalizeAccessMatrixFromApi } from '../config/accessMatrix';

const FALLBACK_ROLE_CFG = {
  superadmin:  { color: '#dc2626', label: 'Super Admin', icon: '🛡', desc: 'Full access + factory setup, data backup & archive', isSystem: true },
  admin:       { color: '#ef4444', label: 'Admin',       icon: '⚙', desc: 'Full access to all features except factory setup & backup', isSystem: true },
  site_admin:  { color: '#f97316', label: 'Site Admin',  icon: '🏭', desc: 'Plant-level access — grant pages in the matrix below', isSystem: true },
  supervisor:  { color: '#f59e0b', label: 'Supervisor',  icon: '📋', desc: 'Planning, data entry, QC incharge approval', isSystem: true },
  operator:    { color: '#0ea5e9', label: 'Operator', icon: '🔧', desc: 'Optional web/tablet login', isSystem: true },
  maintenance: { color: '#10b981', label: 'Maintenance', icon: '🛠', desc: 'Acknowledge and resolve breakdown tickets', isSystem: true },
  quality:     { color: '#8b5cf6', label: 'Quality',     icon: '✓', desc: 'QC inspection sheet — inspector approval', isSystem: true },
};

const INIT_FORM = { username: '', password: '', role: 'supervisor' };
const INIT_ROLE_FORM = { slug: '', label: '', description: '', color: '#64748b', icon: '👤', inheritsSlug: '' };

const ROLE_ICON_OPTIONS = [
  { icon: '👤', label: 'Person' },
  { icon: '👷', label: 'Operator' },
  { icon: '🔧', label: 'Wrench' },
  { icon: '🛠', label: 'Tools' },
  { icon: '⚙', label: 'Settings' },
  { icon: '🛡', label: 'Shield' },
  { icon: '🏭', label: 'Plant' },
  { icon: '📋', label: 'Clipboard' },
  { icon: '✓', label: 'Quality' },
  { icon: '🔍', label: 'Inspect' },
  { icon: '📊', label: 'Reports' },
  { icon: '📈', label: 'Trend' },
  { icon: '📦', label: 'Parts' },
  { icon: '📝', label: 'Plan' },
  { icon: '📅', label: 'Schedule' },
  { icon: '⏱', label: 'Time' },
  { icon: '🚨', label: 'Alert' },
  { icon: '🔴', label: 'Breakdown' },
  { icon: '📧', label: 'Email' },
  { icon: '👔', label: 'Management' },
  { icon: '🧑‍💼', label: 'Lead' },
  { icon: '🧑‍🔬', label: 'Lab' },
  { icon: '🚛', label: 'Stores' },
  { icon: '💡', label: 'Idea' },
];

function permissionType(row) {
  if (row.kind === 'edit') return { text: 'EDIT', color: '#0ea5e9', hint: 'Create / change records on this screen' };
  if (row.kind === 'action') return { text: 'ACTION', color: '#f59e0b', hint: 'Specific button (raise, approve, ack, resolve…)' };
  return { text: 'VIEW', color: '#10b981', hint: 'Show this page in the sidebar (read-only unless EDIT/ACTION is also ticked)' };
}

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
  const { roleAccess, accessMatrix: apiMatrix, toggleableRoles, roles: appRoles, reload: reloadFeatures } = useFeatureFlags();
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
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleEditSlug, setRoleEditSlug] = useState(null);
  const [roleForm, setRoleForm] = useState(INIT_ROLE_FORM);
  const [roleSaving, setRoleSaving] = useState(false);
  const [matrixHighlightRole, setMatrixHighlightRole] = useState(null);
  const [copyFromRole, setCopyFromRole] = useState('');
  const [copyToRole, setCopyToRole] = useState('');
  const matrixTableRef = useRef(null);
  const editFormRef = useRef(null);
  const addFormRef = useRef(null);

  const roleSlugs = useMemo(
    () => mergeAccessMatrixRoles(toggleableRoles),
    [toggleableRoles],
  );

  const roleCfgMap = useMemo(() => {
    const out = { ...FALLBACK_ROLE_CFG };
    for (const r of appRoles || []) {
      out[r.slug] = {
        color: r.color || '#64748b',
        label: r.label || r.slug,
        icon: r.icon || '👤',
        desc: r.description || '',
        isSystem: r.isSystem,
        inheritsSlug: r.inheritsSlug,
      };
    }
    return out;
  }, [appRoles]);

  const matrixRows = useMemo(
    () => normalizeAccessMatrixFromApi(apiMatrix, roleSlugs),
    [apiMatrix, roleSlugs],
  );

  useEffect(() => {
    const defaults = getAccessMatrixRoleDefaults(roleSlugs);
    const merged = {};
    const ids = new Set([
      ...Object.keys(defaults),
      ...Object.keys(roleAccess || {}),
      ...matrixRows.map((row) => row.id),
    ]);
    for (const id of ids) {
      const row = matrixRows.find((r) => r.id === id || r.registryId === id);
      const base = { ...rolesMapFromEmpty(roleSlugs), ...(row?.roles || {}), ...(defaults[id] || {}), ...((roleAccess || {})[id] || {}) };
      merged[id] = base;
    }
    setRoleAccessEdit(merged);
  }, [roleAccess, matrixRows, roleSlugs]);

  function rolesMapFromEmpty(slugs) {
    return Object.fromEntries(slugs.map((s) => [s, false]));
  }

  const flash = (text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg({ text: '', ok: true }), 4000);
  };

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
  const byRole = useMemo(() => roleSlugs.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r);
    return acc;
  }, {}), [users, roleSlugs]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!q) return true;
      const cfg = roleCfgMap[u.role] || {};
      return (
        String(u.id).includes(q)
        || (u.username || '').toLowerCase().includes(q)
        || (u.role || '').toLowerCase().includes(q)
        || (cfg.label || '').toLowerCase().includes(q)
      );
    });
  }, [users, roleFilter, search, roleCfgMap]);

  const toggleFeatureRole = (featureId, role) => {
    setRoleAccessEdit((prev) => {
      const current = { ...(prev[featureId] || {}) };
      const enabled = !current[role];
      const next = { ...prev };
      const setOne = (id, value) => {
        const cur = { ...(next[id] || {}) };
        cur[role] = value;
        next[id] = cur;
        const r = matrixRows.find((x) => x.id === id);
        if (r?.registryId && r.registryId !== id) next[r.registryId] = { ...cur };
      };
      setOne(featureId, enabled);
      const row = matrixRows.find((r) => r.id === featureId);
      if (row?.kind === 'page' && !enabled) {
        for (const child of matrixRows.filter((r) => r.parentId === featureId)) {
          setOne(child.id, false);
        }
      }
      if (row?.parentId && enabled) {
        setOne(row.parentId, true);
      }
      return next;
    });
  };

  const setRoleForAllFeatures = (role, enabled) => {
    setRoleAccessEdit((prev) => {
      const next = { ...prev };
      for (const row of matrixRows) {
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
      const next = { ...prev };
      const setAll = (id, value) => {
        const current = { ...(next[id] || {}) };
        for (const role of roleSlugs) current[role] = value;
        next[id] = current;
        const row = matrixRows.find((r) => r.id === id);
        if (row?.registryId && row.registryId !== id) next[row.registryId] = { ...current };
      };
      setAll(featureId, enabled);
      const row = matrixRows.find((r) => r.id === featureId);
      if (row?.kind === 'page' && !enabled) {
        for (const child of matrixRows.filter((r) => r.parentId === featureId)) {
          setAll(child.id, false);
        }
      }
      if (row?.parentId && enabled) {
        setAll(row.parentId, true);
      }
      return next;
    });
  };

  const applyCopyRoleAccess = () => {
    if (!copyFromRole || !copyToRole || copyFromRole === copyToRole) {
      flash('Choose two different roles to copy', false);
      return;
    }
    setRoleAccessEdit((prev) => {
      const next = { ...prev };
      for (const row of matrixRows) {
        const current = { ...(next[row.id] || { ...row.roles }) };
        current[copyToRole] = !!current[copyFromRole];
        next[row.id] = current;
        if (row.registryId && row.registryId !== row.id) {
          next[row.registryId] = { ...current };
        }
      }
      return next;
    });
    const fromLabel = roleCfgMap[copyFromRole]?.label || copyFromRole;
    const toLabel = roleCfgMap[copyToRole]?.label || copyToRole;
    flash(`Copied ${fromLabel} ticks onto ${toLabel} — click Save access matrix`);
  };

  const resetRoleAccessToDefaults = () => {
    setRoleAccessEdit(getAccessMatrixRoleDefaults(roleSlugs));
    flash('Restored default role access (click Save to apply)');
  };

  const openAddRole = () => {
    setRoleEditSlug(null);
    setRoleForm(INIT_ROLE_FORM);
    setShowRoleForm(true);
  };

  const openEditRole = (slug, e) => {
    e?.stopPropagation?.();
    const r = (appRoles || []).find((x) => x.slug === slug) || {};
    const fb = FALLBACK_ROLE_CFG[slug] || {};
    setRoleEditSlug(slug);
    setRoleForm({
      slug: r.slug || slug,
      label: r.label || fb.label || slug,
      description: r.description || fb.desc || '',
      color: r.color || fb.color || '#64748b',
      icon: r.icon || fb.icon || '👤',
      inheritsSlug: r.inheritsSlug || '',
    });
    setShowRoleForm(true);
  };

  const closeRoleForm = () => {
    setShowRoleForm(false);
    setRoleEditSlug(null);
    setRoleForm(INIT_ROLE_FORM);
  };

  const saveRoleDefinition = async (e) => {
    e.preventDefault();
    if (!roleForm.label.trim()) {
      flash('Role name is required', false);
      return;
    }
    setRoleSaving(true);
    try {
      if (roleEditSlug) {
        await api.patch(`/api/roles/${roleEditSlug}`, {
          label: roleForm.label.trim(),
          description: roleForm.description,
          color: roleForm.color,
          icon: roleForm.icon,
          inheritsSlug: roleForm.inheritsSlug || null,
        });
        flash('✅ Role updated');
      } else {
        const created = await api.post('/api/roles/', {
          slug: roleForm.slug.trim() || undefined,
          label: roleForm.label.trim(),
          description: roleForm.description,
          color: roleForm.color,
          icon: roleForm.icon,
          inheritsSlug: roleForm.inheritsSlug || null,
        });
        const newSlug = created.data?.slug;
        flash('✅ Role created — tick VIEW / EDIT / ACTION in the Feature Access Matrix below, then Save');
        closeRoleForm();
        await reloadFeatures();
        if (newSlug) {
          setShowMatrix(true);
          focusRoleInMatrix(newSlug);
        }
        return;
      }
      closeRoleForm();
      await reloadFeatures();
    } catch (err) {
      flash('❌ ' + (err.response?.data?.detail || err.message || 'Role save failed'), false);
    } finally {
      setRoleSaving(false);
    }
  };

  const deleteRoleDefinition = async (slug, e) => {
    e?.stopPropagation?.();
    const cfg = roleCfgMap[slug] || {};
    if (cfg.isSystem) {
      flash('System roles cannot be deleted. Adjust page access in the matrix instead.', false);
      return;
    }
    if (!window.confirm(`Delete role "${cfg.label || slug}"? Users must be reassigned first.`)) return;
    try {
      await api.delete(`/api/roles/${slug}`);
      if (roleFilter === slug) setRoleFilter(null);
      if (matrixHighlightRole === slug) setMatrixHighlightRole(null);
      await reloadFeatures();
      flash('✅ Role deleted');
    } catch (err) {
      flash('❌ ' + (err.response?.data?.detail || err.message || 'Delete failed'), false);
    }
  };

  const focusRoleInMatrix = (slug) => {
    setMatrixHighlightRole(slug);
    setShowMatrix(true);
    setTimeout(() => {
      const el = matrixTableRef.current?.querySelector(`[data-role-col="${slug}"]`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 80);
  };

  const selectRole = (role) => {
    setRoleFilter((prev) => (prev === role ? null : role));
    setShowUsers(true);
    if (role) focusRoleInMatrix(role);
    else setMatrixHighlightRole(null);
  };

  const saveRoleAccess = async () => {
    setRoleAccessSaving(true);
    try {
      const payload = {};
      for (const row of matrixRows) {
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
                {roleSlugs.map(r => (
                  <option key={r} value={r}>{roleCfgMap[r]?.icon || '👤'} {roleCfgMap[r]?.label || r}</option>
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
              borderLeft: `3px solid ${roleCfgMap[form.role]?.color}`, fontSize: 13,
            }}
            >
              <span style={{ color: roleCfgMap[form.role]?.color, fontWeight: 600 }}>
                {roleCfgMap[form.role]?.icon} {roleCfgMap[form.role]?.label}
              </span>
              <span style={{ color: t.textMuted, marginLeft: 8 }}>{roleCfgMap[form.role]?.desc}</span>
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

      {/* Role Access Summary — linked to Feature Access Matrix */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
          <h4 style={{ ...s.cardTitle, margin: 0 }}>🔐 Role Access Summary</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: t.textFaint, fontSize: 12 }}>
              Click a role to filter users and jump to its matrix column · {users.length} login user{users.length !== 1 ? 's' : ''}
            </span>
            <button type="button" style={s.addBtn} onClick={openAddRole}>+ Add Role</button>
          </div>
        </div>
        <p style={{ color: t.textMuted, fontSize: 12, margin: '0 0 12px', lineHeight: 1.45 }}>
          Page permissions for each role are configured in the <strong>Feature Access Matrix</strong> below.
          Tick <strong>View</strong> to show a page, then tick <strong>Create / Edit</strong> or action rows
          (raise breakdown, approve, etc.) for that role. Click <strong>Save access matrix</strong>.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          <button
            type="button"
            onClick={() => { setRoleFilter(null); setMatrixHighlightRole(null); setShowUsers(true); }}
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
          {roleSlugs.map(r => {
            const cfg = roleCfgMap[r] || { color: '#64748b', label: r, icon: '👤', desc: '', isSystem: false };
            const count = byRole[r]?.length || 0;
            const active = roleFilter === r || matrixHighlightRole === r;
            return (
              <div
                key={r}
                style={{
                  ...s.roleCard,
                  borderLeft: `3px solid ${cfg.color}`,
                  outline: active ? `2px solid ${cfg.color}` : 'none',
                  background: active ? `${cfg.color}18` : t.surface2,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  onClick={() => selectRole(r)}
                  style={{
                    background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                    <span style={{ color: cfg.color, fontWeight: 700, fontSize: 14, lineHeight: 1.35, flex: 1, minWidth: 0 }}>
                      {cfg.icon} {cfg.label}
                      {cfg.isSystem && <span style={{ color: t.textFaint, fontWeight: 500, fontSize: 10, marginLeft: 6 }}>system</span>}
                    </span>
                    <span style={{ background: cfg.color + '33', color: cfg.color, borderRadius: 10,
                                   padding: '1px 8px', fontSize: 12, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {count} user{count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.4 }}>{cfg.desc || 'Custom role — set pages in matrix'}</div>
                </button>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" style={s.outlineBtn} onClick={(e) => openEditRole(r, e)}>Edit</button>
                  <button type="button" style={s.outlineBtn} onClick={() => focusRoleInMatrix(r)}>Matrix</button>
                  {!cfg.isSystem && (
                    <button type="button" style={{ ...s.outlineBtn, color: '#ef4444', borderColor: '#ef4444' }}
                      onClick={(e) => deleteRoleDefinition(r, e)}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showRoleForm && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h4 style={s.cardTitle}>{roleEditSlug ? '✏ Edit Role' : '➕ Add Role'}</h4>
            <button type="button" style={s.closeBtn} onClick={closeRoleForm}>✕</button>
          </div>
          <form onSubmit={saveRoleDefinition}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {!roleEditSlug && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={s.label}>Role ID (optional)</label>
                  <input style={s.inp} placeholder="auto from name, e.g. qc_lead"
                    value={roleForm.slug}
                    onChange={(e) => setRoleForm((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={s.label}>Display name *</label>
                <input style={s.inp} required value={roleForm.label}
                  onChange={(e) => setRoleForm((p) => ({ ...p, label: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
                <label style={s.label}>Description</label>
                <input style={s.inp} value={roleForm.description}
                  onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280, flex: '1 1 100%' }}>
                <label style={s.label}>Icon — click one</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 520 }}>
                  {ROLE_ICON_OPTIONS.map((opt) => {
                    const selected = roleForm.icon === opt.icon;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        title={opt.label}
                        onClick={() => setRoleForm((p) => ({ ...p, icon: opt.icon }))}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          fontSize: 18,
                          lineHeight: 1,
                          cursor: 'pointer',
                          background: selected ? `${roleForm.color}33` : t.surface2,
                          border: selected ? `2px solid ${roleForm.color}` : `1px solid ${t.border}`,
                          color: t.text,
                        }}
                      >
                        {opt.icon}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={s.label}>Color</label>
                <input style={{ ...s.inp, width: 90 }} type="color" value={roleForm.color}
                  onChange={(e) => setRoleForm((p) => ({ ...p, color: e.target.value }))} />
              </div>
              {!roleEditSlug && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={s.label}>Copy access from</label>
                  <select style={s.inp} value={roleForm.inheritsSlug}
                    onChange={(e) => setRoleForm((p) => ({ ...p, inheritsSlug: e.target.value }))}>
                    <option value="">None (all pages off — tick View / Edit below)</option>
                    {roleSlugs.map((slug) => (
                      <option key={slug} value={slug}>{roleCfgMap[slug]?.label || slug}</option>
                    ))}
                  </select>
                </div>
              )}
              <button type="submit" style={{ ...s.submitBtn, opacity: roleSaving ? 0.7 : 1 }} disabled={roleSaving}>
                {roleSaving ? 'Saving…' : roleEditSlug ? 'Update role' : 'Create role'}
              </button>
            </div>
          </form>
        </div>
      )}

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
          label={roleFilter ? `${roleCfgMap[roleFilter]?.icon || '👤'} ${roleCfgMap[roleFilter]?.label || roleFilter}` : 'All Users'}
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
                {roleFilter ? ` · ${roleCfgMap[roleFilter]?.label || roleFilter}` : ''}
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
                    const cfg = roleCfgMap[u.role] || { color: t.textMuted, label: u.role, icon: '👤' };
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
            <p style={{ color: t.textMuted, fontSize: 12, margin: '0 0 10px', lineHeight: 1.5 }}>
              <strong>↳</strong> means a child row under the page above it (not a separate menu).
              Example: <strong>Model Change</strong> is VIEW (open the page).
              <strong>↳ Raise Model Change</strong> ACTION = the “New Change Request” form.
              <strong>↳ Approve Model Change</strong> ACTION = the ✓ Approve / ✗ Reject buttons a supervisor uses
              before a part/setting change can start.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              {[
                { text: 'VIEW', color: '#10b981', desc: 'Show the page in the sidebar (read-only)' },
                { text: 'EDIT', color: '#0ea5e9', desc: 'Create / change (Add Work Order, New Plan, Save Entry…)' },
                { text: 'ACTION', color: '#f59e0b', desc: 'One button on that page — e.g. Approve or Raise' },
              ].map((chip) => (
                <div
                  key={chip.text}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 8,
                    border: `1px solid ${chip.color}66`, background: `${chip.color}14`,
                    fontSize: 12, color: t.text, maxWidth: 360,
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', color: chip.color,
                  }}>{chip.text}</span>
                  <span style={{ color: t.textMuted }}>{chip.desc}</span>
                </div>
              ))}
            </div>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, color: t.textMuted }}>
                <span>Copy ticks</span>
                <select style={s.inp} value={copyFromRole} onChange={(e) => setCopyFromRole(e.target.value)}>
                  <option value="">From role…</option>
                  {roleSlugs.map((slug) => (
                    <option key={slug} value={slug}>{roleCfgMap[slug]?.label || slug}</option>
                  ))}
                </select>
                <span>onto</span>
                <select style={s.inp} value={copyToRole} onChange={(e) => setCopyToRole(e.target.value)}>
                  <option value="">To role…</option>
                  {roleSlugs.map((slug) => (
                    <option key={slug} value={slug}>{roleCfgMap[slug]?.label || slug}</option>
                  ))}
                </select>
                <button type="button" style={s.outlineBtn} onClick={applyCopyRoleAccess}>Apply copy</button>
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
            <div style={{ overflow: 'auto', maxHeight: 'min(70vh, 720px)' }} ref={matrixTableRef}>
              <table style={{ ...s.table, borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, ...s.stickyHead, ...s.stickyFeature, zIndex: 5 }}>Feature</th>
                    <th style={{ ...s.th, ...s.stickyHead, ...s.stickyPerm, textAlign: 'center', zIndex: 5 }}>Permission</th>
                    {roleSlugs.map((r) => {
                      const cfg = roleCfgMap[r] || { color: t.textMuted, label: r, icon: '👤' };
                      const allOn = matrixRows.every((row) => !!roleAccessEdit[row.id]?.[r]);
                      const someOn = matrixRows.some((row) => !!roleAccessEdit[row.id]?.[r]);
                      const highlighted = matrixHighlightRole === r;
                      return (
                        <th
                          key={r}
                          data-role-col={r}
                          style={{
                            ...s.th,
                            ...s.stickyHead,
                            color: cfg.color,
                            textAlign: 'center',
                            background: highlighted ? `${cfg.color}22` : t.surface2,
                            boxShadow: highlighted ? `inset 0 -3px 0 ${cfg.color}` : undefined,
                            zIndex: 4,
                          }}
                        >
                          <label
                            style={{
                              display: 'inline-flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 4,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title={`${allOn ? 'Clear' : 'Select'} ${cfg.label} for all features`}
                          >
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                              onChange={(e) => setRoleForAllFeatures(r, e.target.checked)}
                            />
                            <span>{cfg.icon} {cfg.label}</span>
                          </label>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((row, idx) => {
                    const rolesMap = roleAccessEdit[row.id] || row.roles;
                    const defaults = row.roles || {};
                    const allRolesOn = roleSlugs.every((r) => !!rolesMap[r]);
                    const someRolesOn = roleSlugs.some((r) => !!rolesMap[r]);
                    const prevGroup = idx > 0 ? matrixRows[idx - 1].group : null;
                    const showGroup = row.group && row.group !== prevGroup && !row.parentId;
                    const isChild = Boolean(row.parentId);
                    const perm = permissionType(row);
                    const featureLabel = isChild ? `↳ ${row.feature}` : row.feature;
                    return (
                      <Fragment key={row.id}>
                        {showGroup && (
                          <tr>
                            <td
                              colSpan={2 + roleSlugs.length}
                              style={{
                                ...s.td,
                                position: 'sticky',
                                left: 0,
                                background: t.surface2,
                                color: t.accent,
                                fontWeight: 700,
                                fontSize: 12,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                                zIndex: 1,
                              }}
                            >
                              {row.group}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td style={{
                            ...s.td,
                            ...s.stickyFeature,
                            position: 'sticky',
                            zIndex: 2,
                            fontWeight: isChild ? 400 : 500,
                            color: t.text,
                            paddingLeft: isChild ? 28 : undefined,
                            background: t.surface,
                          }}
                            title={isChild ? 'Child of the page above — not a separate menu item' : undefined}
                          >
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={allRolesOn}
                                ref={(el) => { if (el) el.indeterminate = someRolesOn && !allRolesOn; }}
                                onChange={(e) => setAllRolesForFeature(row.id, e.target.checked)}
                                title="Select / clear all roles for this feature"
                              />
                              <span>{featureLabel}</span>
                            </label>
                          </td>
                          <td
                            style={{
                              ...s.td,
                              ...s.stickyPerm,
                              position: 'sticky',
                              zIndex: 2,
                              textAlign: 'center',
                              background: t.surface,
                            }}
                            title={perm.hint}
                          >
                            <span style={{
                              display: 'inline-block',
                              minWidth: 58,
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: '0.04em',
                              color: perm.color,
                              background: `${perm.color}22`,
                              border: `1px solid ${perm.color}66`,
                            }}>
                              {perm.text}
                            </span>
                          </td>
                          {roleSlugs.map((r) => {
                            const current = !!rolesMap[r];
                            const defOn = !!defaults[r];
                            const changed = current !== defOn;
                            const cfg = roleCfgMap[r] || {};
                            const colHighlight = matrixHighlightRole === r;
                            return (
                              <td
                                key={r}
                                data-role-col={r}
                                style={{
                                  ...s.td,
                                  textAlign: 'center',
                                  background: colHighlight
                                    ? `${(cfg.color || t.accent)}14`
                                    : (changed ? `${t.accent}18` : 'transparent'),
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
                                    aria-label={`${row.feature} — ${cfg.label || r}`}
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
                      </Fragment>
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
    stickyHead:{ position: 'sticky', top: 0, boxShadow: `0 1px 0 ${t.border}` },
    stickyFeature: {
      left: 0, width: 260, minWidth: 260, maxWidth: 260,
      boxShadow: `1px 0 0 ${t.border}`,
      whiteSpace: 'normal',
    },
    stickyPerm: {
      left: 260, minWidth: 96, width: 96,
      boxShadow: `1px 0 0 ${t.border}`,
    },
    td:        { padding: '10px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' },
  };
}

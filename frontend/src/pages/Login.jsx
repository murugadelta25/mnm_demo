import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { useBranding } from '../context/BrandingContext';
import { useTheme } from '../context/ThemeContext';
import LogoIcon from '../components/graphics/LogoIcon';
import ThemeModeToggler from '../components/layout/ThemeModeToggler';
import api from '../api/client';
import { SESSION_EXPIRED_KEY } from '../components/IdleTimeoutGuard';
import { isFeatureEnabled } from '../config/featureRegistry';
import { PASSWORD_HINT, passwordPolicyError } from '../utils/passwordPolicy';

const EMPTY_RESET = {
  username: '',
  newPassword: '',
  confirmPassword: '',
  approverUsername: '',
  approverPassword: '',
};

const EMPTY_FORCE = {
  current: '',
  next: '',
  confirm: '',
};

function PasswordField({
  value,
  onChange,
  placeholder,
  style,
  required = false,
  autoFocus = false,
  autoComplete = 'current-password',
  theme: t,
}) {
  const [visible, setVisible] = useState(false);
  const {
    marginBottom = 12,
    width = '100%',
    minWidth,
    maxWidth,
    margin,
    marginTop,
    marginLeft,
    marginRight,
    ...inputStyle
  } = style || {};
  return (
    <div
      style={{
        position: 'relative',
        width,
        minWidth,
        maxWidth,
        marginBottom,
        margin,
        marginTop,
        marginLeft,
        marginRight,
      }}
    >
      <input
        style={{
          ...inputStyle,
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: 0,
          paddingRight: 42,
        }}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={onChange}
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
          fontSize: 15,
          lineHeight: 1,
          padding: 4,
          color: t.textMuted,
          opacity: 0.85,
          zIndex: 1,
        }}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  );
}

export default function Login() {
  const [creds, setCreds] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [networkUrls, setNetworkUrls] = useState([]);
  const [showForgot, setShowForgot] = useState(false);
  const [resetForm, setResetForm] = useState(EMPTY_RESET);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [forceForm, setForceForm] = useState(EMPTY_FORCE);
  const [forceError, setForceError] = useState('');
  const [forceLoading, setForceLoading] = useState(false);
  const { login, user, clearMustChangePassword, logout } = useAuth();
  const { modules } = useFeatureFlags();
  const nav = useNavigate();
  const { theme: t } = useTheme();
  const { siteTitle } = useBranding();

  const mustChange = Boolean(user?.mustChangePassword);

  useEffect(() => {
    const reason = sessionStorage.getItem(SESSION_EXPIRED_KEY);
    if (reason === 'idle') {
      setSessionNotice('Your session ended after 60 minutes of inactivity. Please sign in again.');
      sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    }
  }, []);

  useEffect(() => {
    api.get('/api/config/network')
      .then(r => {
        const urls = r.data?.access_urls;
        if (Array.isArray(urls) && urls.length) setNetworkUrls(urls);
      })
      .catch(() => {});
  }, []);

  const goAfterLogin = (role) => {
    if (role === 'maintenance' && isFeatureEnabled('maintenance.dashboard', modules)) {
      nav('/maintenance');
    } else {
      nav('/dashboard');
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    marginBottom: 12,
    borderRadius: 6,
    border: `1px solid ${t.inpBorder}`,
    background: t.inp,
    color: t.text,
    fontSize: 14,
    boxSizing: 'border-box',
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(creds.username, creds.password);
      if (data.must_change_password) {
        setForceForm(EMPTY_FORCE);
        setForceError('');
        setShowForgot(false);
        return;
      }
      goAfterLogin(data.role);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout') || err.code === 'ERR_NETWORK') {
        setError('Cannot reach the server. Make sure the backend is running on port 8010.');
      } else if (err.response?.status === 401) {
        setError('Invalid username or password.');
      } else if (err.response?.status >= 500) {
        setError('Server error — database may be misconfigured. Check backend logs and DATABASE_URL in backend/.env.');
      } else {
        setError('Cannot connect to server. Check that the backend is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForceChange = async e => {
    e.preventDefault();
    setForceError('');
    if (forceForm.next !== forceForm.confirm) {
      setForceError('New password and confirmation do not match.');
      return;
    }
    const policyErr = passwordPolicyError(forceForm.next);
    if (policyErr) {
      setForceError(policyErr);
      return;
    }
    setForceLoading(true);
    try {
      await api.post('/api/users/me/change-password', {
        current_password: forceForm.current,
        new_password: forceForm.next,
      });
      clearMustChangePassword();
      goAfterLogin(user.role);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setForceError(typeof detail === 'string' ? detail : 'Could not update password.');
    } finally {
      setForceLoading(false);
    }
  };

  const openForgot = () => {
    setShowForgot(true);
    setResetError('');
    setResetSuccess('');
    setResetForm({ ...EMPTY_RESET, username: creds.username || '' });
    setError('');
  };

  const closeForgot = () => {
    setShowForgot(false);
    setResetError('');
    setResetSuccess('');
    setResetForm(EMPTY_RESET);
  };

  const handleResetPassword = async e => {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');

    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setResetError('New password and confirmation do not match.');
      return;
    }
    const policyErr = passwordPolicyError(resetForm.newPassword);
    if (policyErr) {
      setResetError(policyErr);
      return;
    }

    setResetLoading(true);
    try {
      const r = await api.post('/api/auth/forgot-password', {
        username: resetForm.username.trim(),
        new_password: resetForm.newPassword,
        approver_username: resetForm.approverUsername.trim(),
        approver_password: resetForm.approverPassword,
      });
      setResetSuccess(r.data?.message || 'Password reset. You can sign in now.');
      setCreds(p => ({ ...p, username: resetForm.username.trim(), password: '' }));
      setResetForm(f => ({ ...f, newPassword: '', confirmPassword: '', approverPassword: '' }));
    } catch (err) {
      const detail = err.response?.data?.detail;
      setResetError(typeof detail === 'string' ? detail : 'Password reset failed. Check details and try again.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg, transition: 'background 0.2s' }}>
      <div style={{ background: t.surface, padding: 40, borderRadius: 12, width: 400, boxShadow: '0 4px 24px #0008', border: `1px solid ${t.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <LogoIcon size={40} />
          <div>
            <h2 style={{ color: t.accent, margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '0.5px' }}>{siteTitle}</h2>
            <p style={{ color: t.textMuted, margin: 0, fontSize: 13 }}>Production Dashboard</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <ThemeModeToggler />
        </div>

        {mustChange ? (
          <form onSubmit={handleForceChange}>
            <h3 style={{ color: t.text, margin: '0 0 6px', fontSize: 16 }}>Update your password</h3>
            <p style={{ color: t.textMuted, margin: '0 0 12px', fontSize: 12, lineHeight: 1.45 }}>
              Security upgrade: set a new password once for <strong>{user?.username}</strong>. You will not be asked again after this.
            </p>
            <p style={{ color: t.accent, margin: '0 0 14px', fontSize: 11, lineHeight: 1.4 }}>{PASSWORD_HINT}</p>
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="Current password"
              value={forceForm.current}
              required
              autoFocus
              autoComplete="current-password"
              onChange={e => setForceForm(p => ({ ...p, current: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="New password"
              value={forceForm.next}
              required
              autoComplete="new-password"
              onChange={e => setForceForm(p => ({ ...p, next: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="Confirm new password"
              value={forceForm.confirm}
              required
              autoComplete="new-password"
              onChange={e => setForceForm(p => ({ ...p, confirm: e.target.value }))}
            />
            {forceError && (
              <div style={{ background: '#ef444422', border: '1px solid #ef4444', borderRadius: 6,
                            padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>⚠ {forceError}</p>
              </div>
            )}
            <button
              style={{ width: '100%', padding: '11px', background: forceLoading ? t.textFaint : t.accent,
                       color: '#fff', border: 'none', borderRadius: 6, fontSize: 15,
                       fontWeight: 600, cursor: forceLoading ? 'not-allowed' : 'pointer' }}
              type="submit"
              disabled={forceLoading}
            >
              {forceLoading ? 'Saving…' : 'Save new password & continue'}
            </button>
            <button
              type="button"
              onClick={() => { logout(); setCreds({ username: '', password: '' }); }}
              style={{
                display: 'block', width: '100%', marginTop: 14, padding: 0, border: 'none',
                background: 'transparent', color: t.textMuted, fontSize: 13, cursor: 'pointer', textAlign: 'center',
              }}
            >
              Sign out
            </button>
          </form>
        ) : !showForgot ? (
          <form onSubmit={handleSubmit}>
            <input
              style={inputStyle}
              placeholder="Username"
              value={creds.username}
              autoFocus
              onChange={e => setCreds(p => ({ ...p, username: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={{ ...inputStyle, marginBottom: 16 }}
              placeholder="Password"
              value={creds.password}
              autoComplete="current-password"
              onChange={e => setCreds(p => ({ ...p, password: e.target.value }))}
            />
            {sessionNotice && (
              <div style={{ background: '#f59e0b22', border: '1px solid #f59e0b', borderRadius: 6,
                            padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#d97706', fontSize: 13, margin: 0 }}>{sessionNotice}</p>
              </div>
            )}
            {error && (
              <div style={{ background: '#ef444422', border: '1px solid #ef4444', borderRadius: 6,
                            padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>⚠ {error}</p>
              </div>
            )}
            <button
              style={{ width: '100%', marginTop: 4, padding: '11px', background: loading ? t.textFaint : t.accent,
                       color: '#fff', border: 'none', borderRadius: 6, fontSize: 15,
                       fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Connecting...' : 'Login'}
            </button>
            <button
              type="button"
              onClick={openForgot}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 14,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: t.accent,
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'center',
                textDecoration: 'underline',
              }}
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword}>
            <h3 style={{ color: t.text, margin: '0 0 6px', fontSize: 16 }}>Reset password</h3>
            <p style={{ color: t.textMuted, margin: '0 0 8px', fontSize: 12, lineHeight: 1.4 }}>
              Works for all roles (operator → superadmin). An <strong>admin</strong> or <strong>superadmin</strong> must authorize the reset.
            </p>
            <p style={{ color: t.accent, margin: '0 0 14px', fontSize: 11, lineHeight: 1.4 }}>{PASSWORD_HINT}</p>
            <input
              style={inputStyle}
              placeholder="Username to reset"
              value={resetForm.username}
              autoFocus
              required
              onChange={e => setResetForm(p => ({ ...p, username: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="New password"
              value={resetForm.newPassword}
              required
              autoComplete="new-password"
              onChange={e => setResetForm(p => ({ ...p, newPassword: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="Confirm new password"
              value={resetForm.confirmPassword}
              required
              autoComplete="new-password"
              onChange={e => setResetForm(p => ({ ...p, confirmPassword: e.target.value }))}
            />
            <div style={{ height: 1, background: t.border, margin: '4px 0 14px' }} />
            <p style={{ color: t.textMuted, margin: '0 0 10px', fontSize: 12 }}>
              Approver (admin / superadmin)
            </p>
            <input
              style={inputStyle}
              placeholder="Approver username"
              value={resetForm.approverUsername}
              required
              onChange={e => setResetForm(p => ({ ...p, approverUsername: e.target.value }))}
            />
            <PasswordField
              theme={t}
              style={inputStyle}
              placeholder="Approver password"
              value={resetForm.approverPassword}
              required
              autoComplete="current-password"
              onChange={e => setResetForm(p => ({ ...p, approverPassword: e.target.value }))}
            />
            {resetError && (
              <div style={{ background: '#ef444422', border: '1px solid #ef4444', borderRadius: 6,
                            padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>⚠ {resetError}</p>
              </div>
            )}
            {resetSuccess && (
              <div style={{ background: '#10b98122', border: '1px solid #10b981', borderRadius: 6,
                            padding: '8px 12px', marginBottom: 12 }}>
                <p style={{ color: '#059669', fontSize: 13, margin: 0 }}>✓ {resetSuccess}</p>
              </div>
            )}
            <button
              style={{ width: '100%', padding: '11px', background: resetLoading ? t.textFaint : t.accent,
                       color: '#fff', border: 'none', borderRadius: 6, fontSize: 15,
                       fontWeight: 600, cursor: resetLoading ? 'not-allowed' : 'pointer' }}
              type="submit"
              disabled={resetLoading}
            >
              {resetLoading ? 'Resetting...' : 'Reset password'}
            </button>
            <button
              type="button"
              onClick={closeForgot}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 14,
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: t.textMuted,
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              ← Back to login
            </button>
          </form>
        )}

        {networkUrls.length > 0 && !mustChange && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
            <p style={{ color: t.textMuted, fontSize: 12, margin: '0 0 8px' }}>
              LAN access (Windows, Ubuntu, Android):
            </p>
            {networkUrls.map(url => (
              <a
                key={url}
                href={url}
                style={{ display: 'block', color: t.accent, fontSize: 12, marginBottom: 4, wordBreak: 'break-all' }}
              >
                {url}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

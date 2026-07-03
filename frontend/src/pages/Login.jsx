import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useTheme } from '../context/ThemeContext';
import LogoIcon from '../components/graphics/LogoIcon';
import ThemeModeToggler from '../components/layout/ThemeModeToggler';
import api from '../api/client';
import { SESSION_EXPIRED_KEY } from '../components/IdleTimeoutGuard';

export default function Login() {
  const [creds, setCreds] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [networkUrls, setNetworkUrls] = useState([]);
  const { login } = useAuth();
  const nav = useNavigate();
  const { theme: t } = useTheme();
  const { siteTitle } = useBranding();

  useEffect(() => {
    const reason = sessionStorage.getItem(SESSION_EXPIRED_KEY);
    if (reason === 'idle') {
      setSessionNotice('Your session ended after 30 minutes of inactivity. Please sign in again.');
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

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const role = await login(creds.username, creds.password);
      if (role === 'maintenance') nav('/maintenance');
      else nav('/dashboard');
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg, transition: 'background 0.2s' }}>
      <div style={{ background: t.surface, padding: 40, borderRadius: 12, width: 360, boxShadow: '0 4px 24px #0008', border: `1px solid ${t.border}` }}>
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
        <form onSubmit={handleSubmit}>
          <input style={{ width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 6,
                          border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text,
                          fontSize: 14, boxSizing: 'border-box' }}
            placeholder="Username" value={creds.username} autoFocus
            onChange={e => setCreds(p => ({ ...p, username: e.target.value }))} />
          <input style={{ width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 6,
                          border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text,
                          fontSize: 14, boxSizing: 'border-box' }}
            type="password" placeholder="Password" value={creds.password}
            onChange={e => setCreds(p => ({ ...p, password: e.target.value }))} />
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
          <button style={{ width: '100%', padding: '11px', background: loading ? t.textFaint : t.accent,
                           color: '#fff', border: 'none', borderRadius: 6, fontSize: 15,
                           fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
            type="submit" disabled={loading}>
            {loading ? 'Connecting...' : 'Login'}
          </button>
        </form>
        {networkUrls.length > 0 && (
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

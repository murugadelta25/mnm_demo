import axios from 'axios';
import { PERSISTENT_SESSION_USERNAME } from '../auth/sessionPolicy';

const inIframe = () => {
  try { return window.self !== window.top; } catch { return true; }
};

// Accept token injected by parent PMM3 frame via postMessage
window.addEventListener('message', (e) => {
  if (e.data?.type === 'PMS_TOKEN' && e.data.token) {
    localStorage.setItem('token', e.data.token);
    if (e.data.user) localStorage.setItem('user', JSON.stringify(e.data.user));
  }
});

// Signal parent that we are ready to receive the token
if (inIframe()) {
  window.parent.postMessage({ type: 'PMS_READY' }, '*');
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
});

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    const url = err.config?.url || '';
    const isAuthPublic = url.includes('/api/auth/login') || url.includes('/api/auth/forgot-password');
    if (err.response?.status === 401 && !isAuthPublic) {
      const userJson = localStorage.getItem('user');
      let username = null;
      try {
        username = userJson ? JSON.parse(userJson).username : null;
      } catch {
        username = null;
      }
      // Don't redirect when embedded — just reject so the component handles it
      if (!inIframe() && username !== PERSISTENT_SESSION_USERNAME) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;

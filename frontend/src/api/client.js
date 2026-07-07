import axios from 'axios';
import { PERSISTENT_SESSION_USERNAME } from '../auth/sessionPolicy';

// Empty baseURL = relative paths — Vite proxy forwards /api to backend (localhost:8010)
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
    if (err.response?.status === 401 && !err.config?.url?.includes('/api/auth/login')) {
      const userJson = localStorage.getItem('user');
      let username = null;
      try {
        username = userJson ? JSON.parse(userJson).username : null;
      } catch {
        username = null;
      }
      if (username !== PERSISTENT_SESSION_USERNAME) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;

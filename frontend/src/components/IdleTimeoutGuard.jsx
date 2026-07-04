import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import useIdleTimeout, { IDLE_TIMEOUT_MS } from '../hooks/useIdleTimeout';

export const SESSION_EXPIRED_KEY = 'session_expired_reason';

/**
 * Signs the user out after 60 minutes of no screen interaction.
 * Any mouse, keyboard, scroll, or touch activity keeps the session alive.
 */
export default function IdleTimeoutGuard({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleIdle = useCallback(() => {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, 'idle');
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  useIdleTimeout(handleIdle, {
    enabled: Boolean(user),
    timeoutMs: IDLE_TIMEOUT_MS,
  });

  return children;
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useWebSocket } from '../api/useWebSocket';

const SEV_COLOR = {
  alert: '#ef4444',
  warning: '#f59e0b',
  info: '#0ea5e9',
};

const SEV_ICON = {
  alert: '🚨',
  warning: '⚠',
  info: 'ℹ',
};

/** Above page cards / tables (often z-index 1–100) and modals below 2000 */
const PANEL_Z = 5000;
const PANEL_WIDTH = 360;
const PANEL_MAX_H = 420;

const BELL_SHAKE_CSS = `
@keyframes pms-bell-shake {
  0%, 100% { transform: rotate(0deg); }
  8%  { transform: rotate(14deg); }
  16% { transform: rotate(-14deg); }
  24% { transform: rotate(12deg); }
  32% { transform: rotate(-12deg); }
  40% { transform: rotate(8deg); }
  48% { transform: rotate(-8deg); }
  56%, 100% { transform: rotate(0deg); }
}
@keyframes pms-bell-burst {
  0%   { transform: rotate(0deg) scale(1); }
  12%  { transform: rotate(18deg) scale(1.12); }
  24%  { transform: rotate(-18deg) scale(1.12); }
  36%  { transform: rotate(14deg) scale(1.08); }
  48%  { transform: rotate(-14deg) scale(1.08); }
  60%  { transform: rotate(8deg) scale(1.04); }
  72%  { transform: rotate(-8deg) scale(1.02); }
  100% { transform: rotate(0deg) scale(1); }
}
@keyframes pms-badge-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0.45); }
  50% { transform: scale(1.08); box-shadow: 0 0 0 4px rgba(239,68,68,0); }
}
`;

export default function NotificationBell() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [burst, setBurst] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: PANEL_WIDTH, maxHeight: PANEL_MAX_H });
  const panelRef = useRef(null);
  const btnRef = useRef(null);
  const prevUnreadRef = useRef(0);

  const load = useCallback(async () => {
    if (!localStorage.getItem('token')) return;
    try {
      const { data } = await api.get('/api/notifications/');
      setItems(data.items || []);
      setUnread(data.unread ?? data.count ?? 0);
    } catch {
      /* keep previous list on transient errors */
    }
  }, []);

  const placePanel = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    const gap = 8;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + gap;
    const spaceBelow = window.innerHeight - top - 8;
    const spaceAbove = rect.top - 8;
    let maxHeight = Math.min(PANEL_MAX_H, Math.max(160, spaceBelow));
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
      maxHeight = Math.min(PANEL_MAX_H, Math.max(160, spaceAbove));
      top = Math.max(8, rect.top - gap - maxHeight);
    }
    setPanelPos({ top, left, width, maxHeight });
  }, []);

  // Stronger shake when unread count increases
  useEffect(() => {
    if (unread > prevUnreadRef.current && unread > 0) {
      setBurst(true);
      const id = window.setTimeout(() => setBurst(false), 700);
      prevUnreadRef.current = unread;
      return () => window.clearTimeout(id);
    }
    prevUnreadRef.current = unread;
    return undefined;
  }, [unread]);

  useEffect(() => {
    if (!localStorage.getItem('token')) return undefined;
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  useWebSocket(useCallback((msg) => {
    const type = msg?.type;
    if ([
      'model_change_request',
      'model_change_approved',
      'model_change_completed',
      'model_change_rejected',
      'breakdown_raised',
      'breakdown_acknowledged',
      'breakdown_in_progress',
      'breakdown_resolved',
      'plan_updated',
      'plan_started',
      'machine_status_updated',
      'spc_alert',
      'qc_report_submitted',
      'tool_alert',
    ].includes(type)) {
      load();
    }
  }, [load]));

  useLayoutEffect(() => {
    if (!open) return undefined;
    placePanel();
    const onReposition = () => placePanel();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, placePanel, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (item) => {
    setOpen(false);
    if (item?.path) navigate(item.path);
  };

  const shouldShake = unread > 0 && !open;

  const panel = open
    ? createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: panelPos.top,
          left: panelPos.left,
          width: panelPos.width,
          maxHeight: panelPos.maxHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
          zIndex: PANEL_Z,
        }}
      >
        <div style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
        >
          <strong style={{ fontSize: 13, color: t.text }}>Notifications</strong>
          <button
            type="button"
            onClick={load}
            style={{
              border: 'none',
              background: 'transparent',
              color: t.accent,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {items.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: t.textDim, fontSize: 13 }}>
              No alerts or pending requests
            </div>
          )}
          {items.map((item) => {
            const color = SEV_COLOR[item.severity] || SEV_COLOR.info;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderBottom: `1px solid ${t.border}`,
                  background: t.surface,
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 14, lineHeight: 1.2 }}>{SEV_ICON[item.severity] || '•'}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 2 }}>
                      {item.kind === 'spc_alert' ? '⚠ ' : ''}{item.title}
                    </div>
                    <div style={{ fontSize: 12, color: t.text, lineHeight: 1.35 }}>
                      {item.body}
                    </div>
                    <div style={{ fontSize: 10, color: t.textFaint, marginTop: 4 }}>
                      Open {item.path?.replace('/', '') || 'page'} →
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div style={{ position: 'relative', flexShrink: 0, zIndex: 2 }}>
      <style>{BELL_SHAKE_CSS}</style>
      <button
        ref={btnRef}
        type="button"
        title={unread > 0 ? `${unread} notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        style={{
          position: 'relative',
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: `1px solid ${t.border}`,
          background: open ? `${t.brand}22` : t.bg,
          color: t.text,
          cursor: 'pointer',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            transformOrigin: 'top center',
            animation: burst
              ? 'pms-bell-burst 0.65s ease-in-out'
              : shouldShake
                ? 'pms-bell-shake 2.6s ease-in-out infinite'
                : 'none',
          }}
        >
          🔔
        </span>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              lineHeight: 1,
              animation: shouldShake ? 'pms-badge-pulse 2.6s ease-in-out infinite' : 'none',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {panel}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function NotificationBell() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

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
    ].includes(type)) {
      load();
    }
  }, [load]));

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openItem = (item) => {
    setOpen(false);
    if (item?.path) navigate(item.path);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        title="Notifications"
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
        🔔
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
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 8,
            width: 360,
            maxWidth: 'min(360px, 92vw)',
            maxHeight: 420,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            zIndex: 1300,
          }}
        >
          <div style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${t.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
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

          <div style={{ overflowY: 'auto', flex: 1 }}>
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
        </div>
      )}
    </div>
  );
}

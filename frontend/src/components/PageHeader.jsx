import { useState, useEffect, useRef } from 'react';
import { useConfig, getCurrentShift } from '../context/ConfigContext';
import { useTheme } from '../context/ThemeContext';

const AUTO_REFRESH_SEC = 60;

/**
 * PageHeader
 * Props:
 *   title      – page title string (e.g. "Production Planning")
 *   onRefresh  – async/sync function to call on manual or auto refresh
 *   extra      – optional JSX rendered between title and clock (e.g. action buttons)
 */
export default function PageHeader({ title, onRefresh, extra }) {
  const [now, setNow]         = useState(new Date());
  const { config } = useConfig();
  const [currentShift, setCurrentShift] = useState(() => getCurrentShift(config));
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);
  const [spinning, setSpinning]   = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const countRef = useRef(AUTO_REFRESH_SEC);
  const { theme: t } = useTheme();

  const s = {
    bar: {
      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
      flexWrap: 'wrap',
    },
    title: { color: t.text, fontSize: 18, margin: 0, whiteSpace: 'nowrap' },
    extra: { flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    right: {
      marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10,
      background: t.surface, borderRadius: 10, padding: '6px 14px',
      border: `1px solid ${t.border}`, flexShrink: 0,
    },
    lastRefresh: { color: t.textFaint, fontSize: 11, whiteSpace: 'nowrap' },
    shiftBadge: { background: t.bg, color: t.brand, fontSize: 11, fontWeight: 700,
                  padding: '2px 10px', borderRadius: 10, border: `1px solid ${t.brand}44`, whiteSpace: 'nowrap' },
    refreshBtn: {
      position: 'relative', width: 28, height: 28, borderRadius: '50%',
      background: 'none', border: 'none', cursor: 'pointer',
      color: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    },
    refreshBtnSpin: { opacity: 0.6 },
    countdown: { color: t.textFaint, fontSize: 11, minWidth: 24, textAlign: 'right' },
    clock: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 },
    time: { color: t.accent, fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.03em' },
    date: { color: t.textDim, fontSize: 10, whiteSpace: 'nowrap' },
  };

  // Live clock — tick every second, update shift every minute
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      setCurrentShift(getCurrentShift(config));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-refresh countdown
  useEffect(() => {
    countRef.current = AUTO_REFRESH_SEC;
    setCountdown(AUTO_REFRESH_SEC);
    const t = setInterval(() => {
      countRef.current -= 1;
      setCountdown(countRef.current);
      if (countRef.current <= 0) {
        countRef.current = AUTO_REFRESH_SEC;
        setCountdown(AUTO_REFRESH_SEC);
        triggerRefresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [onRefresh]); // reset when onRefresh changes (e.g. filter change)

  const triggerRefresh = async () => {
    setSpinning(true);
    try { await onRefresh?.(); } finally {
      setSpinning(false);
      setLastRefresh(new Date());
      countRef.current = AUTO_REFRESH_SEC;
      setCountdown(AUTO_REFRESH_SEC);
    }
  };

  const fmt = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDate = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const fmtShort = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const pct = ((AUTO_REFRESH_SEC - countdown) / AUTO_REFRESH_SEC) * 100;
  const r = 10, circ = 2 * Math.PI * r;

  return (
    <div style={{ ...s.bar, borderBottom: `1px solid ${t.border}` }}>
      <h3 style={{ ...s.title, color: t.text }}>{title}</h3>
      {extra && <div style={s.extra}>{extra}</div>}
      <div style={{ ...s.right, background: t.surface, border: `1px solid ${t.border}` }}>
        {currentShift && (
          <span style={{ ...s.shiftBadge, background: t.bg, borderColor: '#f59e0b44' }}>⏱ {currentShift.name}</span>
        )}
        <span style={{ ...s.lastRefresh, color: t.textFaint }}>↻ {fmtShort(lastRefresh)}</span>
        <button style={{ ...s.refreshBtn, ...(spinning ? s.refreshBtnSpin : {}) }}
          onClick={triggerRefresh} title={`Auto-refresh in ${countdown}s — click to refresh now`}>
          <svg width={28} height={28} style={{ position: 'absolute', top: 0, left: 0 }}>
            <circle cx={14} cy={14} r={r} fill="none" stroke={t.border} strokeWidth={2.5} />
            <circle cx={14} cy={14} r={r} fill="none" stroke={t.accent} strokeWidth={2.5}
              strokeDasharray={circ}
              strokeDashoffset={circ - (pct / 100) * circ}
              strokeLinecap="round"
              transform="rotate(-90 14 14)" />
          </svg>
          <span style={{ position: 'relative', fontSize: 14, lineHeight: 1, display: 'inline-block',
                         transform: spinning ? 'rotate(360deg)' : 'none',
                         transition: spinning ? 'transform 0.6s linear' : 'none', color: t.accent }}>
            ↻
          </span>
        </button>
        <span style={{ ...s.countdown, color: t.textFaint }}>{countdown}s</span>
        <div style={s.clock}>
          <span style={{ ...s.time, color: t.accent }}>{fmt(now)}</span>
          <span style={{ ...s.date, color: t.textDim }}>{fmtDate(now)}</span>
        </div>
      </div>
    </div>
  );
}



import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useEmbed } from '../context/EmbedContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { pageClass } from '../themes/tileHelpers';

const INTERVAL_MIN_SEC = 30;
const INTERVAL_MAX_SEC = 300; // 5 minutes

function clampIntervalSec(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return INTERVAL_MIN_SEC;
  return Math.min(INTERVAL_MAX_SEC, Math.max(INTERVAL_MIN_SEC, n));
}

const BASE_PLAYLIST = [
  { path: '/overview/factory', label: 'Factory Overview', featureId: 'overview.factory' },
  { path: '/overview/line', label: 'Line Overview', featureId: 'overview.line' },
  { path: '/overview/equipment', label: 'Equipment Overview', featureId: 'overview.equipment' },
  { path: '/dashboard', label: 'OEE Dashboard', featureId: 'dashboard' },
  { path: '/hourly-output', label: 'Hourly Output', featureId: 'production.hourly_output' },
  { path: '/loss-tracker', label: 'Loss Tracker', featureId: 'maintenance.loss_tracker' },
];

function embedUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}embed=1&hideNav=1`;
}

export default function MonitorMode() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const { setNavHidden } = useEmbed();
  const { isEnabled } = useFeatureFlags();

  const playlist = useMemo(
    () => BASE_PLAYLIST.filter((item) => !item.featureId || isEnabled(item.featureId)),
    [isEnabled],
  );

  const [index, setIndex] = useState(0);
  const [intervalSec, setIntervalSec] = useState(INTERVAL_MIN_SEC);
  const [intervalDraft, setIntervalDraft] = useState(String(INTERVAL_MIN_SEC));
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(INTERVAL_MIN_SEC);

  const applyInterval = useCallback((raw) => {
    const next = clampIntervalSec(raw);
    setIntervalSec(next);
    setIntervalDraft(String(next));
    setRemaining(next);
  }, []);

  useEffect(() => {
    setNavHidden?.(true);
    return () => setNavHidden?.(false);
  }, [setNavHidden]);

  useEffect(() => {
    if (index >= playlist.length) setIndex(0);
  }, [playlist.length, index]);

  const current = playlist[index] || playlist[0];

  const goNext = useCallback(() => {
    setIndex((i) => (playlist.length ? (i + 1) % playlist.length : 0));
    setRemaining(intervalSec);
  }, [playlist.length, intervalSec]);

  const goPrev = useCallback(() => {
    setIndex((i) => (playlist.length ? (i - 1 + playlist.length) % playlist.length : 0));
    setRemaining(intervalSec);
  }, [playlist.length, intervalSec]);

  useEffect(() => {
    setRemaining(intervalSec);
  }, [intervalSec, index]);

  useEffect(() => {
    if (paused || !playlist.length) return undefined;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setIndex((i) => (i + 1) % playlist.length);
          return intervalSec;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [paused, playlist.length, intervalSec]);

  const s = styles(t);

  if (!playlist.length) {
    return (
      <div className={pageClass(t)} style={s.page}>
        <div style={s.bar}>
          <strong>Monitor Mode</strong>
          <button type="button" style={s.btn} onClick={() => navigate('/dashboard')}>Exit</button>
        </div>
        <div style={s.empty}>No enabled screens available for the monitor playlist.</div>
      </div>
    );
  }

  return (
    <div className={pageClass(t)} style={s.page}>
      <div style={s.bar}>
        <div style={s.barLeft}>
          <strong style={{ fontSize: 15 }}>Monitor Mode</strong>
          <span style={{ color: t.textDim, fontSize: 13 }}>
            {current?.label} ({index + 1}/{playlist.length})
          </span>
          <span style={s.countdown}>{paused ? 'Paused' : `${remaining}s`}</span>
        </div>
        <div style={s.barRight}>
          <label style={s.label} title={`Enter ${INTERVAL_MIN_SEC}–${INTERVAL_MAX_SEC} seconds`}>
            Interval (s)
            <input
              type="number"
              min={INTERVAL_MIN_SEC}
              max={INTERVAL_MAX_SEC}
              step={1}
              value={intervalDraft}
              onChange={(e) => setIntervalDraft(e.target.value)}
              onBlur={() => applyInterval(intervalDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyInterval(intervalDraft);
                  e.currentTarget.blur();
                }
              }}
              style={s.intervalInput}
              aria-label={`Rotation interval in seconds, ${INTERVAL_MIN_SEC} to ${INTERVAL_MAX_SEC}`}
            />
            <span style={{ fontSize: 11, opacity: 0.85 }}>
              {INTERVAL_MIN_SEC}–{INTERVAL_MAX_SEC}
            </span>
          </label>
          <button type="button" style={s.btn} onClick={goPrev}>Prev</button>
          <button type="button" style={s.btn} onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" style={s.btn} onClick={goNext}>Next</button>
          <button
            type="button"
            style={{ ...s.btn, background: t.danger || '#b91c1c', color: '#fff', border: 'none' }}
            onClick={() => {
              setNavHidden?.(false);
              navigate('/overview/factory');
            }}
          >
            Exit
          </button>
        </div>
      </div>

      <div style={s.frameWrap}>
        <iframe
          key={current.path}
          title={current.label}
          src={embedUrl(current.path)}
          style={s.frame}
        />
      </div>
    </div>
  );
}

function styles(t) {
  return {
    page: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      background: t.bg,
    },
    bar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
      padding: '8px 12px',
      background: t.surface,
      borderBottom: `1px solid ${t.border || 'transparent'}`,
      flexShrink: 0,
    },
    barLeft: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    barRight: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    countdown: {
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
      fontSize: 13,
      padding: '2px 8px',
      borderRadius: 6,
      background: t.surface2 || t.bg,
      color: t.text,
    },
    label: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      color: t.textDim,
    },
    intervalInput: {
      width: 72,
      border: `1px solid ${t.border || '#cbd5e1'}`,
      background: t.surface2 || t.bg,
      color: t.text,
      borderRadius: 6,
      padding: '4px 8px',
      fontSize: 13,
      fontVariantNumeric: 'tabular-nums',
    },
    btn: {
      border: `1px solid ${t.border || '#cbd5e1'}`,
      background: t.surface2 || t.bg,
      color: t.text,
      borderRadius: 6,
      padding: '6px 10px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    },
    frameWrap: { flex: 1, minHeight: 0, background: t.bg },
    frame: {
      width: '100%',
      height: '100%',
      border: 'none',
      display: 'block',
      background: t.bg,
    },
    empty: {
      padding: 24,
      color: t.textDim,
      fontSize: 14,
    },
  };
}

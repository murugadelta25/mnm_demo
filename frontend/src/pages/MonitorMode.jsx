import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useEmbed } from '../context/EmbedContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { useAuth } from '../context/AuthContext';
import { pageClass } from '../themes/tileHelpers';
import MonitorSetupModal, { INTERVAL_MIN, INTERVAL_MAX, loadPrefs } from '../components/layout/MonitorSetupModal';

const INTERVAL_MIN_SEC = INTERVAL_MIN;
const INTERVAL_MAX_SEC = INTERVAL_MAX;

function clampIntervalSec(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return INTERVAL_MIN_SEC;
  return Math.min(INTERVAL_MAX_SEC, Math.max(INTERVAL_MIN_SEC, n));
}

function embedUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}embed=1&hideNav=1`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MonitorMode() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const { setNavHidden } = useEmbed();
  const { canAccess } = useFeatureFlags();
  const { user } = useAuth();

  // null = setup screen; array = running
  const [playlist, setPlaylist] = useState(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [intervalSec, setIntervalSec] = useState(INTERVAL_MIN_SEC);
  const [intervalDraft, setIntervalDraft] = useState(String(INTERVAL_MIN_SEC));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(INTERVAL_MIN_SEC);

  useEffect(() => {
    setNavHidden?.(true);
    return () => setNavHidden?.(false);
  }, [setNavHidden]);

  const handleStart = useCallback((ordered, sec) => {
    setPlaylist(ordered);
    setIntervalSec(sec);
    setIntervalDraft(String(sec));
    setIndex(0);
    setRemaining(sec);
    setPaused(false);
  }, []);

  const applyInterval = useCallback((raw) => {
    const next = clampIntervalSec(raw);
    setIntervalSec(next);
    setIntervalDraft(String(next));
    setRemaining(next);
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => (playlist?.length ? (i + 1) % playlist.length : 0));
    setRemaining(intervalSec);
  }, [playlist, intervalSec]);

  const goPrev = useCallback(() => {
    setIndex((i) => (playlist?.length ? (i - 1 + playlist.length) % playlist.length : 0));
    setRemaining(intervalSec);
  }, [playlist, intervalSec]);

  useEffect(() => { setRemaining(intervalSec); }, [intervalSec, index]);

  useEffect(() => {
    if (!playlist || paused) return undefined;
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
  }, [playlist, paused, intervalSec]);

  const s = styles(t);
  const isDark = t?.isDark !== false && t?.id !== 'light';

  // ── Setup screen ──
  if (!playlist) {
    return (
      <div className={pageClass(t)} style={{ ...s.page, overflow: 'auto' }}>
        <div style={s.bar}>
          <strong style={{ fontSize: 15 }}>Monitor Mode</strong>
          <button
            type="button"
            style={{ ...s.btn, background: t.danger || '#b91c1c', color: '#fff', border: 'none' }}
            onClick={() => { setNavHidden?.(false); navigate('/overview/factory'); }}
          >
            Exit
          </button>
        </div>
                <MonitorSetupModal
              inline
              theme={t}
              onClose={() => { setNavHidden?.(false); navigate('/overview/factory'); }}
              onStart={handleStart}
            />
      </div>
    );
  }

  const current = playlist[index] || playlist[0];

  // ── Running screen ──
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
          {/* Playlist dots */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {playlist.map((item, i) => (
              <button
                key={item.path}
                type="button"
                title={item.label}
                onClick={() => { setIndex(i); setRemaining(intervalSec); }}
                style={{
                  width: i === index ? 20 : 8, height: 8, borderRadius: 4,
                  border: 'none', cursor: 'pointer', padding: 0,
                  background: i === index ? (t.accent || '#22cae7') : (isDark ? '#475569' : '#cbd5e1'),
                  transition: 'width 0.2s',
                }}
              />
            ))}
          </div>
          <label style={s.label} title={`${INTERVAL_MIN_SEC}–${INTERVAL_MAX_SEC} seconds`}>
            Interval (s)
            <input
              type="number"
              min={INTERVAL_MIN_SEC}
              max={INTERVAL_MAX_SEC}
              step={1}
              value={intervalDraft}
              onChange={(e) => setIntervalDraft(e.target.value)}
              onBlur={() => applyInterval(intervalDraft)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyInterval(intervalDraft); e.currentTarget.blur(); } }}
              style={s.intervalInput}
            />
          </label>
          <button type="button" style={s.btn} onClick={goPrev}>◀</button>
          <button type="button" style={s.btn} onClick={() => setPaused((p) => !p)}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button type="button" style={s.btn} onClick={goNext}>▶</button>
          <button
            type="button"
            style={{ ...s.btn, color: t.accent || '#22cae7', borderColor: t.accent || '#22cae7' }}
            onClick={() => setShowSetupModal(true)}
          >
            ⚙ Setup
          </button>
          <button
            type="button"
            style={{ ...s.btn, background: t.danger || '#b91c1c', color: '#fff', border: 'none' }}
            onClick={() => { setNavHidden?.(false); navigate('/overview/factory'); }}
          >
            Exit
          </button>
        </div>
      </div>

      {showSetupModal && (
        <MonitorSetupModal
          theme={t}
          onClose={() => setShowSetupModal(false)}
          onStart={(ordered, sec) => { handleStart(ordered, sec); setShowSetupModal(false); }}
        />
      )}

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
    page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: t.bg },
    bar: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap', padding: '8px 12px',
      background: t.surface, borderBottom: `1px solid ${t.border || 'transparent'}`, flexShrink: 0,
    },
    barLeft: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    barRight: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    countdown: {
      fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13,
      padding: '2px 8px', borderRadius: 6, background: t.surface2 || t.bg, color: t.text,
    },
    label: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.textDim },
    intervalInput: {
      width: 64, border: `1px solid ${t.border || '#cbd5e1'}`,
      background: t.surface2 || t.bg, color: t.text,
      borderRadius: 6, padding: '4px 8px', fontSize: 13, fontVariantNumeric: 'tabular-nums',
    },
    btn: {
      border: `1px solid ${t.border || '#cbd5e1'}`, background: t.surface2 || t.bg,
      color: t.text, borderRadius: 6, padding: '6px 10px',
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
    },
    frameWrap: { flex: 1, minHeight: 0, background: t.bg },
    frame: { width: '100%', height: '100%', border: 'none', display: 'block', background: t.bg },
    empty: { padding: 24, color: t.textDim, fontSize: 14 },
  };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useEmbed } from '../context/EmbedContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { pageClass } from '../themes/tileHelpers';

const INTERVAL_MIN_SEC = 30;
const INTERVAL_MAX_SEC = 300;
const LS_KEY = 'monitorMode_v1';

function clampIntervalSec(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return INTERVAL_MIN_SEC;
  return Math.min(INTERVAL_MAX_SEC, Math.max(INTERVAL_MIN_SEC, n));
}

const BASE_PLAYLIST = [
  { path: '/overview/factory',   label: 'Factory Overview',  featureId: 'overview.factory' },
  { path: '/overview/line',      label: 'Line Overview',     featureId: 'overview.line' },
  { path: '/overview/equipment', label: 'Equipment Overview',featureId: 'overview.equipment' },
  { path: '/dashboard',          label: 'OEE Dashboard',     featureId: 'dashboard' },
  { path: '/hourly-output',      label: 'Hourly Output',     featureId: 'production.hourly_output' },
  { path: '/loss-tracker',       label: 'Loss Tracker',      featureId: 'maintenance.loss_tracker' },
];

function embedUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}embed=1&hideNav=1`;
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ── Setup screen ─────────────────────────────────────────────────────────────
function SetupPanel({ available, onStart, theme: t }) {
  const isDark = t?.isDark !== false && t?.id !== 'light';
  const saved = loadPrefs();

  const [selected, setSelected] = useState(() => {
    if (saved?.selected?.length) return new Set(saved.selected);
    return new Set(available.map((x) => x.path));
  });
  const [intervalSec, setIntervalSec] = useState(saved?.intervalSec ?? INTERVAL_MIN_SEC);
  const [draft, setDraft] = useState(String(saved?.intervalSec ?? INTERVAL_MIN_SEC));

  const toggle = (path) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { if (next.size > 1) next.delete(path); }
      else next.add(path);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === available.length
        ? new Set([available[0].path])
        : new Set(available.map((x) => x.path)),
    );

  const applyInterval = (raw) => {
    const v = clampIntervalSec(raw);
    setIntervalSec(v);
    setDraft(String(v));
  };

  const handleStart = () => {
    const ordered = available.filter((x) => selected.has(x.path));
    savePrefs({ selected: ordered.map((x) => x.path), intervalSec });
    onStart(ordered, intervalSec);
  };

  const border = isDark ? '#334155' : '#cbd5e1';
  const surface2 = isDark ? (t.surface2 || '#1e293b') : '#f8fafc';
  const accent = t.accent || '#22cae7';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100%', padding: 24, boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: isDark ? t.surface : '#ffffff',
        border: `1px solid ${border}`,
        borderRadius: 14,
        boxShadow: isDark ? '0 0 0 1px rgba(34,202,231,0.1)' : '0 4px 24px rgba(15,23,42,0.1)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>🖥</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>Monitor Mode Setup</div>
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>
              Select dashboards and rotation interval
            </div>
          </div>
        </div>

        {/* Dashboard list */}
        <div style={{ padding: '14px 22px 8px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: t.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Dashboards ({selected.size}/{available.length} selected)
            </span>
            <button
              type="button"
              onClick={toggleAll}
              style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                border: `1px solid ${border}`, background: surface2, color: t.text, cursor: 'pointer',
              }}
            >
              {selected.size === available.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {available.map((item, idx) => {
              const on = selected.has(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => toggle(item.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${on ? accent : border}`,
                    background: on ? `${accent}14` : surface2,
                    color: t.text, transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {/* drag-order badge */}
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: on ? accent : (isDark ? '#334155' : '#e2e8f0'),
                    color: on ? '#fff' : t.textDim,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800,
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  {/* checkmark */}
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${on ? accent : border}`,
                    background: on ? accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff',
                  }}>
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Interval */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${border}`, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text, flex: 1 }}>
              Rotation Interval
            </span>
            <input
              type="number"
              min={INTERVAL_MIN_SEC}
              max={INTERVAL_MAX_SEC}
              step={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => applyInterval(draft)}
              onKeyDown={(e) => { if (e.key === 'Enter') { applyInterval(draft); e.currentTarget.blur(); } }}
              style={{
                width: 80, border: `1px solid ${border}`, background: surface2,
                color: t.text, borderRadius: 7, padding: '6px 10px',
                fontSize: 14, fontWeight: 700, textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 12, color: t.textDim, minWidth: 80 }}>
              seconds ({INTERVAL_MIN_SEC}–{INTERVAL_MAX_SEC})
            </span>
          </label>
        </div>

        {/* Actions */}
        <div style={{
          padding: '14px 22px 18px', borderTop: `1px solid ${border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={selected.size === 0}
            style={{
              padding: '10px 28px', borderRadius: 8, border: 'none',
              background: selected.size === 0 ? (isDark ? '#334155' : '#e2e8f0') : accent,
              color: selected.size === 0 ? t.textDim : '#fff',
              fontSize: 14, fontWeight: 800, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            ▶ Start Monitor
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MonitorMode() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const { setNavHidden } = useEmbed();
  const { isEnabled } = useFeatureFlags();

  const available = useMemo(
    () => BASE_PLAYLIST.filter((item) => !item.featureId || isEnabled(item.featureId)),
    [isEnabled],
  );

  // null = setup screen; array = running
  const [playlist, setPlaylist] = useState(null);
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
        {available.length === 0
          ? <div style={s.empty}>No enabled screens available.</div>
          : <SetupPanel available={available} onStart={handleStart} theme={t} />}
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
            onClick={() => setPlaylist(null)}
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

/**
 * MonitorSetupModal — shared between AppBar ⚙ button and MonitorMode setup screen.
 * Shows ALL pages from the feature registry (filtered by canAccess for current role).
 * inline=true  → renders the card directly (no overlay), used by MonitorMode setup screen
 * inline=false → renders as a fixed overlay modal, used by AppBar ⚙ button
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useFeatureFlags } from '../../context/FeatureFlagsContext';

export const LS_KEY = 'monitorMode_v1';
export const INTERVAL_MIN = 30;
export const INTERVAL_MAX = 300;

const MONITOR_PAGES = [
  { path: '/dashboard',          label: 'OEE Dashboard',     featureId: 'dashboard' },
  { path: '/overview/factory',   label: 'Factory Overview',  featureId: 'overview.factory' },
  { path: '/overview/line',      label: 'Line Overview',     featureId: 'overview.line' },
  { path: '/overview/equipment', label: 'Equipment Overview',featureId: 'overview.equipment' },
  { path: '/hourly-output',      label: 'Hourly Output',     featureId: 'production.hourly_output' },
  { path: '/breakdown',          label: 'Breakdown',         featureId: 'maintenance.breakdown' },
  { path: '/maintenance',        label: 'Maintenance',       featureId: 'maintenance.dashboard' },
  { path: '/loss-tracker',       label: 'Loss Tracker',      featureId: 'maintenance.loss_tracker' },
];

function getAllPages() {
  return MONITOR_PAGES;
}

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function clamp(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, n)) : INTERVAL_MIN;
}

export default function MonitorSetupModal({ onClose, onStart, theme: t, inline = false }) {
  const { user } = useAuth();
  const { canAccess } = useFeatureFlags();
  const isDark = t?.isDark !== false && t?.id !== 'light';
  const border = isDark ? '#334155' : '#cbd5e1';
  const surface2 = isDark ? (t?.surface2 || '#1e293b') : '#f8fafc';
  const accent = t?.accent || '#22cae7';
  const overlayRef = useRef(null);

  const allPages = getAllPages().filter(
    (p) => !p.featureId || canAccess(p.featureId, user?.role),
  );

  const saved = loadPrefs();
  const [selected, setSelected] = useState(() => {
    if (saved?.selected?.length) return new Set(saved.selected);
    return new Set(allPages.map((x) => x.path));
  });
  const [intervalSec, setIntervalSec] = useState(saved?.intervalSec ?? INTERVAL_MIN);
  const [draft, setDraft] = useState(String(saved?.intervalSec ?? INTERVAL_MIN));

  useEffect(() => {
    if (inline) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, inline]);

  const toggle = (path) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) { if (next.size > 1) next.delete(path); }
      else next.add(path);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === allPages.length
        ? new Set([allPages[0]?.path].filter(Boolean))
        : new Set(allPages.map((x) => x.path)),
    );

  const applyInterval = (raw) => {
    const v = clamp(raw);
    setIntervalSec(v);
    setDraft(String(v));
  };

  const handleStart = () => {
    const ordered = allPages.filter((x) => selected.has(x.path));
    savePrefs({ selected: ordered.map((x) => x.path), intervalSec });
    onStart?.(ordered, intervalSec);
    if (!inline) onClose?.();
  };

  const handleSave = () => {
    const ordered = allPages.filter((x) => selected.has(x.path));
    savePrefs({ selected: ordered.map((x) => x.path), intervalSec });
    onClose?.();
  };

  // Group pages by group label for display
  const grouped = [];
  const seen = new Set();
  for (const p of allPages) {
    const g = p.group || '';
    if (!seen.has(g)) { seen.add(g); grouped.push({ group: g, items: [] }); }
    grouped.find((x) => x.group === g).items.push(p);
  }

  const card = (
    <div style={{
      width: '100%', maxWidth: 540,
      ...(inline ? { maxHeight: 'calc(100vh - 120px)' } : { maxHeight: '90vh' }),
      display: 'flex', flexDirection: 'column',
      background: isDark ? t?.surface : '#ffffff',
      border: `1px solid ${border}`,
      borderRadius: 14,
      boxShadow: isDark
        ? '0 0 0 1px rgba(34,202,231,0.12), 0 24px 48px rgba(0,0,0,0.6)'
        : '0 8px 40px rgba(15,23,42,0.18)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 12px', borderBottom: `1px solid ${border}`,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontSize: 20 }}>🖥</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: t?.text }}>Monitor Mode Setup</div>
          <div style={{ fontSize: 11, color: t?.textDim, marginTop: 1 }}>
            Select pages and rotation interval
          </div>
        </div>
        {!inline && (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', color: t?.textDim,
              fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 6px', borderRadius: 6,
            }}
          >✕</button>
        )}
      </div>

      {/* Page list — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: t?.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pages ({selected.size}/{allPages.length} selected)
          </span>
          <button
            type="button"
            onClick={toggleAll}
            style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
              border: `1px solid ${border}`, background: surface2, color: t?.text, cursor: 'pointer',
            }}
          >
            {selected.size === allPages.length ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {grouped.map(({ group, items }) => (
          <div key={group} style={{ marginBottom: 10 }}>
            {group && (
              <div style={{
                fontSize: 10, fontWeight: 800, color: t?.textDim,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                marginBottom: 5, paddingLeft: 2,
              }}>
                {group}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map((item) => {
                const on = selected.has(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => toggle(item.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${on ? accent : border}`,
                      background: on ? `${accent}14` : surface2,
                      color: t?.text, transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${on ? accent : border}`,
                      background: on ? accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff',
                    }}>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Interval */}
      <div style={{ padding: '12px 20px', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t?.text, flex: 1 }}>Rotation Interval</span>
          <input
            type="number"
            min={INTERVAL_MIN}
            max={INTERVAL_MAX}
            step={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => applyInterval(draft)}
            onKeyDown={(e) => { if (e.key === 'Enter') { applyInterval(draft); e.currentTarget.blur(); } }}
            style={{
              width: 72, border: `1px solid ${border}`, background: surface2,
              color: t?.text, borderRadius: 7, padding: '5px 8px',
              fontSize: 13, fontWeight: 700, textAlign: 'center',
            }}
          />
          <span style={{ fontSize: 11, color: t?.textDim }}>sec ({INTERVAL_MIN}–{INTERVAL_MAX})</span>
        </label>
      </div>

      {/* Actions */}
      <div style={{
        padding: '12px 20px 16px', borderTop: `1px solid ${border}`,
        display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0,
      }}>
        {!inline && (
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '8px 18px', borderRadius: 8,
              border: `1px solid ${border}`, background: surface2,
              color: t?.text, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Save
          </button>
        )}
        <button
          type="button"
          onClick={handleStart}
          disabled={selected.size === 0}
          style={{
            padding: '8px 22px', borderRadius: 8, border: 'none',
            background: selected.size === 0 ? (isDark ? '#334155' : '#e2e8f0') : accent,
            color: selected.size === 0 ? t?.textDim : '#fff',
            fontSize: 13, fontWeight: 800, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ▶ Start Monitor
        </button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flex: 1, padding: 24, boxSizing: 'border-box',
      }}>
        {card}
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {card}
    </div>
  );
}

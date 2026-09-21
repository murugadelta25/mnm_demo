/** Shared PMS-themed FMMS UI helpers (tables, badges, layout). */

export function tableWrap(t) {
  return {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  };
}

export function thStyle(t) {
  return {
    padding: '8px 10px',
    textAlign: 'left',
    borderBottom: `1px solid ${t.border}`,
    background: t.surface2,
    color: t.textDim,
    fontWeight: 700,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
}

export function tdStyle(t) {
  return {
    padding: '8px 10px',
    textAlign: 'left',
    borderBottom: `1px solid ${t.border}`,
    color: t.text,
    verticalAlign: 'middle',
  };
}

export function cardStyle(t) {
  return {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    padding: 16,
  };
}

export function FmmsBadge({ children, tone = 'neutral', t }) {
  const tones = {
    critical: { bg: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '#991b1b' },
    warn: { bg: 'rgba(217,119,6,0.16)', color: '#fbbf24', border: '#d97706' },
    ok: { bg: 'rgba(34,197,94,0.14)', color: '#86efac', border: '#166534' },
    info: { bg: 'rgba(56,189,248,0.14)', color: '#7dd3fc', border: '#0284c7' },
    neutral: { bg: t?.surface2 || '#1f2937', color: t?.textDim || '#9ca3af', border: t?.border || '#334155' },
  };
  const s = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {children}
    </span>
  );
}

export function formatInrCost(amount, category) {
  const n = Number(amount || 0);
  const formatted = n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const cat = category
    ? String(category).charAt(0).toUpperCase() + String(category).slice(1)
    : null;
  return cat ? `₹${formatted} (${cat})` : `₹${formatted}`;
}

export function formatHistoryDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export const EVENT_TYPE_LABELS = {
  purchase: 'Purchase Order / Invoice',
  installation: 'Installation & Comm.',
  amc: 'AMC Service Entry',
  calibration: 'Calibration',
  maintenance: 'Maintenance',
  inhouse_maintenance: 'In-house Maintenance',
  breakdown: 'Breakdown',
  upgrade: 'Upgradation / Kaizen',
  investment: 'Investment',
  manpower_cost: 'Manpower Cost',
  other: 'Other',
};

export function formatLifecycleReference(h) {
  return [h.reference_number, h.performed_by].filter(Boolean).join(' · ') || '—';
}

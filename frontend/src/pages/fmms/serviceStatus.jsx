/** FMMS calibration / PM due-date status — terminology & color logic. */

export const SERVICE_STATUS_CSS = `
@keyframes fmms-svc-blink-slow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes fmms-svc-blink-fast {
  0%, 100% { opacity: 1; filter: brightness(1); }
  50% { opacity: 0.3; filter: brightness(1.2); }
}
@keyframes fmms-svc-badge-pulse-slow {
  0%, 100% { transform: scale(1); box-shadow: var(--fmms-badge-shadow); }
  50% { transform: scale(1.06); box-shadow: var(--fmms-badge-shadow-hot); }
}
@keyframes fmms-svc-badge-pulse-fast {
  0%, 100% { transform: scale(1); box-shadow: var(--fmms-badge-shadow); }
  50% { transform: scale(1.12); box-shadow: var(--fmms-badge-shadow-hot); }
}
`;

/**
 * Status terminology (example: next=20-Aug, alert_before=5):
 * - days > threshold     → On Track          #28A745 Forest Green   (no FX)
 * - 1..threshold days    → Action Required   #D97706 Amber/Orange   (no FX)
 * - 0 days               → Due Today         #8B0000 Blood Red      (slow blink)
 * - days < 0             → Overdue / Critical #DC3545 Danger Red    (fast blink + ⚠️)
 */
export function getServiceDueStatus(nextServiceDate, alertBeforeDays = 5) {
  if (!nextServiceDate) {
    return {
      level: 'none',
      statusText: null,
      days: null,
      label: null,
      color: '#94a3b8',
      accent: '#94a3b8',
      bg: 'rgba(148,163,184,0.15)',
      blink: null,
      danger: false,
      title: 'No next service date',
    };
  }
  const next = new Date(`${nextServiceDate}T00:00:00`);
  if (Number.isNaN(next.getTime())) {
    return {
      level: 'none', statusText: null, days: null, label: null,
      color: '#94a3b8', accent: '#94a3b8', bg: 'rgba(148,163,184,0.15)',
      blink: null, danger: false, title: 'Invalid date',
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((next.getTime() - today.getTime()) / 86400000);
  const threshold = Math.max(0, Number(alertBeforeDays) || 5);

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      level: 'overdue',
      statusText: 'Overdue',
      days,
      label: `${days} (${overdue} day${overdue === 1 ? '' : 's'} overdue)`,
      color: '#DC3545',
      accent: '#DC3545',
      bg: 'rgba(220,53,69,0.18)',
      blink: 'fast',
      danger: true,
      title: `Overdue / Critical — ${overdue} day(s) past due`,
    };
  }
  if (days === 0) {
    return {
      level: 'due',
      statusText: 'Due Today',
      days: 0,
      label: '0 days (due today)',
      color: '#8B0000',
      accent: '#8B0000',
      bg: 'rgba(139,0,0,0.16)',
      blink: 'slow',
      danger: false,
      title: 'Due Today — blood-red alert',
    };
  }
  if (days <= threshold) {
    return {
      level: 'action_required',
      statusText: 'Action Required',
      days,
      label: `${days} day${days === 1 ? '' : 's'}`,
      color: '#D97706',
      accent: '#D97706',
      bg: 'rgba(217,119,6,0.16)',
      blink: null,
      danger: false,
      title: `Action Required — within ${threshold}-day threshold`,
    };
  }
  return {
    level: 'on_track',
    statusText: 'On Track',
    days,
    label: `${days} day${days === 1 ? '' : 's'}`,
    color: '#28A745',
    accent: '#28A745',
    bg: 'rgba(40,167,69,0.14)',
    blink: null,
    danger: false,
    title: 'On Track — safe zone (before alert threshold)',
  };
}

function blinkAnimation(blink, kind = 'text') {
  if (blink === 'fast') {
    return kind === 'badge'
      ? 'fmms-svc-badge-pulse-fast 0.55s ease-in-out infinite'
      : 'fmms-svc-blink-fast 0.55s ease-in-out infinite';
  }
  if (blink === 'slow') {
    return kind === 'badge'
      ? 'fmms-svc-badge-pulse-slow 1.6s ease-in-out infinite'
      : 'fmms-svc-blink-slow 1.6s ease-in-out infinite';
  }
  return undefined;
}

/** Square 3D status badge for asset header / list. */
export function ServiceStatusBadge({ status, size = 18 }) {
  if (!status || status.level === 'none') return null;
  const c = status.accent || status.color;
  const shadow = `inset 1px 1px 0 rgba(255,255,255,0.45), inset -1px -1px 0 rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.35)`;
  const shadowHot = `inset 1px 1px 0 rgba(255,255,255,0.55), inset -1px -1px 0 rgba(0,0,0,0.4), 0 0 10px ${c}`;
  return (
    <span
      title={status.title || status.statusText}
      aria-label={status.title || status.statusText}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 3,
        flexShrink: 0,
        verticalAlign: 'middle',
        background: `linear-gradient(145deg, ${c} 0%, ${status.color} 70%, ${c} 100%)`,
        border: `1px solid ${c}`,
        boxShadow: shadow,
        '--fmms-badge-shadow': shadow,
        '--fmms-badge-shadow-hot': shadowHot,
        animation: blinkAnimation(status.blink, 'badge'),
      }}
    />
  );
}

/** Colored "Next service in days" value with status FX. */
export function ServiceDaysDisplay({ status, textDim }) {
  if (!status || status.level === 'none' || status.label == null) {
    return <span style={{ color: textDim }}>—</span>;
  }
  return (
    <span
      title={status.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        fontWeight: 700,
        fontSize: 11,
        lineHeight: 1.35,
        color: status.color,
        background: status.bg,
        border: `1px solid ${status.color}`,
        borderRadius: 6,
        padding: '3px 6px',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        animation: blinkAnimation(status.blink, 'text'),
      }}
    >
      {status.danger && (
        <span aria-hidden style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>⚠️</span>
      )}
      <span style={{ minWidth: 0 }}>{status.label}</span>
    </span>
  );
}

export function ServiceStatusStyles() {
  return <style>{SERVICE_STATUS_CSS}</style>;
}

/** Compact status chips for list rows. */
export function ServiceAlertChips({ status }) {
  if (!status || status.level === 'none' || !status.statusText) return null;
  return (
    <span
      title={status.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        color: status.color,
        background: status.bg,
        border: `1px solid ${status.color}`,
        borderRadius: 4,
        padding: '1px 6px',
        animation: blinkAnimation(status.blink, 'text'),
      }}
    >
      {status.danger ? '⚠️ ' : ''}{status.statusText}
    </span>
  );
}

/** Aggregate counts for hierarchy menus / nodes. */
export function countServiceAlerts(assets) {
  let overdue = 0;
  let actionRequired = 0;
  let dueToday = 0;
  let onTrack = 0;
  for (const a of assets || []) {
    const st = getServiceDueStatus(a.next_service_date, a.alert_before_days);
    if (st.level === 'overdue') overdue += 1;
    else if (st.level === 'due') dueToday += 1;
    else if (st.level === 'action_required') actionRequired += 1;
    else if (st.level === 'on_track') onTrack += 1;
  }
  return {
    overdue,
    actionRequired,
    dueToday,
    onTrack,
    /** @deprecated use actionRequired — kept for older call sites */
    breached: actionRequired + dueToday,
    total: overdue + actionRequired + dueToday,
  };
}

/** Count pills for location / building / facility rows & menus. */
export function HierarchyAlertCounts({
  overdue = 0,
  actionRequired = 0,
  dueToday = 0,
  breached,
}) {
  // Back-compat: older callers passed breached
  const action = actionRequired || 0;
  const due = dueToday || 0;
  const legacyBreached = breached != null && actionRequired == null && dueToday == null
    ? breached
    : null;
  const showAction = legacyBreached != null ? legacyBreached : action;
  const showDue = legacyBreached != null ? 0 : due;

  if (!overdue && !showAction && !showDue) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {overdue > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#DC3545', background: 'rgba(220,53,69,0.18)',
          border: '1px solid #DC3545', borderRadius: 4, padding: '1px 6px',
          animation: 'fmms-svc-blink-fast 0.55s ease-in-out infinite',
        }}>
          ⚠️ Overdue {overdue}
        </span>
      )}
      {showDue > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#8B0000', background: 'rgba(139,0,0,0.14)',
          border: '1px solid #8B0000', borderRadius: 4, padding: '1px 6px',
          animation: 'fmms-svc-blink-slow 1.6s ease-in-out infinite',
        }}>
          Due Today {showDue}
        </span>
      )}
      {showAction > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#D97706', background: 'rgba(217,119,6,0.16)',
          border: '1px solid #D97706', borderRadius: 4, padding: '1px 6px',
        }}>
          Action Required {showAction}
        </span>
      )}
    </div>
  );
}

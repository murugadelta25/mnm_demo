import { useNavigate } from 'react-router-dom';

/**
 * Dropdown switcher for Factory / Line / Equipment overview pages.
 * Factory name is shown bold CAPS, centered in the header (via PageHeader extra).
 */
export default function OverviewSelector({
  mode = 'factory',
  factoryName = '',
  lines = [],
  lineId,
  machines = [],
  machineId,
  stations = [],
  stationId = '',
  onStationChange,
  theme,
  /** When false, caller renders factory name elsewhere (e.g. centered in header). */
  showFactoryName = true,
}) {
  const navigate = useNavigate();
  const t = theme || {};
  const accent = t.accent || t.brand || '#38bdf8';
  const isDark = t.isDark !== false && t.id !== 'light';

  const selectWrap = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
  };

  const selectStyle = {
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    border: `1.5px solid ${accent}`,
    background: isDark ? (t.surface2 || t.surface || '#0f172a') : (t.surface || '#fff'),
    color: t.text || '#111',
    borderRadius: 999,
    padding: '7px 34px 7px 14px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    maxWidth: 240,
    lineHeight: 1.2,
    boxShadow: isDark ? `0 0 10px ${accent}22` : 'none',
  };

  const Chevron = () => (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        right: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
        color: accent,
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      ▼
    </span>
  );

  const factoryTitle = (factoryName || '').trim().toUpperCase();

  const stationKey = stationId != null && stationId !== '' ? String(stationId) : '';
  const machinesForStation = stationKey
    ? machines.filter((m) => String(m.station_id) === stationKey)
    : machines;

  const goStation = (nextStationId) => {
    // Treat numeric 0 as a valid station id — only null/undefined/'' mean "all".
    const sid = nextStationId != null && nextStationId !== ''
      ? String(nextStationId)
      : '';
    onStationChange?.(sid);
    if (!sid) {
      navigate('/overview/equipment');
      return;
    }
    const inStation = machines.filter((m) => String(m.station_id) === sid);
    const currentOk = machineId != null && machineId !== ''
      && inStation.some((m) => String(m.id) === String(machineId));
    if (currentOk) return;
    const first = inStation[0];
    if (first) navigate(`/overview/equipment/${first.id}`);
    else navigate('/overview/equipment');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={selectWrap}>
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'factory') navigate('/overview/factory');
            else if (next === 'line') {
              const id = lineId || lines[0]?.id;
              navigate(id ? `/overview/line/${encodeURIComponent(id)}` : '/overview/line');
            } else navigate('/overview/equipment');
          }}
          style={selectStyle}
          aria-label="Overview mode"
        >
          <option value="factory">Factory Overview</option>
          <option value="line">Line Overview</option>
          <option value="equipment">Equipment Overview</option>
        </select>
        <Chevron />
      </div>

      {mode === 'factory' && showFactoryName && factoryTitle ? (
        <span style={{
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: accent,
        }}>
          {factoryTitle}
        </span>
      ) : null}

      {mode === 'line' && lines.length > 0 ? (
        <div style={selectWrap}>
          <select
            // Keep select value as string — HTML option values are always strings;
            // a numeric lineId would fail to match and show an unselected control.
            value={
              lineId != null && lineId !== ''
                ? String(lineId)
                : String(lines[0]?.id ?? '')
            }
            onChange={(e) => navigate(`/overview/line/${encodeURIComponent(e.target.value)}`)}
            style={selectStyle}
            aria-label="Select line"
          >
            {lines.map((ln) => (
              <option key={String(ln.id)} value={String(ln.id)}>
                {ln.factory_name ? `${ln.factory_name} / ${ln.name}` : ln.name}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
      ) : null}

      {mode === 'equipment' && stations.length > 0 ? (
        <div style={selectWrap}>
          <select
            value={stationKey}
            onChange={(e) => goStation(e.target.value)}
            style={selectStyle}
            aria-label="Select station"
          >
            <option value="">All stations</option>
            {stations.map((st) => (
              <option key={st.id} value={String(st.id)}>
                {st.name}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
      ) : null}

      {mode === 'equipment' && machines.length > 0 ? (
        <div style={selectWrap}>
          <select
            // Keep select value as string — HTML option values are always strings;
            // a numeric machineId would fail to match and show "All equipment".
            value={machineId != null && machineId !== '' ? String(machineId) : ''}
            onChange={(e) => {
              const id = e.target.value;
              navigate(id ? `/overview/equipment/${id}` : '/overview/equipment');
            }}
            style={selectStyle}
            aria-label="Select equipment"
          >
            <option value="">All equipment</option>
            {machinesForStation.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
      ) : null}
    </div>
  );
}

/** Centered bold CAPS factory title for PageHeader `extra` slot. */
export function FactoryTitleBanner({ name = '', theme }) {
  const t = theme || {};
  const title = String(name || '').trim().toUpperCase();
  if (!title) return null;
  const isDark = t.isDark !== false && t.id !== 'light';
  return (
    <div
      style={{
        width: '100%',
        textAlign: 'center',
        fontSize: 16,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: isDark ? '#ffffff' : '#0f172a',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        padding: '0 8px',
      }}
      title={title}
    >
      {title}
    </div>
  );
}

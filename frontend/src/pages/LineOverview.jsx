import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import PageHeader from '../components/PageHeader';
import OverviewSelector, { FactoryTitleBanner } from '../components/OverviewSelector';
import DonutGauge from '../components/charts/DonutGauge';
import PlannedActualBarChart from '../components/charts/PlannedActualBarChart';
import { useTheme } from '../context/ThemeContext';
import { pageClass, surfaceClass } from '../themes/tileHelpers';
import { statusPalette, STATUS_ROWS } from '../utils/overviewStatus';

export default function LineOverview() {
  const { lineId } = useParams();
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');
  const [focusStation, setFocusStation] = useState(null);

  const load = useCallback(async () => {
    try {
      const lr = await api.get('/api/overview/lines');
      setLines(lr.data?.lines || []);
      const id = lineId || lr.data?.lines?.[0]?.id;
      if (!id) {
        setData(null);
        setErr(lr.data?.lines_hint || 'No lines configured. Add lines in Factory Setup.');
        return;
      }
      if (!lineId && id) {
        navigate(`/overview/line/${encodeURIComponent(id)}`, { replace: true });
        return;
      }
      const r = await api.get(`/api/overview/line/${encodeURIComponent(id)}`);
      setData(r.data);
      setErr('');
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to load line overview');
    }
  }, [lineId, navigate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // New line selection → show all stations' machines by default
    setFocusStation('all');
  }, [lineId]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const rr = data?.running_rate || { pct: 0, running: 0, total: 0 };
  const ar = data?.achievement_rate || { pct: 0, actual: 0, planned: 0 };
  const sc = data?.status_counts || {};
  const stations = data?.stations || [];
  const machines = data?.machines || [];
  const isDark = t?.isDark !== false && t?.id !== 'light';
  const statusColors = statusPalette(isDark);

  const stationBlocks = (() => {
    const perStation = stations.map((st) => {
      const ms = machines.filter((m) => Number(m.station_id) === Number(st.id));
      const running = ms.filter((m) => m.status === 'running').length;
      return {
        id: `station-${st.id}`,
        name: st.name,
        machines: ms,
        total: ms.length,
        running_pct: ms.length ? Math.round((100 * running) / ms.length) : 0,
      };
    });
    const allRunning = machines.filter((m) => m.status === 'running').length;
    const allBlock = {
      id: 'all',
      name: 'All stations',
      machines,
      total: machines.length,
      running_pct: machines.length
        ? Math.round((100 * allRunning) / machines.length)
        : 0,
    };
    return stations.length ? [allBlock, ...perStation] : [allBlock];
  })();

  const stationAchieveBars = useMemo(() => (
    stations.map((st) => {
      const ms = machines.filter((m) => Number(m.station_id) === Number(st.id));
      let planned = 0;
      let actual = 0;
      for (const m of ms) {
        const plan = m.plan || {};
        planned += Number(plan.planned_qty) || 0;
        actual += Number(plan.actual_qty) || 0;
      }
      return {
        id: st.id,
        name: st.name,
        planned,
        actual,
      };
    })
  ), [stations, machines]);

  const focus = stationBlocks.find((b) => b.id === focusStation) || stationBlocks[0];
  const equipmentTitle = focus?.id === 'all'
    ? `Equipment — ${data?.line?.name || 'Line'} (all stations)`
    : `Equipment — ${focus?.name || 'Station'}`;
  const s = styles(t, isDark);
  const factoryName = data?.factory_name || data?.site_label || '';

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader
        title={(
          <OverviewSelector
            mode="line"
            factoryName={factoryName}
            lines={lines.length ? lines : (data?.lines || [])}
            lineId={lineId || data?.line?.id}
            theme={t}
            showFactoryName={false}
          />
        )}
        extra={<FactoryTitleBanner name={factoryName} theme={t} />}
        onRefresh={load}
      />
      {err && <div style={s.alert}>{err}</div>}

      <div style={s.kpiRow}>
        <section className={surfaceClass(t)} style={s.kpiCard}>
          <h3 style={s.cardTitle}>Line Running Rate</h3>
          <div style={s.tileBody}>
            <DonutGauge
              value={rr.pct}
              useHeatMap
              size={220}
              trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
              theme={t}
              label="Running"
              sublabel={`${rr.running} / ${rr.total} machines`}
              metaAlign="left"
              showLegend
            />
          </div>
        </section>
        <section className={surfaceClass(t)} style={s.kpiCard}>
          <h3 style={s.cardTitle}>Plan Achievement</h3>
          <div style={s.tileBody}>
            <DonutGauge
              value={ar.pct}
              useHeatMap
              size={220}
              trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
              theme={t}
              label="Actual"
              sublabel={`${ar.actual} / ${ar.planned} qty`}
              metaAlign="left"
              showLegend
            />
          </div>
        </section>
        <section className={surfaceClass(t)} style={s.kpiCard}>
          <h3 style={s.cardTitle}>Station Achievement</h3>
          <div style={s.tileBody}>
            <PlannedActualBarChart
              items={stationAchieveBars}
              theme={t}
              height="100%"
              trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
              plannedColor="#a855f7"
              actualColor="#22d3ee"
              xLabel="Station"
              yLabel="Qty"
              onBarClick={(item) => setFocusStation(`station-${item.id}`)}
            />
          </div>
        </section>
      </div>

      <section className={surfaceClass(t)} style={{ ...s.card, marginTop: 14, flexShrink: 0 }}>
        <h3 style={s.cardTitle}>Line Machine Status</h3>
        <div style={s.statusRow}>
          {STATUS_ROWS.map(([key, label]) => {
            const palette = statusColors[key] || statusColors.offline;
            return (
              <div
                key={key}
                style={{
                  ...s.statusChip,
                  background: palette.bg,
                  border: `2px solid ${palette.border}`,
                  boxShadow: isDark
                    ? `0 0 18px ${palette.color}33, inset 0 0 12px ${palette.color}18`
                    : '0 1px 4px rgba(15,23,42,0.08)',
                }}
              >
                <span style={{ ...s.statusVal, color: palette.color }}>{sc[key] ?? 0}</span>
                <span style={{ ...s.statusLbl, color: palette.color }}>{label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={surfaceClass(t)} style={s.stationsCard}>
        <h3 style={s.cardTitle}>Stations</h3>
        <div style={s.stationTabs}>
          {stationBlocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setFocusStation(b.id)}
              style={{
                ...s.tab,
                background: focus?.id === b.id ? (t.accent || '#0ea5e9') : (t.surface2 || t.bg),
                color: focus?.id === b.id ? '#fff' : t.text,
                border: `1px solid ${focus?.id === b.id ? (t.accent || '#0ea5e9') : (t.border || 'transparent')}`,
              }}
            >
              {b.name}
              <span style={{ opacity: 0.85, marginLeft: 6 }}>{b.running_pct}%</span>
              <span style={{ opacity: 0.7, marginLeft: 6, fontSize: 12 }}>({b.total})</span>
            </button>
          ))}
        </div>

        <h3 style={{ ...s.cardTitle, paddingTop: 8 }}>
          {equipmentTitle}
        </h3>
        <div style={s.machineGrid}>
          {(focus?.machines || []).map((m) => (
            <button
              key={m.id}
              type="button"
              style={s.machineCard}
              onClick={() => navigate(`/overview/equipment/${m.id}`)}
            >
              {m.image_url ? (
                <div style={s.fleetThumbWrap}>
                  <img src={m.image_url} alt={m.name} style={s.fleetThumb} />
                </div>
              ) : (
                <div style={{ ...s.fleetThumbWrap, ...s.fleetThumbPh }}>⚙</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <strong style={s.fleetName}>{m.name}</strong>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: m.status_color,
                    textTransform: 'uppercase',
                  }}
                >
                  {m.status_label}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>
                {m.station_name}
              </div>
              {m.plan ? (
                <div style={{ fontSize: 12, marginTop: 6, color: t.text }}>
                  {m.plan.model_variant || 'Plan'} · {m.plan.actual_qty}/{m.plan.planned_qty}
                </div>
              ) : (
                <div style={{ fontSize: 12, marginTop: 6, color: t.textDim }}>No active plan</div>
              )}
            </button>
          ))}
          {!focus?.machines?.length && (
            <div style={{ color: t.textDim, fontSize: 13 }}>No machines on this station.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function styles(t, isDark) {
  return {
    // Grow with content so the app shell right scrollbar can reach stations/machines.
    page: {
      padding: 16,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 'calc(100vh - 52px)',
      color: t.text,
    },
    alert: {
      background: '#fef2f2',
      color: '#b91c1c',
      border: '1px solid #fecaca',
      borderRadius: 8,
      padding: '8px 12px',
      marginBottom: 12,
    },
    kpiRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: 14,
      minHeight: 300,
      flexShrink: 0,
    },
    kpiCard: {
      background: isDark ? t.surface : '#ffffff',
      borderRadius: 12,
      border: `1px solid ${isDark ? (t.border || '#334155') : '#cbd5e1'}`,
      boxShadow: isDark
        ? '0 0 0 1px rgba(56,189,248,0.08)'
        : '0 2px 10px rgba(15,23,42,0.08)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 300,
      overflow: 'hidden',
    },
    card: {
      background: isDark ? t.surface : '#ffffff',
      borderRadius: 12,
      padding: 0,
      border: `1px solid ${isDark ? (t.border || '#334155') : '#cbd5e1'}`,
      boxShadow: isDark
        ? '0 0 0 1px rgba(56,189,248,0.08)'
        : '0 2px 10px rgba(15,23,42,0.08)',
    },
    stationsCard: {
      background: isDark ? t.surface : '#ffffff',
      borderRadius: 12,
      padding: 0,
      border: `1px solid ${isDark ? (t.border || '#334155') : '#cbd5e1'}`,
      boxShadow: isDark
        ? '0 0 0 1px rgba(56,189,248,0.08)'
        : '0 2px 10px rgba(15,23,42,0.08)',
      marginTop: 14,
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    },
    cardTitle: {
      margin: 0,
      padding: '12px 14px 8px',
      fontSize: 15,
      fontWeight: 700,
      color: t.text,
      flexShrink: 0,
    },
    tileBody: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      padding: '0 12px 14px',
      boxSizing: 'border-box',
    },
    statusRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      gap: 14,
      padding: '0 14px 16px',
    },
    statusChip: {
      borderRadius: 14,
      padding: '20px 10px',
      textAlign: 'center',
      minHeight: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusVal: { display: 'block', fontSize: 32, fontWeight: 800, lineHeight: 1.1 },
    statusLbl: {
      display: 'block',
      fontSize: 13,
      marginTop: 10,
      fontWeight: 800,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    stationTabs: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      padding: '0 14px 4px',
      flexShrink: 0,
    },
    tab: {
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    },
    machineGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 12,
      padding: '0 14px 16px',
      flex: '0 0 auto',
      alignContent: 'start',
      boxSizing: 'border-box',
    },
    machineCard: {
      textAlign: 'left',
      background: t.surface2 || t.bg,
      borderRadius: 10,
      padding: 12,
      border: `1px solid ${t.border || 'transparent'}`,
      cursor: 'pointer',
      color: t.text,
      minHeight: 0,
      height: 'auto',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
      maxWidth: '100%',
      alignSelf: 'start',
    },
    fleetThumbWrap: {
      width: '100%',
      height: 96,
      maxHeight: 96,
      borderRadius: 8,
      marginBottom: 8,
      background: isDark ? 'rgba(15,23,42,0.55)' : '#f1f5f9',
      border: `1px solid ${t.border || 'transparent'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      boxSizing: 'border-box',
      padding: 6,
      flexShrink: 0,
      position: 'relative',
    },
    fleetThumb: {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: 'center',
      display: 'block',
    },
    fleetThumbPh: {
      fontSize: 28,
      color: t.textDim,
      padding: 0,
    },
    fleetName: {
      fontSize: 18,
      fontWeight: 800,
      letterSpacing: '0.02em',
      lineHeight: 1.15,
    },
  };
}

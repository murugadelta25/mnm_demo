import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import PageHeader from '../components/PageHeader';
import OverviewSelector, { FactoryTitleBanner } from '../components/OverviewSelector';
import FreeformTileBoard from '../components/FreeformTileBoard';
import DonutGauge from '../components/charts/DonutGauge';
import LineUtilizationBarChart from '../components/charts/LineUtilizationBarChart';
import LineAchievementBarChart from '../components/charts/LineAchievementBarChart';
import RunningRateTrendChart from '../components/charts/RunningRateTrendChart';
import { useTheme } from '../context/ThemeContext';
import { pageClass, surfaceClass } from '../themes/tileHelpers';
import { seriesColor } from '../utils/heatMap';
import { statusPalette, STATUS_ROWS } from '../utils/overviewStatus';

export default function FactoryOverview() {
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [err, setErr] = useState('');
  const resetTilesRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [r, tr] = await Promise.all([
        api.get('/api/overview/factory'),
        api.get('/api/overview/factory/running-rate-trend'),
      ]);
      setData(r.data);
      setTrendData(tr.data);
      setErr('');
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to load factory overview');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const lines = data?.lines || [];
  const lineBars = useMemo(
    () => lines.map((ln, idx) => ({
      name: ln.name,
      pct: ln.running_pct ?? 0,
      running: ln.running ?? 0,
      total: ln.total ?? 0,
      id: ln.id,
      color: seriesColor(idx),
    })),
    [lines],
  );
  const achieveBars = useMemo(
    () => lines.map((ln) => {
      const pct = Number(ln.achievement_pct ?? 0) || 0;
      return {
        name: ln.name,
        pct,
        actual: Number(ln.achievement_actual ?? 0) || 0,
        planned: Number(ln.achievement_planned ?? 0) || 0,
        id: ln.id,
      };
    }),
    [lines],
  );

  const s = styles(t);
  const isDark = t?.isDark !== false && t?.id !== 'light';
  const statusColors = statusPalette(isDark);
  const ar = data?.achievement_rate || { pct: 0, actual: 0, planned: 0 };
  const sc = data?.status_counts || {};
  const util = data?.utilization || {};

  const utilLines = useMemo(() => {
    if (util.by_line?.length) return util.by_line;
    return lines.map((ln) => ({
      id: ln.id,
      name: ln.name,
      uptime_min: ln.uptime_min,
      downtime_min: ln.downtime_min,
      mttr_min: ln.mttr_min,
      mtbf_min: ln.mtbf_min,
    }));
  }, [util.by_line, lines]);

  const cardShell = {
    background: isDark ? t.surface : '#ffffff',
    border: `1px solid ${isDark ? (t.border || '#334155') : '#cbd5e1'}`,
    borderRadius: 12,
    boxShadow: isDark
      ? '0 0 0 1px rgba(56,189,248,0.08)'
      : '0 2px 10px rgba(15,23,42,0.08), 0 0 0 1px rgba(15,23,42,0.04)',
  };

  const tiles = [
    {
      id: 'planAchieve',
      style: cardShell,
      header: <h3 style={s.cardTitle}>Plan Achievement (today)</h3>,
      body: (
        <div style={s.tileBodyRow}>
          <div style={s.tileBodyFlex}>
            <DonutGauge
              key={`ar-${ar.pct}-${ar.planned}`}
              value={Math.round(Number(ar.pct) || 0)}
              useHeatMap
              size={200}
              trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
              theme={t}
              label="Actual"
              showLegend
            />
          </div>
          <div style={s.equipStats}>
            <div style={s.equipStat}>
              <div style={s.equipStatLabel}>Actual Produced Qty</div>
              <div style={s.equipStatValue}>{Math.round(Number(ar.actual) || 0)}</div>
              <div style={s.equipStatUnit}>units</div>
            </div>
            <div style={s.equipStatDivider} />
            <div style={s.equipStat}>
              <div style={s.equipStatLabel}>Total Planned Quantity</div>
              <div style={s.equipStatValue}>{Math.round(Number(ar.planned) || 0)}</div>
              <div style={s.equipStatUnit}>units</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'runningByLine',
      style: cardShell,
      header: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 4px' }}>
          <h3 style={{ ...s.cardTitle, padding: 0 }}>Hourly Running Rate by Line</h3>
          {trendData?.shift_name && (
            <span style={{ fontSize: 11, fontWeight: 700, color: t.textDim }}>
              {trendData.shift_name} · {trendData.shift_start}–{trendData.shift_end}
            </span>
          )}
        </div>
      ),
      body: (
        <div style={s.tileBody}>
          <RunningRateTrendChart
            data={trendData}
            theme={t}
            onLineClick={(ln) => navigate(`/overview/line/${encodeURIComponent(ln.id)}`)}
          />
        </div>
      ),
    },
    {
      id: 'achieveByLine',
      style: cardShell,
      header: <h3 style={s.cardTitle}>Achievement by Line</h3>,
      body: (
        <div style={s.tileBody}>
          <LineAchievementBarChart
            items={achieveBars}
            theme={t}
            height="100%"
            trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
            yLabel="Qty / %"
            xLabel="Line"
            onBarClick={(item) => navigate(`/overview/line/${encodeURIComponent(item.id)}`)}
          />
        </div>
      ),
    },
    {
      id: 'overallUtil',
      style: cardShell,
      header: (
        <div style={s.utilHeader}>
          <h3 style={s.utilTitle}>Overall Utilization</h3>
          <span style={s.shiftBadge}>
            {util.shift_name || '—'}
          </span>
        </div>
      ),
      body: (
        <div style={s.tileBody}>
          <LineUtilizationBarChart
            items={utilLines}
            theme={t}
            height="100%"
            trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
            yLabel="Minutes"
            xLabel="Line"
            onBarClick={(item) => navigate(`/overview/line/${encodeURIComponent(item.id)}`)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className={pageClass(t)} style={s.page}>
      <div style={s.headerSlot}>
        <PageHeader
          compact
          title={(
            <OverviewSelector
              mode="factory"
              factoryName={data?.factory_name || data?.site_label || ''}
              lines={lines}
              theme={t}
              showFactoryName={false}
            />
          )}
          extra={(
            <FactoryTitleBanner
              name={data?.factory_name || data?.site_label || ''}
              theme={t}
            />
          )}
          onRefresh={load}
        />
      </div>
      {err && <div style={s.alert}>{err}</div>}
      {data?.lines_hint && !lines.length && <div style={s.hint}>{data.lines_hint}</div>}

      <FreeformTileBoard
        tiles={tiles}
        theme={t}
        fillHeight={false}
        minBoardHeight={480}
        resetRef={resetTilesRef}
      />

      <section className={surfaceClass(t)} style={{ ...s.card, ...s.statusCard }}>
        <div style={s.sectionHead}>
          <h3 style={s.sectionTitle}>Overall Machine Status</h3>
          <div style={s.resetInline}>
            <span style={s.dragHint}>Drag title · resize corner</span>
            <button
              type="button"
              onClick={() => resetTilesRef.current?.()}
              style={s.resetBtn}
              title="Restore standard KPI tile layout"
            >
              Reset tiles
            </button>
          </div>
        </div>
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
                    ? `0 0 12px ${palette.color}33, inset 0 0 8px ${palette.color}18`
                    : '0 1px 3px rgba(15,23,42,0.08)',
                }}
              >
                <span style={{ ...s.statusVal, color: palette.color }}>{sc[key] ?? 0}</span>
                <span style={{ ...s.statusLbl, color: palette.color }}>{label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={surfaceClass(t)} style={{ ...s.card, ...s.linesCard }}>
        <h3 style={s.sectionTitle}>Lines</h3>
        <div style={s.lineGrid}>
          {lines.map((ln, idx) => (
            <button
              key={ln.id}
              type="button"
              style={{ ...s.lineTile, borderColor: seriesColor(idx) }}
              onClick={() => navigate(`/overview/line/${encodeURIComponent(ln.id)}`)}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{ln.name}</div>
              <div style={{
                marginTop: 4,
                fontSize: 18,
                fontWeight: 800,
                color: seriesColor(idx),
              }}>
                {ln.running_pct}%
              </div>
              <div style={{ fontSize: 11, color: t.textDim }}>
                {ln.running}/{ln.total} running
              </div>
            </button>
          ))}
          {!lines.length && (
            <div style={{ color: t.textDim, fontSize: 13 }}>No lines configured.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function styles(t) {
  const isLight = t.id === 'light';
  return {
    // Document flow (like Planning) so .titan-page-outlet shows a right scrollbar
    // when content is taller than the viewport.
    page: {
      padding: '8px 12px 16px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minHeight: 'calc(100vh - 52px)',
      color: t.text,
    },
    headerSlot: {
      flexShrink: 0,
    },
    alert: {
      background: '#fef2f2',
      color: '#b91c1c',
      border: '1px solid #fecaca',
      borderRadius: 8,
      padding: '6px 10px',
      fontSize: 13,
      flexShrink: 0,
    },
    hint: {
      background: t.surface2 || '#f1f5f9',
      color: t.textDim || '#64748b',
      borderRadius: 8,
      padding: '8px 10px',
      fontSize: 13,
      flexShrink: 0,
    },
    card: {
      background: isLight ? '#ffffff' : t.surface,
      borderRadius: 10,
      padding: '8px 12px 10px',
      border: `1px solid ${isLight ? '#cbd5e1' : (t.border || 'transparent')}`,
      minWidth: 0,
      flexShrink: 0,
      boxShadow: isLight ? '0 1px 6px rgba(15,23,42,0.06)' : undefined,
    },
    statusCard: {
      padding: '8px 12px 10px',
    },
    linesCard: {
      padding: '8px 12px 10px',
    },
    sectionHead: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    sectionTitle: {
      margin: 0,
      fontSize: 14,
      fontWeight: 700,
      color: t.text,
    },
    cardTitle: {
      margin: 0,
      padding: '8px 10px 4px',
      fontSize: 13,
      fontWeight: 700,
      color: t.text,
      flexShrink: 0,
    },
    titleRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '8px 10px 4px',
      flexWrap: 'wrap',
    },
    utilHeader: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
      padding: '8px 10px 4px',
    },
    utilTitle: {
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      margin: 0,
      fontSize: 13,
      fontWeight: 700,
      color: t.text,
      whiteSpace: 'nowrap',
    },
    tileBody: {
      flex: 1,
      minHeight: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '0 8px 8px',
      boxSizing: 'border-box',
    },
    tileBodyRow: {
      flex: 1,
      minHeight: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
      padding: '0 8px 8px',
      boxSizing: 'border-box',
    },
    tileBodyFlex: {
      flex: 1.15,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    },
    equipStats: {
      flex: '0 0 138px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 10,
      padding: '8px 6px',
      borderLeft: `1px solid ${isLight ? '#e2e8f0' : (t.border || '#334155')}`,
    },
    equipStat: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    },
    equipStatLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: t.textDim || '#94a3b8',
      lineHeight: 1.25,
    },
    equipStatValue: {
      fontSize: 28,
      fontWeight: 800,
      color: t.text,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1.1,
    },
    equipStatUnit: {
      fontSize: 12,
      fontWeight: 600,
      color: t.textDim || '#94a3b8',
    },
    equipStatDivider: {
      height: 1,
      background: isLight ? '#e2e8f0' : (t.border || '#334155'),
      margin: '2px 0',
    },
    shiftBadge: {
      fontSize: 11,
      fontWeight: 700,
      color: t.textDim || '#94a3b8',
      padding: '2px 8px',
      borderRadius: 999,
      border: `1px solid ${isLight ? '#cbd5e1' : (t.border || '#334155')}`,
      background: isLight ? '#f8fafc' : (t.surface2 || t.bg),
    },
    statusRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
      gap: 8,
    },
    statusChip: {
      borderRadius: 10,
      padding: '10px 6px',
      textAlign: 'center',
      minHeight: 64,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusVal: { display: 'block', fontSize: 22, fontWeight: 800, lineHeight: 1.1 },
    statusLbl: {
      display: 'block',
      fontSize: 11,
      marginTop: 4,
      fontWeight: 800,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    lineGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 8,
    },
    lineTile: {
      textAlign: 'left',
      background: isLight ? '#f8fafc' : (t.surface2 || t.bg),
      borderRadius: 8,
      padding: '8px 10px',
      border: '2px solid',
      cursor: 'pointer',
      color: t.text,
      boxShadow: isLight ? '0 1px 3px rgba(15,23,42,0.06)' : undefined,
    },
    resetInline: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    },
    dragHint: {
      fontSize: 11,
      fontWeight: 600,
      color: t.textDim || '#64748b',
    },
    resetBtn: {
      fontSize: 12,
      fontWeight: 700,
      padding: '6px 12px',
      borderRadius: 7,
      border: `1px solid ${isLight ? '#94a3b8' : (t.border || '#334155')}`,
      background: isLight ? '#ffffff' : (t.surface2 || t.surface),
      color: t.text,
      cursor: 'pointer',
    },
  };
}

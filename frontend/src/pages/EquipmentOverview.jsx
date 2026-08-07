import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import PageHeader from '../components/PageHeader';
import OverviewSelector, { FactoryTitleBanner } from '../components/OverviewSelector';
import DonutGauge from '../components/charts/DonutGauge';
import { useTheme } from '../context/ThemeContext';
import { pageClass, surfaceClass } from '../themes/tileHelpers';
import { statusPalette, STATUS_ROWS } from '../utils/overviewStatus';

const AR_COLOR = '#4fc3f7';
const PR_COLOR = '#fb7185';
const QR_COLOR = '#34d399';
const HEART_CSS = `@keyframes liveHeartbeat{0%,100%{transform:scale(1)}25%{transform:scale(1.25)}40%{transform:scale(1)}55%{transform:scale(1.15)}70%{transform:scale(1)}}`;

function fmtSec(sec) {
  const n = Math.max(0, Number(sec) || 0);
  if (n < 60) return `${n.toFixed(n % 1 ? 1 : 0)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}m ${s}s`;
}

// Renders a value as two stacked lines: "355s" on top, "5m 55s" below
function CtValue({ sec, color, fontSize = 15 }) {
  const n = Math.max(0, Number(sec) || 0);
  const secs = `${n.toFixed(n % 1 ? 1 : 0)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  const mins = m > 0 ? `${m}m ${s}s` : null;
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div style={{ fontWeight: 800, color, fontSize }}>{secs}</div>
      {mins && <div style={{ fontWeight: 600, color, fontSize: fontSize - 2, opacity: 0.75 }}>{mins}</div>}
    </div>
  );
}

function pctColor(v) {
  const n = Number(v) || 0;
  if (n >= 85) return '#10b981';
  if (n >= 60) return '#f59e0b';
  return '#ef4444';
}

export default function EquipmentOverview() {
  const { machineId } = useParams();
  const { theme: t } = useTheme();
  const navigate = useNavigate();
  const [listData, setListData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stationFilter, setStationFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.get('/api/overview/equipment');
      setListData(list.data);
      if (machineId) {
        const d = await api.get(`/api/overview/equipment/${machineId}`);
        setDetail(d.data);
      } else {
        setDetail(null);
      }
      setErr('');
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Failed to load equipment overview');
    }
  }, [machineId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const machines = listData?.machines || [];

  const stations = useMemo(() => {
    const map = new Map();
    for (const m of machines) {
      if (m.station_id == null) continue;
      const key = String(m.station_id);
      if (map.has(key)) continue;
      map.set(key, {
        id: m.station_id,
        name: m.station_name || `Station ${m.station_id}`,
      });
    }
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [machines]);

  // Selecting a machine auto-picks its station; list view keeps stationFilter
  const activeStationId = useMemo(() => {
    if (machineId) {
      const m = machines.find((x) => String(x.id) === String(machineId));
      if (m?.station_id != null) return String(m.station_id);
      const fromDetail = detail?.machine?.station_id;
      if (fromDetail != null) return String(fromDetail);
    }
    return stationFilter;
  }, [machineId, machines, detail, stationFilter]);

  useEffect(() => {
    if (!machineId) return;
    const m = machines.find((x) => String(x.id) === String(machineId));
    if (m?.station_id != null) setStationFilter(String(m.station_id));
  }, [machineId, machines]);

  const filtered = useMemo(() => {
    let list = machines;
    if (activeStationId) {
      list = list.filter((m) => String(m.station_id) === String(activeStationId));
    }
    if (statusFilter !== 'all') {
      list = list.filter((m) => m.status === statusFilter);
    }
    return list;
  }, [machines, statusFilter, activeStationId]);

  const rr = listData?.running_rate || { pct: 0, running: 0, total: 0 };
  const sc = listData?.status_counts || {};
  const isDark = t?.isDark !== false && t?.id !== 'light';
  const statusColors = statusPalette(isDark);
  const s = styles(t, isDark);
  const info = detail?.equipment_info;
  const plan = detail?.plan || {};
  const live = detail?.live_cycle || {};
  const kpiPanel = detail?.kpi_panel;
  const k = kpiPanel?.kpi || {};
  const factoryName = listData?.factory_name || listData?.site_label || detail?.factory_name || '';

  // Use ?? so a legitimate 0 from the backend is kept (|| would fall through).
  const setCt = Number(plan.cycle_time_sec ?? kpiPanel?.cycle_time_sec ?? 0);
  const setMach = Number(plan.process_time_sec ?? kpiPanel?.process_time_sec ?? 0);
  const setLoad = Number(plan.loading_unloading_sec ?? kpiPanel?.loading_unloading_sec ?? 0);
  const liveMach = Number(live.machining_live_sec ?? 0);
  const liveLoad = Number(live.loading_live_sec ?? 0);
  const liveCycle = Number(live.live_cycle_sec ?? (liveMach + liveLoad));
  const idleBeyondLu = Boolean(live.idle_beyond_lu);
  const avgMach = Number(live.avg_machining_sec ?? 0);
  const avgLoad = Number(live.avg_loading_sec ?? 0);
  const avgCycle = Number(live.avg_cycle_sec ?? 0);
  const shiftMachMin = Number(kpiPanel?.machining_time_min ?? 0);
  const shiftLoadMin = Number(kpiPanel?.loading_unloading_time_min ?? 0);

  return (
    <div className={pageClass(t)} style={s.page}>
      <style>{HEART_CSS}</style>
      <PageHeader
        compact
        title={(
          <OverviewSelector
            mode="equipment"
            factoryName={factoryName}
            machines={machines}
            machineId={machineId || ''}
            stations={stations}
            stationId={activeStationId}
            onStationChange={setStationFilter}
            theme={t}
            showFactoryName={false}
          />
        )}
        extra={<FactoryTitleBanner name={factoryName} theme={t} />}
        onRefresh={load}
      />
      {err && <div style={s.alert}>{err}</div>}

      {machineId && detail ? (
        <div style={s.detailLayout}>
          <div style={s.detailTop}>
            {/* Tile 1 — Machine card */}
            <section className={surfaceClass(t)} style={{ ...s.card, ...s.machineDetailCard }}>
              <div style={s.machineHead}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.machineName}>{info?.name || 'Equipment'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    <span
                      style={{
                        ...s.badge,
                        background: `${info?.status_color || '#6b7280'}22`,
                        color: info?.status_color || t.text,
                        border: `1px solid ${info?.status_color || t.border}`,
                      }}
                    >
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: info?.status_color || '#6b7280',
                        display: 'inline-block',
                        boxShadow: `0 0 6px ${info?.status_color || '#6b7280'}`,
                      }}
                      />
                      {(info?.status || '—').toUpperCase()}
                      <span
                        style={{
                          color: info?.status_color || '#6b7280',
                          fontSize: 14,
                          animation: 'liveHeartbeat 1.2s ease-in-out infinite',
                          filter: `drop-shadow(0 0 5px ${info?.status_color || '#6b7280'})`,
                          lineHeight: 1,
                        }}
                        aria-hidden
                      >
                        ❤
                      </span>
                    </span>
                    {detail.line ? (
                      <button
                        type="button"
                        style={s.linkBtn}
                        onClick={() => navigate(`/overview/line/${encodeURIComponent(detail.line.id)}`)}
                      >
                        Line: {detail.line.name}
                      </button>
                    ) : null}
                  </div>
                  {(info?.operator_name || info?.operator_code) ? (
                    <div style={{ fontSize: 13, color: t.accent || '#38bdf8', fontWeight: 600, marginTop: 8 }}>
                      Operator: {info.operator_name || info.operator_code}
                      {info.operator_code && info.operator_name && info.operator_code !== info.operator_name
                        ? ` (${info.operator_code})`
                        : ''}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: t.textDim, marginTop: 8, fontStyle: 'italic' }}>
                      No operator assigned
                    </div>
                  )}
                </div>
              </div>
              <div style={s.dl}>
                {[
                  ['Station', info?.station],
                  ['Type', info?.type],
                  ['Make', info?.make],
                  ['Model', info?.model],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={s.dlLabel}>{label}</div>
                    <div style={s.dlValue}>{value || '—'}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 14px 10px' }}>
                <div style={s.dlLabel}>Location</div>
                <div style={s.dlValue}>{info?.location || '—'}</div>
              </div>
              <div style={s.machineHeroWrap}>
                {info?.image_url ? (
                  <img
                    src={info.image_url}
                    alt={info?.name || 'Machine'}
                    style={{
                      ...s.machineHeroImg,
                      borderColor: info?.status_color || t.border,
                    }}
                  />
                ) : (
                  <div style={{
                    ...s.machineHeroImg,
                    ...s.machineImgPlaceholder,
                    borderColor: info?.status_color || t.border,
                  }}
                  >
                    ⚙
                  </div>
                )}
              </div>
            </section>

            {/* Tile 2 — Today's Plan + CT */}
            <section className={surfaceClass(t)} style={s.card}>
              <h3 style={s.cardTitle}>Today&apos;s Plan</h3>
              <div style={{ padding: '0 14px 14px', overflow: 'auto', flex: 1, minHeight: 0 }}>
                {plan?.model_variant || plan?.planned_qty != null ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{plan.model_variant || '—'}</div>
                    <div style={{ color: t.textDim, fontSize: 13 }}>
                      Status: {plan.status || '—'}
                      {plan.shift ? ` · Shift ${plan.shift}` : ''}
                      {kpiPanel?.shift_name && !plan.shift ? ` · ${kpiPanel.shift_name}` : ''}
                    </div>
                    <div style={s.qtyPair}>
                      <div style={s.qtyBlock}>
                        <div style={s.qtyLabel}>Actual Qty</div>
                        <div style={s.qtyValue}>{Math.round(Number(plan.actual_qty) || 0)}</div>
                      </div>
                      <div style={s.qtyDivider}>/</div>
                      <div style={s.qtyBlock}>
                        <div style={s.qtyLabel}>Planned Qty</div>
                        <div style={{ ...s.qtyValue, color: t.accent || '#38bdf8' }}>
                          {Math.round(Number(plan.planned_qty) || 0)}
                        </div>
                      </div>
                    </div>
                    <div style={s.progressTrack}>
                      <div
                        style={{
                          ...s.progressFill,
                          width: `${plan.planned_qty
                            ? Math.min(100, Math.round((100 * (plan.actual_qty || 0)) / plan.planned_qty))
                            : 0}%`,
                        }}
                      />
                    </div>

                    <div style={s.ctBox}>
                      <div style={{ ...s.dlLabel, marginBottom: 8 }}>Set Cycle Time (CT)</div>
                      <div style={s.ctTriple}>
                        <div>
                          <div style={s.dlLabel}>Machining / Op time</div>
                          {setMach > 0 ? <CtValue sec={setMach} color="#34d399" /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                        <div>
                          <div style={s.dlLabel}>Loading &amp; Unloading</div>
                          {setLoad > 0 ? <CtValue sec={setLoad} color="#fbbf24" /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                        <div style={s.ctCorner}>
                          <div style={s.dlLabel}>CT</div>
                          {setCt > 0 ? <CtValue sec={setCt} color={isDark ? '#ffffff' : '#0f172a'} fontSize={16} /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                      </div>
                    </div>

                    <div style={s.ctBox}>
                      <div style={{ ...s.dlLabel, marginBottom: 6 }}>Live cycle breakup</div>
                      <div style={s.ctTriple}>
                        <div>
                          <div style={s.dlLabel}>Machining (live)</div>
                          <CtValue sec={liveMach} color="#34d399" fontSize={15} />
                          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
                            Shift total: {shiftMachMin} min
                          </div>
                        </div>
                        <div>
                          <div style={s.dlLabel}>Loading / Unloading (live)</div>
                          <CtValue sec={liveLoad} color={idleBeyondLu ? t.textDim : '#fbbf24'} fontSize={15} />
                          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
                            {idleBeyondLu
                              ? `Idle beyond L&U threshold (${fmtSec(live.ld_unld_threshold_sec || setLoad)})`
                              : `Shift total: ${shiftLoadMin} min`}
                          </div>
                        </div>
                        <div style={s.ctCorner}>
                          <div style={s.dlLabel}>CT</div>
                          <CtValue sec={liveCycle} color={isDark ? '#ffffff' : '#0f172a'} fontSize={16} />
                        </div>
                      </div>
                    </div>

                    <div style={s.ctBox}>
                      <div style={{ ...s.dlLabel, marginBottom: 6 }}>Avg cycle time breakup</div>
                      <div style={s.ctTriple}>
                        <div>
                          <div style={s.dlLabel}>Avg machining</div>
                          {avgMach > 0 ? <CtValue sec={avgMach} color="#34d399" fontSize={15} /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                        <div>
                          <div style={s.dlLabel}>Avg loading / unloading</div>
                          {avgLoad > 0 ? <CtValue sec={avgLoad} color="#fbbf24" fontSize={15} /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                        <div style={s.ctCorner}>
                          <div style={s.dlLabel}>CT</div>
                          {avgCycle > 0 ? <CtValue sec={avgCycle} color={isDark ? '#ffffff' : '#0f172a'} fontSize={16} /> : <span style={{ color: t.textDim }}>—</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: t.textDim }}>No running / paused / pending plan today.</div>
                )}
              </div>
            </section>

            {/* Tile 3 — OEE dashboard (fills empty space) */}
            <section className={surfaceClass(t)} style={{ ...s.card, ...s.oeeCard }}>
              <h3 style={s.cardTitle}>Overall Equipment Effectiveness</h3>
              {!kpiPanel ? (
                <div style={{ padding: 24, color: t.textDim, textAlign: 'center' }}>
                  KPI data unavailable for this shift.
                </div>
              ) : (
                <div style={s.oeeBody}>
                  <div style={{ textAlign: 'center', padding: '4px 12px 12px' }}>
                    <div style={{
                      fontSize: 44,
                      fontWeight: 800,
                      color: pctColor(k.oee),
                      lineHeight: 1.1,
                    }}>
                      {Math.round(Number(k.oee) || 0)}%
                    </div>
                    {kpiPanel.entry_date ? (
                      <div style={{ fontSize: 11, color: t.textDim, marginTop: 6 }}>
                        {kpiPanel.entry_date}
                        {kpiPanel.shift_name
                          ? ` · ${kpiPanel.shift_name} (${kpiPanel.shift_start} – ${kpiPanel.shift_end})`
                          : ''}
                      </div>
                    ) : null}
                  </div>

                  <div style={s.kpiGrid}>
                    {[
                      { label: 'Availability Rate', value: k.ar, color: AR_COLOR, icon: '⏱' },
                      { label: 'Performance Rate', value: k.pr, color: PR_COLOR, icon: '⚡' },
                      { label: 'Quality Rate', value: k.qr, color: QR_COLOR, icon: '✅' },
                      { label: 'Machine Utilization', value: k.machine_utilization, color: '#818cf8', icon: '⚙' },
                      { label: 'Production Yield', value: k.production_yield, color: '#34d399', icon: '📈' },
                      { label: 'TEEP', value: k.teep, color: '#fb923c', icon: '🏭' },
                    ].map((item) => (
                      <div key={item.label} style={s.kpiCell}>
                        <div style={{ fontSize: 16 }}>{item.icon}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>
                          {Math.round(Math.min(100, Number(item.value) || 0))}%
                        </div>
                        <div style={{ fontSize: 10, color: t.textDim }}>{item.label}</div>
                      </div>
                    ))}
                  </div>

                  <table style={s.statsTable}>
                    <tbody>
                      {[
                        ['Available Time', `${kpiPanel.available_time_min ?? 0} min`],
                        ['Uptime (Running)', `${kpiPanel.uptime_min ?? kpiPanel.machining_time_min ?? 0} min`],
                        ['Operating Time', `${kpiPanel.operating_time_min ?? 0} min`],
                        ['Downtime', `${kpiPanel.downtime_min ?? 0} min`],
                        ['MTTR', kpiPanel.mttr_min != null ? `${kpiPanel.mttr_min} min` : '—'],
                        ['MTBF', kpiPanel.mtbf_min != null ? `${kpiPanel.mtbf_min} min` : '—'],
                        ['Actual Production Time', `${kpiPanel.actual_production_time_min ?? 0} min`],
                        ['Planned Qty', kpiPanel.planned_qty ?? plan.planned_qty ?? 0],
                        ['Expected Qty', kpiPanel.expected_qty ?? 0],
                        ['Actual Qty', kpiPanel.actual_qty ?? plan.actual_qty ?? 0],
                        ['Good Qty', kpiPanel.good_qty ?? 0],
                        ['Defect Qty', kpiPanel.defect_qty ?? 0],
                        ['Theoretical Qty', kpiPanel.theoretical_qty ?? 0],
                      ].map(([lbl, val]) => (
                        <tr key={lbl}>
                          <td style={s.statsLbl}>{lbl}</td>
                          <td style={s.statsVal}>{val}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {detail.hourly_output?.slots?.length ? (
            <section className={surfaceClass(t)} style={{ ...s.card, ...s.hourlyCard }}>
              <h3 style={s.cardTitle}>
                Hourly Output
                {detail.hourly_output.shift_name
                  ? ` · ${detail.hourly_output.shift_name}`
                  : detail.hourly_output.shift
                    ? ` · Shift ${detail.hourly_output.shift}`
                    : ''}
                {detail.hourly_output.shift_start && detail.hourly_output.shift_end
                  ? ` (${detail.hourly_output.shift_start} – ${detail.hourly_output.shift_end})`
                  : ''}
              </h3>
              <div style={{ padding: '0 12px 14px', overflowX: 'auto', flex: 1, minHeight: 0 }}>
                <EquipmentHourlyTable
                  slots={detail.hourly_output.slots}
                  states={detail.hourly_output.states || {}}
                  shiftTotals={detail.hourly_output.shift_totals || {}}
                  theme={t}
                  isDark={isDark}
                />
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          <div style={s.kpiRow}>
            <section className={surfaceClass(t)} style={s.kpiCard}>
              <h3 style={s.cardTitle}>Equipment Running Rate</h3>
              <div style={s.runningRateBody}>
                <div style={s.runningRateGauge}>
                  <DonutGauge
                    key={`rr-${rr.pct}-${rr.total}`}
                    value={rr.pct}
                    useHeatMap
                    size={240}
                    trackColor={isDark ? (t.surface2 || '#1e293b') : '#e2e8f0'}
                    theme={t}
                    label="Running"
                    showLegend
                  />
                </div>
                <div style={s.equipStats}>
                  <div style={s.equipStat}>
                    <div style={s.equipStatLabel}>Running Equipment</div>
                    <div style={s.equipStatValue}>{rr.running}</div>
                    <div style={s.equipStatUnit}>units</div>
                  </div>
                  <div style={s.equipStatDivider} />
                  <div style={s.equipStat}>
                    <div style={s.equipStatLabel}>Total Equipment Quantity</div>
                    <div style={s.equipStatValue}>{rr.total}</div>
                    <div style={s.equipStatUnit}>units</div>
                  </div>
                </div>
              </div>
            </section>

            <section className={surfaceClass(t)} style={{ ...s.kpiCard, minHeight: 360 }}>
              <h3 style={s.cardTitle}>Machine Status</h3>
              <div style={s.statusFilterWrap}>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  style={{
                    ...s.filterAll,
                    background: statusFilter === 'all' ? (t.accent || '#0ea5e9') : (t.surface2 || t.bg),
                    color: statusFilter === 'all' ? '#fff' : t.text,
                    border: `1px solid ${statusFilter === 'all' ? (t.accent || '#0ea5e9') : (t.border || 'transparent')}`,
                  }}
                >
                  All · {sc.total ?? machines.length}
                </button>
                <div style={s.statusRow}>
                  {STATUS_ROWS.map(([key, label]) => {
                    const palette = statusColors[key] || statusColors.offline;
                    const active = statusFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStatusFilter(key)}
                        style={{
                          ...s.statusChip,
                          background: palette.bg,
                          border: `2px solid ${active ? palette.color : palette.border}`,
                          boxShadow: isDark
                            ? `0 0 18px ${palette.color}33, inset 0 0 12px ${palette.color}18`
                            : '0 1px 4px rgba(15,23,42,0.08)',
                          outline: active ? `2px solid ${palette.color}` : 'none',
                          outlineOffset: 2,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ ...s.statusVal, color: palette.color }}>{sc[key] ?? 0}</span>
                        <span style={{ ...s.statusLbl, color: palette.color }}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>

          <section
            className={surfaceClass(t)}
            style={{
              ...s.card,
              marginTop: 14,
              flex: '0 0 auto',
              minHeight: 280,
            }}
          >
            <h3 style={s.cardTitle}>
              Equipment ({filtered.length}
              {statusFilter !== 'all' ? ` · ${STATUS_ROWS.find(([k]) => k === statusFilter)?.[1] || statusFilter}` : ''})
            </h3>
            <div style={s.machineGrid}>
              {filtered.map((m) => (
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
                    <span style={{ fontSize: 11, fontWeight: 700, color: m.status_color }}>
                      {m.status_label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>
                    {[m.line_name, m.station_name].filter(Boolean).join(' · ') || 'Unassigned'}
                  </div>
                  {m.plan ? (
                    <div style={s.planMeta}>
                      <div>
                        <span style={s.planMetaLabel}>Part:</span>{' '}
                        {m.plan.model_variant || '—'}
                      </div>
                      <div>
                        <span style={s.planMetaLabel}>Planned Qty:</span>{' '}
                        {Math.round(Number(m.plan.planned_qty) || 0)}
                      </div>
                      <div>
                        <span style={s.planMetaLabel}>Actual Qty:</span>{' '}
                        {Math.round(Number(m.plan.actual_qty) || 0)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, marginTop: 6, color: t.textDim }}>No active plan</div>
                  )}
                  <div style={s.oeeRow}>
                    <span style={s.planMetaLabel}>OEE:</span>
                    <span style={{
                      fontWeight: 800,
                      color: m.oee == null ? t.textDim : pctColor(m.oee),
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {m.oee == null ? '—' : `${Math.round(Number(m.oee) || 0)}%`}
                    </span>
                  </div>
                </button>
              ))}
              {!filtered.length && (
                <div style={{ color: t.textDim, fontSize: 13, gridColumn: '1 / -1' }}>
                  No equipment matches this filter.
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function incrementalHourly(cumulative = []) {
  return cumulative.map((v, i) => (i === 0 ? v : Math.max(0, v - (cumulative[i - 1] || 0))));
}

function slotHeaderLabel(label, slotCount) {
  if (!label) return '';
  const short = String(label).replace(':00-', '-').replace(':00', '');
  if (slotCount > 10 && short.length > 5) return short.slice(0, 5);
  return short;
}

const HOURLY_ROWS = [
  { key: 'running', label: 'Running', pct: false },
  { key: 'expected', label: 'Exp Output', pct: false },
  { key: 'ar', label: 'AR%', pct: true },
  { key: 'pr', label: 'PR%', pct: true },
  { key: 'qr', label: 'QR%', pct: true },
  { key: 'oee', label: 'OEE%', pct: true },
];

function EquipmentHourlyTable({ slots = [], states = {}, shiftTotals = {}, theme: t, isDark }) {
  const runningInc = incrementalHourly(states.running || []);
  const expected = states.expected || [];
  const cellPad = slots.length > 10 ? '4px 2px' : '6px 4px';
  const headerFont = slots.length > 10 ? 10 : 11;

  const rowColors = {
    running: { bg: isDark ? '#052e1622' : '#dcfce7', fg: isDark ? '#4ade80' : '#15803d', border: isDark ? '#166534' : '#86efac' },
    expected: { bg: isDark ? '#312e8122' : '#ede9fe', fg: isDark ? '#a78bfa' : '#6d28d9', border: isDark ? '#5b21b6' : '#c4b5fd' },
    ar: { bg: isDark ? '#0c4a6e44' : '#dbeafe', fg: isDark ? '#7dd3fc' : '#1d4ed8', border: isDark ? '#0ea5e9' : '#60a5fa' },
    pr: { bg: isDark ? '#43140744' : '#ffedd5', fg: isDark ? '#fdba74' : '#b45309', border: isDark ? '#f59e0b' : '#f97316' },
    qr: { bg: isDark ? '#450a0a44' : '#fee2e2', fg: isDark ? '#fca5a5' : '#b91c1c', border: isDark ? '#ef4444' : '#f87171' },
    oee: { bg: isDark ? '#1e1b4b44' : '#e0e7ff', fg: isDark ? '#a5b4fc' : '#3730a3', border: isDark ? '#6366f1' : '#818cf8' },
  };

  const valuesFor = (key) => {
    if (key === 'running') return runningInc;
    if (key === 'expected') return expected;
    return states[key] || [];
  };

  const formatCell = (val, isPct) => {
    if (val == null) return 0;
    const n = Number(val) || 0;
    if (isPct) return Math.round(n);
    return Math.round(n);
  };

  const formatTotal = (key, isPct) => {
    const raw = shiftTotals[key];
    if (raw == null) return isPct ? '0%' : 0;
    const n = Number(raw) || 0;
    return isPct ? `${Math.round(n)}%` : Math.round(n);
  };

  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12,
      minWidth: Math.max(480, 72 + slots.length * 48),
    }}>
      <thead>
        <tr>
          <th style={{
            padding: cellPad,
            textAlign: 'left',
            background: t.surface2 || (isDark ? '#1e293b' : '#f1f5f9'),
            color: t.textDim,
            fontSize: 12,
            fontWeight: 700,
            minWidth: 88,
          }}>
            State
          </th>
          {slots.map((label) => (
            <th
              key={label}
              title={label}
              style={{
                padding: cellPad,
                textAlign: 'center',
                background: t.surface2 || (isDark ? '#1e293b' : '#f1f5f9'),
                color: t.textDim,
                fontSize: headerFont,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {slotHeaderLabel(label, slots.length)}
            </th>
          ))}
          <th style={{
            padding: cellPad,
            textAlign: 'center',
            background: isDark ? '#42200666' : '#fef08a88',
            color: isDark ? '#fde047' : '#854d0e',
            fontSize: 12,
            fontWeight: 800,
            minWidth: 52,
          }}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {HOURLY_ROWS.map((row) => {
          const colors = rowColors[row.key];
          const values = valuesFor(row.key);
          return (
            <tr key={row.key}>
              <td style={{
                padding: cellPad,
                fontWeight: 700,
                color: colors.fg,
                background: colors.bg,
                borderLeft: `3px solid ${colors.border}`,
                whiteSpace: 'nowrap',
              }}>
                {row.label}
              </td>
              {slots.map((_, i) => (
                <td
                  key={`${row.key}-${i}`}
                  style={{
                    padding: cellPad,
                    textAlign: 'center',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    background: colors.bg,
                    color: t.text,
                  }}
                >
                  {formatCell(values[i], row.pct)}
                </td>
              ))}
              <td style={{
                padding: cellPad,
                textAlign: 'center',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                background: isDark ? '#42200644' : '#fef08a55',
                color: isDark ? '#fde047' : '#854d0e',
              }}>
                {formatTotal(row.key, row.pct)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function styles(t, isDark) {
  return {
    // Document flow like Planning — right scrollbar via .titan-page-outlet.
    page: {
      padding: 12,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 'calc(100vh - 52px)',
      gap: 0,
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
    detailLayout: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      flex: '0 0 auto',
    },
    detailTop: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 10,
      alignItems: 'stretch',
      flex: '0 0 auto',
      minHeight: 320,
    },
    hourlyCard: {
      flex: '0 0 auto',
    },
    kpiRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 14,
      minHeight: 360,
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
      minHeight: 360,
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
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    },
    oeeCard: {
      overflow: 'auto',
      minHeight: 0,
    },
    oeeBody: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      minHeight: 0,
      overflow: 'auto',
      flex: 1,
    },
    cardTitle: {
      margin: 0,
      padding: '12px 14px 8px',
      fontSize: 15,
      fontWeight: 700,
      color: t.text,
      flexShrink: 0,
    },
    machineDetailCard: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    },
    machineHead: {
      display: 'flex',
      gap: 14,
      padding: '14px 14px 8px',
      alignItems: 'flex-start',
      flexShrink: 0,
    },
    machineHeroWrap: {
      flex: 1,
      minHeight: 120,
      maxHeight: 200,
      margin: '0 14px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    machineHeroImg: {
      width: '100%',
      height: '100%',
      maxHeight: 180,
      minHeight: 100,
      objectFit: 'contain',
      borderRadius: 12,
      border: '2px solid',
      background: isDark ? 'rgba(15,23,42,0.55)' : '#f1f5f9',
      padding: 10,
      boxSizing: 'border-box',
    },
    machineImgPlaceholder: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 48,
      color: t.textDim,
      padding: 0,
    },
    machineName: {
      fontSize: 22,
      fontWeight: 800,
      color: t.text,
      lineHeight: 1.1,
      letterSpacing: '0.02em',
    },
    fleetThumbWrap: {
      width: '100%',
      height: 120,
      maxHeight: 120,
      borderRadius: 8,
      marginBottom: 8,
      background: isDark ? 'rgba(15,23,42,0.55)' : '#f1f5f9',
      border: `1px solid ${t.border || 'transparent'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      boxSizing: 'border-box',
      padding: 8,
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
    planMeta: {
      fontSize: 12,
      marginTop: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      color: t.text,
      lineHeight: 1.35,
    },
    planMetaLabel: {
      fontWeight: 700,
      color: t.textDim || '#94a3b8',
    },
    oeeRow: {
      marginTop: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13,
    },
    tileBody: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      padding: '0 12px 14px',
      boxSizing: 'border-box',
    },
    runningRateBody: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
      padding: '0 12px 14px',
      boxSizing: 'border-box',
    },
    runningRateGauge: {
      flex: 1.2,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    },
    equipStats: {
      flex: '0 0 140px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 12,
      padding: '8px 6px 8px 12px',
      borderLeft: `1px solid ${isDark ? (t.border || '#334155') : '#e2e8f0'}`,
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
      background: isDark ? (t.border || '#334155') : '#e2e8f0',
      margin: '2px 0',
    },
    statusFilterWrap: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '0 14px 16px',
      minHeight: 0,
    },
    filterAll: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      padding: '8px 14px',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
    },
    statusRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      gap: 12,
      flex: 1,
    },
    statusChip: {
      borderRadius: 14,
      padding: '16px 8px',
      textAlign: 'center',
      minHeight: 88,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusVal: { display: 'block', fontSize: 28, fontWeight: 800, lineHeight: 1.1 },
    statusLbl: {
      display: 'block',
      fontSize: 12,
      marginTop: 8,
      fontWeight: 800,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    machineGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 12,
      padding: '0 14px 14px',
    },
    machineCard: {
      textAlign: 'left',
      background: t.surface2 || t.bg,
      borderRadius: 10,
      padding: 12,
      border: `1px solid ${t.border || 'transparent'}`,
      cursor: 'pointer',
      color: t.text,
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minHeight: 72,
      overflow: 'hidden',
      boxSizing: 'border-box',
      maxWidth: '100%',
    },
    badge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      padding: '4px 12px',
      fontSize: 12,
      fontWeight: 700,
    },
    linkBtn: {
      border: 'none',
      background: 'transparent',
      color: t.accent || '#0ea5e9',
      fontWeight: 600,
      cursor: 'pointer',
      padding: 0,
      fontSize: 13,
    },
    dl: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
      margin: '4px 0 0',
      padding: '0 14px 10px',
    },
    dlLabel: { fontSize: 11, color: t.textDim, marginBottom: 2 },
    dlValue: { fontSize: 14, fontWeight: 600, color: t.text },
    progressTrack: {
      height: 8,
      borderRadius: 999,
      background: t.surface2 || '#e5e7eb',
      overflow: 'hidden',
    },
    qtyPair: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 14,
      flexWrap: 'wrap',
    },
    qtyBlock: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0,
    },
    qtyLabel: {
      fontSize: 12,
      fontWeight: 700,
      color: t.textDim,
      letterSpacing: '0.02em',
    },
    qtyValue: {
      fontSize: 34,
      fontWeight: 800,
      lineHeight: 1.05,
      fontVariantNumeric: 'tabular-nums',
      color: t.text,
    },
    qtyDivider: {
      fontSize: 28,
      fontWeight: 700,
      color: t.textDim,
      paddingBottom: 4,
      lineHeight: 1,
    },
    progressFill: {
      height: '100%',
      background: t.brand || '#77AF46',
      borderRadius: 999,
    },
    ctBox: {
      background: t.surface2 || t.bg,
      borderRadius: 10,
      padding: '10px 12px',
      border: `1px solid ${t.border || 'transparent'}`,
    },
    ctRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: 13,
      marginBottom: 8,
      color: t.text,
    },
    ctSplit: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
    },
    ctTriple: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr auto',
      gap: 10,
      alignItems: 'start',
    },
    ctCorner: {
      textAlign: 'right',
      minWidth: 72,
      justifySelf: 'end',
    },
    ctWhite: {
      fontWeight: 800,
      fontSize: 16,
      color: isDark ? '#ffffff' : '#0f172a',
      lineHeight: 1.2,
    },
    kpiGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 1,
      background: t.border || '#334155',
      borderTop: `1px solid ${t.border || '#334155'}`,
      borderBottom: `1px solid ${t.border || '#334155'}`,
    },
    kpiCell: {
      background: isDark ? t.surface : '#fff',
      padding: '10px 8px',
      textAlign: 'center',
    },
    statsTable: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12,
      marginTop: 8,
      padding: '0 4px',
    },
    statsLbl: {
      padding: '5px 14px',
      color: t.textDim,
      borderBottom: `1px solid ${t.border || 'transparent'}`,
    },
    statsVal: {
      padding: '5px 14px',
      textAlign: 'right',
      fontWeight: 700,
      color: t.text,
      borderBottom: `1px solid ${t.border || 'transparent'}`,
    },
  };
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api/client';
import PageHeader from '../components/PageHeader';
import { useTheme } from '../context/ThemeContext';
import { pageClass, surfaceClass } from '../themes/tileHelpers';
import { useConfig, getCurrentShift } from '../context/ConfigContext';
import { getFactoryLines } from '../utils/factoryHelpers';
import { downloadBlobResponse } from '../utils/downloadBlob';
import { formatCtSeconds } from '../utils/cycleTime';
import { DRAFT_KEYS } from '../utils/formPersistence';
import usePersistedState from '../hooks/usePersistedState';

// IST calendar dates (match Loss Tracker — avoid UTC drift from toISOString)
const todayStr = () => new Date().toLocaleDateString('en-CA');
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
};

/** Shift start date for "today" — overnight shifts before end time use yesterday. */
function liveEntryDateForShift(shift) {
  if (!shift) return todayStr();
  const [sH] = shift.start.split(':').map(Number);
  const [eH] = shift.end.split(':').map(Number);
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const overnight = eH <= sH;
  if (overnight && currentMin < eH * 60) return yesterdayStr();
  return todayStr();
}

const STATE_ROWS = [
  { key: 'running', label: 'Running' },
  { key: 'ld_unld', label: 'Ld/UnLd' },
  { key: 'idle', label: 'Idle' },
  { key: 'expected', label: 'Exp Output' },
];

const VARIANT_COLORS = ['#86efac', '#fde047', '#f9a8d4', '#93c5fd'];

function shiftDate(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toLocaleDateString('en-CA');
}

/** Cumulative hourly values → incremental per slot. */
function incrementalHourly(cumulative = []) {
  return cumulative.map((v, i) => (i === 0 ? v : Math.max(0, v - (cumulative[i - 1] || 0))));
}

/** Performance vs expected: red <50%, orange <60%, blue >75%, green >90%. */
function perfStyle(ratio, palette) {
  if (ratio == null || Number.isNaN(ratio)) return palette.cellNeutral;
  if (ratio < 0.5) return palette.perfRed;
  if (ratio < 0.6) return palette.perfOrange;
  if (ratio > 0.9) return palette.perfGreen;
  if (ratio > 0.75) return palette.perfBlue;
  return palette.cellNeutral;
}

function buildPalette(t, isDark) {
  return {
    running: {
      rowBg: isDark ? '#052e1622' : '#dcfce7',
      rowLabel: isDark ? '#4ade80' : '#15803d',
      border: isDark ? '#166534' : '#86efac',
    },
    ld_unld: {
      rowBg: isDark ? '#0c4a6e22' : '#e0f2fe',
      rowLabel: isDark ? '#38bdf8' : '#0369a1',
      border: isDark ? '#0369a1' : '#7dd3fc',
    },
    idle: {
      rowBg: isDark ? '#450a0a22' : '#fee2e2',
      rowLabel: isDark ? '#f87171' : '#b91c1c',
      border: isDark ? '#991b1b' : '#fca5a5',
    },
    expected: {
      rowBg: isDark ? '#312e8122' : '#ede9fe',
      rowLabel: isDark ? '#a78bfa' : '#6d28d9',
      border: isDark ? '#5b21b6' : '#c4b5fd',
    },
    perfRed: {
      background: isDark ? '#7f1d1dcc' : '#fecaca',
      color: isDark ? '#fecaca' : '#7f1d1d',
      fontWeight: 800,
      boxShadow: isDark ? 'inset 0 0 0 1px #ef4444' : 'inset 0 0 0 1px #f87171',
    },
    perfOrange: {
      background: isDark ? '#78350fcc' : '#fed7aa',
      color: isDark ? '#fdba74' : '#9a3412',
      fontWeight: 800,
      boxShadow: isDark ? 'inset 0 0 0 1px #f59e0b' : 'inset 0 0 0 1px #fb923c',
    },
    perfBlue: {
      background: isDark ? '#1e3a5fcc' : '#bfdbfe',
      color: isDark ? '#93c5fd' : '#1e40af',
      fontWeight: 800,
      boxShadow: isDark ? 'inset 0 0 0 1px #3b82f6' : 'inset 0 0 0 1px #60a5fa',
    },
    perfGreen: {
      background: isDark ? '#14532dcc' : '#bbf7d0',
      color: isDark ? '#86efac' : '#166534',
      fontWeight: 800,
      boxShadow: isDark ? 'inset 0 0 0 1px #22c55e' : 'inset 0 0 0 1px #4ade80',
    },
    cellNeutral: {
      background: isDark ? t.surface2 : '#f8fafc',
      color: t.text,
      fontWeight: 600,
    },
    totalCol: {
      background: isDark ? '#42200644' : '#fef08a55',
      color: isDark ? '#fde047' : '#854d0e',
      fontWeight: 800,
    },
    cardHeader: {
      background: isDark
        ? `linear-gradient(135deg, ${t.surface2} 0%, #1e3a5f44 100%)`
        : `linear-gradient(135deg, #e0f2fe 0%, #f0fdf4 100%)`,
      borderBottom: `2px solid ${t.accent}`,
    },
  };
}

function gridLayout(machineCount) {
  if (machineCount <= 1) return { cols: 1, compact: false, ultra: false };
  if (machineCount <= 3) return { cols: machineCount, compact: false, ultra: false };
  if (machineCount <= 6) return { cols: 3, compact: true, ultra: false };
  if (machineCount <= 9) return { cols: 4, compact: true, ultra: false };
  return { cols: 5, compact: true, ultra: true };
}

function modelVariantFont(text, layout, lineCount = 1) {
  const len = (text || '').length;
  const lines = Math.max(1, lineCount);
  const shrink = lines > 2 ? 2 : lines > 1 ? 1 : 0;
  if (layout.ultra) {
    if (len <= 14) return 12 - shrink;
    if (len <= 24) return 11 - shrink;
    return 10 - shrink;
  }
  if (layout.compact) {
    if (len <= 14) return 14 - shrink;
    if (len <= 22) return 13 - shrink;
    if (len <= 32) return 12 - shrink;
    return 11 - shrink;
  }
  if (len <= 14) return 16 - shrink;
  if (len <= 22) return 15 - shrink;
  if (len <= 32) return 14 - shrink;
  return 13 - shrink;
}

function formatCtLabel(ctDisplay, cycleTime) {
  if (ctDisplay != null && ctDisplay !== '') return String(ctDisplay);
  if (cycleTime != null && cycleTime !== '') return formatCtSeconds(cycleTime);
  return '0';
}

function VariantTimeline({ breakdown, t, layout }) {
  if (!breakdown?.length) return null;
  const fontSize = layout.ultra ? 9 : layout.compact ? 10 : 11;
  return (
    <div style={{ padding: layout.ultra ? '6px 8px' : '8px 12px', borderBottom: `1px solid ${t.border}`, background: t.surface2 }}>
      <div style={{ fontSize, color: t.textMuted, fontWeight: 600, marginBottom: 6 }}>Shift variant timeline</div>
      <div style={{
        position: 'relative', height: layout.ultra ? 14 : 18, borderRadius: 6,
        background: t.bg, border: `1px solid ${t.border}`, overflow: 'hidden',
      }}>
        {breakdown.map((vb, i) => {
          const left = Math.max(0, vb.timeline_pct_start ?? 0);
          const width = Math.max(0, (vb.timeline_pct_end ?? 0) - left);
          if (width <= 0) return null;
          const color = VARIANT_COLORS[i % VARIANT_COLORS.length];
          return (
            <div
              key={`${vb.variant}-${i}`}
              title={`${vb.variant} (${vb.window_start}–${vb.window_end})`}
              style={{
                position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0,
                background: color, opacity: 0.92,
                borderRight: i < breakdown.length - 1 ? '1px solid rgba(255,255,255,0.35)' : 'none',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {breakdown.map((vb, i) => (
          <span key={`${vb.variant}-legend-${i}`} style={{ fontSize, color: t.textDim, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2, display: 'inline-block',
              background: VARIANT_COLORS[i % VARIANT_COLORS.length],
            }} />
            <span style={{ fontWeight: 700, color: t.text }}>{vb.variant}</span>
            <span>({vb.window_start}–{vb.window_end})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function slotHeaderLabel(label, slotCount) {
  if (!label) return '';
  const short = label.replace(':00-', '-').replace(':00', '');
  if (slotCount > 10 && short.length > 5) return short.slice(0, 5);
  return short;
}

function HourlyStateTable({ states, shiftTotals, slots, palette, layout, t, incremental = false }) {
  const runningVals = incremental
    ? (states?.running || [])
    : incrementalHourly(states?.running || []);
  const expected = states?.expected || [];
  const slotCount = slots.length;
  const metaFont = layout.ultra ? 11 : layout.compact ? 12 : 13;
  const cellFont = layout.ultra ? 11 : layout.compact ? 12 : 13;
  const headerFont = slotCount > 10 ? 9 : slotCount > 8 ? 10 : 11;
  const labelW = layout.ultra ? 56 : layout.compact ? 62 : 68;
  const cellPad = slotCount > 10 ? '3px 1px' : slotCount > 8 ? '4px 2px' : '5px 3px';

  const displayValues = (rowKey) => {
    const raw = states?.[rowKey] || [];
    if (incremental || rowKey === 'expected') return raw;
    if (rowKey === 'running') return runningVals;
    return incrementalHourly(raw);
  };

  const formatCell = (val) => (val == null || val === 0 ? 0 : val);

  return (
    <div className="titan-hourly-table-wrap">
      <table className="titan-hourly-table" style={{ borderCollapse: 'collapse', fontSize: cellFont }}>
        <thead>
          <tr>
            <th style={{
              padding: cellPad, background: t.surface2, color: t.textDim, fontSize: metaFont,
              textAlign: 'left', width: labelW, minWidth: labelW, maxWidth: labelW,
            }}>State</th>
            {slots.map(label => (
              <th key={label} style={{
                padding: cellPad, background: t.surface2, color: t.textDim,
                fontSize: headerFont, textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700,
              }} title={label}>{slotHeaderLabel(label, slotCount)}</th>
            ))}
            <th style={{
              padding: cellPad, background: isDarkShadow(t) ? '#42200666' : '#fef08a88',
              color: isDarkShadow(t) ? '#fde047' : '#854d0e', fontSize: metaFont, textAlign: 'center', fontWeight: 800,
              width: 44, minWidth: 44,
            }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {STATE_ROWS.map(row => {
            const rowPalette = palette[row.key];
            const values = displayValues(row.key);
            return (
              <tr key={row.key}>
                <td style={{
                  padding: cellPad, fontSize: metaFont, fontWeight: 700,
                  color: rowPalette.rowLabel, background: rowPalette.rowBg,
                  borderLeft: `3px solid ${rowPalette.border}`,
                  whiteSpace: 'nowrap', width: labelW, minWidth: labelW, maxWidth: labelW,
                }}>{row.label}</td>
                {values.map((val, i) => {
                  const displayVal = incremental && row.key !== 'expected' && !(expected[i] > 0)
                    ? 0
                    : formatCell(val);
                  let cellStyle = { ...palette.cellNeutral, background: rowPalette.rowBg, color: t.text };
                  if (row.key === 'running') {
                    const exp = expected[i] || 0;
                    const ratio = exp > 0 ? runningVals[i] / exp : null;
                    cellStyle = { ...perfStyle(ratio, palette), fontSize: cellFont };
                  } else if (row.key === 'expected') {
                    cellStyle = {
                      background: rowPalette.rowBg,
                      color: rowPalette.rowLabel,
                      fontWeight: 700,
                      fontSize: cellFont,
                    };
                  } else if (row.key === 'ld_unld' || row.key === 'idle') {
                    cellStyle = { background: rowPalette.rowBg, color: rowPalette.rowLabel, fontWeight: 600, fontSize: cellFont };
                  }
                  return (
                    <td key={i} style={{
                      padding: cellPad, textAlign: 'center', borderBottom: `1px solid ${t.border}`,
                      ...cellStyle,
                    }}>{displayVal}</td>
                  );
                })}
                <td style={{
                  padding: cellPad, textAlign: 'center', borderBottom: `1px solid ${t.border}`,
                  ...palette.totalCol, fontSize: cellFont, width: 44, minWidth: 44,
                }}>{shiftTotals?.[row.key] ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VariantSection({ variantBlock, colorIndex, slots, palette, layout, t, isLast }) {
  const statFont = layout.ultra ? 9 : layout.compact ? 10 : 11;
  const statValueFont = layout.ultra ? 11 : layout.compact ? 12 : 13;
  const variantFont = layout.ultra ? 11 : layout.compact ? 13 : 14;
  const accent = VARIANT_COLORS[colorIndex % VARIANT_COLORS.length];
  const ctText = formatCtLabel(variantBlock.cycle_time_display, variantBlock.cycle_time);
  const planQty = variantBlock.planned_qty || 0;

  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${t.border}` }}>
      <div style={{
        padding: layout.ultra ? '5px 8px' : '6px 10px',
        background: isDarkShadow(t) ? `${accent}22` : `${accent}18`,
        borderLeft: `3px solid ${accent}`,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 8,
        minHeight: layout.ultra ? 32 : 36,
      }}>
        <div style={{
          fontSize: variantFont, fontWeight: 800, color: t.text,
          textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={variantBlock.variant}>
          {variantBlock.variant}
        </div>
        <div style={{
          fontSize: statFont, color: t.textDim, lineHeight: 1.35, textAlign: 'right', whiteSpace: 'nowrap',
        }}>
          <div>
            CT in secs = <strong style={{ color: t.text, fontSize: statValueFont, fontWeight: 800 }}>{ctText}</strong>
          </div>
          <div>
            Plan Qty = <strong style={{ color: t.text, fontSize: statValueFont, fontWeight: 800 }}>
              {planQty > 0 ? `${planQty} nos.` : '—'}
            </strong>
          </div>
        </div>
      </div>
      <HourlyStateTable
        states={variantBlock.states}
        shiftTotals={variantBlock.shift_totals}
        slots={slots}
        palette={palette}
        layout={layout}
        t={t}
        incremental
      />
    </div>
  );
}

function formatMachineCt(machine) {
  const disp = machine.cycle_time_display;
  if (disp != null && disp !== '') return String(disp);
  if (machine.cycle_time != null && machine.cycle_time !== '') {
    return formatCtSeconds(machine.cycle_time);
  }
  return '—';
}

function MachineCard({ machine, slots, palette, layout, t }) {
  const metaFont = layout.ultra ? 10 : layout.compact ? 11 : 12;
  const nameFont = layout.ultra ? 14 : layout.compact ? 16 : 18;
  const statFont = layout.ultra ? 10 : layout.compact ? 11 : 12;
  const statValueFont = layout.ultra ? 12 : layout.compact ? 13 : 14;
  const variants = (machine.model_variants?.length
    ? machine.model_variants
    : (machine.model_variant?.trim() ? [machine.model_variant.trim()] : []));
  const breakdown = machine.variant_breakdown?.length > 1
    ? machine.variant_breakdown
    : null;
  const ctText = formatMachineCt(machine);
  const planQty = machine.planned_qty || 0;

  return (
    <div
      className={`titan-hourly-machine-card ${surfaceClass(t) || ''}`.trim()}
      style={{
      border: `1px solid ${t.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      background: t.surface,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      boxShadow: isDarkShadow(t) ? '0 4px 12px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{ ...palette.cardHeader, padding: layout.ultra ? '8px 8px' : '10px 12px' }}>
        {breakdown ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: nameFont, fontWeight: 800, color: t.accent,
                letterSpacing: '0.02em', lineHeight: 1.2,
              }}>
                {machine.machine_name}
              </div>
              <div style={{ fontSize: metaFont, color: t.textMuted, marginTop: 3 }}>{machine.station_name}</div>
            </div>
            <div style={{ fontSize: statFont, color: t.textDim, textAlign: 'right' }}>
              <div>
                Plan Qty = <strong style={{ color: t.text, fontSize: statValueFont, fontWeight: 800 }}>
                  {planQty > 0 ? `${planQty} nos.` : '—'}
                </strong>
              </div>
              <div style={{ marginTop: 2, color: t.textMuted }}>
                {breakdown.length} variants this shift
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', gap: 6 }}>
            <div style={{ minWidth: 0, flex: '1 1 30%', alignSelf: 'center' }}>
              <div style={{
                fontSize: nameFont, fontWeight: 800, color: t.accent,
                letterSpacing: '0.02em', lineHeight: 1.2,
              }}>
                {machine.machine_name}
              </div>
              <div style={{ fontSize: metaFont, color: t.textMuted, marginTop: 3 }}>{machine.station_name}</div>
            </div>
            <div style={{
              flex: '1 1 40%', textAlign: 'center', alignSelf: 'center',
              minWidth: 0, padding: '0 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            }}>
              {variants.length ? variants.map((v, i) => (
                <div
                  key={`${v}-${i}`}
                  title={v}
                  style={{
                    fontSize: modelVariantFont(v, layout, variants.length),
                    fontWeight: 800,
                    color: t.text,
                    letterSpacing: '0.02em',
                    lineHeight: 1.2,
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                    maxWidth: '100%',
                  }}
                >
                  {v}
                </div>
              )) : (
                <div style={{ fontSize: metaFont + 1, fontWeight: 700, color: t.textFaint }}>—</div>
              )}
            </div>
            <div style={{
              flex: '1 1 30%', textAlign: 'right', alignSelf: 'center',
              fontSize: statFont, color: t.textDim, lineHeight: 1.45,
            }}>
              <div>
                CT in secs = <strong style={{ color: t.text, fontSize: statValueFont, fontWeight: 800 }}>{ctText}</strong>
              </div>
              <div style={{ marginTop: 2 }}>
                Plan Qty = <strong style={{ color: t.text, fontSize: statValueFont, fontWeight: 800 }}>
                  {planQty > 0 ? `${planQty} nos.` : '—'}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {breakdown ? (
        <>
          <VariantTimeline breakdown={breakdown} t={t} layout={layout} />
          <div style={{ flex: 1 }}>
            {breakdown.map((vb, i) => (
              <VariantSection
                key={`${vb.variant}-${i}`}
                variantBlock={vb}
                colorIndex={i}
                slots={slots}
                palette={palette}
                layout={layout}
                t={t}
                isLast={i === breakdown.length - 1}
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ flex: 1 }}>
          <HourlyStateTable
            states={machine.states}
            shiftTotals={machine.shift_totals}
            slots={slots}
            palette={palette}
            layout={layout}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function isDarkShadow(t) {
  return t.isDark ?? (t.bg === '#0f172a' || t.bg?.includes('0f172a'));
}

function PerformanceLegend({ palette, t }) {
  const items = [
    { label: '< 50% of expected', style: palette.perfRed },
    { label: '< 60% of expected', style: palette.perfOrange },
    { label: '> 75% of expected', style: palette.perfBlue },
    { label: '> 90% of expected', style: palette.perfGreen },
  ];
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, padding: '8px 12px',
      background: t.surface, borderRadius: 8, border: `1px solid ${t.border}`, alignItems: 'center',
    }}>
      <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>Running vs expected:</span>
      {items.map(it => (
        <span key={it.label} style={{
          fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6, ...it.style,
        }}>{it.label}</span>
      ))}
      <span style={{ fontSize: 10, color: t.textFaint, marginLeft: 'auto' }}>
        <span style={{ color: palette.running.rowLabel }}>■ Running</span>
        {' · '}
        <span style={{ color: palette.ld_unld.rowLabel }}>■ Ld/UnLd</span>
        {' · '}
        <span style={{ color: palette.idle.rowLabel }}>■ Idle</span>
        {' · '}
        <span style={{ color: palette.expected.rowLabel }}>■ Expected</span>
      </span>
    </div>
  );
}

export default function MachineHourlyOutput() {
  const { config } = useConfig();
  const { theme: t } = useTheme();
  const isDark = t.isDark ?? false;
  const palette = useMemo(() => buildPalette(t, isDark), [t, isDark]);

  const currentShift = useMemo(() => getCurrentShift(config), [config]);
  const factoryLines = useMemo(() => getFactoryLines(config), [config]);
  const factories = config?.factory?.factories || [];

  const defaultFilters = {
    entryDate: todayStr(),
    shiftId: currentShift?.id || config.shifts.find(s => s.enabled)?.id || 'A',
    scope: 'all',
    stationId: '',
    lineId: '',
    factoryId: '',
  };
  const [filters, setFilters] = usePersistedState(DRAFT_KEYS.hourlyOutput, defaultFilters);
  const {
    entryDate, shiftId, scope, stationId, lineId, factoryId,
  } = filters;
  const setEntryDate = (v) => setFilters((p) => ({ ...p, entryDate: typeof v === 'function' ? v(p.entryDate) : v }));
  const setShiftId = (v) => setFilters((p) => ({ ...p, shiftId: v }));
  const setScope = (v) => setFilters((p) => ({ ...p, scope: v }));
  const setStationId = (v) => setFilters((p) => ({ ...p, stationId: v }));
  const setLineId = (v) => setFilters((p) => ({ ...p, lineId: v }));
  const setFactoryId = (v) => setFilters((p) => ({ ...p, factoryId: v }));
  const [stations, setStations] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState('');

  const isToday = entryDate === todayStr() || entryDate === yesterdayStr();
  const isLiveView = Boolean(data?.is_live) || (
    isToday && currentShift?.id === shiftId && entryDate === liveEntryDateForShift(currentShift)
  );
  const isHistoric = !isLiveView && entryDate < todayStr();

  useEffect(() => {
    api.get('/api/stations/').then(r => setStations(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const sh = config.shifts.find(s => s.id === shiftId);
    if (!sh) return;
    const liveDate = liveEntryDateForShift(sh);
    setEntryDate((prev) => {
      if (prev !== todayStr() && prev !== yesterdayStr()) return prev;
      return liveDate;
    });
  }, [shiftId, config.shifts]);

  const buildParams = useCallback(() => {
    const p = { entry_date: entryDate, shift: shiftId, scope };
    if (scope === 'station' && stationId) p.station_id = parseInt(stationId, 10);
    if (scope === 'line' && lineId) p.line_id = lineId;
    if (scope === 'factory' && factoryId) p.factory_id = factoryId;
    return p;
  }, [entryDate, shiftId, scope, stationId, lineId, factoryId]);

  const fetchData = useCallback(async () => {
    if (!entryDate || !shiftId) return;
    setLoading(true);
    setFetchErr('');
    try {
      const r = await api.get('/api/hourly-output/', { params: buildParams() });
      setData(r.data);
    } catch (err) {
      setData(null);
      const msg = err.response?.data?.detail || err.message || 'Failed to load hourly output';
      setFetchErr(typeof msg === 'string' ? msg : 'Failed to load hourly output');
    } finally {
      setLoading(false);
    }
  }, [buildParams, entryDate, shiftId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isLiveView) return undefined;
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [isLiveView, fetchData]);

  const goToday = () => {
    const sh = currentShift || config.shifts.find(s => s.id === shiftId);
    setEntryDate(liveEntryDateForShift(sh));
    if (currentShift?.id) setShiftId(currentShift.id);
  };

  const downloadExcel = async () => {
    setDownloading(true);
    setDlErr('');
    try {
      const params = buildParams();
      const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/hourly-output/download-xlsx?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await downloadBlobResponse(response, `hourly_output_${entryDate}_shift_${shiftId}.xlsx`);
    } catch (err) {
      setDlErr(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const s = getStyles(t);
  const slots = data?.slots || [];
  const machines = data?.machines || [];
  const activeShift = config.shifts.find(sh => sh.id === shiftId);
  const layout = gridLayout(machines.length);

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader
        title="MACHINES HOURLY OUTPUT"
        onRefresh={fetchData}
        extra={
          <button style={s.dlBtn} onClick={downloadExcel} disabled={downloading || !machines.length}>
            {downloading ? 'Downloading…' : '⬇ Download Excel'}
          </button>
        }
      />

      <div style={s.banner}>
        <span style={s.bannerLabel}>Live shift now:</span>
        <strong style={{ color: t.accent }}>
          {currentShift ? `${currentShift.name} (${currentShift.start} – ${currentShift.end})` : 'No active shift'}
        </strong>
        <span style={{
          marginLeft: 12, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
          background: isLiveView ? '#10b98122' : isHistoric ? '#f59e0b22' : '#6366f122',
          color: isLiveView ? '#10b981' : isHistoric ? '#f59e0b' : '#6366f1',
        }}>
          {isLiveView ? 'Live' : isHistoric ? 'Historic view' : 'Future date'}
        </span>
        <span style={{ color: t.textMuted, marginLeft: 12, fontSize: 12 }}>
          Report: {entryDate} · {activeShift?.name || shiftId}
          {data?.as_of && isLiveView && (
            <> · updated to <strong style={{ color: t.text }}>{data.as_of}</strong> IST</>
          )}
        </span>
      </div>

      {fetchErr && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>⚠ {fetchErr}</div>
      )}

      <div style={s.filterBar}>
        <input style={s.input} type="date" value={entryDate} max={todayStr()}
          onChange={e => setEntryDate(e.target.value)} />
        <button style={s.quickBtn} onClick={() => setEntryDate(shiftDate(-1))}>← Yesterday</button>
        <button style={s.quickBtn} onClick={goToday}>Today</button>
        <select style={s.input} value={shiftId} onChange={e => setShiftId(e.target.value)}>
          {config.shifts.filter(sh => sh.enabled).map(sh => (
            <option key={sh.id} value={sh.id}>{sh.name} ({sh.start}–{sh.end})</option>
          ))}
        </select>
        <select style={s.input} value={scope} onChange={e => {
          setFilters((p) => ({
            ...p,
            scope: e.target.value,
            stationId: '',
            lineId: '',
            factoryId: '',
          }));
        }}>
          <option value="all">All machines (fleet)</option>
          <option value="factory">By factory</option>
          <option value="line">By line</option>
          <option value="station">By station</option>
        </select>
        {scope === 'factory' && (
          <select style={s.input} value={factoryId} onChange={e => setFactoryId(e.target.value)}>
            <option value="">Select factory</option>
            {factories.map(f => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
          </select>
        )}
        {scope === 'line' && (
          <select style={s.input} value={lineId} onChange={e => setLineId(e.target.value)}>
            <option value="">Select line</option>
            {factoryLines.map(line => <option key={line.id} value={line.id}>{line.label}</option>)}
          </select>
        )}
        {scope === 'station' && (
          <select style={s.input} value={stationId} onChange={e => setStationId(e.target.value)}>
            <option value="">Select station</option>
            {stations.map(st => <option key={st.id} value={st.id}>{st.display_name || st.name}</option>)}
          </select>
        )}
      </div>

      {data?.scope_label && (
        <p style={{ color: t.textMuted, fontSize: 12, margin: '0 0 8px' }}>
          <strong style={{ color: t.text }}>{data.machine_count ?? 0}</strong> machine(s) — {data.scope_label}
          {layout.ultra && ' · Compact grid for large fleet'}
        </p>
      )}

      {machines.length > 0 && <PerformanceLegend palette={palette} t={t} />}
      {dlErr && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{dlErr}</p>}

      {loading ? (
        <div style={s.empty}>Loading hourly output…</div>
      ) : !machines.length ? (
        <div style={s.empty}>
          No machine data for {entryDate}, shift {shiftId}.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: machines.length === 1
            ? '1fr'
            : `repeat(${layout.cols}, minmax(0, 1fr))`,
          gap: layout.ultra ? 8 : layout.compact ? 10 : 14,
          alignItems: 'stretch',
        }}>
          {machines.map(m => (
            <MachineCard
              key={m.machine_id}
              machine={m}
              slots={slots}
              palette={palette}
              layout={layout}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getStyles(t) {
  return {
    page: { padding: 16, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text },
    banner: {
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      padding: '10px 16px', marginBottom: 12, borderRadius: 8,
      background: t.surface, border: `1px solid ${t.border}`,
    },
    bannerLabel: { color: t.textMuted, fontSize: 13 },
    filterBar: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' },
    input: { padding: '6px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13 },
    quickBtn: {
      padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface2,
      color: t.textMuted, cursor: 'pointer', fontSize: 12,
    },
    dlBtn: {
      padding: '7px 18px', background: t.brand, color: '#fff', border: 'none',
      borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    },
    empty: { padding: 40, textAlign: 'center', color: t.textFaint, background: t.surface, borderRadius: 10 },
  };
}

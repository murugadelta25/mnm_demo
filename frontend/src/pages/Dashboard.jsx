import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import api from '../api/client';
import { useWebSocket } from '../api/useWebSocket';
import PageHeader from '../components/PageHeader';
import Donut3D, { DONUT_CANVAS } from '../components/charts/Donut3D';
import ProductionVsPossibleChart from '../components/charts/ProductionVsPossibleChart';
import { useTheme } from '../context/ThemeContext';
import { pageClass } from '../themes/tileHelpers';
import { downloadBlobResponse } from '../utils/downloadBlob';
import { formatCtSeconds, sumCt } from '../utils/cycleTime';
import { useConfig, getCurrentShift } from '../context/ConfigContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const AR_COLOR = '#4fc3f7';
const PR_COLOR = '#f8a5c8';
const QR_COLOR = '#f8bf05';
const todayStr = () => new Date().toISOString().slice(0, 10);

function weekRangeEndingToday() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return {
    date_from: from.toISOString().slice(0, 10),
    date_to: to.toISOString().slice(0, 10),
  };
}

function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

export default function Dashboard() {
  const { config } = useConfig();
  const currentShift = useMemo(() => getCurrentShift(config), [config]);

  const [filters, setFilters] = useState(() => {
    const wr = weekRangeEndingToday();
    return {
      shift: '', entry_date: todayStr(), month: '', year: new Date().getFullYear(),
      station_no: '', machine_id: '', search: '',
      date_from: wr.date_from, date_to: wr.date_to,
    };
  });
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [stations, setStations] = useState([]);
  const [machines, setMachines] = useState([]);
  const [viewMode, setViewMode] = useState('week');
  const [missingShifts, setMissingShifts] = useState([]);
  const [defectEdit, setDefectEdit] = useState({ id: null, value: '', note: '' });
  const [defectSaving, setDefectSaving] = useState(false);
  const [defectLog, setDefectLog] = useState({ id: null, records: [] }); // {id, records[]}

  const getStationLabel = (stationId) => {
    const station = stations.find(s => s.id === stationId);
    return station ? (station.display_name || station.name || `Station ${station.id}`) : stationId;
  };

  const getMachineLabel = (machineId) => {
    if (!machineId) return '—';
    const machine = machines.find(m => m.id === machineId);
    return machine ? machine.name : `Machine ${machineId}`;
  };

  const buildParams = useCallback(() => {
    const p = {};
    if (filters.shift) p.shift = filters.shift;
    if (viewMode === 'day' && filters.entry_date) p.entry_date = filters.entry_date;
    if ((viewMode === 'week' || viewMode === 'range') && filters.date_from) p.date_from = filters.date_from;
    if ((viewMode === 'week' || viewMode === 'range') && filters.date_to) p.date_to = filters.date_to;
    if (viewMode === 'month' && filters.month) p.month = filters.month;
    if (filters.year) p.year = filters.year;
    if (filters.station_no) p.station_no = parseInt(filters.station_no, 10);
    if (filters.machine_id) p.machine_id = parseInt(filters.machine_id, 10);
    if (filters.search?.trim()) p.search = filters.search.trim();
    return p;
  }, [filters, viewMode]);

  const fetchData = useCallback(async () => {
    try {
      const params = buildParams();
      const [e, s, p, m] = await Promise.all([
        api.get('/api/oee/', { params }),
        api.get('/api/oee/summary', { params }),
        api.get('/api/stations/'),
        api.get('/api/machines/'),
      ]);
      setEntries(Array.isArray(e.data) ? e.data : []);
      setSummary(s.data || null);
      setStations(Array.isArray(p.data) ? p.data : []);
      setMachines(Array.isArray(m.data) ? m.data : []);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    }
  }, [buildParams]);

  // Check missing shifts - warn if previous shift data not found in configured days back
  const checkMissingShifts = useCallback(async () => {
    if (!localStorage.getItem('token')) return;
    const missing = [];
    
    const enabledShifts = config.shifts.filter(s => s.enabled);
    const currentShiftIndex = enabledShifts.findIndex(s => s.id === currentShift?.id);
    
    if (currentShiftIndex === -1) return;
    
    // Determine which shift to check and which date to start from
    let previousShift, startDate;
    
    if (currentShiftIndex === 0) {
      // Current is first shift (A): check previous shift (B/C) from yesterday
      previousShift = enabledShifts[enabledShifts.length - 1];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday;
    } else {
      // Current is not first shift (B/C): check previous shift from today
      previousShift = enabledShifts[currentShiftIndex - 1];
      startDate = new Date();
    }
    
    // Check N days back for previous shift data
    const daysToCheck = config.checkDataDaysBack || 1;
    let foundData = false;
    
    for (let i = 0; i < daysToCheck; i++) {
      const checkDate = new Date(startDate);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = checkDate.toISOString().slice(0, 10);
      
      try {
        const res = await api.get('/api/oee/', { params: { entry_date: dateStr, shift: previousShift.id } });
        if (res.data && res.data.length > 0) {
          foundData = true;
          break;
        }
      } catch { /* ignore */ }
    }
    
    if (!foundData) {
      const d2 = startDate;
      const p = n => String(n).padStart(2,'0');
      const dateLabel = `${p(d2.getDate())}-${p(d2.getMonth()+1)}-${d2.getFullYear()}`;
      missing.push(`${previousShift.name} data is not updated for ${dateLabel}`);
    }
    
    setMissingShifts(missing);
  }, [config.shifts, config.checkDataDaysBack, currentShift]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { 
    checkMissingShifts(); 
  }, []);

  useWebSocket(useCallback(msg => {
    if (msg.type === 'oee_updated') fetchData();
  }, [fetchData]));

  const saveDefect = async (entryId) => {
    if (defectEdit.value === '' || defectEdit.value < 0) return;
    setDefectSaving(true);
    try {
      const r = await api.patch(`/api/oee/${entryId}/defect`, {
        defect_qty: parseInt(defectEdit.value),
        note: defectEdit.note
      });
      setEntries(prev => prev.map(e => e.id === entryId
        ? { ...e, defect_qty: r.data.defect_qty, accp_qty: r.data.accp_qty,
             qr: r.data.qr, oee: r.data.oee }
        : e
      ));
      setDefectEdit({ id: null, value: '', note: '' });
      fetchData(); // refresh summary KPIs
    } finally { setDefectSaving(false); }
  };

  const loadDefectLog = async (entryId) => {
    if (defectLog.id === entryId) { setDefectLog({ id: null, records: [] }); return; }
    const r = await api.get(`/api/oee/${entryId}/defect-log`);
    setDefectLog({ id: entryId, records: r.data });
  };

  const fmtIST = (istStr) => {
    if (!istStr) return '—';
    return istStr.replace('T', ' ').slice(0, 19) + ' IST';
  };

  const downloadExcel = async () => {
    if (!entries.length) return;
    const params = buildParams();
    const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/oee/download-xlsx?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await downloadBlobResponse(
        response,
        `oee_report_${filters.entry_date || filters.month || 'all'}.xlsx`
      );
    } catch (err) {
      alert(`Excel download failed: ${err.message}`);
    }
  };

  const chartData = entries.map(e => ({
    label: `${e.entry_date} ${e.shift}`,
    AR: safeNum(e.ar),
    PR: safeNum(e.pr),
    QR: safeNum(e.qr),
    OEE: safeNum(e.oee),
  }));

  const barData = entries.map(e => ({
    label: `${e.entry_date} ${e.shift}`,
    Possible: safeNum(e.possible_qty),
    Actual: safeNum(e.actual_qty),
    Accepted: safeNum(e.accp_qty),
  }));

  // derive runtime styles from theme
  const { theme: t } = useTheme();
  const s = getStyles(t);

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader title="PRODUCTION DASHBOARD" onRefresh={fetchData} />

      {/* Missing shift alerts */}
      {missingShifts.map(sh => (
        <div key={sh} style={s.alert}>⚠ {sh}</div>
      ))}

      {/* Filters */}
      <div style={s.filterBar}>
        <div style={s.viewBtns}>
          {['week','day','range','shift','month'].map(v => (
            <button key={v} style={{ ...s.viewBtn, ...(viewMode === v ? s.viewBtnActive : {}) }}
              onClick={() => {
                if (v === 'week') {
                  const wr = weekRangeEndingToday();
                  setFilters(p => ({ ...p, date_from: wr.date_from, date_to: wr.date_to }));
                }
                setViewMode(v);
              }}>
              {v === 'range' ? '📅 Date Range' : v === 'week' ? '📅 Week' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {(viewMode === 'day' || viewMode === 'week' || viewMode === 'range') && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...s.viewBtn, fontSize: 12 }}
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setFilters(p => ({ ...p, entry_date: d.toISOString().slice(0, 10) }));
                setViewMode('day');
              }}>
              ← Yesterday
            </button>
            <button style={{ ...s.viewBtn, fontSize: 12 }}
              onClick={() => {
                const wr = weekRangeEndingToday();
                setFilters(p => ({ ...p, date_from: wr.date_from, date_to: wr.date_to }));
                setViewMode('week');
              }}>
              This Week
            </button>
          </div>
        )}

        {viewMode === 'day' && (
          <input style={s.input} type="date" value={filters.entry_date}
            onChange={e => setFilters(p => ({ ...p, entry_date: e.target.value }))} />
        )}
        {(viewMode === 'week' || viewMode === 'range') && (
          <>
            <input style={s.input} type="date" value={filters.date_from}
              onChange={e => setFilters(p => ({ ...p, date_from: e.target.value }))} />
            <span style={{ color: t.textDim, fontSize: 13 }}>to</span>
            <input style={s.input} type="date" value={filters.date_to}
              onChange={e => setFilters(p => ({ ...p, date_to: e.target.value }))} />
          </>
        )}
        {viewMode === 'shift' && (
          <select style={s.input} value={filters.shift} onChange={e => setFilters(p => ({ ...p, shift: e.target.value }))}>
            <option value="">All Shifts</option>
            {config.shifts.filter(sh => sh.enabled).map(sh => (
              <option key={sh.id} value={sh.id}>{sh.name}</option>
            ))}
          </select>
        )}
        {viewMode === 'month' && (
          <select style={s.input} value={filters.month} onChange={e => setFilters(p => ({ ...p, month: e.target.value }))}>
            <option value="">All Months</option>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        )}
        <select style={s.input} value={filters.year} onChange={e => setFilters(p => ({ ...p, year: e.target.value }))}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select style={s.input} value={filters.station_no} onChange={e => setFilters(p => ({ ...p, station_no: e.target.value }))}>
          <option value="">All Stations</option>
          {stations.map(station => (
            <option key={station.id} value={station.id}>{station.display_name || station.name || `Station ${station.id}`}</option>
          ))}
        </select>
        <select style={s.input} value={filters.machine_id} onChange={e => setFilters(p => ({ ...p, machine_id: e.target.value }))}>
          <option value="">All Machines</option>
          {machines.map(machine => (
            <option key={machine.id} value={machine.id}>{machine.name}</option>
          ))}
        </select>
        <input style={s.input} placeholder="Model or Current Operation" value={filters.search}
          onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} />
        <button style={s.dlBtn} onClick={downloadExcel}>⬇ Download Excel</button>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={s.kpiRow}>
          {[
            { label: 'Availability (AR)', value: `${safeNum(summary.avg_ar).toFixed(2)}%`, color: '#0ea5e9' },
            { label: 'Performance (PR)', value: `${safeNum(summary.avg_pr).toFixed(2)}%`, color: '#8b5cf6' },
            { label: 'Quality (QR)', value: `${safeNum(summary.avg_qr).toFixed(2)}%`, color: '#10b981' },
            { label: 'OEE', value: `${safeNum(summary.avg_oee).toFixed(2)}%`,
              color: safeNum(summary.avg_oee) >= 85 ? '#10b981' : safeNum(summary.avg_oee) >= 65 ? '#f59e0b' : '#ef4444' },
            { label: 'Total Produced', value: summary.total_actual ?? 0, color: '#64748b' },
            { label: 'Accepted Qty', value: summary.total_accp ?? 0, color: '#10b981' },
            { label: 'Defects', value: summary.total_defect ?? 0, color: '#ef4444' },
          ].map(k => (
            <div key={k.label} style={{ ...s.kpi, borderTop: `3px solid ${k.color}` }}>
              <div style={{ color: k.color, fontSize: 24, fontWeight: 700 }}>{k.value}</div>
              <div style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div style={s.charts}>
        <div style={s.chartBox}>
          <h4 style={s.chartTitle}>OEE Overview</h4>
          {!summary || chartData.length === 0
            ? <div style={s.noData}>No data for selected filters</div>
            : (
              <div style={s.donutRow}>
                {[
                  { key: 'avg_ar',  label: 'AR',  color: AR_COLOR },
                  { key: 'avg_pr',  label: 'PR',  color: PR_COLOR },
                  { key: 'avg_qr',  label: 'QR',  color: QR_COLOR },
                  { key: 'avg_oee', label: 'OEE', color: safeNum(summary.avg_oee) >= 85 ? '#10b981' : safeNum(summary.avg_oee) >= 65 ? '#f59e0b' : '#ef4444' },
                ].map(({ key, label, color }) => {
                  const val = safeNum(summary[key]);
                  return (
                    <div key={label} style={s.donutWrap}>
                      <Donut3D key={`${label}-${val}`} value={val} color={color} trackColor={t.surface2} />
                      <div style={s.donutCenter}>
                        <span style={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{val.toFixed(1)}%</span>
                        <span style={{ color: t.textDim, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
        <div style={s.chartBox}>
          <h4 style={s.chartTitle}>Production vs Possible</h4>
          {barData.length === 0
            ? <div style={s.noData}>No data for selected filters</div>
            : (
              <ProductionVsPossibleChart data={barData} theme={t} />
            )}
        </div>
      </div>

      {/* Data Table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>{['Date','Station','Machine','Shift','Model / Variant','Current Operation','Next Operation','CT','Avail(min)','Op Time','Possible','Actual','Prod Loss','Accp','Defect','AR%','PR%','QR%','OEE%','QC Edit'].map(h =>
              <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={20} style={{ ...s.td, textAlign: 'center', color: t.textFaint, padding: 24 }}>
                No entries found
              </td></tr>
            ) : entries.map(e => {
              const prodLoss = Math.max(0, safeNum(e.possible_qty) - safeNum(e.actual_qty));
              const oee = safeNum(e.oee);
              const isEditing = defectEdit.id === e.id;
              const showLog = defectLog.id === e.id;
              return (
                <Fragment key={e.id}>
                  <tr style={s.tr}>
                    <td style={s.td}>{e.entry_date}</td>
                    <td style={s.td}>{getStationLabel(e.station_no)}</td>
                    <td style={s.td}>{getMachineLabel(e.machine_id)}</td>
                    <td style={s.td}>{e.shift}</td>
                    <td style={s.td}>{e.model_variant || '—'}</td>
                    <td style={s.td}>{e.current_operation}</td>
                    <td style={s.td}>{e.next_operation}</td>
                    <td style={s.td}>{formatCtSeconds(sumCt(e.process_time, e.loading_unloading))}</td>
                    <td style={s.td}>{e.available_shift_time}</td>
                    <td style={s.td}>{e.operating_time}</td>
                    <td style={s.td}>{e.possible_qty}</td>
                    <td style={s.td}>{e.actual_qty}</td>
                    <td style={{ ...s.td, color: prodLoss > 0 ? '#f59e0b' : '#10b981' }}>{prodLoss}</td>
                    <td style={s.td}>{e.accp_qty}</td>
                    {/* Defect — editable inline */}
                    <td style={{ ...s.td, color: safeNum(e.defect_qty) > 0 ? '#ef4444' : '#10b981' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 180 }}>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input type="number" min="0" max={e.actual_qty}
                              style={{ ...s.input, width: 70, padding: '3px 6px', fontSize: 12 }}
                              value={defectEdit.value}
                              autoFocus
                              onChange={ev => setDefectEdit(p => ({ ...p, value: ev.target.value }))}
                              onKeyDown={ev => { if (ev.key === 'Enter') saveDefect(e.id); if (ev.key === 'Escape') setDefectEdit({ id: null, value: '', note: '' }); }}
                            />
                            <button disabled={defectSaving} onClick={() => saveDefect(e.id)}
                              style={{ padding: '3px 8px', background: '#10b981', color: '#fff',
                                       border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓</button>
                            <button onClick={() => setDefectEdit({ id: null, value: '', note: '' })}
                              style={{ padding: '3px 6px', background: t.surface2, color: t.textMuted,
                                       border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✕</button>
                          </div>
                          <input placeholder="QC note (optional)"
                            style={{ ...s.input, fontSize: 11, padding: '3px 6px' }}
                            value={defectEdit.note}
                            onChange={ev => setDefectEdit(p => ({ ...p, note: ev.target.value }))}
                          />
                        </div>
                      ) : (
                        <span>{e.defect_qty}</span>
                      )}
                    </td>
                    <td style={s.td}>{safeNum(e.ar).toFixed(2)}%</td>
                    <td style={s.td}>{safeNum(e.pr).toFixed(2)}%</td>
                    <td style={s.td}>{safeNum(e.qr).toFixed(2)}%</td>
                    <td style={{ ...s.td, fontWeight: 700, color: oee >= 85 ? '#10b981' : oee >= 65 ? '#f59e0b' : '#ef4444' }}>
                      {oee.toFixed(2)}%
                    </td>
                    {/* QC Edit column */}
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!isEditing && (
                          <button onClick={() => setDefectEdit({ id: e.id, value: String(e.defect_qty || 0), note: '' })}
                            style={{ padding: '3px 8px', background: '#f59e0b', color: '#fff', border: 'none',
                                     borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                            title="Update defect qty after QC">✏ QC</button>
                        )}
                        <button onClick={() => loadDefectLog(e.id)}
                          style={{ padding: '3px 8px', background: showLog ? t.accent : t.surface2,
                                   color: showLog ? '#fff' : t.textMuted, border: 'none',
                                   borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                          title="View QC history">{showLog ? '▲ Hide' : '📋 Log'}</button>
                      </div>
                    </td>
                  </tr>
                  {/* QC history expansion row */}
                  {showLog && (
                    <tr key={`log-${e.id}`}>
                      <td colSpan={20} style={{ padding: '0 8px 12px 8px', background: t.surface2 }}>
                        <div style={{ padding: '10px 12px', borderRadius: 8, background: t.surface,
                                      border: `1px solid ${t.border}`, marginTop: 4 }}>
                          <div style={{ color: t.accent, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
                            QC Defect Update History — {e.current_operation} | {e.entry_date} Shift {e.shift}
                          </div>
                          {defectLog.records.length === 0 ? (
                            <div style={{ color: t.textFaint, fontSize: 12 }}>No QC updates recorded yet.</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                              <thead>
                                <tr>
                                  {['Updated At (IST)','Updated By','Before Defect','Before Accp','Before QR%','Before OEE%',
                                    'After Defect','After Accp','After QR%','After OEE%','Note'].map(h => (
                                    <th key={h} style={{ padding: '5px 8px', background: t.surface2, color: t.textDim,
                                                         textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {defectLog.records.map((l, li) => (
                                  <tr key={l.id}>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.text }}>{fmtIST(l.updated_at)}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.text }}>{l.updated_by}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: '#ef4444' }}>{l.before_defect_qty}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.text }}>{l.before_accp_qty}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.textMuted }}>{l.before_qr.toFixed(2)}%</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: l.before_oee >= 85 ? '#10b981' : l.before_oee >= 65 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>{l.before_oee.toFixed(2)}%</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: '#10b981' }}>{l.after_defect_qty}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.text }}>{l.after_accp_qty}</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.textMuted }}>{l.after_qr.toFixed(2)}%</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: l.after_oee >= 85 ? '#10b981' : l.after_oee >= 65 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>{l.after_oee.toFixed(2)}%</td>
                                    <td style={{ padding: '5px 8px', borderBottom: `1px solid ${t.border}`, color: t.textMuted }}>{l.note || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getStyles(t) {
  return {
    page: { padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text },
    alert: { background: '#7f1d1d', color: '#fca5a5', padding: '10px 16px', borderRadius: 8,
             marginBottom: 10, fontSize: 13, fontWeight: 600 },
    filterBar: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' },
    viewBtns: { display: 'flex', gap: 4 },
    viewBtn: { padding: '6px 14px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface2,
               color: t.textMuted, cursor: 'pointer', fontSize: 13 },
    viewBtnActive: { background: t.accent, color: '#fff', border: `1px solid ${t.accent}` },
    input: { padding: '6px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp,
             color: t.text, fontSize: 13 },
    dlBtn: { marginLeft: 'auto', padding: '6px 16px', background: t.brand, color: '#fff', border: 'none',
             borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    kpiRow: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 },
    kpi: { background: t.surface, borderRadius: 10, padding: '16px 20px', minWidth: 130, flex: 1 },
    charts: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 },
    chartBox: { background: t.surface, borderRadius: 10, padding: 16, overflow: 'visible' },
    chartTitle: { color: t.textMuted, margin: '0 0 12px', fontSize: 14 },
    noData: { height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: t.textFaint, fontSize: 13 },
    donutRow: { display: 'flex', justifyContent: 'space-around', alignItems: 'center',
                flexWrap: 'wrap', gap: 8, paddingTop: 4, paddingBottom: 4, minHeight: 220 },
    donutWrap: { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: DONUT_CANVAS, height: DONUT_CANVAS, flexShrink: 0 },
    donutCenter: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                   display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                   pointerEvents: 'none', textAlign: 'center' },
    tableWrap: { background: t.surface, borderRadius: 10, overflow: 'auto' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: { padding: '10px 8px', background: t.surface2, color: t.textDim, textAlign: 'left', whiteSpace: 'nowrap' },
    td: { padding: '8px', borderBottom: `1px solid ${t.surface2}`, color: t.text, whiteSpace: 'nowrap' },
    tr: { transition: 'background .15s' },
  };
}

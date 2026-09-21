import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { assetUrl } from '../../api/config';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import {
  getServiceDueStatus,
  ServiceStatusBadge,
  ServiceDaysDisplay,
  ServiceStatusStyles,
  ServiceAlertChips,
  countServiceAlerts,
  HierarchyAlertCounts,
} from './serviceStatus';

const LEVELS = [
  { id: 'location', label: 'Location', color: '#0ea5e9', icon: '📍' },
  { id: 'building', label: 'Building', color: '#8b5cf6', icon: '🏢' },
  { id: 'facility', label: 'Facility / Lab', color: '#10b981', icon: '🔬' },
  { id: 'equipment', label: 'Equipment', color: '#f59e0b', icon: '⚙️' },
];

/**
 * Cascading hierarchy:
 * Click Location → Building column fills with children
 * Click Building → Facility column fills
 * Click Facility → Equipment column fills (registered AST assets preferred)
 * Click Equipment → Full detail panel (same as Asset Management)
 */
export default function FmmsAssetHierarchy() {
  const { theme: t } = useTheme();
  const [focusLevel, setFocusLevel] = useState('location');
  const [selected, setSelected] = useState({
    location: null,
    building: null,
    facility: null,
    equipment: null,
  });
  const [lists, setLists] = useState({
    location: [],
    building: [],
    facility: [],
    equipment: [],
  });
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState({ location: '', building: '', facility: '', equipment: '' });
  const [registeredFleet, setRegisteredFleet] = useState([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const fleetRef = useRef([]);
  fleetRef.current = registeredFleet;

  const inp = {
    padding: '6px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 12, width: '100%', boxSizing: 'border-box',
  };
  const btnSecondary = {
    padding: '8px 16px', background: t.surface2, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
  };

  const fetchLevel = useCallback(async (level, parent = null) => {
    const parentId = parent?.id ?? null;
    setLoading((p) => ({ ...p, [level]: true }));
    try {
      let rows = [];
      if (level === 'equipment') {
        const sel = selectedRef.current;
        const locName = sel.location?.name || null;
        const bldName = sel.building?.name || null;
        const facName = parent?.name || sel.facility?.name || null;

        // 1) Registered equipment (AST / mapped) — full machine details
        let registered = fleetRef.current.length
          ? fleetRef.current
          : await fetchRegisteredEquipment();
        if (!fleetRef.current.length && registered.length) setRegisteredFleet(registered);
        if (facName || locName || bldName) {
          registered = registered.filter((a) => matchesPlace(a, locName, bldName, facName));
        }

        // 2) Hierarchy children under facility (may include EQ scaffolds)
        let children = [];
        if (parentId) {
          const [eqRes, subRes] = await Promise.all([
            api.get('/api/fmms/assets', { params: { hierarchy_level: 'equipment', parent_id: parentId } }),
            api.get('/api/fmms/assets', { params: { hierarchy_level: 'sub_assembly', parent_id: parentId } }),
          ]);
          children = [...asList(eqRes.data), ...asList(subRes.data)];
        }

        rows = preferRegisteredEquipment(registered, children);
      } else {
        const params = { hierarchy_level: level };
        if (parentId) params.parent_id = parentId;
        const { data } = await api.get('/api/fmms/assets', { params });
        rows = asList(data);
      }
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      setLists((p) => ({ ...p, [level]: rows }));
      return rows;
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
      setLists((p) => ({ ...p, [level]: [] }));
      return [];
    } finally {
      setLoading((p) => ({ ...p, [level]: false }));
    }
  }, []);

  useEffect(() => {
    fetchLevel('location');
    fetchRegisteredEquipment()
      .then((rows) => setRegisteredFleet(rows))
      .catch(() => setRegisteredFleet([]));
  }, [fetchLevel]);

  /** Resolve EQ scaffold → registered AST asset with full details */
  const resolveRegisteredAsset = useCallback(async (asset) => {
    if (!asset?.id) return null;
    if (isRegisteredAsset(asset)) return asset;

    try {
      const sel = selectedRef.current;
      const registered = await fetchRegisteredEquipment();
      const nameKey = String(asset.name || asset.equipment_name || '').trim().toLowerCase();
      const match = registered.find((a) => {
        const aName = String(a.name || a.equipment_name || '').trim().toLowerCase();
        if (aName !== nameKey) return false;
        return matchesPlace(
          a,
          sel.location?.name || asset.location,
          sel.building?.name || asset.building,
          sel.facility?.name || asset.facility_lab,
        );
      }) || registered.find((a) => String(a.name || '').trim().toLowerCase() === nameKey);

      return match || asset;
    } catch {
      return asset;
    }
  }, []);

  const loadDetail = useCallback(async (asset) => {
    if (!asset?.id) {
      setDetail(null);
      setHistory([]);
      return;
    }
    setDetailLoading(true);
    try {
      const resolved = await resolveRegisteredAsset(asset);
      const [aRes, hRes] = await Promise.all([
        api.get(`/api/fmms/assets/${resolved.id}`),
        api.get(`/api/fmms/assets/${resolved.id}/history`),
      ]);
      setDetail(aRes.data);
      setHistory(hRes.data || []);
      // Keep selection pointing at the rich registered record
      if (resolved.id !== asset.id) {
        setSelected((p) => ({ ...p, equipment: { ...resolved, ...aRes.data } }));
      }
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
      setDetail(asset);
    } finally {
      setDetailLoading(false);
    }
  }, [resolveRegisteredAsset]);

  const onPick = async (level, node) => {
    setMsg('');
    if (level === 'location') {
      setSelected({ location: node, building: null, facility: null, equipment: null });
      setDetail(null);
      setHistory([]);
      setLists((p) => ({ ...p, building: [], facility: [], equipment: [] }));
      setFocusLevel('building');
      await fetchLevel('building', node);
    } else if (level === 'building') {
      setSelected((p) => ({ ...p, building: node, facility: null, equipment: null }));
      setDetail(null);
      setHistory([]);
      setLists((p) => ({ ...p, facility: [], equipment: [] }));
      setFocusLevel('facility');
      await fetchLevel('facility', node);
    } else if (level === 'facility') {
      setSelected((p) => ({ ...p, facility: node, equipment: null }));
      setDetail(null);
      setHistory([]);
      setLists((p) => ({ ...p, equipment: [] }));
      setFocusLevel('equipment');
      await fetchLevel('equipment', node);
    } else if (level === 'equipment') {
      setSelected((p) => ({ ...p, equipment: node }));
      setFocusLevel('equipment');
      await loadDetail(node);
    }
  };

  const openLevelMenu = async (level) => {
    setFocusLevel(level);
    setMsg('');
    const sel = selectedRef.current;
    if (level === 'location') {
      await fetchLevel('location');
    } else if (level === 'building') {
      await fetchLevel('building', sel.location || null);
    } else if (level === 'facility') {
      await fetchLevel('facility', sel.building || null);
    } else if (level === 'equipment') {
      await fetchLevel('equipment', sel.facility || null);
    }
  };

  const clearFrom = (level) => {
    if (level === 'location') {
      setSelected({ location: null, building: null, facility: null, equipment: null });
      setLists((p) => ({ ...p, building: [], facility: [], equipment: [] }));
      setDetail(null);
      setHistory([]);
      setFocusLevel('location');
      fetchLevel('location');
    } else if (level === 'building') {
      setSelected((p) => ({ ...p, building: null, facility: null, equipment: null }));
      setLists((p) => ({ ...p, facility: [], equipment: [] }));
      setDetail(null);
      setFocusLevel('building');
    } else if (level === 'facility') {
      setSelected((p) => ({ ...p, facility: null, equipment: null }));
      setLists((p) => ({ ...p, equipment: [] }));
      setDetail(null);
      setFocusLevel('facility');
    } else {
      setSelected((p) => ({ ...p, equipment: null }));
      setDetail(null);
      setHistory([]);
    }
  };

  const refresh = async () => {
    await openLevelMenu(focusLevel);
    if (selectedRef.current.equipment) await loadDetail(selectedRef.current.equipment);
  };

  const filterList = (level, rows) => {
    const q = (search[level] || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((n) =>
      [n.name, n.asset_code, n.machine_type, n.location, n.building, n.facility_lab]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  };

  const showBuilding = !!selected.location || focusLevel === 'building' || focusLevel === 'facility' || focusLevel === 'equipment';
  const showFacility = !!selected.building || focusLevel === 'facility' || focusLevel === 'equipment';
  const showEquipment = !!selected.facility || focusLevel === 'equipment';

  const columns = [
    { level: 'location', visible: true },
    { level: 'building', visible: showBuilding },
    { level: 'facility', visible: showFacility },
    { level: 'equipment', visible: showEquipment },
  ].filter((c) => c.visible);

  const colCount = columns.length + (selected.equipment || detail ? 1 : 0);
  const serviceStatus = detail
    ? getServiceDueStatus(detail.next_service_date, detail.alert_before_days)
    : null;

  const menuAlertCounts = {
    location: countServiceAlerts(registeredFleet),
    building: countServiceAlerts(
      registeredFleet.filter((a) => matchesPlace(a, selected.location?.name || null, null, null)),
    ),
    facility: countServiceAlerts(
      registeredFleet.filter((a) => matchesPlace(
        a,
        selected.location?.name || null,
        selected.building?.name || null,
        null,
      )),
    ),
    equipment: countServiceAlerts(
      registeredFleet.filter((a) => matchesPlace(
        a,
        selected.location?.name || null,
        selected.building?.name || null,
        selected.facility?.name || null,
      )),
    ),
  };

  const alertsForNode = (level, node) => {
    if (!node) return { overdue: 0, breached: 0, total: 0 };
    if (level === 'location') {
      return countServiceAlerts(registeredFleet.filter((a) => matchesPlace(a, node.name, null, null)));
    }
    if (level === 'building') {
      return countServiceAlerts(registeredFleet.filter((a) => matchesPlace(
        a,
        selected.location?.name || null,
        node.name,
        null,
      )));
    }
    if (level === 'facility') {
      return countServiceAlerts(registeredFleet.filter((a) => matchesPlace(
        a,
        selected.location?.name || null,
        selected.building?.name || null,
        node.name,
      )));
    }
    return { overdue: 0, breached: 0, total: 0 };
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <ServiceStatusStyles />
      <PageHeader
        title="Asset Hierarchy"
        onRefresh={refresh}
        extra={(
          <Link to="/fmms/assets" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            ← Asset Management
          </Link>
        )}
      />

      {msg && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {LEVELS.map((lv, idx) => {
          const active = focusLevel === lv.id;
          const picked = selected[lv.id];
          const counts = menuAlertCounts[lv.id] || { overdue: 0, breached: 0 };
          return (
            <button
              key={lv.id}
              type="button"
              onClick={() => openLevelMenu(lv.id)}
              style={{
                padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                border: `2px solid ${active ? lv.color : t.border}`,
                background: active ? `${lv.color}22` : t.surface2,
                color: t.text,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', width: 22, height: 22, borderRadius: 6,
                  alignItems: 'center', justifyContent: 'center', background: lv.color, color: '#fff', fontSize: 11,
                }}>{idx + 1}</span>
                {lv.icon} {lv.label}
                {picked ? ` · ${picked.name}` : ''}
              </span>
              {(lv.id === 'location' || lv.id === 'building' || lv.id === 'facility') && (
                <HierarchyAlertCounts
                  overdue={counts.overdue}
                  actionRequired={counts.actionRequired}
                  dueToday={counts.dueToday}
                />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: t.textDim, marginBottom: 12 }}>
        Path:{' '}
        <strong style={{ color: t.text }}>
          {[selected.location?.name, selected.building?.name, selected.facility?.name, selected.equipment?.name]
            .filter(Boolean).join(' › ') || 'Select a location — buildings open in the next panel'}
        </strong>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, minmax(190px, 1fr))`,
        gap: 12,
        alignItems: 'start',
      }}>
        {columns.map((col) => {
          const meta = LEVELS.find((l) => l.id === col.level);
          const rows = filterList(col.level, lists[col.level] || []);
          const parentLabel =
            col.level === 'building' ? selected.location?.name
              : col.level === 'facility' ? selected.building?.name
                : col.level === 'equipment' ? selected.facility?.name
                  : null;

          return (
            <section
              key={col.level}
              className={surfaceClass(t)}
              style={{
                background: t.surface,
                border: `2px solid ${focusLevel === col.level ? meta.color : `${meta.color}55`}`,
                borderRadius: 10,
                padding: 12,
                minHeight: 380,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>
                  {meta.icon} {meta.label}
                </span>
                {selected[col.level] && (
                  <button type="button" style={{ ...btnSecondary, padding: '2px 8px', fontSize: 11 }}
                    onClick={() => clearFrom(col.level)}>Clear</button>
                )}
              </div>

              {parentLabel ? (
                <div style={{
                  fontSize: 11, marginBottom: 8, padding: '6px 8px', borderRadius: 6,
                  background: `${meta.color}14`, color: t.textDim,
                }}>
                  Linked under: <strong style={{ color: t.text }}>{parentLabel}</strong>
                </div>
              ) : col.level !== 'location' ? (
                <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 8 }}>
                  All {meta.label.toLowerCase()}s (or pick parent in previous panel)
                </div>
              ) : (
                <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 8 }}>
                  Click a location to load its buildings →
                </div>
              )}

              <input
                style={{ ...inp, marginBottom: 8 }}
                placeholder={`Search ${meta.label}…`}
                value={search[col.level] || ''}
                onChange={(e) => setSearch((p) => ({ ...p, [col.level]: e.target.value }))}
              />

              {loading[col.level] ? (
                <p style={{ fontSize: 12, color: t.textDim }}>Loading…</p>
              ) : (
                <div style={{ display: 'grid', gap: 5, maxHeight: 'calc(100vh - 310px)', overflowY: 'auto' }}>
                  {rows.map((n) => {
                    const isSel = selected[col.level]?.id === n.id
                      || (col.level === 'equipment' && selected.equipment?.name === n.name
                        && isRegisteredAsset(selected.equipment) && !isRegisteredAsset(n));
                    const nodeAlerts = (col.level === 'location' || col.level === 'building' || col.level === 'facility')
                      ? alertsForNode(col.level, n)
                      : null;
                    const eqStatus = col.level === 'equipment'
                      ? getServiceDueStatus(n.next_service_date, n.alert_before_days)
                      : null;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => onPick(col.level, n)}
                        style={{
                          textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${isSel ? meta.color : t.border}`,
                          background: isSel ? `${meta.color}22` : t.surface2,
                          color: t.text,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {eqStatus && <ServiceStatusBadge status={eqStatus} size={14} />}
                          <div style={{ fontWeight: 600, fontSize: 13, minWidth: 0, flex: 1 }}>{n.name}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 10, color: t.textFaint }}>{n.asset_code}</span>
                          {eqStatus && <ServiceAlertChips status={eqStatus} />}
                        </div>
                        {col.level === 'equipment' && n.machine_type && (
                          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>{n.machine_type}</div>
                        )}
                        {nodeAlerts && (
                          <HierarchyAlertCounts
                            overdue={nodeAlerts.overdue}
                            actionRequired={nodeAlerts.actionRequired}
                            dueToday={nodeAlerts.dueToday}
                          />
                        )}
                      </button>
                    );
                  })}
                  {rows.length === 0 && (
                    <p style={{ fontSize: 12, color: t.textFaint, textAlign: 'center', padding: 16 }}>
                      {col.level === 'building' && !selected.location
                        ? 'Select a location on the left to list buildings here.'
                        : col.level === 'facility' && !selected.building
                          ? 'Select a building to list facilities here.'
                          : col.level === 'equipment' && !selected.facility
                            ? 'Select a facility to list equipment here.'
                            : `No ${meta.label.toLowerCase()} found.`}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {(selected.equipment || detail) && (
          <section className={surfaceClass(t)} style={{
            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14, minHeight: 380,
            minWidth: 0, overflow: 'hidden',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textDim, marginBottom: 10, textTransform: 'uppercase' }}>
              Equipment details
            </div>
            {detailLoading ? (
              <p style={{ color: t.textDim, fontSize: 13 }}>Loading…</p>
            ) : !detail ? (
              <p style={{ color: t.textFaint, fontSize: 13 }}>Select equipment to view details.</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <ServiceStatusBadge status={serviceStatus} size={18} />
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: t.textFaint }}>{detail.asset_code}</div>
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 6 }}>{detail.name}</div>
                <div style={{ fontSize: 12, color: t.textDim, marginBottom: 12 }}>
                  {[detail.location, detail.building, detail.facility_lab].filter(Boolean).join(' › ')
                    || detail.hierarchy_path || '—'}
                </div>
                {detail.image_url && (
                  <img src={assetUrl(detail.image_url)} alt={detail.name}
                    style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', borderRadius: 8, border: `1px solid ${t.border}`, marginBottom: 10 }} />
                )}
                <DetailRow t={t} label="Type" value={detail.machine_type} />
                <DetailRow t={t} label="Make" value={detail.manufacturer} />
                <DetailRow t={t} label="Model / Serial" value={[detail.model_number, detail.serial_number].filter(Boolean).join(' / ')} />
                <DetailRow t={t} label="Class" value={detail.classification === 'critical' ? 'Critical' : 'Non-Critical'} />
                <DetailRow t={t} label="Status" value={detail.status} />
                <DetailRow t={t} label="Schedule" value={detail.schedule_type === 'pm' ? 'PM' : 'Calibration'} />
                <DetailRow t={t} label="Last service" value={detail.last_service_date} />
                <DetailRow t={t} label="Next service" value={detail.next_service_date} />
                <DetailRow t={t} label="Next service in days">
                  <ServiceDaysDisplay status={serviceStatus} textDim={t.textDim} />
                </DetailRow>
                {history.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, marginBottom: 6 }}>History</div>
                    {history.slice(0, 4).map((h) => (
                      <div key={h.id} style={{ fontSize: 11, padding: '4px 0', borderBottom: `1px solid ${t.border}`, color: t.text }}>
                        {h.title} <span style={{ color: t.textFaint }}>· {h.event_date || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Link to="/fmms/assets" style={{ ...btnSecondary, display: 'inline-block', textDecoration: 'none', marginTop: 12, fontSize: 12 }}>
                  Open in Asset Management
                </Link>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

/** Load all registered equipment pages (API page_size max 1000). */
async function fetchRegisteredEquipment() {
  const pageSize = 100;
  const first = await api.get('/api/fmms/assets', {
    params: { equipment_only: true, page: 1, page_size: pageSize },
  });
  const rows = asList(first.data);
  const total = first.data?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return rows;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      api.get('/api/fmms/assets', {
        params: { equipment_only: true, page: i + 2, page_size: pageSize },
      })),
  );
  for (const res of rest) rows.push(...asList(res.data));
  return rows;
}

function isRegisteredAsset(a) {
  if (!a) return false;
  const code = String(a.asset_code || '');
  if (code.startsWith('AST-')) return true;
  if (a.machine_id || a.machine_type || a.next_service_date || a.image_url || a.manufacturer) return true;
  // Scaffold hierarchy equipment codes: ...-EQ-001
  if (/-EQ-\d+$/i.test(code)) return false;
  return false;
}

function matchesPlace(a, locName, bldName, facName) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  if (facName) {
    if (!norm(a.facility_lab) || norm(a.facility_lab) !== norm(facName)) return false;
  }
  if (bldName) {
    if (!norm(a.building) || norm(a.building) !== norm(bldName)) return false;
  }
  if (locName) {
    if (!norm(a.location) || norm(a.location) !== norm(locName)) return false;
  }
  return true;
}

/** Prefer AST/registered rows over EQ scaffold duplicates with the same name. */
function preferRegisteredEquipment(registered, children) {
  const byName = new Map();
  const push = (row) => {
    const key = String(row.name || row.equipment_name || '').trim().toLowerCase();
    if (!key) {
      byName.set(`id:${row.id}`, row);
      return;
    }
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, row);
      return;
    }
    // Prefer registered over scaffold
    if (isRegisteredAsset(row) && !isRegisteredAsset(prev)) byName.set(key, row);
    else if (isRegisteredAsset(row) === isRegisteredAsset(prev)) {
      // Prefer AST code / richer record
      const score = (a) => (String(a.asset_code || '').startsWith('AST-') ? 4 : 0)
        + (a.image_url ? 2 : 0) + (a.next_service_date ? 1 : 0) + (a.machine_type ? 1 : 0);
      if (score(row) > score(prev)) byName.set(key, row);
    }
  };
  registered.forEach(push);
  children.forEach(push);
  return Array.from(byName.values());
}

function DetailRow({ t, label, value, children }) {
  if (!children && (value == null || value === '')) return null;
  return (
    <div style={{
      display: 'flex', gap: 8, fontSize: 12, marginBottom: 6, alignItems: 'flex-start',
      minWidth: 0, maxWidth: '100%',
    }}>
      <span style={{ color: t.textDim, minWidth: 100, maxWidth: '42%', flexShrink: 0 }}>{label}</span>
      <span style={{
        color: t.text, flex: 1, minWidth: 0, overflow: 'hidden',
        wordBreak: 'break-word', overflowWrap: 'anywhere',
      }}>
        {children || value}
      </span>
    </div>
  );
}

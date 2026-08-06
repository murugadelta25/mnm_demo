import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { pageClass } from '../themes/tileHelpers';
import { useConfig } from '../context/ConfigContext';
import { useBranding } from '../context/BrandingContext';
import { DEFAULT_APP_NAME } from '../config/branding';
import PageHeader from '../components/PageHeader';
import api from '../api/client';
import { assetUrl } from '../api/config';
import { applySiteBranding } from '../utils/siteBranding';

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const EMPTY_FACTORY = {
  name: '',
  logoUrl: '',
  location: { address: '', lat: '', lng: '' },
  departments: [],
};

function newDepartment() {
  return { id: uid(), name: '', lines: [] };
}

function newLine() {
  return { id: uid(), name: '', stationIds: [], enabled: true };
}

/** First *enabled* line that owns each station (disabled lines do not lock stations). */
function stationOwnersInFactory(factory) {
  const owners = new Map();
  for (const dept of factory?.departments || []) {
    for (const line of dept.lines || []) {
      if (line.enabled === false) continue;
      for (const raw of line.stationIds || []) {
        const id = Number(raw);
        if (!Number.isFinite(id) || owners.has(id)) continue;
        owners.set(id, {
          lineId: line.id,
          lineName: (line.name || '').trim() || 'unnamed line',
          deptName: (dept.name || '').trim() || 'unnamed dept',
        });
      }
    }
  }
  return owners;
}

/**
 * One station → one line. Enabled lines claim first; disabled lines keep only
 * stations that no enabled line is using (so a disabled line does not block reuse).
 */
function uniqueStationIdsAcrossDepartments(departments) {
  const claimed = new Set();

  const claimForLines = (depts, onlyEnabled) =>
    (depts || []).map((d) => ({
      ...d,
      lines: (d.lines || []).map((l) => {
        const isDisabled = l.enabled === false;
        if (onlyEnabled ? isDisabled : !isDisabled) {
          return { ...l, stationIds: [...(l.stationIds || [])] };
        }
        const cleaned = [];
        for (const raw of l.stationIds || []) {
          const id = Number(raw);
          if (!Number.isFinite(id) || claimed.has(id)) continue;
          claimed.add(id);
          cleaned.push(id);
        }
        return { ...l, stationIds: cleaned };
      }),
    }));

  return claimForLines(claimForLines(departments, true), false);
}

/** Drop station ids from disabled lines when an enabled line takes them. */
function stripStationsFromDisabledLines(departments, stationIds, exceptLineId) {
  const take = new Set((stationIds || []).map(Number).filter(Number.isFinite));
  if (take.size === 0) return departments;
  return (departments || []).map((d) => ({
    ...d,
    lines: (d.lines || []).map((l) => {
      if (l.id === exceptLineId || l.enabled !== false) return l;
      const next = (l.stationIds || [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && !take.has(id));
      return { ...l, stationIds: next };
    }),
  }));
}

export default function FactorySetup() {
  const { config, reload } = useConfig();
  const { reload: reloadBranding } = useBranding();
  const { theme: t } = useTheme();
  const [siteTitle, setSiteTitle] = useState(DEFAULT_APP_NAME);
  const [faviconFactoryId, setFaviconFactoryId] = useState(null);
  const [factories, setFactories] = useState([]);
  const [stations, setStations] = useState([]);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [logoFiles, setLogoFiles] = useState({});
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingFactoryId, setEditingFactoryId] = useState(null);
  const [showFactoryForm, setShowFactoryForm] = useState(false);
  const [draftFactory, setDraftFactory] = useState(null);

  const [stationForm, setStationForm] = useState({ name: '', display_name: '' });
  const [editStationId, setEditStationId] = useState(null);
  const [showStationForm, setShowStationForm] = useState(false);
  const [stationMsg, setStationMsg] = useState('');

  useEffect(() => {
    const fc = config?.factory;
    if (!fc) return;
    setSiteTitle(fc.siteTitle || DEFAULT_APP_NAME);
    setFaviconFactoryId(fc.faviconFactoryId || null);
    // Always sync — including empty list after removals
    setFactories(Array.isArray(fc.factories) ? fc.factories : []);
  }, [config]);

  const fetchStations = useCallback(async () => {
    const r = await api.get('/api/stations/');
    setStations(r.data);
  }, []);

  useEffect(() => { fetchStations(); }, [fetchStations]);

  const openAddFactory = () => {
    setDraftFactory({ ...EMPTY_FACTORY, id: uid(), location: { address: '', lat: '', lng: '' }, departments: [] });
    setEditingFactoryId(null);
    setShowFactoryForm(true);
    setLogoPreview(null);
    setErr('');
  };

  const openEditFactory = (factory) => {
    setDraftFactory(JSON.parse(JSON.stringify({
      ...factory,
      location: factory.location || { address: '', lat: '', lng: '' },
      departments: factory.departments || [],
    })));
    setEditingFactoryId(factory.id);
    setShowFactoryForm(true);
    setLogoPreview(null);
    setErr('');
  };

  const updateDraft = (patch) => {
    setDraftFactory(prev => ({ ...prev, ...patch }));
  };

  const uploadLogoForFactory = async (factoryId, file) => {
    if (!file) return null;
    setUploadingLogo(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api.post('/api/config/factory-logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const logoUrl = up.data.logoUrl;
      // Keep draft + list in sync immediately so Save persists the URL
      setDraftFactory(prev => (prev && prev.id === factoryId ? { ...prev, logoUrl } : prev));
      setFactories(prev => prev.map(f => (f.id === factoryId ? { ...f, logoUrl } : f)));
      setLogoPreview(URL.createObjectURL(file));
      return logoUrl;
    } catch (e) {
      setErr(e.response?.data?.detail || 'Logo upload failed');
      return null;
    } finally {
      setUploadingLogo(false);
    }
  };

  const commitDraftFactory = async () => {
    if (!draftFactory?.name?.trim()) {
      setErr('Factory name is required');
      return;
    }
    const next = {
      ...draftFactory,
      name: draftFactory.name.trim(),
      location: {
        address: draftFactory.location?.address || '',
        lat: draftFactory.location?.lat || '',
        lng: draftFactory.location?.lng || '',
      },
      departments: uniqueStationIdsAcrossDepartments(
        (draftFactory.departments || []).map(d => ({
          ...d,
          name: (d.name || '').trim(),
          // Drop blank nameless lines with no stations so removals stick cleanly
          lines: (d.lines || [])
            .filter(l => (l.name || '').trim() || (l.stationIds || []).length)
            .map(l => ({
              ...l,
              name: (l.name || '').trim(),
              stationIds: l.stationIds || [],
              enabled: l.enabled !== false,
            })),
        })),
      ),
    };
    const updatedFactories = editingFactoryId
      ? factories.map(f => (f.id === editingFactoryId ? next : f))
      : [...factories, next];
    setFactories(updatedFactories);
    setShowFactoryForm(false);
    setDraftFactory(null);
    setEditingFactoryId(null);
    setLogoPreview(null);
    setErr('');
    // Persist immediately so Overview / Line screens drop removed lines without a second Save click
    await persistFactoryConfig(updatedFactories);
  };

  const removeFactory = async (id) => {
    if (!window.confirm('Remove this factory from configuration?')) return;
    const updated = factories.filter(f => f.id !== id);
    setFactories(updated);
    const nextFavicon = faviconFactoryId === id ? null : faviconFactoryId;
    if (faviconFactoryId === id) setFaviconFactoryId(null);
    if (draftFactory?.id === id) {
      setShowFactoryForm(false);
      setDraftFactory(null);
      setEditingFactoryId(null);
    }
    // Persist removal so Overview drops the factory/lines immediately
    setSaving(true);
    try {
      const payload = {
        ...config,
        factory: {
          configured: true,
          siteTitle: siteTitle.trim() || DEFAULT_APP_NAME,
          faviconFactoryId: nextFavicon,
          factories: updated,
        },
      };
      const { data: savedCfg } = await api.put('/api/config/', { config: payload });
      const savedFactories = savedCfg?.factory?.factories || updated;
      setFactories(savedFactories);
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to remove factory');
    } finally {
      setSaving(false);
    }
  };

  const persistFactoryConfig = async (factoriesList) => {
    setSaving(true);
    try {
      const updatedFactories = [];
      for (const f of factoriesList) {
        let logoUrl = f.logoUrl || '';
        if (logoFiles[f.id]) {
          const fd = new FormData();
          fd.append('file', logoFiles[f.id]);
          const up = await api.post('/api/config/factory-logo', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          logoUrl = up.data.logoUrl;
        }
        updatedFactories.push({ ...f, logoUrl });
      }

      const payload = {
        ...config,
        factory: {
          configured: true,
          siteTitle: siteTitle.trim() || DEFAULT_APP_NAME,
          faviconFactoryId,
          factories: updatedFactories,
        },
      };
      const { data: savedCfg } = await api.put('/api/config/', { config: payload });
      const savedFactories = savedCfg?.factory?.factories || updatedFactories;
      setFactories(savedFactories);
      await reload();
      reloadBranding();
      applySiteBranding({
        siteTitle: payload.factory.siteTitle,
        factories: savedFactories,
        faviconFactoryId,
      });
      setLogoFiles({});
      setLogoPreview(null);
      setSaved(true);
      setErr('');
      setTimeout(() => setSaved(false), 2500);
      return true;
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to save factory setup');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (showFactoryForm && draftFactory) {
      setErr('Finish or cancel the open factory form before saving configuration');
      return;
    }
    await persistFactoryConfig(factories);
  };

  const openAddStation = () => {
    setStationForm({ name: '', display_name: '' });
    setEditStationId(null);
    setShowStationForm(true);
    setStationMsg('');
  };

  const openEditStation = (station) => {
    setStationForm({ name: station.name, display_name: station.display_name });
    setEditStationId(station.id);
    setShowStationForm(true);
    setStationMsg('');
  };

  const saveStation = async (e) => {
    e.preventDefault();
    try {
      if (editStationId) {
        await api.put(`/api/stations/${editStationId}`, { display_name: stationForm.display_name });
        setStationMsg('Station updated');
      } else {
        await api.post('/api/stations/', stationForm);
        setStationMsg('Station added');
      }
      setShowStationForm(false);
      fetchStations();
    } catch (err) {
      setStationMsg(err.response?.data?.detail || err.message);
    }
  };

  const deleteStation = async (id) => {
    if (!window.confirm('Delete this station?')) return;
    try {
      await api.delete(`/api/stations/${id}`);
      setStationMsg('Station deleted');
      fetchStations();
    } catch (err) {
      setStationMsg(err.response?.data?.detail || err.message);
    }
  };

  const toggleStationEnabled = async (st) => {
    const next = !(st.is_enabled !== false && st.is_enabled !== 0);
    try {
      await api.post(`/api/stations/${st.id}/enabled`, { is_enabled: next });
      setStationMsg(next ? `Station "${st.display_name || st.name}" enabled` : `Station "${st.display_name || st.name}" disabled`);
      fetchStations();
    } catch (err) {
      setStationMsg(err.response?.data?.detail || err.message);
    }
  };

  const deptCount = (f) => (f.departments || []).length;
  const lineCount = (f) => (f.departments || []).reduce((n, d) => n + (d.lines || []).length, 0);

  const s = {
    page: { padding: 24, maxWidth: 1200, margin: '0 auto' },
    card: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 20, marginBottom: 16 },
    title: { color: t.accent, fontSize: 14, fontWeight: 600, margin: '0 0 12px' },
    inp: { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface2, color: t.text, boxSizing: 'border-box' },
    btn: { padding: '10px 18px', borderRadius: 6, border: 'none', background: t.accent, color: '#fff', cursor: 'pointer', fontWeight: 600 },
    subBtn: { padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface2, color: t.text, cursor: 'pointer', fontSize: 12 },
    label: { fontSize: 12, color: t.textMuted, marginBottom: 4, display: 'block' },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { padding: '10px 8px', background: t.surface2, color: t.textDim, textAlign: 'left', fontWeight: 600 },
    td: { padding: '10px 8px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' },
    miniBtn: { padding: '4px 10px', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  };

  const renderFactoryEditor = () => {
    if (!draftFactory) return null;
    const fi = draftFactory;
    const setDept = (di, patch) => {
      const departments = [...(fi.departments || [])];
      departments[di] = { ...departments[di], ...patch };
      updateDraft({ departments });
    };

    return (
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={s.title}>{editingFactoryId ? 'Edit Factory' : 'Add Factory'}</h3>
          <button type="button" style={s.subBtn} onClick={() => { setShowFactoryForm(false); setDraftFactory(null); }}>✕</button>
        </div>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Factory Name</label>
            <input style={s.inp} value={fi.name}
              onChange={e => updateDraft({ name: e.target.value })} />
          </div>
          <div>
            <label style={s.label}>Factory Logo</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
              disabled={uploadingLogo}
              onChange={async (e) => {
                const file = e.target.files?.[0] || null;
                if (!file) return;
                setLogoFiles(p => ({ ...p, [fi.id]: file }));
                setLogoPreview(URL.createObjectURL(file));
                await uploadLogoForFactory(fi.id, file);
                e.target.value = '';
              }}
            />
            {uploadingLogo && (
              <p style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>Uploading logo...</p>
            )}
            {(logoPreview || fi.logoUrl) && (
              <img
                src={logoPreview || assetUrl(fi.logoUrl)}
                alt="logo"
                style={{ height: 56, marginTop: 8, objectFit: 'contain', display: 'block' }}
              />
            )}
            {fi.logoUrl && (
              <p style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>Saved: {fi.logoUrl}</p>
            )}
            <label style={{ ...s.label, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={faviconFactoryId === fi.id}
                onChange={e => setFaviconFactoryId(e.target.checked ? fi.id : null)} />
              Use as browser tab icon (favicon)
            </label>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={s.label}>Location (address)</label>
          <input style={s.inp} value={fi.location?.address || ''}
            placeholder="Full address for Google Maps"
            onChange={e => updateDraft({ location: { ...fi.location, address: e.target.value } })} />
        </div>
        <div style={{ ...s.grid2, marginTop: 12 }}>
          <div>
            <label style={s.label}>Latitude</label>
            <input style={s.inp} value={fi.location?.lat || ''}
              onChange={e => updateDraft({ location: { ...fi.location, lat: e.target.value } })} />
          </div>
          <div>
            <label style={s.label}>Longitude</label>
            <input style={s.inp} value={fi.location?.lng || ''}
              onChange={e => updateDraft({ location: { ...fi.location, lng: e.target.value } })} />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={s.title}>Departments & Lines</h4>
            <button type="button" style={s.subBtn}
              onClick={() => updateDraft({ departments: [...(fi.departments || []), newDepartment()] })}>
              + Department
            </button>
          </div>
          {(fi.departments || []).map((dept, di) => (
            <div key={dept.id} style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={s.label}>Department Name</label>
                  <input style={s.inp} value={dept.name}
                    onChange={e => setDept(di, { name: e.target.value })} />
                </div>
                <button type="button" style={{ ...s.miniBtn, background: '#ef4444', marginBottom: 1 }}
                  onClick={() => {
                    updateDraft({ departments: fi.departments.filter((_, i) => i !== di) });
                  }}>Remove</button>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button type="button" style={s.subBtn}
                  onClick={() => {
                    const departments = [...fi.departments];
                    departments[di] = { ...dept, lines: [...(dept.lines || []), newLine()] };
                    updateDraft({ departments });
                  }}>+ Line</button>
              </div>
              {(dept.lines || []).map((line, li) => (
                <div key={line.id} style={{
                  marginTop: 10,
                  paddingLeft: 12,
                  borderLeft: `3px solid ${line.enabled === false ? t.textFaint : t.accent}`,
                  opacity: line.enabled === false ? 0.72 : 1,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={s.label}>Line Name</label>
                      <input style={s.inp} value={line.name}
                        onChange={e => {
                          const departments = [...fi.departments];
                          const lines = [...dept.lines];
                          lines[li] = { ...line, name: e.target.value };
                          departments[di] = { ...dept, lines };
                          updateDraft({ departments });
                        }} />
                    </div>
                    <button
                      type="button"
                      style={{
                        ...s.miniBtn,
                        marginBottom: 1,
                        background: line.enabled === false ? '#64748b' : (t.brand || '#10b981'),
                      }}
                      onClick={() => {
                        const departments = [...fi.departments];
                        const lines = [...dept.lines];
                        const turningOn = line.enabled === false;
                        let nextLine = { ...line, enabled: turningOn };
                        if (turningOn) {
                          // Stations already on another enabled line stay there; drop them here
                          const otherOwners = stationOwnersInFactory(fi);
                          nextLine = {
                            ...nextLine,
                            stationIds: (line.stationIds || [])
                              .map(Number)
                              .filter((id) => {
                                const o = otherOwners.get(id);
                                return !o || o.lineId === line.id;
                              }),
                          };
                        }
                        lines[li] = nextLine;
                        departments[di] = { ...dept, lines };
                        updateDraft({ departments });
                      }}
                      title={line.enabled === false ? 'Enable this line in overviews' : 'Disable this line in overviews'}
                    >
                      {line.enabled === false ? 'Disabled' : 'Enabled'}
                    </button>
                    <button type="button" style={{ ...s.miniBtn, background: '#ef4444', marginBottom: 1 }}
                      onClick={() => {
                        const departments = [...fi.departments];
                        departments[di] = { ...dept, lines: dept.lines.filter((_, i) => i !== li) };
                        updateDraft({ departments });
                      }}>Remove</button>
                  </div>
                  <label style={{ ...s.label, marginTop: 8 }}>Stations on this line</label>
                  {stations.length === 0 ? (
                    <p style={{
                      margin: '6px 0 0',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: `1px dashed ${t.border}`,
                      background: t.surface2 || t.surface,
                      fontSize: 12,
                      color: t.textMuted || t.textFaint,
                      lineHeight: 1.45,
                    }}>
                      No stations available yet. Add a station from the <strong>Stations</strong> section below, then come back here to assign it to this line.
                    </p>
                  ) : (
                    (() => {
                      const selectedIds = (line.stationIds || []).map(Number);
                      const selectedSet = new Set(selectedIds);
                      const owners = stationOwnersInFactory(fi);
                      const takenByOtherLine = (stationId) => {
                        const owner = owners.get(Number(stationId));
                        return owner && owner.lineId !== line.id ? owner : null;
                      };
                      const availableStations = stations.filter((st) => !takenByOtherLine(st.id));
                      const allAvailableSelected = availableStations.length > 0
                        && availableStations.every((st) => selectedSet.has(Number(st.id)));
                      const setLineStations = (nextIds) => {
                        // Never keep ids already owned by another *enabled* line
                        const cleaned = nextIds
                          .map(Number)
                          .filter((id) => Number.isFinite(id) && !takenByOtherLine(id));
                        let departments = [...fi.departments];
                        const lines = [...(departments[di].lines || dept.lines)];
                        lines[li] = { ...line, stationIds: cleaned };
                        departments[di] = { ...departments[di], lines };
                        // Enabled line takes the station: free it from disabled lines
                        if (line.enabled !== false) {
                          departments = stripStationsFromDisabledLines(
                            departments,
                            cleaned,
                            line.id,
                          );
                        }
                        updateDraft({ departments });
                      };
                      const toggleStation = (stationId) => {
                        const id = Number(stationId);
                        if (selectedSet.has(id)) {
                          setLineStations(selectedIds.filter((x) => x !== id));
                          return;
                        }
                        if (takenByOtherLine(id)) return;
                        setLineStations([...selectedIds, id]);
                      };
                      return (
                        <div style={{
                          marginTop: 6,
                          border: `1px solid ${t.border}`,
                          borderRadius: 8,
                          background: t.surface2 || t.surface,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            flexWrap: 'wrap',
                            padding: '8px 10px',
                            borderBottom: `1px solid ${t.border}`,
                          }}>
                            <span style={{ fontSize: 12, color: t.textDim || t.textFaint }}>
                              {selectedIds.length} of {availableStations.length} available selected
                              {stations.length > availableStations.length
                                ? ` · ${stations.length - availableStations.length} used on other lines`
                                : ''}
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                style={{
                                  ...s.miniBtn,
                                  background: allAvailableSelected ? (t.surface || t.bg) : (t.accent || '#22cae7'),
                                  color: allAvailableSelected ? (t.text || '#fff') : '#041018',
                                  border: `1px solid ${t.border}`,
                                }}
                                onClick={() => setLineStations(availableStations.map((st) => Number(st.id)))}
                                disabled={allAvailableSelected || availableStations.length === 0}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                style={{
                                  ...s.miniBtn,
                                  background: t.surface || t.bg,
                                  color: t.text,
                                  border: `1px solid ${t.border}`,
                                }}
                                onClick={() => setLineStations([])}
                                disabled={selectedIds.length === 0}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          <div style={{
                            maxHeight: 180,
                            overflowY: 'auto',
                            padding: '6px 8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}>
                            {stations.map((st) => {
                              const sid = Number(st.id);
                              const checked = selectedSet.has(sid);
                              const other = takenByOtherLine(sid);
                              // Allow unchecking a duplicate; only block newly assigning a taken station
                              const locked = Boolean(other) && !checked;
                              const stEnabled = st.is_enabled !== false && st.is_enabled !== 0;
                              const label = st.display_name || st.name;
                              return (
                                <label
                                  key={st.id}
                                  title={
                                    locked
                                      ? `Already assigned to ${other.lineName} (${other.deptName}). Uncheck it there first.`
                                      : (checked && other
                                        ? `Also listed on ${other.lineName} — uncheck here to resolve the duplicate.`
                                        : undefined)
                                  }
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    cursor: locked ? 'not-allowed' : 'pointer',
                                    background: checked ? `${t.accent || '#22cae7'}22` : 'transparent',
                                    color: t.text,
                                    fontSize: 13,
                                    opacity: locked ? 0.45 : (stEnabled ? 1 : 0.55),
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={locked}
                                    onChange={() => toggleStation(st.id)}
                                    style={{
                                      width: 16,
                                      height: 16,
                                      accentColor: t.accent || '#22cae7',
                                      cursor: locked ? 'not-allowed' : 'pointer',
                                    }}
                                  />
                                  <span>
                                    {label}
                                    {!stEnabled ? ' (disabled)' : ''}
                                    {locked ? ` — on ${other.lineName}` : ''}
                                    {checked && other ? ` — duplicate of ${other.lineName}` : ''}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" style={s.btn} onClick={commitDraftFactory} disabled={saving}>
            {saving ? 'Saving…' : (editingFactoryId ? 'Update & Save Factory' : 'Add & Save Factory')}
          </button>
          <button type="button" style={s.subBtn} onClick={() => { setShowFactoryForm(false); setDraftFactory(null); }}>Cancel</button>
        </div>
      </div>
    );
  };

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader title="Factory Setup" subtitle="Site branding, stations, factories, departments, and line mapping" />

      <div style={s.card}>
        <h3 style={s.title}>Site Branding</h3>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Browser Tab Title</label>
            <input style={s.inp} value={siteTitle}
              placeholder="DELTA-EAP-PMS"
              onChange={e => setSiteTitle(e.target.value)} />
            <p style={{ fontSize: 11, color: t.textFaint, marginTop: 4 }}>
              Shown in the browser tab and window title bar
            </p>
          </div>
        </div>
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={s.title}>Factories ({factories.length})</h3>
          <button type="button" style={s.subBtn} onClick={openAddFactory}>+ Add Factory</button>
        </div>

        {showFactoryForm && renderFactoryEditor()}

        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Logo', 'Factory Name', 'Location', 'Departments', 'Lines', 'Favicon', 'Actions'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {factories.length === 0 ? (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: t.textFaint }}>No factories configured</td></tr>
              ) : factories.map(f => (
                <tr key={f.id}>
                  <td style={s.td}>
                    {f.logoUrl
                      ? <img src={assetUrl(f.logoUrl)} alt="" style={{ height: 32 }} />
                      : '—'}
                  </td>
                  <td style={s.td}>{f.name || '—'}</td>
                  <td style={s.td}>{f.location?.address || '—'}</td>
                  <td style={s.td}>{deptCount(f)}</td>
                  <td style={s.td}>{lineCount(f)}</td>
                  <td style={s.td}>{faviconFactoryId === f.id ? '✓' : '—'}</td>
                  <td style={s.td}>
                    <button type="button" style={{ ...s.miniBtn, background: t.accent, marginRight: 6 }}
                      onClick={() => openEditFactory(f)}>Edit</button>
                    <button type="button" style={{ ...s.miniBtn, background: '#ef4444' }}
                      onClick={() => removeFactory(f.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={s.title}>Stations ({stations.length})</h3>
          <button type="button" style={s.subBtn} onClick={openAddStation}>+ Add Station</button>
        </div>
        {stationMsg && (
          <p style={{ fontSize: 12, color: stationMsg.includes('deleted') || stationMsg.includes('updated') || stationMsg.includes('added') ? t.brand : '#ef4444', marginBottom: 8 }}>
            {stationMsg}
          </p>
        )}
        {showStationForm && (
          <form onSubmit={saveStation} style={{ marginBottom: 16, padding: 12, border: `1px solid ${t.border}`, borderRadius: 8 }}>
            <div style={s.grid2}>
              <div>
                <label style={s.label}>Station Name *</label>
                <input style={s.inp} value={stationForm.name} required disabled={!!editStationId}
                  onChange={e => setStationForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Display Name *</label>
                <input style={s.inp} value={stationForm.display_name} required
                  onChange={e => setStationForm(p => ({ ...p, display_name: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="submit" style={s.subBtn}>{editStationId ? 'Save' : 'Add'}</button>
              <button type="button" style={s.subBtn} onClick={() => setShowStationForm(false)}>Cancel</button>
            </div>
          </form>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Name', 'Display Name', 'Machines', 'Status', 'Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {stations.length === 0 ? (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: t.textFaint }}>No stations yet</td></tr>
              ) : stations.map(st => {
                const enabled = st.is_enabled !== false && st.is_enabled !== 0;
                return (
                <tr key={st.id} style={{ opacity: enabled ? 1 : 0.65 }}>
                  <td style={s.td}>{st.name}</td>
                  <td style={s.td}>{st.display_name}</td>
                  <td style={s.td}>{st.machine_count ?? 0}</td>
                  <td style={s.td}>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: enabled ? (t.brand || '#10b981') : '#94a3b8',
                    }}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <button type="button" style={{ ...s.miniBtn, background: t.accent, marginRight: 6 }}
                      onClick={() => openEditStation(st)}>Edit</button>
                    <button type="button" style={{
                      ...s.miniBtn,
                      background: enabled ? '#64748b' : (t.brand || '#10b981'),
                      marginRight: 6,
                    }}
                      onClick={() => toggleStationEnabled(st)}>
                      {enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" style={{ ...s.miniBtn, background: '#ef4444' }}
                      onClick={() => deleteStation(st.id)}>Delete</button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: t.textFaint, marginTop: 8 }}>
          Stations created here appear on the Machines page for machine assignment.
        </p>
      </div>

      {err && <p style={{ color: '#ef4444' }}>{err}</p>}
      {saved && <p style={{ color: t.brand }}>Factory configuration saved. Logos, departments, and lines are live across the app.</p>}
      <button type="button" style={{ ...s.btn, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving || uploadingLogo}>
        {saving ? 'Saving...' : 'Save Factory Configuration'}
      </button>
      <p style={{ fontSize: 11, color: t.textFaint, marginTop: 8 }}>
        Add factories with logo, location, departments, and lines, then click Save. Machine Config and Hourly Output will use the saved lines dynamically.
      </p>
    </div>
  );
}

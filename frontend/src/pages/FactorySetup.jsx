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
  return { id: uid(), name: '', stationIds: [] };
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
  const [editingFactoryId, setEditingFactoryId] = useState(null);
  const [showFactoryForm, setShowFactoryForm] = useState(false);
  const [draftFactory, setDraftFactory] = useState(null);

  const [stationForm, setStationForm] = useState({ name: '', display_name: '' });
  const [editStationId, setEditStationId] = useState(null);
  const [showStationForm, setShowStationForm] = useState(false);
  const [stationMsg, setStationMsg] = useState('');

  useEffect(() => {
    const fc = config?.factory;
    if (fc) {
      setSiteTitle(fc.siteTitle || DEFAULT_APP_NAME);
      setFaviconFactoryId(fc.faviconFactoryId || null);
      if (fc.factories?.length) setFactories(fc.factories);
    }
  }, [config]);

  const fetchStations = useCallback(async () => {
    const r = await api.get('/api/stations/');
    setStations(r.data);
  }, []);

  useEffect(() => { fetchStations(); }, [fetchStations]);

  const openAddFactory = () => {
    setDraftFactory({ ...EMPTY_FACTORY, id: uid(), departments: [] });
    setEditingFactoryId(null);
    setShowFactoryForm(true);
    setErr('');
  };

  const openEditFactory = (factory) => {
    setDraftFactory(JSON.parse(JSON.stringify(factory)));
    setEditingFactoryId(factory.id);
    setShowFactoryForm(true);
    setErr('');
  };

  const updateDraft = (patch) => {
    setDraftFactory(prev => ({ ...prev, ...patch }));
  };

  const commitDraftFactory = () => {
    if (!draftFactory?.name?.trim()) {
      setErr('Factory name is required');
      return;
    }
    if (editingFactoryId) {
      setFactories(prev => prev.map(f => (f.id === editingFactoryId ? draftFactory : f)));
    } else {
      setFactories(prev => [...prev, draftFactory]);
    }
    setShowFactoryForm(false);
    setDraftFactory(null);
    setEditingFactoryId(null);
    setErr('');
  };

  const removeFactory = (id) => {
    if (!window.confirm('Remove this factory from configuration?')) return;
    setFactories(prev => prev.filter(f => f.id !== id));
    if (faviconFactoryId === id) setFaviconFactoryId(null);
  };

  const save = async () => {
    try {
      const updatedFactories = [];
      for (const f of factories) {
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
      await api.put('/api/config/', { config: payload });
      reload();
      reloadBranding();
      applySiteBranding({
        siteTitle: payload.factory.siteTitle,
        factories: updatedFactories,
        faviconFactoryId,
      });
      setLogoFiles({});
      setSaved(true);
      setErr('');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to save factory setup');
    }
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
            <input type="file" accept="image/*"
              onChange={e => setLogoFiles(p => ({ ...p, [fi.id]: e.target.files?.[0] || null }))} />
            {fi.logoUrl && (
              <img src={assetUrl(fi.logoUrl)} alt="logo" style={{ height: 48, marginTop: 8 }} />
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
              <label style={s.label}>Department Name</label>
              <input style={s.inp} value={dept.name}
                onChange={e => setDept(di, { name: e.target.value })} />
              <div style={{ marginTop: 10 }}>
                <button type="button" style={s.subBtn}
                  onClick={() => {
                    const departments = [...fi.departments];
                    departments[di] = { ...dept, lines: [...(dept.lines || []), newLine()] };
                    updateDraft({ departments });
                  }}>+ Line</button>
              </div>
              {(dept.lines || []).map((line, li) => (
                <div key={line.id} style={{ marginTop: 10, paddingLeft: 12, borderLeft: `3px solid ${t.accent}` }}>
                  <label style={s.label}>Line Name</label>
                  <input style={s.inp} value={line.name}
                    onChange={e => {
                      const departments = [...fi.departments];
                      const lines = [...dept.lines];
                      lines[li] = { ...line, name: e.target.value };
                      departments[di] = { ...dept, lines };
                      updateDraft({ departments });
                    }} />
                  <label style={{ ...s.label, marginTop: 8 }}>Stations on this line</label>
                  <select multiple style={{ ...s.inp, minHeight: 90 }}
                    value={(line.stationIds || []).map(String)}
                    onChange={e => {
                      const selected = Array.from(e.target.selectedOptions).map(o => parseInt(o.value, 10));
                      const departments = [...fi.departments];
                      const lines = [...dept.lines];
                      lines[li] = { ...line, stationIds: selected };
                      departments[di] = { ...dept, lines };
                      updateDraft({ departments });
                    }}>
                    {stations.map(st => (
                      <option key={st.id} value={st.id}>{st.display_name || st.name}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: t.textFaint }}>Hold Ctrl/Cmd to select multiple stations</p>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" style={s.btn} onClick={commitDraftFactory}>
            {editingFactoryId ? 'Update Factory' : 'Add Factory'}
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
                {['Name', 'Display Name', 'Machines', 'Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {stations.length === 0 ? (
                <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: t.textFaint }}>No stations yet</td></tr>
              ) : stations.map(st => (
                <tr key={st.id}>
                  <td style={s.td}>{st.name}</td>
                  <td style={s.td}>{st.display_name}</td>
                  <td style={s.td}>{st.machine_count ?? 0}</td>
                  <td style={s.td}>
                    <button type="button" style={{ ...s.miniBtn, background: t.accent, marginRight: 6 }}
                      onClick={() => openEditStation(st)}>Edit</button>
                    <button type="button" style={{ ...s.miniBtn, background: '#ef4444' }}
                      onClick={() => deleteStation(st.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: t.textFaint, marginTop: 8 }}>
          Stations created here appear on the Machines page for machine assignment.
        </p>
      </div>

      {err && <p style={{ color: '#ef4444' }}>{err}</p>}
      {saved && <p style={{ color: t.brand }}>Factory configuration saved.</p>}
      <button type="button" style={s.btn} onClick={save}>Save Factory Configuration</button>
    </div>
  );
}

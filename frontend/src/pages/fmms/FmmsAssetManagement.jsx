import { useState, useEffect, useCallback, useRef } from 'react';
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
} from './serviceStatus';
import {
  tableWrap, thStyle, tdStyle, FmmsBadge,
  formatInrCost, formatHistoryDate, EVENT_TYPE_LABELS, formatLifecycleReference,
} from './fmmsUi';

const MACHINE_TYPES = ['CNC', 'VMC', 'Lathe', 'Grinding', 'Drilling', 'Milling', 'Inspection', 'Other'];

const MEASURING_INSTRUMENTS = [
  'Screw Gauge', 'Vernier Caliper', 'Slip Gauge', 'Plug Gauge', 'Micrometer',
  'Dial Gauge', 'Height Gauge', 'Bore Gauge', 'Feeler Gauge', 'Thread Gauge',
  'Other Measuring Instrument',
];

const QUALITY_INSTRUMENTS = [
  'Profile Projector', 'Optical Microscope', 'Tool Maker Microscope',
  'Vision Measuring System', 'CMM (Coordinate Measuring Machine)',
  'Surface Roughness Tester', 'Hardness Tester', 'Optical Comparator',
  'Visual Inspection Station', 'Other QA Instrument',
];

const EMPTY_ASSET = {
  asset_source: 'machine',
  machine_id: '',
  machine_type: 'CNC',
  name: '',
  manufacturer: '',
  model_number: '',
  serial_number: '',
  installation_date: '',
  location: '',
  building: '',
  facility_lab: '',
  equipment_name: '',
  sub_assembly: '',
  classification: 'non_critical',
  status: 'active',
  category: 'machine',
  schedule_type: 'calibration',
  last_service_date: '',
  next_service_date: '',
  alert_before_days: 7,
  notes: '',
};

const EMPTY_HISTORY = {
  event_type: 'purchase',
  title: '',
  description: '',
  event_date: '',
  cost: '',
  cost_category: 'capital',
  reference_number: '',
  performed_by: '',
};

const EMPTY_DOC = {
  doc_type: 'purchase_order',
  doc_number: '',
  title: '',
  doc_date: '',
  amount: '',
  vendor: '',
  remarks: '',
};

const HISTORY_LABELS = {
  purchase: 'Purchase Order / Invoice',
  installation: 'Installation & Comm.',
  breakdown: 'Breakdown',
  amc: 'AMC Service Entry',
  calibration: 'Calibration',
  inhouse_maintenance: 'In-house Maintenance',
  investment: 'Investment',
  manpower_cost: 'Manpower Cost',
};

const DOC_LABELS = {
  sor: 'SOR',
  quotation: 'Quotation',
  purchase_order: 'Purchase Order',
  invoice: 'Invoice',
  inspection_report: 'Inspection Report',
  other: 'Other',
};

export default function FmmsAssetManagement() {
  const { theme: t } = useTheme();
  const [meta, setMeta] = useState(null);
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historySummaryLoading, setHistorySummaryLoading] = useState(false);
  const [historySummary, setHistorySummary] = useState([]);
  const [registrySelectedId, setRegistrySelectedId] = useState(null);
  const [lifecycleHistory, setLifecycleHistory] = useState([]);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailTab, setDetailTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_ASSET);
  const [previewCode, setPreviewCode] = useState('');
  const [machines, setMachines] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [qrModal, setQrModal] = useState(null);
  const [qrPrintSize, setQrPrintSize] = useState(40);
  const fileRef = useRef(null);
  const [showHistoryForm, setShowHistoryForm] = useState(false);
  const [historyForm, setHistoryForm] = useState(EMPTY_HISTORY);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState(EMPTY_DOC);
  const [serviceAlerts, setServiceAlerts] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };

  const btnPrimary = {
    padding: '8px 16px', background: t.accent, color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
  };
  const btnSecondary = {
    padding: '8px 16px', background: t.surface2, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
  };

  const loadMachines = useCallback(async () => {
    const { data } = await api.get('/api/fmms/assets/machines');
    setMachines(data || []);
  }, []);

  const loadNextCode = useCallback(async () => {
    const { data } = await api.get('/api/fmms/assets/next-code');
    setPreviewCode(data?.asset_code || '');
  }, []);

  const loadMeta = useCallback(async () => {
    const { data } = await api.get('/api/fmms/assets/meta');
    setMeta(data);
  }, []);

  const loadAssets = useCallback(async () => {
    const params = {
      equipment_only: true,
      page,
      page_size: pageSize,
    };
    if (search.trim()) params.search = search.trim();
    if (buFilter.trim()) params.business_unit = buFilter.trim();
    const { data } = await api.get('/api/fmms/assets', { params });
    if (Array.isArray(data)) {
      setAssets(data);
      setTotalAssets(data.length);
      setTotalPages(1);
    } else {
      setAssets(data?.items || []);
      setTotalAssets(data?.total || 0);
      setTotalPages(data?.pages || 1);
    }
  }, [search, buFilter, page, pageSize]);

  // Debounce search so we don't hit API on every keystroke (important for 600–800 assets)
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const loadServiceAlerts = useCallback(async () => {
    try {
      const { data } = await api.get('/api/fmms/assets/alerts');
      setServiceAlerts(data?.items || []);
      setBannerDismissed(false);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  const loadHistorySummary = useCallback(async () => {
    setHistorySummaryLoading(true);
    try {
      const { data } = await api.get('/api/fmms/assets/history/summary');
      setHistorySummary(data || []);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setHistorySummaryLoading(false);
    }
  }, []);

  const openHistoryModal = async () => {
    setRegistrySelectedId(null);
    setLifecycleHistory([]);
    await loadHistorySummary();
    setShowHistoryModal(true);
  };

  const selectRegistryAsset = async (row) => {
    setRegistrySelectedId(row.asset_id);
    setLifecycleLoading(true);
    try {
      const { data } = await api.get(`/api/fmms/assets/${row.asset_id}/history`);
      setLifecycleHistory(data || []);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
      setLifecycleHistory([]);
    } finally {
      setLifecycleLoading(false);
    }
  };

  const seedDemoLifecycle = async (scope = 'all', assetIdOverride = null) => {
    try {
      const oneId = assetIdOverride || registrySelectedId || selectedId;
      const params = scope === 'one' && oneId
        ? { asset_id: oneId, all_assets: false }
        : { all_assets: true };
      const { data } = await api.post('/api/fmms/assets/history/seed-demo', null, { params });
      setMsg(`✅ ${data?.message || 'Sample lifecycle loaded'}`);
      await loadHistorySummary();
      const refreshId = oneId || registrySelectedId;
      if (refreshId) await selectRegistryAsset({ asset_id: refreshId });
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const openAddLifecycleRecord = () => {
    if (!selectedId && !registrySelectedId) {
      setMsg('❌ Select an asset first (list or Asset History registry), then add a lifecycle record.');
      return;
    }
    if (registrySelectedId && registrySelectedId !== selectedId) {
      setSelectedId(registrySelectedId);
    }
    setHistoryForm({
      ...EMPTY_HISTORY,
      title: HISTORY_LABELS[EMPTY_HISTORY.event_type] || '',
    });
    setShowHistoryForm(true);
  };

  const loadDetail = useCallback(async (id) => {
    if (!id) { setSelectedAsset(null); setHistory([]); setDocuments([]); return; }
    const [assetRes, histRes, docRes] = await Promise.all([
      api.get(`/api/fmms/assets/${id}`),
      api.get(`/api/fmms/assets/${id}/history`),
      api.get(`/api/fmms/assets/${id}/documents`),
    ]);
    setSelectedAsset(assetRes.data);
    setHistory(histRes.data || []);
    setDocuments(docRes.data || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      await Promise.all([loadAssets(), loadServiceAlerts()]);
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [loadAssets, loadServiceAlerts, loadDetail, selectedId]);

  useEffect(() => { loadMeta(); loadMachines(); }, [loadMeta, loadMachines]);
  useEffect(() => { loadAssets(); }, [loadAssets]);
  useEffect(() => { loadServiceAlerts(); }, [loadServiceAlerts]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const openCreate = async () => {
    setEditingId(null);
    setForm({ ...EMPTY_ASSET });
    setImageFile(null);
    setImagePreview(null);
    await loadNextCode();
    await loadMachines();
    setShowForm(true);
  };

  const openEdit = async (asset) => {
    if (!asset) return;
    const source = asset.category === 'measuring_instrument' || asset.category === 'quality_instrument'
      ? asset.category
      : (asset.machine_id ? 'machine' : 'other');
    setEditingId(asset.id);
    setForm({
      asset_source: source,
      machine_id: asset.machine_id || '',
      machine_type: asset.machine_type || 'CNC',
      name: asset.name || '',
      manufacturer: asset.manufacturer || '',
      model_number: asset.model_number || '',
      serial_number: asset.serial_number || '',
      installation_date: asset.installation_date || '',
      location: asset.location || '',
      building: asset.building || '',
      facility_lab: asset.facility_lab || '',
      equipment_name: asset.equipment_name || '',
      sub_assembly: asset.sub_assembly || '',
      classification: asset.classification || 'non_critical',
      status: asset.status || 'active',
      category: asset.category || source,
      schedule_type: asset.schedule_type || 'calibration',
      last_service_date: asset.last_service_date || '',
      next_service_date: asset.next_service_date || '',
      alert_before_days: asset.alert_before_days ?? 7,
      notes: asset.notes || '',
    });
    setImageFile(null);
    setImagePreview(asset.image_url ? assetUrl(asset.image_url) : null);
    setPreviewCode(asset.asset_code || '');
    await loadMachines();
    setShowForm(true);
  };

  const deleteAsset = async (asset) => {
    if (!asset) return;
    if (!window.confirm(`Delete asset ${asset.asset_code} — ${asset.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/fmms/assets/${asset.id}`);
      if (selectedId === asset.id) setSelectedId(null);
      await refresh();
      setMsg('✅ Asset deleted');
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const applyMachine = (machineId) => {
    if (!machineId) {
      setForm((p) => ({
        ...p,
        machine_id: '',
        asset_source: 'other',
      }));
      return;
    }
    const m = machines.find((x) => String(x.id) === String(machineId));
    if (!m) return;
    setForm((p) => ({
      ...p,
      asset_source: 'machine',
      machine_id: m.id,
      machine_type: m.machine_type || 'CNC',
      name: m.name || p.name,
      manufacturer: m.make || '',
      model_number: m.model_no || '',
      location: m.location || p.location,
      equipment_name: m.name || p.equipment_name,
      image_url_from_machine: m.image_url || null,
    }));
    if (m.image_url && !imageFile) {
      setImagePreview(assetUrl(m.image_url));
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submitAsset = async (e) => {
    e.preventDefault();
    setMsg('');
    const wasEditing = Boolean(editingId);
    try {
      const source = form.asset_source || 'other';
      const isMachine = source === 'machine' && form.machine_id;
      if (source === 'machine' && !wasEditing && !form.machine_id) {
        setMsg('❌ Please select a machine from Machine Configuration');
        return;
      }
      if (!form.last_service_date || !form.next_service_date) {
        setMsg('❌ Last and Next Calibration / PM dates are mandatory');
        return;
      }
      const alertDays = Number(form.alert_before_days);
      if (Number.isNaN(alertDays) || alertDays < 0) {
        setMsg('❌ Alert-before days must be 0 or greater');
        return;
      }
      const payload = {
        flat_form: true,
        asset_source: source,
        category: source,
        machine_id: isMachine ? Number(form.machine_id) : null,
        machine_type: form.machine_type || null,
        name: form.name || form.equipment_name || form.machine_type || form.sub_assembly || null,
        manufacturer: form.manufacturer || null,
        model_number: form.model_number || null,
        serial_number: form.serial_number || null,
        installation_date: form.installation_date || null,
        location: form.location || null,
        building: form.building || null,
        facility_lab: form.facility_lab || null,
        equipment_name: form.equipment_name || form.name || null,
        sub_assembly: form.sub_assembly || null,
        classification: form.classification,
        status: form.status,
        schedule_type: form.schedule_type || 'calibration',
        last_service_date: form.last_service_date,
        next_service_date: form.next_service_date,
        alert_before_days: alertDays,
        notes: form.notes || null,
        auto_code: !wasEditing,
      };
      let data;
      if (wasEditing) {
        const res = await api.patch(`/api/fmms/assets/${editingId}`, payload);
        data = res.data;
      } else {
        const res = await api.post('/api/fmms/assets', payload);
        data = res.data;
      }
      if (imageFile) {
        const fd = new FormData();
        fd.append('file', imageFile);
        await api.post(`/api/fmms/assets/${data.id}/image`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setShowForm(false);
      setEditingId(null);
      setSelectedId(data.id);
      await refresh();
      if (!wasEditing) {
        setQrModal({
          asset_code: data.asset_code,
          name: data.name,
          qr_code: data.qr_code || data.asset_code,
        });
      }
      setMsg(wasEditing ? `✅ Asset updated — ${data.asset_code}` : `✅ Asset created — ID: ${data.asset_code}`);
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const printQrLabel = () => {
    if (!qrModal) return;
    const sizePx = Math.max(80, Math.round(qrPrintSize * 3.78));
    const imgUrl = qrImageUrl(qrModal.qr_code, sizePx);
    const win = window.open('', '_blank', 'width=420,height=520');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>QR ${qrModal.asset_code}</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; margin: 24px; }
        img { width: ${qrPrintSize}mm; height: ${qrPrintSize}mm; }
        .code { font-family: monospace; font-size: 14px; margin-top: 8px; }
        .name { font-size: 12px; margin-top: 4px; }
      </style></head><body>
      <img src="${imgUrl}" alt="QR" />
      <div class="code">${qrModal.asset_code}</div>
      <div class="name">${qrModal.name || ''}</div>
      <script>window.onload = () => { window.print(); }<\/script>
      </body></html>`);
    win.document.close();
  };

  const submitHistory = async (e) => {
    e.preventDefault();
    const targetId = selectedId || registrySelectedId;
    if (!targetId) {
      setMsg('❌ Select an asset before saving a lifecycle record.');
      return;
    }
    try {
      await api.post(`/api/fmms/assets/${targetId}/history`, {
        ...historyForm,
        cost: historyForm.cost ? Number(historyForm.cost) : 0,
        event_date: historyForm.event_date || null,
      });
      setShowHistoryForm(false);
      setHistoryForm(EMPTY_HISTORY);
      if (selectedId === targetId || !selectedId) {
        setSelectedId(targetId);
        await loadDetail(targetId);
      }
      if (showHistoryModal) {
        setRegistrySelectedId(targetId);
        await selectRegistryAsset({ asset_id: targetId });
        await loadHistorySummary();
      }
      setMsg('✅ Lifecycle history record added');
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const submitDocument = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/fmms/assets/${selectedId}/documents`, {
        ...docForm,
        amount: docForm.amount ? Number(docForm.amount) : 0,
        doc_date: docForm.doc_date || null,
      });
      setShowDocForm(false);
      setDocForm(EMPTY_DOC);
      await loadDetail(selectedId);
      setMsg('✅ Document record added');
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    }
  };

  const stats = {
    total: totalAssets,
    critical: assets.filter((a) => a.classification === 'critical').length,
    pageCount: assets.length,
  };

  const measuringList = meta?.measuringInstruments || MEASURING_INSTRUMENTS;
  const qualityList = meta?.qualityInstruments || QUALITY_INSTRUMENTS;

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <ServiceStatusStyles />
      <PageHeader
        title="Centralized Asset Management"
        onRefresh={refresh}
        extra={(
          <>
            <button type="button" style={btnPrimary} onClick={openCreate}>+ Add asset</button>
            <button type="button" style={btnSecondary} onClick={openHistoryModal}>
              {historySummaryLoading ? 'Loading…' : 'Asset History'}
            </button>
          </>
        )}
      />

      {msg && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>
          {msg}
        </div>
      )}

      {!bannerDismissed && serviceAlerts.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '12px 14px', borderRadius: 10,
          background: 'rgba(234, 179, 8, 0.16)',
          border: '1px solid #eab308',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fca5a5' }}>
                Calibration / PM alerts ({serviceAlerts.length})
              </div>
              <div style={{ fontSize: 12, color: '#fde047', marginTop: 4 }}>
                Threshold reached for due / overdue assets. Also shown in the header notification bell.
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#facc15' }}>
                {serviceAlerts.slice(0, 5).map((a) => {
                  const isOverdue = a.status === 'overdue' || a.status === 'due_today';
                  const lineColor = isOverdue ? '#fde047' : '#facc15';
                  return (
                    <li key={`${a.asset_id}-${a.status}`} style={{ marginBottom: 6, color: lineColor }}>
                      <button
                        type="button"
                        onClick={() => { setSelectedId(a.asset_id); setDetailTab('overview'); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                          fontSize: 13, textAlign: 'left', fontWeight: 700, color: lineColor,
                          textDecoration: 'underline', textUnderlineOffset: 2,
                        }}
                      >
                        {a.title}
                      </button>
                      <span style={{ color: '#fde68a' }}> — {a.body}</span>
                    </li>
                  );
                })}
                {serviceAlerts.length > 5 && (
                  <li style={{ color: '#fde68a' }}>+{serviceAlerts.length - 5} more in notification bell</li>
                )}
              </ul>
            </div>
            <button type="button" style={{ ...btnSecondary, padding: '4px 10px', fontSize: 12 }}
              onClick={() => setBannerDismissed(true)}>Dismiss</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard t={t} label="Registered assets" value={stats.total} />
        <StatCard t={t} label="On this page" value={stats.pageCount} />
        <StatCard t={t} label="Critical (page)" value={stats.critical} alert={stats.critical > 0} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 420px)', gap: 16, alignItems: 'start' }}>
        {/* Compact asset list — equipment only, paginated */}
        <section className={surfaceClass(t)} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              style={{ ...inp, flex: 1, minWidth: 180 }}
              placeholder="Search asset code, name, type, location, BU…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select
              style={{ ...inp, width: 180 }}
              value={buFilter}
              onChange={(e) => { setPage(1); setBuFilter(e.target.value); }}
              title="Filter by Business Unit (TEST-01 / TEST-02)"
            >
              <option value="">All BUs</option>
              {['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'].map((bu) => (
                <option key={bu} value={bu}>{bu}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 11, color: t.textFaint, margin: '0 0 10px' }}>
            Showing registered equipment only (not Location / Building / Facility nodes). Use Asset Hierarchy to browse structure. BU filter supports group-wide discovery (TEST-01/02).
          </p>
          {loading ? (
            <p style={{ color: t.textDim, fontSize: 13 }}>Loading…</p>
          ) : assets.length === 0 ? (
            <p style={{ fontSize: 13, color: t.textFaint, textAlign: 'center', padding: 28 }}>
              {search ? 'No assets match your search.' : 'No registered assets yet. Click + Add asset.'}
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 6, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                {assets.map((a) => {
                  const active = selectedId === a.id;
                  const place = [a.location, a.building, a.facility_lab].filter(Boolean).join(' › ');
                  const svc = getServiceDueStatus(a.next_service_date, a.alert_before_days);
                  return (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setSelectedId(a.id); setDetailTab('overview'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setSelectedId(a.id); setDetailTab('overview'); } }}
                      style={{
                        padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${active ? t.accent : (svc.level === 'overdue' || svc.level === 'due' ? svc.accent : t.border)}`,
                        background: active ? `${t.accent}18` : t.surface2,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <ServiceStatusBadge status={svc} size={16} />
                            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.name}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2, paddingLeft: 24 }}>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: t.textFaint }}>{a.asset_code}</span>
                            <ServiceAlertChips status={svc} />
                          </div>
                          {(svc.level === 'overdue' || svc.level === 'action_required' || svc.level === 'due') && (
                            <div style={{ fontSize: 11, marginTop: 4, paddingLeft: 24 }}>
                              <ServiceDaysDisplay status={svc} textDim={t.textDim} />
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, paddingLeft: 24 }}>
                            {[a.machine_type, a.classification === 'critical' ? 'Critical' : 'Non-Critical', a.status]
                              .filter(Boolean).join(' · ')}
                          </div>
                          {place && (
                            <div style={{ fontSize: 11, color: t.textFaint, marginTop: 2, paddingLeft: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {place}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button type="button" style={{ ...btnSecondary, padding: '4px 8px', fontSize: 11 }}
                            onClick={() => openEdit(a)}>Edit</button>
                          <button type="button" style={{ ...btnSecondary, padding: '4px 8px', fontSize: 11, color: '#ef4444' }}
                            onClick={() => deleteAsset(a)}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                marginTop: 12, paddingTop: 10, borderTop: `1px solid ${t.border}`, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 12, color: t.textDim }}>
                  Page {page} of {totalPages} · {totalAssets} asset{totalAssets === 1 ? '' : 's'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={btnSecondary} disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                  <button type="button" style={btnSecondary} disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Detail panel — FR-03 history & documents */}
        <section className={surfaceClass(t)} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, minHeight: 400 }}>
          {!selectedAsset ? (
            <p style={{ color: t.textFaint, fontSize: 13, textAlign: 'center', padding: 40 }}>Select an asset to view details, history, and documents.</p>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ServiceStatusBadge
                    status={getServiceDueStatus(selectedAsset.next_service_date, selectedAsset.alert_before_days)}
                    size={18}
                  />
                  <div style={{ fontSize: 11, color: t.textFaint, fontFamily: 'monospace' }}>{selectedAsset.asset_code}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: t.text }}>{selectedAsset.name}</div>
                <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{selectedAsset.hierarchy_path}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" style={{ ...btnSecondary, fontSize: 12, padding: '6px 10px' }}
                    onClick={() => openEdit(selectedAsset)}>Edit</button>
                  <button type="button" style={{ ...btnSecondary, fontSize: 12, padding: '6px 10px', color: '#ef4444' }}
                    onClick={() => deleteAsset(selectedAsset)}>Delete</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
                {['overview', 'history', 'documents'].map((tab) => (
                  <button key={tab} type="button"
                    onClick={() => setDetailTab(tab)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.border}`, cursor: 'pointer', fontSize: 12,
                      background: detailTab === tab ? t.accent : t.surface2,
                      color: detailTab === tab ? '#fff' : t.text,
                    }}>
                    {tab === 'overview' ? 'Overview' : tab === 'history' ? 'History' : 'Documents'}
                  </button>
                ))}
              </div>

              {detailTab === 'overview' && (
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  {selectedAsset.image_url && (
                    <div style={{ marginBottom: 8 }}>
                      <img src={assetUrl(selectedAsset.image_url)} alt={selectedAsset.name}
                        style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 8, border: `1px solid ${t.border}` }} />
                    </div>
                  )}
                  {selectedAsset.qr_code && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                      <img src={qrImageUrl(selectedAsset.qr_code, 72)} alt="QR"
                        style={{ width: 72, height: 72, borderRadius: 6, border: `1px solid ${t.border}` }} />
                      <button type="button" style={{ ...btnSecondary, fontSize: 12 }}
                        onClick={() => setQrModal({
                          asset_code: selectedAsset.asset_code,
                          name: selectedAsset.name,
                          qr_code: selectedAsset.qr_code,
                        })}>
                        Print QR
                      </button>
                    </div>
                  )}
                  <InfoRow t={t} label="Classification (FR-04)" value={selectedAsset.classification === 'critical' ? 'Critical' : 'Non-Critical'} />
                  <InfoRow t={t} label="Machine Type" value={selectedAsset.machine_type} />
                  <InfoRow t={t} label="Location" value={selectedAsset.location} />
                  <InfoRow t={t} label="Building" value={selectedAsset.building} />
                  <InfoRow t={t} label="Facility / Lab" value={selectedAsset.facility_lab} />
                  <InfoRow t={t} label="Equipment" value={selectedAsset.equipment_name} />
                  <InfoRow t={t} label="Sub-assembly" value={selectedAsset.sub_assembly} />
                  <InfoRow t={t} label="Make / Brand" value={selectedAsset.manufacturer} />
                  <InfoRow t={t} label="Model / Serial" value={[selectedAsset.model_number, selectedAsset.serial_number].filter(Boolean).join(' / ')} />
                  <InfoRow t={t} label="Installation" value={selectedAsset.installation_date} />
                  <InfoRow t={t} label="Schedule"
                    value={selectedAsset.schedule_type === 'pm' ? 'Preventive Maintenance (PM)' : 'Calibration'} />
                  <InfoRow t={t} label={selectedAsset.schedule_type === 'pm' ? 'Last PM' : 'Last Calibration'}
                    value={selectedAsset.last_service_date} />
                  <InfoRow t={t} label={selectedAsset.schedule_type === 'pm' ? 'Next PM' : 'Next Calibration'}
                    value={selectedAsset.next_service_date} />
                  <InfoRow t={t} label="Next service in days">
                    <ServiceDaysDisplay
                      status={getServiceDueStatus(selectedAsset.next_service_date, selectedAsset.alert_before_days)}
                      textDim={t.textDim}
                    />
                  </InfoRow>
                  <InfoRow t={t} label="Alert before"
                    value={selectedAsset.alert_before_days != null ? `${selectedAsset.alert_before_days} day(s)` : null} />
                  {selectedAsset.service_alert && (
                    <div style={{
                      marginTop: 4, padding: '8px 10px', borderRadius: 8, fontSize: 12,
                      background: selectedAsset.service_alert.severity === 'alert' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                      border: `1px solid ${selectedAsset.service_alert.severity === 'alert' ? '#ef4444' : '#f59e0b'}`,
                      color: t.text,
                    }}>
                      {selectedAsset.service_alert.title}
                    </div>
                  )}
                  <InfoRow t={t} label="Hierarchy" value={selectedAsset.hierarchy_path} />
                  <InfoRow t={t} label="Notes" value={selectedAsset.notes} />
                </div>
              )}

              {detailTab === 'history' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button type="button" style={{ ...btnSecondary, fontSize: 12, padding: '6px 12px' }}
                      onClick={() => seedDemoLifecycle(selectedId ? 'one' : 'all', selectedId)}>
                      Load sample lifecycle
                    </button>
                    <button type="button" style={{ ...btnPrimary, fontSize: 12, padding: '6px 12px' }}
                      onClick={() => {
                        setHistoryForm({ ...EMPTY_HISTORY, title: HISTORY_LABELS.purchase });
                        setShowHistoryForm(true);
                      }}>
                      + Add Record
                    </button>
                  </div>
                  <p style={{ fontSize: 11, color: t.textFaint, margin: '0 0 8px' }}>
                    Enter Record Type, Reference/Vendor, and Cost (Capital / Revenue / Manpower) with + Add Record.
                  </p>
                  {history.length === 0 ? (
                    <p style={{ fontSize: 12, color: t.textFaint }}>No history records yet. Use + Add Record or Load sample lifecycle.</p>
                  ) : history.map((h) => (
                    <div key={h.id} style={{ padding: '8px 0', borderBottom: `1px solid ${t.border}`, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ color: t.text }}>{h.title}</strong>
                        <Badge t={t} color={t.accent}>{HISTORY_LABELS[h.event_type] || h.event_type}</Badge>
                      </div>
                      <div style={{ color: t.textDim, marginTop: 2 }}>
                        {formatHistoryDate(h.event_date)} · {formatLifecycleReference(h)}
                      </div>
                      <div style={{ color: t.text, marginTop: 2 }}>{formatInrCost(h.cost, h.cost_category)}</div>
                      {h.description && <div style={{ color: t.textFaint, marginTop: 4 }}>{h.description}</div>}
                    </div>
                  ))}
                </>
              )}

              {detailTab === 'documents' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button type="button" style={{ ...btnPrimary, fontSize: 12, padding: '6px 12px' }} onClick={() => setShowDocForm(true)}>+ Add Document</button>
                  </div>
                  {documents.length === 0 ? (
                    <p style={{ fontSize: 12, color: t.textFaint }}>No commercial documents. Add SOR, Quotation, PO, or Invoice records.</p>
                  ) : documents.map((d) => (
                    <div key={d.id} style={{ padding: '8px 0', borderBottom: `1px solid ${t.border}`, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ color: t.text }}>{d.title || d.doc_number || 'Document'}</strong>
                        <Badge t={t} color="#8b5cf6">{DOC_LABELS[d.doc_type] || d.doc_type}</Badge>
                      </div>
                      <div style={{ color: t.textDim, marginTop: 2 }}>
                        {d.doc_date || '—'} {d.amount ? `· ₹ ${d.amount.toLocaleString()}` : ''} {d.vendor ? `· ${d.vendor}` : ''}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {showForm && (
        <Modal t={t} title={editingId ? `Edit Asset — ${previewCode}` : 'Add Asset'} wide onClose={() => { setShowForm(false); setEditingId(null); }}>
          <form onSubmit={submitAsset}>
            <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600 }}>Asset ID {editingId ? '' : '(auto-generated)'}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 16, color: t.accent, marginTop: 4 }}>{previewCode || '…'}</div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 8 }}>Asset source</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { id: 'machine', label: 'Machine (Machine Configuration)' },
                  { id: 'measuring_instrument', label: 'Measuring Instruments' },
                  { id: 'quality_instrument', label: 'Quality / QA Instruments' },
                  { id: 'other', label: 'Other Equipment' },
                ].map((opt) => (
                  <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: t.text, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="asset_source"
                      checked={form.asset_source === opt.id}
                      onChange={() => setForm((p) => ({
                        ...p,
                        asset_source: opt.id,
                        category: opt.id,
                        machine_id: opt.id === 'machine' ? p.machine_id : '',
                        machine_type: opt.id === 'machine' ? (p.machine_type || 'CNC')
                          : opt.id === 'measuring_instrument' ? (measuringList[0] || '')
                            : opt.id === 'quality_instrument' ? (qualityList[0] || '')
                              : (p.machine_type || 'Other'),
                      }))}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {form.asset_source === 'machine' && (
              <Field t={t} label="Select Machine" full>
                <select style={inp} value={form.machine_id}
                  onChange={(e) => applyMachine(e.target.value)}>
                  <option value="">— Select machine —</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.machine_type || 'CNC'}{m.make ? ` · ${m.make}` : ''})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {form.asset_source === 'measuring_instrument' && (
              <Field t={t} label="Measuring Instrument *" full>
                <select style={inp} required value={form.machine_type}
                  onChange={(e) => setForm({
                    ...form,
                    machine_type: e.target.value,
                    name: form.name || e.target.value,
                    equipment_name: form.equipment_name || e.target.value,
                  })}>
                  {measuringList.map((tp) => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
              </Field>
            )}

            {form.asset_source === 'quality_instrument' && (
              <Field t={t} label="Quality / QA Instrument *" full>
                <select style={inp} required value={form.machine_type}
                  onChange={(e) => setForm({
                    ...form,
                    machine_type: e.target.value,
                    name: form.name || e.target.value,
                    equipment_name: form.equipment_name || e.target.value,
                  })}>
                  {qualityList.map((tp) => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
              </Field>
            )}

            <FormGrid t={t}>
              {form.asset_source === 'machine' || form.asset_source === 'other' ? (
                <Field t={t} label="Machine Type *">
                  <select style={inp} required value={form.machine_type}
                    onChange={(e) => setForm({ ...form, machine_type: e.target.value })}>
                    {(meta?.machineTypes || MACHINE_TYPES).map((tp) => (
                      <option key={tp} value={tp}>{tp}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field t={t} label="Instrument Type">
                  <input style={inp} value={form.machine_type} readOnly />
                </Field>
              )}
              <Field t={t} label="Asset / Equipment Name">
                <input style={inp} value={form.name} placeholder="Defaults from machine or instrument"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field t={t} label="Make / Brand">
                <input style={inp} value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </Field>
              <Field t={t} label="Model No">
                <input style={inp} value={form.model_number} onChange={(e) => setForm({ ...form, model_number: e.target.value })} />
              </Field>
              <Field t={t} label="Serial Number">
                <input style={inp} value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
              </Field>
              <Field t={t} label="Installation Date">
                <input style={inp} type="date" value={form.installation_date} onChange={(e) => setForm({ ...form, installation_date: e.target.value })} />
              </Field>
              <Field t={t} label="Location">
                <input style={inp} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field t={t} label="Building">
                <input style={inp} value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
              </Field>
              <Field t={t} label="Facility / Lab">
                <input style={inp} value={form.facility_lab} onChange={(e) => setForm({ ...form, facility_lab: e.target.value })} />
              </Field>
              <Field t={t} label="Equipment">
                <input style={inp} value={form.equipment_name} onChange={(e) => setForm({ ...form, equipment_name: e.target.value })} />
              </Field>
              <Field t={t} label="Sub-assembly">
                <input style={inp} value={form.sub_assembly} onChange={(e) => setForm({ ...form, sub_assembly: e.target.value })} />
              </Field>
              <Field t={t} label="Classification">
                <select style={inp} value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })}>
                  <option value="non_critical">Non-Critical</option>
                  <option value="critical">Critical</option>
                </select>
              </Field>
              <Field t={t} label="Status">
                <select style={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {(meta?.assetStatuses || ['active', 'inactive', 'under_maintenance', 'decommissioned']).map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>

            <div style={{
              marginTop: 14, marginBottom: 8, padding: 12, borderRadius: 8,
              border: `1px solid ${t.border}`, background: t.surface2,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.textDim, marginBottom: 10, textTransform: 'uppercase' }}>
                Calibration / PM schedule (mandatory)
              </div>
              <FormGrid t={t}>
                <Field t={t} label="Schedule Type *">
                  <select style={inp} required value={form.schedule_type}
                    onChange={(e) => setForm({ ...form, schedule_type: e.target.value })}>
                    <option value="calibration">Calibration</option>
                    <option value="pm">Preventive Maintenance (PM)</option>
                  </select>
                </Field>
                <Field t={t} label={`Alert before (days) *`}>
                  <input style={inp} type="number" min="0" max="3650" required
                    value={form.alert_before_days}
                    onChange={(e) => setForm({ ...form, alert_before_days: e.target.value })}
                    placeholder="e.g. 7" />
                </Field>
                <Field t={t} label={form.schedule_type === 'pm' ? 'Last PM Date *' : 'Last Calibration Date *'}>
                  <input style={inp} type="date" required value={form.last_service_date}
                    onChange={(e) => setForm({ ...form, last_service_date: e.target.value })} />
                </Field>
                <Field t={t} label={form.schedule_type === 'pm' ? 'Next PM Date *' : 'Next Calibration Date *'}>
                  <input style={inp} type="date" required value={form.next_service_date}
                    onChange={(e) => setForm({ ...form, next_service_date: e.target.value })} />
                </Field>
              </FormGrid>
              <p style={{ fontSize: 11, color: t.textFaint, margin: '8px 0 0' }}>
                Alert starts on (Next date − Alert days). When that day is reached, a notification appears in the bell and on this page.
              </p>
            </div>

            <Field t={t} label="Equipment Image" full>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 4 }}>
                <div style={{
                  width: 140, height: 100, borderRadius: 8, border: `2px dashed ${t.border}`,
                  background: t.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {imagePreview
                    ? <img src={imagePreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ color: t.textFaint, fontSize: 12 }}>No image</span>}
                </div>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                  <button type="button" style={btnSecondary} onClick={() => fileRef.current?.click()}>
                    {imagePreview ? 'Change Image' : 'Upload Image'}
                  </button>
                  {imagePreview && (
                    <button type="button" style={{ ...btnSecondary, marginLeft: 8, color: '#ef4444' }}
                      onClick={() => { setImagePreview(null); setImageFile(null); }}>
                      Remove
                    </button>
                  )}
                  <div style={{ fontSize: 11, color: t.textFaint, marginTop: 6 }}>JPG, PNG, WebP — max 2MB</div>
                </div>
              </div>
            </Field>

            <Field t={t} label="Notes" full>
              <textarea style={{ ...inp, minHeight: 60 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>

            {!editingId && (
              <p style={{ fontSize: 11, color: t.textFaint, margin: '8px 0 0' }}>
                A QR code will be generated automatically after the asset is saved. You can print it in a custom size for labelling.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" style={btnSecondary} onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button>
              <button type="submit" style={btnPrimary}>{editingId ? 'Update Asset' : 'Save Asset'}</button>
            </div>
          </form>
        </Modal>
      )}

      {qrModal && (
        <Modal t={t} title={`QR Label — ${qrModal.asset_code}`} onClose={() => setQrModal(null)}>
          <div style={{ textAlign: 'center' }}>
            <img
              src={qrImageUrl(qrModal.qr_code, Math.max(120, Math.round(qrPrintSize * 3.78)))}
              alt={`QR ${qrModal.qr_code}`}
              style={{
                width: qrPrintSize * 2,
                height: qrPrintSize * 2,
                maxWidth: '100%',
                borderRadius: 8,
                border: `1px solid ${t.border}`,
              }}
            />
            <div style={{ fontFamily: 'monospace', fontWeight: 700, marginTop: 12, color: t.text }}>{qrModal.asset_code}</div>
            <div style={{ fontSize: 13, color: t.textDim, marginTop: 4 }}>{qrModal.name}</div>
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <label style={{ fontSize: 12, color: t.textDim, display: 'block', marginBottom: 6 }}>
                Print size: {qrPrintSize} mm (width &amp; height)
              </label>
              <input type="range" min="15" max="120" value={qrPrintSize}
                onChange={(e) => setQrPrintSize(Number(e.target.value))}
                style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {[20, 30, 40, 60, 80].map((sz) => (
                  <button key={sz} type="button" style={{ ...btnSecondary, fontSize: 12, padding: '4px 10px' }}
                    onClick={() => setQrPrintSize(sz)}>{sz} mm</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" style={btnSecondary} onClick={() => setQrModal(null)}>Close</button>
              <button type="button" style={btnPrimary} onClick={printQrLabel}>Print QR Label</button>
            </div>
          </div>
        </Modal>
      )}

      {showHistoryForm && (
        <Modal t={t} title="Add Lifecycle Asset History Record" onClose={() => setShowHistoryForm(false)}>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 12 }}>
            Best place to enter lifecycle details: <strong>Asset Management → select asset → History tab → + Add Record</strong>
            (or from Asset History after selecting a registry row).
          </p>
          <form onSubmit={submitHistory}>
            <FormGrid t={t}>
              <Field t={t} label="Record Type *">
                <select
                  style={inp}
                  required
                  value={historyForm.event_type}
                  onChange={(e) => {
                    const et = e.target.value;
                    setHistoryForm({
                      ...historyForm,
                      event_type: et,
                      title: historyForm.title || HISTORY_LABELS[et] || et,
                    });
                  }}
                >
                  {(meta?.historyEventTypes || Object.keys(HISTORY_LABELS)).map((et) => (
                    <option key={et} value={et}>{HISTORY_LABELS[et] || et}</option>
                  ))}
                </select>
              </Field>
              <Field t={t} label="Date *">
                <input style={inp} type="date" required value={historyForm.event_date} onChange={(e) => setHistoryForm({ ...historyForm, event_date: e.target.value })} />
              </Field>
              <Field t={t} label="Title / Record label *">
                <input style={inp} required value={historyForm.title} onChange={(e) => setHistoryForm({ ...historyForm, title: e.target.value })} placeholder="e.g. Purchase Order / Invoice" />
              </Field>
              <Field t={t} label="Reference / Vendor">
                <input
                  style={inp}
                  value={historyForm.reference_number}
                  onChange={(e) => setHistoryForm({ ...historyForm, reference_number: e.target.value })}
                  placeholder="e.g. PO-MSIL-2024-88 (SOR Link)"
                />
              </Field>
              <Field t={t} label="Performed by / Vendor name">
                <input
                  style={inp}
                  value={historyForm.performed_by}
                  onChange={(e) => setHistoryForm({ ...historyForm, performed_by: e.target.value })}
                  placeholder="e.g. Vendor: Siemens India / In-House Engg Team"
                />
              </Field>
              <Field t={t} label="Cost (₹)">
                <input style={inp} type="number" min="0" step="0.01" value={historyForm.cost} onChange={(e) => setHistoryForm({ ...historyForm, cost: e.target.value })} />
              </Field>
              <Field t={t} label="Cost type (Revenue / Capital / Manpower)">
                <select style={inp} value={historyForm.cost_category} onChange={(e) => setHistoryForm({ ...historyForm, cost_category: e.target.value })}>
                  <option value="capital">Capital</option>
                  <option value="revenue">Revenue</option>
                  <option value="manpower">Manpower</option>
                </select>
              </Field>
              <Field t={t} label="Notes / Description" full>
                <textarea style={{ ...inp, minHeight: 60 }} value={historyForm.description} onChange={(e) => setHistoryForm({ ...historyForm, description: e.target.value })} />
              </Field>
            </FormGrid>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" style={btnSecondary} onClick={() => setShowHistoryForm(false)}>Cancel</button>
              <button type="submit" style={btnPrimary}>Save Lifecycle Record</button>
            </div>
          </form>
        </Modal>
      )}

      {showHistoryModal && (
        <Modal t={t} title="Asset Registry & Hierarchy Mapping" onClose={() => setShowHistoryModal(false)} wide>
          {historySummaryLoading ? (
            <p style={{ color: t.textDim }}>Loading…</p>
          ) : (
            <div style={{ display: 'grid', gap: 18 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableWrap(t)}>
                  <thead>
                    <tr>
                      <th style={thStyle(t)}>3D Status</th>
                      <th style={thStyle(t)}>Hierarchy Asset ID</th>
                      <th style={thStyle(t)}>Equipment Name</th>
                      <th style={thStyle(t)}>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historySummary.map((r) => {
                      const svc = getServiceDueStatus(r.next_service_date, r.alert_before_days);
                      const active = registrySelectedId === r.asset_id;
                      return (
                        <tr
                          key={r.asset_id}
                          onClick={() => selectRegistryAsset(r)}
                          style={{
                            cursor: 'pointer',
                            background: active ? `${t.accent}22` : 'transparent',
                          }}
                        >
                          <td style={tdStyle(t)}>
                            <ServiceStatusBadge status={svc} size={14} />
                          </td>
                          <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>
                            {r.hierarchy_asset_id || r.asset_code}
                          </td>
                          <td style={tdStyle(t)}>
                            <div style={{ fontWeight: 600 }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: t.textFaint }}>{r.asset_code}</div>
                          </td>
                          <td style={tdStyle(t)}>
                            <FmmsBadge
                              t={t}
                              tone={r.classification === 'critical' ? 'critical' : 'warn'}
                            >
                              {r.classification === 'critical' ? 'Critical' : 'Non-Critical'}
                            </FmmsBadge>
                          </td>
                        </tr>
                      );
                    })}
                    {historySummary.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint, padding: 24 }}>
                          No registered assets found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: t.text }}>
                    Lifecycle Asset History
                    {registrySelectedId
                      ? ` — ${historySummary.find((x) => x.asset_id === registrySelectedId)?.name || ''}`
                      : ''}
                  </h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" style={{ ...btnSecondary, fontSize: 11, padding: '4px 10px' }}
                      onClick={() => seedDemoLifecycle('all')}>
                      Fill sample for all assets
                    </button>
                    <button type="button" style={{ ...btnSecondary, fontSize: 11, padding: '4px 10px' }}
                      disabled={!registrySelectedId}
                      onClick={() => seedDemoLifecycle('one')}>
                      Fill sample for selected
                    </button>
                    <button type="button" style={{ ...btnPrimary, fontSize: 11, padding: '4px 10px' }}
                      onClick={openAddLifecycleRecord}>
                      + Add record
                    </button>
                  </div>
                </div>
                {!registrySelectedId ? (
                  <p style={{ fontSize: 12, color: t.textFaint, margin: 0 }}>
                    Select an asset in the registry table to view purchase, installation, AMC, and cost history — or click “Fill sample for all assets”.
                  </p>
                ) : lifecycleLoading ? (
                  <p style={{ color: t.textDim, fontSize: 13 }}>Loading lifecycle…</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableWrap(t)}>
                      <thead>
                        <tr>
                          <th style={thStyle(t)}>Date</th>
                          <th style={thStyle(t)}>Record Type</th>
                          <th style={thStyle(t)}>Reference / Vendor</th>
                          <th style={thStyle(t)}>Cost (Revenue/Capital)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lifecycleHistory.map((h) => (
                          <tr key={h.id}>
                            <td style={tdStyle(t)}>{formatHistoryDate(h.event_date)}</td>
                            <td style={tdStyle(t)}>
                              {EVENT_TYPE_LABELS[h.event_type] || h.title || h.event_type}
                            </td>
                            <td style={tdStyle(t)}>{formatLifecycleReference(h)}</td>
                            <td style={tdStyle(t)}>
                              {formatInrCost(h.cost, h.cost_category)}
                            </td>
                          </tr>
                        ))}
                        {lifecycleHistory.length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint, padding: 20 }}>
                              No lifecycle records yet. Use “Fill sample for selected” or “+ Add record”.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {showDocForm && (
        <Modal t={t} title="Add Commercial Document" onClose={() => setShowDocForm(false)}>
          <form onSubmit={submitDocument}>
            <FormGrid t={t}>
              <Field t={t} label="Document Type *">
                <select style={inp} required value={docForm.doc_type} onChange={(e) => setDocForm({ ...docForm, doc_type: e.target.value })}>
                  {(meta?.documentTypes || []).map((dt) => (
                    <option key={dt} value={dt}>{DOC_LABELS[dt] || dt}</option>
                  ))}
                </select>
              </Field>
              <Field t={t} label="Document Number">
                <input style={inp} value={docForm.doc_number} onChange={(e) => setDocForm({ ...docForm, doc_number: e.target.value })} />
              </Field>
              <Field t={t} label="Title">
                <input style={inp} value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
              </Field>
              <Field t={t} label="Date">
                <input style={inp} type="date" value={docForm.doc_date} onChange={(e) => setDocForm({ ...docForm, doc_date: e.target.value })} />
              </Field>
              <Field t={t} label="Amount (₹)">
                <input style={inp} type="number" min="0" step="0.01" value={docForm.amount} onChange={(e) => setDocForm({ ...docForm, amount: e.target.value })} />
              </Field>
              <Field t={t} label="Vendor">
                <input style={inp} value={docForm.vendor} onChange={(e) => setDocForm({ ...docForm, vendor: e.target.value })} />
              </Field>
              <Field t={t} label="Remarks" full>
                <textarea style={{ ...inp, minHeight: 60 }} value={docForm.remarks} onChange={(e) => setDocForm({ ...docForm, remarks: e.target.value })} />
              </Field>
            </FormGrid>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" style={btnSecondary} onClick={() => setShowDocForm(false)}>Cancel</button>
              <button type="submit" style={btnPrimary}>Save Document</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function StatCard({ t, label, value, alert }) {
  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: t.textDim }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: alert ? '#ef4444' : t.accent }}>{value}</div>
    </div>
  );
}

function Badge({ t, color, children }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {children}
    </span>
  );
}

function InfoRow({ t, label, value, children }) {
  if (!children && !value && value !== 0) return null;
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      minWidth: 0, maxWidth: '100%',
    }}>
      <span style={{ color: t.textDim, minWidth: 100, maxWidth: '42%', flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span style={{
        color: t.text, fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden',
        wordBreak: 'break-word', overflowWrap: 'anywhere',
      }}>
        {children || value}
      </span>
    </div>
  );
}

function Field({ t, label, children, full }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: full ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, color: t.textDim, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function FormGrid({ t, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {children}
    </div>
  );
}

function Modal({ t, title, onClose, children, wide }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div className={surfaceClass(t, 'raised')} style={{
        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12,
        padding: 20, width: '100%', maxWidth: wide ? 980 : 640, maxHeight: '90vh', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: t.text, fontSize: 16 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: t.textDim, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function qrImageUrl(value, size = 64) {
  const data = encodeURIComponent(value || '');
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=1&data=${data}`;
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useConfig } from '../context/ConfigContext';
import { useBranding } from '../context/BrandingContext';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { pageClass } from '../themes/tileHelpers';
import PageHeader from '../components/PageHeader';
import api from '../api/client';
import { formatMaxMb, MAX_BACKUP_BYTES, validateBackupFile } from '../utils/uploadLimits';

export default function DatabaseManagement() {
  const { theme: t } = useTheme();
  const s = getStyles(t);
  const navigate = useNavigate();
  const { reload: reloadConfig } = useConfig();
  const { reload: reloadBranding } = useBranding();
  const { reload: reloadFeatures } = useFeatureFlags();

  const [backupCfg, setBackupCfg] = useState({ enabled: false, interval_days: 15, max_backups: 10 });
  const [histCfg, setHistCfg] = useState({
    enabled: false,
    retention_days: 60,
    interval_days: 1,
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: 'eap_pms_archive',
    reachable: false,
    configured: false,
    hot_cutoff_date: '',
    last_run_at: null,
    last_run_result: null,
    using_env_url: false,
    password_set: false,
    tables: [],
    summary: {
      archived_count: 0,
      pending_count: 0,
      remaining_count: 0,
      enabled_count: 0,
      archived_tables: [],
      pending_tables: [],
      remaining_tables: [],
    },
    retention_presets: [
      { days: 60, label: '2 months (60 days)' },
      { days: 90, label: '3 months (90 days)' },
      { days: 120, label: '4 months (120 days)' },
      { days: 180, label: '6 months (180 days)' },
    ],
  });
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [restoring, setRestoring] = useState(null);
  const [restorePct, setRestorePct] = useState(null);
  const [restorePhase, setRestorePhase] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [ackConfigDiff, setAckConfigDiff] = useState(false);
  const [infoModal, setInfoModal] = useState(null); // 'about' | 'setup' | null
  const [showAboutBackups, setShowAboutBackups] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);
  const [uploadPhase, setUploadPhase] = useState('idle'); // idle | transfer | processing
  const backupFileRef = useRef(null);

  const flash = (text, isErr = false, holdMs = 4000) => {
    if (isErr) { setErr(text); setMsg(''); }
    else { setMsg(text); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, holdMs);
  };

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get('/api/archive/config');
      setBackupCfg({
        enabled: res.data.enabled ?? false,
        interval_days: res.data.interval_days ?? 15,
        max_backups: res.data.max_backups ?? 10,
      });
    } catch { /* ignore — defaults remain */ }
    try {
      const h = await api.get('/api/archive/history/config');
      setHistCfg((prev) => ({
        ...prev,
        ...h.data,
        password: '', // never echo stored password
      }));
    } catch { /* ignore */ }
    setConfigLoading(false);
  }, []);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await api.get('/api/archive/list');
      setBackups(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchConfig(); fetchBackups(); }, [fetchConfig, fetchBackups]);

  const saveConfig = async () => {
    try {
      await api.put('/api/archive/config', backupCfg);
      flash('Backup schedule saved');
    } catch (e) {
      flash(e.response?.data?.detail || 'Failed to save', true);
    }
  };

  const triggerBackup = async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/archive/backup', null, { timeout: 600000 });
      const metaName = res.data.meta_filename || `${res.data.filename}.meta.json`;
      flash(`Backup created: ${res.data.filename} + ${metaName} (${res.data.size_display})`);
      fetchBackups();
    } catch (e) {
      flash(e.response?.data?.detail || 'Backup failed', true);
    } finally {
      setLoading(false);
    }
  };

  const saveHistoryConfig = async () => {
    try {
      const payload = {
        enabled: histCfg.enabled,
        retention_days: histCfg.retention_days,
        interval_days: histCfg.interval_days,
        host: histCfg.host,
        port: Number(histCfg.port) || 3306,
        user: histCfg.user,
        database: histCfg.database || 'eap_pms_archive',
        tables: (histCfg.tables || []).map((t) => ({
          name: t.name,
          enabled: !!t.enabled,
          retention_days: Number(t.retention_days) || 60,
        })),
      };
      if (histCfg.password) payload.password = histCfg.password;
      const res = await api.put('/api/archive/history/config', payload);
      setHistCfg((prev) => ({ ...prev, ...res.data, password: '' }));
      flash('History archive settings saved');
    } catch (e) {
      flash(e.response?.data?.detail || 'Failed to save history archive settings', true);
    }
  };

  const updateHistTable = (name, patch) => {
    setHistCfg((prev) => ({
      ...prev,
      tables: (prev.tables || []).map((t) => (t.name === name ? { ...t, ...patch } : t)),
    }));
  };

  const setHistTablesEnabled = (names, enabled) => {
    const set = new Set(names);
    setHistCfg((prev) => ({
      ...prev,
      tables: (prev.tables || []).map((t) => (set.has(t.name) ? { ...t, enabled } : t)),
    }));
  };

  const setHighGrowthRetention = (days) => {
    const d = Number(days) || 60;
    setHistCfg((prev) => ({
      ...prev,
      retention_days: d,
      tables: (prev.tables || []).map((t) => (
        t.tier === 'high' ? { ...t, retention_days: d } : t
      )),
    }));
  };

  const testHistoryConnection = async () => {
    setHistLoading(true);
    try {
      const res = await api.post('/api/archive/history/test');
      setHistCfg((prev) => ({ ...prev, ...res.data.status, password: '' }));
      flash(`Archive DB OK — tables ready (${(res.data.schema?.created_tables || []).length} created)`);
    } catch (e) {
      flash(e.response?.data?.detail || 'Archive DB connection failed', true);
    } finally {
      setHistLoading(false);
    }
  };

  const runHistoryArchive = async () => {
    if (!window.confirm(
      'Move data older than the retention window from the live IPC database to the archive DB?\n\n'
      + 'This deletes those old rows from the live DB after a successful copy.',
    )) return;
    setHistLoading(true);
    try {
      const res = await api.post('/api/archive/history/run');
      flash(`History archive done — moved ${res.data.moved_total || 0} row(s)`);
      fetchConfig();
    } catch (e) {
      flash(e.response?.data?.detail || 'History archive run failed', true);
    } finally {
      setHistLoading(false);
    }
  };

  const handleDelete = async (filename) => {
    if (!window.confirm(`Delete backup "${filename}"?`)) return;
    try {
      await api.delete(`/api/archive/${filename}`);
      flash(`Deleted: ${filename}`);
      fetchBackups();
    } catch (e) {
      flash(e.response?.data?.detail || 'Delete failed', true);
    }
  };

  const openRestorePreview = async (filename) => {
    setAckConfigDiff(false);
    try {
      const res = await api.get(`/api/archive/restore-preview/${encodeURIComponent(filename)}`);
      setConfirmRestore({ filename, preview: res.data });
    } catch (e) {
      setConfirmRestore({
        filename,
        preview: {
          filename,
          config_differs: true,
          changes: [],
          warning: e.response?.data?.detail || 'Could not compare live and backup configuration',
        },
      });
    }
  };

  const handleRestore = async (filename, confirmConfigDiff) => {
    setConfirmRestore(null);
    setAckConfigDiff(false);
    setRestoring(filename);
    setRestorePct(1);
    setRestorePhase('Starting restore…');
    try {
      await api.post(
        `/api/archive/restore/${encodeURIComponent(filename)}`,
        { confirm_config_diff: !!confirmConfigDiff },
        { timeout: 120000 },
      );
      const deadline = Date.now() + 600000;
      let last = {};
      while (Date.now() < deadline) {
        try {
          const res = await api.get('/api/archive/restore-progress', { timeout: 15000 });
          last = res.data || {};
          if (last.filename === filename || last.active || last.done) {
            if (typeof last.pct === 'number') setRestorePct(last.pct);
            if (last.phase) setRestorePhase(last.phase);
          }
          if (last.done && last.filename === filename) break;
        } catch { /* keep polling through brief proxy blips */ }
        if (last.done && last.filename === filename) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (last.error && last.filename === filename) {
        throw new Error(last.error);
      }
      if (!(last.done && last.filename === filename)) {
        throw new Error('Restore timed out');
      }
      setRestorePct(100);
      setRestorePhase('Restore complete');
      try {
        await Promise.all([reloadConfig(), reloadBranding(), reloadFeatures()]);
      } catch { /* pages still reload on navigation */ }
      window.dispatchEvent(new Event('pms-db-restored'));
      navigate('/dashboard', { state: { restoreSuccess: filename } });
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (e.response?.status === 409 && detail && typeof detail === 'object' && detail.config_differs) {
        setConfirmRestore({ filename, preview: detail });
        flash('Live configuration differs from the backup. Confirm to continue.', true, 8000);
      } else {
        flash((typeof detail === 'string' ? detail : null) || e.message || 'Restore failed', true, 8000);
      }
    } finally {
      setRestoring(null);
      setRestorePct(null);
      setRestorePhase('');
    }
  };

  const uploadBackup = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) {
      const sizeErr = validateBackupFile(file);
      if (sizeErr) {
        flash(sizeErr, true);
        return;
      }
    }
    setUploading(true);
    setUploadPct(0);
    setUploadPhase('transfer');
    try {
      const fd = new FormData();
      files.forEach((file) => fd.append('files', file));
      const res = await api.post('/api/archive/upload', fd, {
        timeout: 600000,
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
          setUploadPct(pct);
          if (pct >= 100) setUploadPhase('processing');
        },
      });
      setUploadPct(100);
      setUploadPhase('processing');
      const metaName = res.data.meta_filename || `${res.data.filename}.meta.json`;
      flash(`Backup upload complete: ${res.data.filename} + ${metaName} (${res.data.size_display})`, false, 8000);
      fetchBackups();
    } catch (e) {
      flash(e.response?.data?.detail || 'Upload failed', true, 8000);
    } finally {
      setUploading(false);
      setUploadPct(null);
      setUploadPhase('idle');
      if (backupFileRef.current) backupFileRef.current.value = '';
    }
  };

  const downloadBackup = async (filename) => {
    const token = localStorage.getItem('token');
    const base = api.defaults.baseURL || '';
    const url = `${base}/api/archive/download/${encodeURIComponent(filename)}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        flash('Download failed', true);
        return;
      }
      const blob = await response.blob();
      const cd = response.headers.get('content-disposition') || '';
      const match = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const downloadName = decodeURIComponent((match?.[1] || '').replace(/"/g, ''))
        || filename.replace(/\.(sql|json)\.gz$/i, '.zip');
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadName;
      link.click();
      URL.revokeObjectURL(objectUrl);
      flash(`Downloaded: ${downloadName} (dump + .meta.json)`);
    } catch {
      flash('Download failed', true);
    }
  };

  const totalSize = backups.reduce((sum, b) => sum + (b.size_bytes || 0), 0);

  return (
    <div className={pageClass(t)} style={s.page}>
      <PageHeader title="🗄  DATABASE MANAGEMENT" />

      {/* ── Stats ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard t={t} label="Total Backups" value={backups.length} accent="#2563eb" />
        <StatCard t={t} label="Storage Used" value={humanSize(totalSize)} accent="#7c3aed" />
        <StatCard t={t} label="Auto Backup"
          value={backupCfg.enabled ? `Every ${backupCfg.interval_days} day(s)` : 'Disabled'}
          accent={backupCfg.enabled ? '#16a34a' : '#94a3b8'} />
        <StatCard t={t} label="History Archive"
          value={histCfg.enabled ? `Hot ${histCfg.retention_days || 60}d` : 'Disabled'}
          accent={histCfg.enabled ? (histCfg.reachable ? '#16a34a' : '#ea580c') : '#94a3b8'} />
        <StatCard t={t} label="Latest Backup"
          value={backups.length > 0 ? new Date(backups[0].created_at).toLocaleDateString() : 'None'}
          accent="#ea580c" />
      </div>

      {/* ── Schedule Settings ── */}
      <Section title="Backup Schedule" t={t}>
        {configLoading ? (
          <p style={{ color: t.textFaint, fontSize: 13 }}>Loading settings...</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={s.label}>Automatic Backup:</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={backupCfg.enabled}
                    onChange={e => setBackupCfg(prev => ({ ...prev, enabled: e.target.checked }))} />
                  <span style={{ color: t.text, fontSize: 13, fontWeight: 600 }}>
                    {backupCfg.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={s.label}>Run every:</label>
                <input style={{ ...s.inp, width: 70 }} type="number" min="1" max="90"
                  value={backupCfg.interval_days}
                  onChange={e => setBackupCfg(prev => ({
                    ...prev, interval_days: Math.max(1, Math.min(90, parseInt(e.target.value) || 15)),
                  }))} />
                <span style={{ color: t.textDim, fontSize: 12 }}>days</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={s.label}>Max backups to keep:</label>
                <input style={{ ...s.inp, width: 70 }} type="number" min="1" max="100"
                  value={backupCfg.max_backups}
                  onChange={e => setBackupCfg(prev => ({
                    ...prev, max_backups: Math.max(1, Math.min(100, parseInt(e.target.value) || 10)),
                  }))} />
              </div>
            </div>

            <p style={{ color: t.textFaint, fontSize: 11, margin: '0 0 12px' }}>
              When enabled, the system creates a compressed database backup every N days and auto-deletes
              the oldest backups beyond the maximum count. Each backup stores both the dump
              (<code>.sql.gz</code> / <code>.json.gz</code>) and its sidecar <code>.meta.json</code>.
              IPC-to-IPC: on IPC A click Download (zip contains both files) or FTP those two files,
              then on IPC B click Upload Backup (zip, dump, and/or <code>.meta.json</code>) and Restore.
              Max upload {formatMaxMb(MAX_BACKUP_BYTES)}.
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button style={s.btn} onClick={saveConfig} disabled={!!restoring}>Save Schedule</button>
              <button style={{ ...s.btn, background: '#16a34a' }} onClick={triggerBackup} disabled={loading || uploading || !!restoring}>
                {loading ? 'Creating Backup...' : 'Create Backup Now'}
              </button>
              <input
                ref={backupFileRef}
                type="file"
                multiple
                accept=".gz,.sql.gz,.json.gz,.zip,.json,application/gzip,application/zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) uploadBackup(e.target.files);
                }}
              />
              <button
                style={{ ...s.btn, background: '#0ea5e9' }}
                onClick={() => backupFileRef.current?.click()}
                disabled={loading || uploading || !!restoring}
              >
                {uploading
                  ? (uploadPhase === 'processing'
                    ? 'Processing...'
                    : `Uploading ${uploadPct ?? 0}%`)
                  : 'Upload Backup'}
              </button>
              {uploading && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 220 }}>
                  <span style={{
                    flex: 1, height: 8, borderRadius: 99, background: t.surface2 || '#e2e8f0',
                    overflow: 'hidden', minWidth: 140,
                  }}>
                    <span style={{
                      display: 'block', height: '100%', borderRadius: 99, background: '#0ea5e9',
                      width: `${uploadPhase === 'processing' ? 100 : (uploadPct ?? 0)}%`,
                      transition: 'width 0.2s ease',
                    }} />
                  </span>
                  <span style={{ color: t.textDim, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {uploadPhase === 'processing' ? 'Saving on server…' : `${uploadPct ?? 0}%`}
                  </span>
                </span>
              )}
              {restoring && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
                  <span style={{
                    flex: 1, height: 8, borderRadius: 99, background: t.surface2 || '#e2e8f0',
                    overflow: 'hidden', minWidth: 160,
                  }}>
                    <span style={{
                      display: 'block', height: '100%', borderRadius: 99, background: '#16a34a',
                      width: `${restorePct ?? 0}%`,
                      transition: 'width 0.2s ease',
                    }} />
                  </span>
                  <span style={{ color: t.textDim, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {restorePhase || 'Restoring…'} {restorePct ?? 0}%
                  </span>
                </span>
              )}
              {msg && <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 500 }}>✓ {msg}</span>}
              {err && <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 500 }}>✗ {err}</span>}
            </div>
          </>
        )}
      </Section>

      {/* ── Backup History ── */}
      <Section title="Backup History" t={t}>
        {backups.length === 0 ? (
          <div style={{ color: t.textFaint, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
            No backups yet. Click "Create Backup Now", or "Upload Backup" to import a dump / .meta.json / zip from another IPC.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Backup File', 'Format', 'Created', 'Size', 'Trigger', 'Actions'].map(h =>
                    <th key={h} style={s.th}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {backups.map(b => (
                  <tr key={b.filename} style={{ transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = t.surface2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={s.td}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.filename}</span>
                    </td>
                    <td style={s.td}>
                      <Badge bg={b.method === 'sql' ? '#2563eb' : '#7c3aed'}
                        label={b.method === 'sql' ? 'SQL Dump' : 'JSON'} />
                    </td>
                    <td style={s.td}>{new Date(b.created_at).toLocaleString()}</td>
                    <td style={s.td}>{b.size_display}</td>
                    <td style={s.td}>
                      <Badge
                        bg={b.triggered_by === 'scheduled' ? '#16a34a' : b.triggered_by === 'uploaded' ? '#0ea5e9' : '#ea580c'}
                        label={b.triggered_by}
                      />
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <ActionBtn color="#2563eb" onClick={() => downloadBackup(b.filename)}>
                          ⬇ Download zip
                        </ActionBtn>
                        <ActionBtn color="#16a34a"
                          onClick={() => openRestorePreview(b.filename)}
                          disabled={!!restoring || uploading}>
                          {restoring === b.filename ? `${restorePct ?? 0}%` : '🔄 Restore'}
                        </ActionBtn>
                        <ActionBtn color="#ef4444" onClick={() => handleDelete(b.filename)}>
                          🗑 Delete
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Historical archive (remote LAN DB) ── */}
      <Section
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            History Archive (LAN DB Server)
            <InfoIconBtn title="About history archive" onClick={() => setInfoModal('about')} />
            <button
              type="button"
              onClick={() => setInfoModal('setup')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 12, border: `1px solid ${t.inpBorder}`,
                background: t.surface2 || t.bg, color: t.accent, fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Setup <span style={{
                width: 16, height: 16, borderRadius: '50%', background: t.accent, color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
              }}>i</span>
            </button>
          </span>
        }
        t={t}
      >
        <p style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.45, margin: '0 0 14px' }}>
          Keep recent data on the live IPC database for fast dashboards. Older rows from selected tables
          move to a MySQL database on another PC/server on the LAN. High-growth tables default to every
          <strong> ~2 months</strong> (60 days). Low-growth tables can use 2–6 month retention when enabled.
        </p>
        {configLoading ? (
          <p style={{ color: t.textFaint, fontSize: 13 }}>Loading settings...</p>
        ) : (
          <>
            {histCfg.using_env_url && (
              <p style={{ color: '#0ea5e9', fontSize: 12, margin: '0 0 12px' }}>
                Using <code>ARCHIVE_DATABASE_URL</code> from backend/.env (overrides host fields below).
              </p>
            )}

            {/* Status summary */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Badge bg="#16a34a" label={`Archived: ${histCfg.summary?.archived_count || 0}`} />
              <Badge bg="#ea580c" label={`Awaiting first move: ${histCfg.summary?.pending_count || 0}`} />
              <Badge bg="#94a3b8" label={`Not selected: ${histCfg.summary?.remaining_count || 0}`} />
              <Badge bg="#0ea5e9" label={`Enabled: ${histCfg.summary?.enabled_count || 0}`} />
            </div>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={s.label}>Auto archive:</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!histCfg.enabled}
                    onChange={e => setHistCfg(prev => ({ ...prev, enabled: e.target.checked }))} />
                  <span style={{ color: histCfg.enabled ? '#16a34a' : t.textFaint, fontSize: 13, fontWeight: 600 }}>
                    {histCfg.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={s.label}>High-growth keep on live:</label>
                <select
                  style={{ ...s.inp, width: 180 }}
                  value={histCfg.retention_days}
                  onChange={e => setHighGrowthRetention(parseInt(e.target.value, 10))}
                >
                  {(histCfg.retention_presets || []).map((p) => (
                    <option key={p.days} value={p.days}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={s.label}>Run every (days):</label>
                <input type="number" min={1} max={30} style={{ ...s.inp, width: 70 }}
                  value={histCfg.interval_days}
                  onChange={e => setHistCfg(prev => ({
                    ...prev, interval_days: Math.max(1, Math.min(30, parseInt(e.target.value) || 1)),
                  }))} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={s.label}>Archive DB host (LAN IP)</label>
                <input style={s.inp} placeholder="e.g. 192.168.0.50" value={histCfg.host}
                  onChange={e => setHistCfg(prev => ({ ...prev, host: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Port</label>
                <input style={s.inp} type="number" value={histCfg.port}
                  onChange={e => setHistCfg(prev => ({ ...prev, port: parseInt(e.target.value) || 3306 }))} />
              </div>
              <div>
                <label style={s.label}>Database name</label>
                <input style={s.inp} value={histCfg.database}
                  onChange={e => setHistCfg(prev => ({ ...prev, database: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>User</label>
                <input style={s.inp} value={histCfg.user}
                  onChange={e => setHistCfg(prev => ({ ...prev, user: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Password {histCfg.password_set ? '(leave blank to keep)' : ''}</label>
                <input style={s.inp} type="password" value={histCfg.password}
                  placeholder={histCfg.password_set ? '••••••••' : ''}
                  onChange={e => setHistCfg(prev => ({ ...prev, password: e.target.value }))} />
              </div>
            </div>

            {/* High-growth tables */}
            <h5 style={{ color: t.text, fontSize: 13, margin: '4px 0 8px' }}>
              High-growth tables <span style={{ color: t.textFaint, fontWeight: 400 }}>(archived by default · ~2 months)</span>
            </h5>
            <TableArchiveList
              t={t} s={s}
              tables={(histCfg.tables || []).filter((x) => x.tier === 'high')}
              presets={histCfg.retention_presets}
              onChange={updateHistTable}
              onToggleAll={setHistTablesEnabled}
              allowPerTableRetention={false}
            />

            {/* Low-growth tables */}
            <h5 style={{ color: t.text, fontSize: 13, margin: '16px 0 8px' }}>
              Low-growth tables <span style={{ color: t.textFaint, fontWeight: 400 }}>(optional · set 2 / 3 / 4 / 6 months)</span>
            </h5>
            <TableArchiveList
              t={t} s={s}
              tables={(histCfg.tables || []).filter((x) => x.tier === 'low')}
              presets={histCfg.retention_presets}
              onChange={updateHistTable}
              onToggleAll={setHistTablesEnabled}
              allowPerTableRetention
            />

            {/* Already archived / remaining lists */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '16px 0 12px' }}>
              <StatusList
                t={t}
                title="Already archived"
                color="#16a34a"
                items={(histCfg.tables || []).filter((x) => x.status === 'archived')}
                empty="No archive data yet — run Test & Create Schema, then Run Archive Now."
              />
              <StatusList
                t={t}
                title="Selected — awaiting first move"
                color="#ea580c"
                items={(histCfg.tables || []).filter((x) => x.status === 'pending')}
                empty="All selected tables already have archive rows (or none selected)."
              />
              <StatusList
                t={t}
                title="Remaining (not selected)"
                color="#94a3b8"
                items={(histCfg.tables || []).filter((x) => x.status === 'not_selected')}
                empty="All catalog tables are selected for archive."
              />
            </div>

            <p style={{ color: t.textFaint, fontSize: 11, margin: '0 0 12px' }}>
              Hot cutoff (high-growth default): <strong>{histCfg.hot_cutoff_date || '—'}</strong>
              {histCfg.reachable ? ' · Archive DB reachable' : histCfg.configured ? ' · Archive DB not reachable' : ''}
              {histCfg.last_run_at ? ` · Last run: ${new Date(histCfg.last_run_at).toLocaleString()}` : ''}
              {histCfg.last_run_result?.moved_total != null ? ` · Moved ${histCfg.last_run_result.moved_total} rows` : ''}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={s.btn} onClick={saveHistoryConfig}>Save History Settings</button>
              <button style={{ ...s.btn, background: '#0ea5e9' }} onClick={testHistoryConnection} disabled={histLoading}>
                {histLoading ? 'Testing…' : 'Test & Create Schema'}
              </button>
              <button style={{ ...s.btn, background: '#7c3aed' }} onClick={runHistoryArchive} disabled={histLoading}>
                Run Archive Now
              </button>
            </div>
          </>
        )}
      </Section>

      {/* ── Info (collapsible) ── */}
      {showAboutBackups ? (
        <Section
          title={
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%' }}>
              <span>About Database Backups</span>
              <button
                type="button"
                onClick={() => setShowAboutBackups(false)}
                style={{
                  padding: '4px 12px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
                  background: t.surface2 || t.bg, color: t.textMuted, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Hide
              </button>
            </span>
          }
          t={t}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            <InfoCard t={t} title="Backup Method"
              text="Uses mysqldump (SQL) when available for full-fidelity database dumps. Falls back to JSON export if mysqldump is not installed." />
            <InfoCard t={t} title="What's Included"
              text="All 22+ tables: machines, production plans, OEE entries, work orders, QC reports, configurations, email logs, and more." />
            <InfoCard t={t} title="Storage"
              text="File backups are gzip-compressed under backend/backups on the IPC. History Archive (above) stores old transactional rows on a separate LAN MySQL server." />
            <InfoCard t={t} title="Restore"
              text="Restoring a backup will overwrite ALL current data with the backup snapshot. Always create a fresh backup before restoring an older one." />
          </div>
        </Section>
      ) : (
        <div style={{
          background: t.surface, borderRadius: 10, padding: '10px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ color: t.textMuted, fontSize: 13 }}>About Database Backups (hidden)</span>
          <button
            type="button"
            onClick={() => setShowAboutBackups(true)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
              background: t.surface2 || t.bg, color: t.accent, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Show
          </button>
        </div>
      )}

      {/* ── Info / Setup modals ── */}
      {infoModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={() => setInfoModal(null)}>
          <div
            style={{
              background: t.surface, borderRadius: 12, padding: 24, maxWidth: 560, width: '92%',
              maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ color: t.accent, margin: 0, fontSize: 16 }}>
                {infoModal === 'setup' ? 'How to set it up (LAN DB server)' : 'About History Archive'}
              </h4>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                style={{ background: 'transparent', border: 'none', color: t.textMuted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            {infoModal === 'about' ? (
              <div style={{ color: t.textMuted, fontSize: 13, lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 10px' }}>
                  History Archive moves old transactional rows from the live IPC MySQL to a separate LAN MySQL
                  server so dashboards stay fast while long-range reports can still read archived data.
                </p>
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  <li><strong>High-growth</strong> tables (OEE, status log, KPI, email logs) are selected by default with a ~2 month (60 day) hot window.</li>
                  <li><strong>Low-growth</strong> tables (attendance, QC, tools, etc.) stay on live until you enable them and pick 2 / 3 / 4 / 6 months retention.</li>
                  <li><strong>Already archived</strong> means the archive DB already holds rows for that table.</li>
                  <li><strong>Awaiting first move</strong> means the table is selected but no rows have been copied yet.</li>
                  <li><strong>Remaining</strong> means the table is not selected for archive.</li>
                </ul>
                <p style={{ margin: 0 }}>
                  Master data (users, machines, parts, work orders, live plans) is never moved. Save settings,
                  then use Test &amp; Create Schema and optionally Run Archive Now.
                </p>
              </div>
            ) : (
              <div style={{ color: t.textMuted, fontSize: 13, lineHeight: 1.55 }}>
                <ol style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                  <li style={{ marginBottom: 8 }}>
                    On the other PC/server, install MySQL and allow the IPC to connect (open port 3306, grant remote user).
                  </li>
                  <li style={{ marginBottom: 8 }}>Restart the EAP backend so new code loads.</li>
                  <li style={{ marginBottom: 8 }}>
                    Open <strong>Database Management</strong> (superadmin) → <strong>History Archive (LAN DB Server)</strong>.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Fill in:
                    <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                      <li>Host = LAN IP of archive DB (e.g. 192.168.0.50)</li>
                      <li>User / password / database (eap_pms_archive)</li>
                      <li>Keep on live = 60 days (or pick 2 / 3 months for low-growth tables)</li>
                    </ul>
                  </li>
                  <li style={{ marginBottom: 8 }}>Click <strong>Test &amp; Create Schema</strong> (creates DB + tables).</li>
                  <li style={{ marginBottom: 8 }}>Enable <strong>Auto archive</strong> → <strong>Save History Settings</strong>.</li>
                  <li style={{ marginBottom: 8 }}>Optionally <strong>Run Archive Now</strong> for the first move.</li>
                </ol>
                <p style={{ margin: '0 0 8px' }}>Or set in <code>backend/.env</code> (overrides UI host fields):</p>
                <pre style={{
                  margin: 0, padding: 12, borderRadius: 8, background: t.surface2 || t.bg,
                  color: t.text, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
{`ARCHIVE_DATABASE_URL=mysql+pymysql://archive_user:YourPassword@192.168.0.50:3306/eap_pms_archive`}
                </pre>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={s.btn} onClick={() => setInfoModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore Confirmation Modal ── */}
      {confirmRestore && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: t.surface, borderRadius: 12, padding: 24, maxWidth: 560, width: '92%',
            maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <h4 style={{ color: '#ef4444', margin: '0 0 12px', fontSize: 16 }}>
              Confirm Database Restore
            </h4>
            <p style={{ color: t.text, fontSize: 13, lineHeight: 1.5, margin: '0 0 8px' }}>
              This will <strong>overwrite all current live data</strong> with the backup.
              Other features stay unchanged until you confirm restore.
            </p>
            <p style={{ color: t.accent, fontSize: 13, fontWeight: 600, fontFamily: 'monospace', margin: '0 0 12px' }}>
              {confirmRestore.filename}
            </p>
            {confirmRestore.preview?.config_differs && (
              <div style={{
                background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8,
                padding: 12, margin: '0 0 14px',
              }}>
                <p style={{ color: '#9a3412', fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
                  Live configuration differs from this backup
                </p>
                {(confirmRestore.preview.changes || []).length > 0 && (
                  <ul style={{ margin: '0 0 10px', paddingLeft: 18, color: '#9a3412', fontSize: 12, lineHeight: 1.5 }}>
                    {confirmRestore.preview.changes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {confirmRestore.preview.warning && (
                  <p style={{ color: '#9a3412', fontSize: 12, margin: '0 0 10px' }}>
                    {confirmRestore.preview.warning}
                  </p>
                )}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ackConfigDiff}
                    onChange={(e) => setAckConfigDiff(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ color: '#9a3412', fontSize: 12, fontWeight: 600 }}>
                    I understand factory / shift / archive settings on this IPC will be replaced by the backup.
                  </span>
                </label>
              </div>
            )}
            <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 20px' }}>
              This cannot be undone. Create a backup of current data first if you may need it.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                style={{ padding: '8px 20px', background: t.surface2, color: t.text, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                onClick={() => { setConfirmRestore(null); setAckConfigDiff(false); }}>
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 20px', background: '#ef4444', color: '#fff', border: 'none',
                  borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  opacity: (confirmRestore.preview?.config_differs && !ackConfigDiff) ? 0.5 : 1,
                }}
                disabled={confirmRestore.preview?.config_differs && !ackConfigDiff}
                onClick={() => handleRestore(
                  confirmRestore.filename,
                  !!(confirmRestore.preview?.config_differs && ackConfigDiff),
                )}>
                Restore Database
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, t, children }) {
  return (
    <div style={{ background: t.surface, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h4 style={{ color: t.accent, margin: '0 0 12px', fontSize: 14 }}>{title}</h4>
      {children}
    </div>
  );
}

function InfoIconBtn({ title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 18, height: 18, borderRadius: '50%', border: 'none',
        background: '#0ea5e9', color: '#fff', fontSize: 11, fontWeight: 700,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, lineHeight: 1,
      }}
    >
      i
    </button>
  );
}

function TableArchiveList({ t, s, tables, presets, onChange, onToggleAll, allowPerTableRetention }) {
  if (!tables?.length) {
    return <p style={{ color: t.textFaint, fontSize: 12 }}>No tables in this group.</p>;
  }
  const allEnabled = tables.every((row) => row.enabled);
  const someEnabled = tables.some((row) => row.enabled);
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${t.surface2}`, borderRadius: 8 }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={allEnabled}
                  ref={(el) => { if (el) el.indeterminate = someEnabled && !allEnabled; }}
                  onChange={(e) => onToggleAll?.(tables.map((row) => row.name), e.target.checked)}
                  title={allEnabled ? 'Deselect all' : 'Select all'}
                />
                Archive
              </label>
            </th>
            <th style={s.th}>Table</th>
            <th style={s.th}>Keep on live</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Archive rows</th>
            <th style={s.th}>Eligible on live</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((row) => (
            <tr key={row.name}>
              <td style={s.td}>
                <input
                  type="checkbox"
                  checked={!!row.enabled}
                  onChange={(e) => onChange(row.name, { enabled: e.target.checked })}
                />
              </td>
              <td style={s.td}>
                <div style={{ fontWeight: 600 }}>{row.label}</div>
                <div style={{ color: t.textFaint, fontSize: 10 }}>{row.name}</div>
                {row.description && (
                  <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>{row.description}</div>
                )}
              </td>
              <td style={s.td}>
                {allowPerTableRetention ? (
                  <select
                    style={{ ...s.inp, width: 160 }}
                    value={row.retention_days}
                    disabled={!row.enabled}
                    onChange={(e) => onChange(row.name, { retention_days: parseInt(e.target.value, 10) })}
                  >
                    {(presets || []).map((p) => (
                      <option key={p.days} value={p.days}>{p.label}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ color: t.textMuted, fontSize: 12 }}>
                    {(presets || []).find((p) => p.days === row.retention_days)?.label
                      || `${row.retention_days} days`}
                  </span>
                )}
              </td>
              <td style={s.td}>
                <Badge
                  bg={row.status === 'archived' ? '#16a34a' : row.status === 'pending' ? '#ea580c' : '#94a3b8'}
                  label={row.status_label || row.status}
                />
              </td>
              <td style={s.td}>{row.archive_row_count ?? 0}</td>
              <td style={s.td}>{row.live_eligible_rows ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusList({ t, title, color, items, empty }) {
  return (
    <div style={{ background: t.surface2 || t.bg, borderRadius: 8, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ color, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {!items?.length ? (
        <p style={{ color: t.textFaint, fontSize: 11, margin: 0 }}>{empty}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 16, color: t.textMuted, fontSize: 12, lineHeight: 1.5 }}>
          {items.map((x) => (
            <li key={x.name}>
              {x.label}
              {x.archive_row_count != null && x.status === 'archived' ? ` (${x.archive_row_count} rows)` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({ t, label, value, accent }) {
  return (
    <div style={{
      background: t.surface, borderRadius: 10, padding: '14px 20px', minWidth: 160, flex: 1,
      borderLeft: `4px solid ${accent}`,
    }}>
      <div style={{ color: t.textDim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ color: t.text, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Badge({ bg, label }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
      background: `${bg}18`, color: bg,
    }}>
      {label}
    </span>
  );
}

function ActionBtn({ color, onClick, disabled, children }) {
  return (
    <button
      style={{
        padding: '4px 10px', background: color, color: '#fff', border: 'none',
        borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11, fontWeight: 500, opacity: disabled ? 0.5 : 1,
      }}
      onClick={onClick}
      disabled={disabled}>
      {children}
    </button>
  );
}

function InfoCard({ t, title, text }) {
  return (
    <div style={{ background: t.surface2 || t.bg, borderRadius: 8, padding: 14 }}>
      <div style={{ color: t.accent, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <p style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.5, margin: 0 }}>{text}</p>
    </div>
  );
}

function humanSize(b) {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (b < 1024) return `${b.toFixed(1)} ${unit}`;
    b /= 1024;
  }
  return `${b.toFixed(1)} TB`;
}

function getStyles(t) {
  return {
    page: { padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text },
    label: { color: t.textMuted, fontSize: 13 },
    inp: {
      padding: '6px 8px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp,
      color: t.text, fontSize: 13, boxSizing: 'border-box',
    },
    btn: {
      padding: '8px 20px', background: t.accent, color: '#fff', border: 'none',
      borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: { padding: '8px 10px', background: t.surface2, color: t.textDim, textAlign: 'left', fontSize: 11, fontWeight: 600 },
    td: { padding: '8px 10px', borderBottom: `1px solid ${t.surface2}`, color: t.text, fontSize: 12 },
  };
}

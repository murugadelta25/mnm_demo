import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { assetUrl } from '../api/config';
import PageHeader from '../components/PageHeader';
import { useTheme } from '../context/ThemeContext';
import { pageClass } from '../themes/tileHelpers';
import { getWorkInstructionStyles } from '../themes/workInstructionStyles';
import {
  DEFAULT_QC_COLUMNS,
  normalizeQcColumnSchema,
  getParamColumnValue,
  setParamColumnValue,
  emptyParamFromSchema,
  serializeParamColumns,
} from '../utils/qcColumnSchema';
import { MAX_IMAGE_BYTES, validateFileSize, validateWiDocFile, WI_DOC_ACCEPT } from '../utils/uploadLimits';

const PARTS_PAGE_SIZE = 50;

const PARAMETER_PRESETS = [
  'Thread', 'Thread Length', 'Inner Dia', 'Outer Dia', 'Total Length',
  'Perpendicularity', 'Appearance', 'Hardness', 'Weight', 'Visual',
];

const EMPTY_PART = {
  part_no: '',
  model_variant: '',
  description: '',
  tool_no: '',
  production_section: '',
  operation_code: '',
  process_time: '',
  loading_unloading: '10',
  qc_column_schema: [...DEFAULT_QC_COLUMNS],
  qc_parameters: [],
};

const DOC_TYPES = [
  { key: 'control_plan', label: 'Control Plan' },
  { key: 'wi_visual', label: 'WI-Visual' },
  { key: 'wi_tray', label: 'WI-Tray' },
  { key: 'breakdown_sheet', label: 'Breakdown Sheet' },
];

const DOC_LABEL_BY_KEY = Object.fromEntries(DOC_TYPES.map((d) => [d.key, d.label]));

/** Safe value for controlled type="number" inputs — avoids React NaN warnings. */
function toNumberInputValue(val, fallback = '') {
  if (val === '' || val == null) return fallback;
  const n = Number(val);
  return Number.isNaN(n) ? fallback : String(val);
}

function normalizeQcParamRow(q, seqNo) {
  return {
    seq_no: seqNo,
    parameter: q.parameter || '',
    std_value: q.std_value || '',
    is_numeric: !!q.is_numeric,
    lsl: toNumberInputValue(q.lsl),
    usl: toNumberInputValue(q.usl),
    method: q.method || '',
    frequency: q.frequency || '',
    extra_columns: (q.extra_columns || []).map((c) => ({ ...c })),
  };
}

function PartThumbImage({ url, alt, style, placeholder }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return placeholder;
  return (
    <img
      src={assetUrl(url)}
      alt={alt || ''}
      style={style}
      onError={() => setBroken(true)}
    />
  );
}

export default function PartManagement() {
  const { theme: t } = useTheme();
  const [parts, setParts] = useState([]);
  const [partsTotal, setPartsTotal] = useState(0);
  const [partsPage, setPartsPage] = useState(1);
  const [partsPages, setPartsPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [partDocuments, setPartDocuments] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_PART });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [copySourceLabel, setCopySourceLabel] = useState(null);

  const s = getWorkInstructionStyles(t);

  const loadParts = useCallback(async (page = 1, search = '') => {
    setListLoading(true);
    try {
      const { data } = await api.get('/api/parts/', {
        params: {
          active_only: false,
          page,
          page_size: PARTS_PAGE_SIZE,
          search: search.trim() || undefined,
        },
      });
      setParts(data.items || []);
      setPartsTotal(data.total ?? 0);
      setPartsPage(data.page ?? page);
      setPartsPages(data.pages ?? 1);
    } catch {
      setParts([]);
      setPartsTotal(0);
      setMsg('Failed to load parts — ensure database migration has been run');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadParts(1, searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, loadParts]);

  const applyFullPart = (p) => {
    setSelectedId(p.id);
    setCopySourceLabel(null);
    setPartDocuments(p.documents || []);
    setForm({
      part_no: p.part_no,
      model_variant: p.model_variant || p.part_no,
      description: p.description || '',
      tool_no: p.tool_no || '',
      production_section: p.production_section || '',
      operation_code: p.operation_code || '',
      process_time: toNumberInputValue(p.process_time),
      loading_unloading: toNumberInputValue(p.loading_unloading, '10'),
      image_url: p.image_url || '',
      qc_column_schema: normalizeQcColumnSchema(p.qc_column_schema, p.qc_parameters),
      qc_parameters: (p.qc_parameters || []).map((q, i) => normalizeQcParamRow(q, i + 1)),
      active: p.active ?? 1,
    });
    setMsg('');
  };

  const applyCopyAsNew = (p, sourceLabel) => {
    setSelectedId(null);
    setPartDocuments([]);
    setCopySourceLabel(sourceLabel || p.part_no || 'part');
    setForm({
      part_no: '',
      model_variant: '',
      description: p.description || '',
      tool_no: p.tool_no || '',
      production_section: p.production_section || '',
      operation_code: p.operation_code || '',
      process_time: toNumberInputValue(p.process_time),
      loading_unloading: toNumberInputValue(p.loading_unloading, '10'),
      qc_column_schema: normalizeQcColumnSchema(p.qc_column_schema, p.qc_parameters),
      qc_parameters: (p.qc_parameters || []).map((q, i) => normalizeQcParamRow(q, i + 1)),
      active: 1,
    });
    setMsg(`Copied from ${sourceLabel || p.part_no} — enter a new Part No, adjust fields, then Save Part`);
  };

  const copyPartAndEdit = async (partId = selectedId) => {
    if (!partId) {
      setMsg('Select a part to copy');
      return;
    }
    try {
      const { data } = await api.get(`/api/parts/${partId}`);
      applyCopyAsNew(data, data.part_no);
    } catch {
      setMsg('Failed to load part for copy');
    }
  };

  const copyPartFromList = async (e, summary) => {
    e.stopPropagation();
    await copyPartAndEdit(summary.id);
  };

  const selectPart = async (summary) => {
    try {
      const { data } = await api.get(`/api/parts/${summary.id}`);
      applyFullPart(data);
    } catch {
      setMsg('Failed to load part details');
    }
  };

  const newPart = () => {
    setSelectedId(null);
    setCopySourceLabel(null);
    setPartDocuments([]);
    setForm({ ...EMPTY_PART, qc_column_schema: [...DEFAULT_QC_COLUMNS], qc_parameters: [] });
    setMsg('');
  };

  const addQcRow = () => {
    setForm((f) => {
      const schema = f.qc_column_schema || DEFAULT_QC_COLUMNS;
      const blank = emptyParamFromSchema(schema);
      return {
        ...f,
        qc_parameters: [
          ...f.qc_parameters,
          {
            seq_no: f.qc_parameters.length + 1,
            parameter: '',
            std_value: '',
            is_numeric: false,
            lsl: '',
            usl: '',
            ...blank,
          },
        ],
      };
    });
  };

  const updateQcColumnLabel = (key, label) => {
    setForm((f) => ({
      ...f,
      qc_column_schema: (f.qc_column_schema || []).map((c) => (
        c.key === key ? { ...c, label } : c
      )),
    }));
  };

  const addQcColumn = () => {
    const key = `col_${Date.now()}`;
    setForm((f) => ({
      ...f,
      qc_column_schema: [...(f.qc_column_schema || DEFAULT_QC_COLUMNS), { key, label: '' }],
      qc_parameters: f.qc_parameters.map((q) => setParamColumnValue(q, key, '')),
    }));
  };

  const removeQcColumn = (key) => {
    if (key === 'method' || key === 'frequency') return;
    setForm((f) => ({
      ...f,
      qc_column_schema: (f.qc_column_schema || []).filter((c) => c.key !== key),
      qc_parameters: f.qc_parameters.map((q) => ({
        ...q,
        extra_columns: (q.extra_columns || []).filter((c) => c.key !== key),
      })),
    }));
  };

  const updateQcColumnValue = (rowIdx, key, val) => {
    setForm((f) => {
      const qc = [...f.qc_parameters];
      qc[rowIdx] = setParamColumnValue(qc[rowIdx], key, val);
      return { ...f, qc_parameters: qc };
    });
  };

  const updateQc = (idx, field, val) => {
    setForm((f) => {
      const qc = [...f.qc_parameters];
      const row = { ...qc[idx], [field]: val };
      if (field === 'is_numeric' && !val) {
        row.lsl = '';
        row.usl = '';
      }
      qc[idx] = row;
      return { ...f, qc_parameters: qc };
    });
  };

  const removeQc = (idx) => {
    setForm((f) => ({
      ...f,
      qc_parameters: f.qc_parameters.filter((_, i) => i !== idx).map((q, i) => ({ ...q, seq_no: i + 1 })),
    }));
  };

  const savePart = async () => {
    if (!form.part_no.trim()) {
      setMsg('Part number is required');
      return;
    }
    for (const q of form.qc_parameters) {
      if (q.is_numeric && (q.lsl === '' || q.lsl == null || q.usl === '' || q.usl == null)) {
        setMsg(`LSL and USL are required for numeric parameter "${q.parameter || '(unnamed)'}"`);
        return;
      }
    }
    for (const col of form.qc_column_schema || []) {
      if (!col.label?.trim()) {
        setMsg('All QC column names must be filled in');
        return;
      }
    }
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...form,
        process_time: form.process_time === '' ? null : Number(form.process_time),
        loading_unloading: Number(form.loading_unloading) || 10,
        qc_column_schema: form.qc_column_schema || DEFAULT_QC_COLUMNS,
        qc_parameters: form.qc_parameters.map((q, i) => {
          const cols = serializeParamColumns(q, form.qc_column_schema);
          return {
            seq_no: i + 1,
            parameter: q.parameter,
            std_value: q.std_value,
            is_numeric: !!q.is_numeric,
            lsl: q.is_numeric && q.lsl !== '' ? Number(q.lsl) : null,
            usl: q.is_numeric && q.usl !== '' ? Number(q.usl) : null,
            method: cols.method,
            frequency: cols.frequency,
            extra_columns: cols.extra_columns,
          };
        }),
      };
      delete payload.image_url;
      if (selectedId) {
        await api.put(`/api/parts/${selectedId}`, payload);
        setMsg('Part updated');
      } else {
        const { data } = await api.post('/api/parts/', payload);
        setSelectedId(data.id);
        applyFullPart(data);
        setCopySourceLabel(null);
        setMsg('Part created');
      }
      await loadParts(partsPage, searchQuery);
    } catch (e) {
      setMsg(e.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file) => {
    if (!selectedId || !file) return;
    const sizeErr = validateFileSize(file, MAX_IMAGE_BYTES, 'Image');
    if (sizeErr) {
      setMsg(sizeErr);
      return;
    }
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/parts/${selectedId}/image`, fd);
      setMsg('File uploaded successfully — part image');
      await loadParts(partsPage, searchQuery);
      const updated = (await api.get(`/api/parts/${selectedId}`)).data;
      applyFullPart(updated);
    } catch (e) {
      setMsg(e.response?.data?.detail || 'Image upload failed');
    }
  };

  const uploadDoc = async (docType, file, revision, revDate) => {
    if (!selectedId || !file) return { ok: false };
    const sizeErr = validateWiDocFile(file);
    if (sizeErr) {
      setMsg(sizeErr);
      return { ok: false, message: sizeErr };
    }
    setMsg('');
    const label = DOC_LABEL_BY_KEY[docType] || docType;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const params = { revision: revision || '0' };
      if (revDate) params.rev_date = revDate;
      await api.post(`/api/parts/${selectedId}/documents/${docType}/upload`, fd, { params });
      const success = `File uploaded successfully — ${label} (Rev ${revision || '0'})`;
      setMsg(success);
      await loadParts(partsPage, searchQuery);
      const updated = (await api.get(`/api/parts/${selectedId}`)).data;
      applyFullPart(updated);
      return { ok: true, message: success };
    } catch (e) {
      const err = e.response?.data?.detail || 'Document upload failed';
      setMsg(err);
      return { ok: false, message: err };
    }
  };

  const inp = { ...s.inp };

  return (
    <div className={pageClass(t)} style={s.page}>
      <datalist id="param-presets">
        {PARAMETER_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>

      <PageHeader title="Part Management Master" onRefresh={() => loadParts(partsPage, searchQuery)} extra={
        <button type="button" onClick={newPart} style={s.btnSecondary}>+ New Part</button>
      } />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        <div style={{ ...s.card, padding: 10, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: t.accent }}>Parts Knowledge Base</div>
          <input
            type="search"
            placeholder="Search part no, variant, tool…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...inp, marginBottom: 8, fontSize: 12 }}
          />
          <div style={{ fontSize: 11, color: t.textDim, marginBottom: 6 }}>
            {listLoading ? 'Loading…' : `${partsTotal} part(s) · page ${partsPage} of ${partsPages}`}
          </div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {parts.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                marginBottom: 4,
                gap: 4,
              }}
            >
            <button
              type="button"
              onClick={() => selectPart(p)}
              style={{
                display: 'flex', gap: 10, alignItems: 'center', flex: 1, textAlign: 'left',
                padding: '8px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: selectedId === p.id && !copySourceLabel ? `${t.brand}22` : 'transparent',
                color: p.active ? t.text : t.textFaint,
                fontSize: 13,
              }}
            >
              <div style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: 6,
                border: `1px solid ${t.border}`, background: t.surface2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {p.image_url ? (
                  <PartThumbImage
                    url={p.image_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    placeholder={<span style={{ fontSize: 18, opacity: 0.35 }}>📷</span>}
                  />
                ) : (
                  <span style={{ fontSize: 18, opacity: 0.35 }}>📷</span>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.part_no}</div>
                {p.model_variant && p.model_variant !== p.part_no && (
                  <div style={{ fontSize: 11, color: t.textDim }}>Variant: {p.model_variant}</div>
                )}
                {(p.qc_parameter_preview || p.qc_parameters || []).length > 0 && (
                  <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2 }}>
                    QC: {(p.qc_parameter_preview || (p.qc_parameters || []).map((q) => q.parameter))
                      .filter(Boolean).join(', ')}
                    {p.qc_param_count > (p.qc_parameter_preview?.length || 0) && '…'}
                  </div>
                )}
              </div>
            </button>
            <button
              type="button"
              title={`Copy ${p.part_no} as new part`}
              onClick={(e) => copyPartFromList(e, p)}
              style={{
                flexShrink: 0,
                width: 32,
                borderRadius: 6,
                border: `1px solid ${t.border}`,
                background: t.surface2,
                cursor: 'pointer',
                fontSize: 14,
                color: t.textDim,
              }}
            >
              ⧉
            </button>
            </div>
          ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'space-between' }}>
            <button
              type="button"
              style={s.btnSecondary}
              disabled={partsPage <= 1 || listLoading}
              onClick={() => loadParts(partsPage - 1, searchQuery)}
            >
              ← Prev
            </button>
            <button
              type="button"
              style={s.btnSecondary}
              disabled={partsPage >= partsPages || listLoading}
              onClick={() => loadParts(partsPage + 1, searchQuery)}
            >
              Next →
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 10, color: t.textFaint }}>
            WI docs: PDF max 5 MB · JPEG/PNG/SVG max 2 MB · part image max 2 MB
          </p>
        </div>

        <div style={{ ...s.card, padding: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{
              width: 120, height: 120, flexShrink: 0, borderRadius: 10,
              border: `2px dashed ${form.image_url ? t.brand : t.border}`,
              background: t.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {form.image_url ? (
                <PartThumbImage
                  url={form.image_url}
                  alt={form.part_no || 'Part'}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  placeholder={<span style={{ fontSize: 32, opacity: 0.3, color: t.textDim }}>📷</span>}
                />
              ) : (
                <span style={{ fontSize: 32, opacity: 0.3, color: t.textDim }}>📷</span>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: t.text }}>
                  {selectedId
                    ? 'Edit Part'
                    : copySourceLabel
                      ? `New Part (copied from ${copySourceLabel})`
                      : 'New Part'}
                </h3>
                {selectedId && (
                  <button
                    type="button"
                    onClick={() => copyPartAndEdit()}
                    style={s.btnSecondary}
                    title="Duplicate this part as a new record"
                  >
                    Copy &amp; Edit as New
                  </button>
                )}
              </div>
              {copySourceLabel && !selectedId && (
                <p style={{ margin: '0 0 8px', fontSize: 12, color: t.warning || '#ed6c02' }}>
                  QC parameters and spec columns were copied. Enter a unique Part No, then save.
                  Image and PDFs are not copied — upload after saving.
                </p>
              )}
              {selectedId ? (
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: t.textDim, display: 'block', marginBottom: 4 }}>Part Image</label>
                  <input type="file" accept="image/*" onChange={(e) => { uploadImage(e.target.files?.[0]); e.target.value = ''; }} style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10, color: t.textFaint }}>Max 2 MB (jpg, png, webp, gif)</span>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: t.textDim }}>Save the part first, then upload an image.</p>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[
              ['part_no', 'Part No / Article No'],
              ['model_variant', 'Planning Sheet Variant Name'],
              ['description', 'Description'],
              ['tool_no', 'Tool No'],
              ['production_section', 'Production Section'],
              ['operation_code', 'Operation Code'],
              ['process_time', 'Process Time (s)', 'number'],
              ['loading_unloading', 'Loading/Unloading (s)', 'number'],
            ].map(([key, label, type]) => (
              <label key={key} style={{ fontSize: 12, color: t.textDim }}>
                {label}
                <input
                  type={type || 'text'}
                  value={type === 'number' ? toNumberInputValue(form[key], key === 'loading_unloading' ? '10' : '') : (form[key] ?? '')}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  style={{ ...inp, marginTop: 4 }}
                />
              </label>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>QC Parameters (shown on WI / QC sheet)</strong>
              <button type="button" onClick={addQcRow} style={s.btnSecondary}>+ Add Row</button>
            </div>
            <div style={{
              marginBottom: 10, padding: 10, borderRadius: 8,
              border: `1px solid ${t.border}`, background: t.surface2,
            }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                  Spec columns (shared by all parameters — rename for each customer)
                </span>
                <button type="button" onClick={addQcColumn} style={s.btnSecondary}>+ Add Column</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(form.qc_column_schema || DEFAULT_QC_COLUMNS).map((col) => (
                  <div
                    key={col.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 6, border: `1px solid ${t.border}`,
                      background: t.surface,
                    }}
                  >
                    <input
                      value={col.label || ''}
                      onChange={(e) => updateQcColumnLabel(col.key, e.target.value)}
                      placeholder="Column name"
                      style={{ ...inp, width: 120, fontSize: 11 }}
                    />
                    {col.key !== 'method' && col.key !== 'frequency' && (
                      <button
                        type="button"
                        onClick={() => removeQcColumn(col.key)}
                        style={{ cursor: 'pointer', border: 'none', background: 'transparent', color: t.textDim }}
                        title="Remove column"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11, color: t.textDim }}>
                Method and Freq are default columns; rename their labels or add more columns — every parameter row uses the same set.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['#', 'Parameter (select or type)', 'STD', 'Num', 'LSL', 'USL'].map((h) => (
                      <th key={h} className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }}>{h}</th>
                    ))}
                    {(form.qc_column_schema || DEFAULT_QC_COLUMNS).map((col) => (
                      <th key={col.key} className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }}>
                        {col.label || col.key}
                      </th>
                    ))}
                    <th className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {form.qc_parameters.map((q, i) => (
                    <tr key={i}>
                      <td style={{ padding: 4 }}>{i + 1}</td>
                      <td style={{ padding: 4 }}>
                        <input list="param-presets" value={q.parameter || ''}
                          onChange={(e) => updateQc(i, 'parameter', e.target.value)} style={inp}
                          placeholder="Select or enter name" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input value={q.std_value || ''} onChange={(e) => updateQc(i, 'std_value', e.target.value)} style={inp} />
                      </td>
                      <td style={{ padding: 4, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!q.is_numeric}
                          onChange={(e) => updateQc(i, 'is_numeric', e.target.checked)}
                          title="Numeric value — enter LSL/USL for SPC"
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          type="number"
                          step="any"
                          value={toNumberInputValue(q.lsl)}
                          disabled={!q.is_numeric}
                          onChange={(e) => updateQc(i, 'lsl', e.target.value)}
                          style={{ ...inp, opacity: q.is_numeric ? 1 : 0.45 }}
                          placeholder="LSL"
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          type="number"
                          step="any"
                          value={toNumberInputValue(q.usl)}
                          disabled={!q.is_numeric}
                          onChange={(e) => updateQc(i, 'usl', e.target.value)}
                          style={{ ...inp, opacity: q.is_numeric ? 1 : 0.45 }}
                          placeholder="USL"
                        />
                      </td>
                      {(form.qc_column_schema || DEFAULT_QC_COLUMNS).map((col) => (
                        <td key={col.key} style={{ padding: 4 }}>
                          <input
                            value={getParamColumnValue(q, col.key)}
                            onChange={(e) => updateQcColumnValue(i, col.key, e.target.value)}
                            style={inp}
                            placeholder={col.label || col.key}
                          />
                        </td>
                      ))}
                      <td style={{ padding: 4 }}>
                        <button type="button" onClick={() => removeQc(i)} style={{ cursor: 'pointer' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedId && (
            <div style={{ marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Upload Work Instructions</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                {DOC_TYPES.map(({ key, label }) => (
                  <DocUploadRow
                    key={key}
                    label={label}
                    t={t}
                    current={partDocuments.find((d) => d.doc_type === key)}
                    onUpload={(file, rev, date) => uploadDoc(key, file, rev, date)}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" onClick={savePart} disabled={saving} style={s.btnAccent}>
              {saving ? 'Saving…' : selectedId ? 'Update Part' : 'Save Part'}
            </button>
            {msg && (
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                color: msg.toLowerCase().includes('fail') || msg.includes('required') ? '#dc2626' : '#16a34a',
              }}
              >
                {msg.toLowerCase().includes('success') || msg.includes('uploaded') ? '✓ ' : ''}{msg}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocUploadRow({ label, current, onUpload, t }) {
  const [rev, setRev] = useState('0');
  const [revDate, setRevDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [rowMsg, setRowMsg] = useState('');
  const s = getWorkInstructionStyles(t);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setRowMsg('');
    const result = await onUpload(file, rev, revDate);
    setUploading(false);
    if (result?.ok) {
      setRowMsg(result.message || 'File uploaded successfully');
    } else if (result?.message) {
      setRowMsg(result.message);
    }
  };

  const rowOk = rowMsg && !rowMsg.toLowerCase().includes('fail');

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 10, fontSize: 12, background: t.surface2 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: t.text }}>{label}</div>
      {current && (
        <div style={{ color: t.textDim, marginBottom: 6 }}>
          Current: Rev {current.revision} · {current.rev_date || '—'}
          {current.file_url && (
            <span style={{ marginLeft: 6, color: '#16a34a', fontWeight: 600 }}>✓ On file</span>
          )}
        </div>
      )}
      <input type="text" placeholder="Revision" value={rev} onChange={(e) => setRev(e.target.value)} style={{ ...s.inp, marginBottom: 4 }} />
      <input type="date" value={revDate} onChange={(e) => setRevDate(e.target.value)} style={{ ...s.inp, marginBottom: 4 }} />
      <input
        type="file"
        accept={WI_DOC_ACCEPT}
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            const err = validateWiDocFile(f);
            if (err) {
              setRowMsg(err);
              e.target.value = '';
              return;
            }
            handleFile(f);
          }
          e.target.value = '';
        }}
        style={{ width: '100%', fontSize: 11 }}
      />
      <div style={{ fontSize: 10, color: t.textDim, marginTop: 4 }}>PDF, JPEG, PNG, or SVG (PDF max 5 MB, images max 2 MB)</div>
      {uploading && <div style={{ marginTop: 6, color: t.textDim }}>Uploading…</div>}
      {rowMsg && (
        <div style={{
          marginTop: 6,
          fontWeight: 600,
          color: rowOk ? '#16a34a' : '#dc2626',
        }}
        >
          {rowOk ? '✓ ' : ''}{rowMsg}
        </div>
      )}
    </div>
  );
}

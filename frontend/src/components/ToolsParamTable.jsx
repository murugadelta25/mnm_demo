/**
 * ToolsParamTable — Enhanced tools parameters table for Part Master.
 *
 * Features:
 * 1. "Add Row" opens a searchable tool picker from Tool Management
 * 2. Quick-add a new tool if it doesn't exist in Tool Management
 * 3. "Load from Tool Group" selector to bulk-fill rows from a reusable group
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';

/* ── tiny helpers ── */
const DEBOUNCE = 300;

function useClickOutside(ref, handler) {
  useEffect(() => {
    const cb = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener('mousedown', cb);
    return () => document.removeEventListener('mousedown', cb);
  }, [ref, handler]);
}

/* ── Tool picker dropdown ── */
function ToolPickerDropdown({ onSelect, onQuickAdd, t, inp, anchorStyle }) {
  const [search, setSearch] = useState('');
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const ref = useRef(null);
  const [open, setOpen] = useState(true);

  useClickOutside(ref, () => setOpen(false));

  const fetchTools = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/tools/', { params: { search: q || '', limit: 30 } });
      setTools(Array.isArray(data) ? data : data.tools || []);
    } catch { setTools([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTools(''); }, [fetchTools]);

  const onSearch = (val) => {
    setSearch(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchTools(val), DEBOUNCE);
  };

  if (!open) return null;

  return (
    <div ref={ref} style={{
      position: 'absolute', zIndex: 999, top: anchorStyle?.top ?? 32,
      left: 0, minWidth: 340, maxHeight: 320, background: t.surface,
      border: `1px solid ${t.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.18)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ padding: 8, borderBottom: `1px solid ${t.border}` }}>
        <input
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tools by code or name..."
          style={{ ...inp, width: '100%', fontSize: 12 }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 220 }}>
        {loading && <div style={{ padding: 10, fontSize: 12, color: t.textDim }}>Loading...</div>}
        {!loading && tools.length === 0 && (
          <div style={{ padding: 10, fontSize: 12, color: t.textDim }}>
            No tools found.{' '}
            <button type="button" onClick={() => onQuickAdd(search)} style={{
              color: t.accent, background: 'none', border: 'none', cursor: 'pointer',
              textDecoration: 'underline', fontSize: 12, padding: 0,
            }}>
              + Add "{search}" to Tool Management
            </button>
          </div>
        )}
        {tools.map((tool) => (
          <div
            key={tool.id}
            onClick={() => { onSelect(tool); setOpen(false); }}
            style={{
              padding: '6px 10px', cursor: 'pointer', fontSize: 12,
              borderBottom: `1px solid ${t.border}22`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span><strong>{tool.tool_code}</strong> — {tool.tool_name}</span>
            <span style={{ fontSize: 11, color: t.textDim }}>
              Life: {tool.life_cycles_limit ?? '—'}
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding: 6, borderTop: `1px solid ${t.border}`, textAlign: 'center' }}>
        <button type="button" onClick={() => onQuickAdd(search)} style={{
          fontSize: 11, color: t.accent, background: 'none', border: 'none',
          cursor: 'pointer', textDecoration: 'underline',
        }}>
          + Add new tool to Tool Management
        </button>
      </div>
    </div>
  );
}

/* ── Quick-add tool modal ── */
function QuickAddToolModal({ initialCode, onCreated, onClose, t, inp }) {
  const [code, setCode] = useState(initialCode || '');
  const [name, setName] = useState('');
  const [life, setLife] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!code.trim() || !name.trim()) { setError('Code and name are required'); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/api/tools/', {
        tool_code: code.trim(),
        tool_name: name.trim(),
        life_cycles_limit: life ? parseInt(life, 10) : null,
        stock_qty: 0, min_stock: 0,
      });
      onCreated(data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to create tool');
    }
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: t.surface, borderRadius: 12, padding: 24,
        minWidth: 360, maxWidth: 440, boxShadow: '0 6px 32px rgba(0,0,0,.25)',
      }}>
        <h3 style={{ margin: '0 0 16px', color: t.text, fontSize: 15 }}>Add New Tool to Tool Management</h3>
        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: t.text }}>
            Tool Code *
            <input value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inp, width: '100%' }} />
          </label>
          <label style={{ fontSize: 12, color: t.text }}>
            Tool Name *
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: '100%' }} />
          </label>
          <label style={{ fontSize: 12, color: t.text }}>
            Life Cycles Limit
            <input value={life} onChange={(e) => setLife(e.target.value)} type="number" style={{ ...inp, width: '100%' }} />
          </label>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{
            padding: '6px 16px', borderRadius: 6, border: `1px solid ${t.border}`,
            background: t.surface2, color: t.text, cursor: 'pointer', fontSize: 12,
          }}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none',
            background: t.accent, color: '#fff', cursor: 'pointer', fontSize: 12,
            opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Saving...' : 'Add Tool & Use'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function ToolsParamTable({
  table, onChange, toolGroupId, onToolGroupChange, t, s, inp,
  CollapsibleSection, SymbolInput, isSpecColumn, emptyRowFromColumns,
}) {
  const columns = table?.columns || [];
  const rows = table?.rows || [];
  const [showPicker, setShowPicker] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null); // string | null
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const pickerAnchor = useRef(null);

  /* load groups on mount */
  useEffect(() => {
    (async () => {
      setLoadingGroups(true);
      try {
        const { data } = await api.get('/api/tools/groups/');
        setGroups(Array.isArray(data) ? data : []);
      } catch { setGroups([]); }
      setLoadingGroups(false);
    })();
  }, []);

  /* ── column helpers (same as DynamicParamTable) ── */
  const updateColumnLabel = (key, label) => {
    onChange({ ...table, columns: columns.map((c) => (c.key === key ? { ...c, label } : c)) });
  };
  const addColumn = () => {
    const key = `col_${Date.now()}`;
    onChange({ columns: [...columns, { key, label: '' }], rows: rows.map((r) => ({ ...r, [key]: '' })) });
  };
  const removeColumn = (key) => {
    if (columns.length <= 1) return;
    onChange({
      columns: columns.filter((c) => c.key !== key),
      rows: rows.map((r) => { const next = { ...r }; delete next[key]; return next; }),
    });
  };
  const updateCell = (rowIdx, key, val) => {
    const nextRows = [...rows];
    nextRows[rowIdx] = { ...nextRows[rowIdx], [key]: val };
    onChange({ ...table, rows: nextRows });
  };
  const removeRow = (rowIdx) => {
    onChange({ ...table, rows: rows.filter((_, i) => i !== rowIdx) });
  };

  /* ── tool selection → new row ── */
  const addToolRow = (tool) => {
    const row = {};
    columns.forEach((c) => { row[c.key] = ''; });
    row.tool_id = tool.id;
    row.tools_detail = tool.tool_name || '';
    row.tool_no = tool.tool_code || '';
    row.approx_tool_life = tool.life_cycles_limit != null ? String(tool.life_cycles_limit) : '';
    onChange({ ...table, rows: [...rows, row] });
    setShowPicker(false);
  };

  /* ── quick-add callbacks ── */
  const handleQuickAdd = (searchText) => {
    setShowPicker(false);
    setQuickAdd(searchText || '');
  };
  const handleToolCreated = (tool) => {
    setQuickAdd(null);
    addToolRow(tool);
  };

  /* ── load from group ── */
  const handleGroupSelect = async (groupId) => {
    if (!groupId) {
      onToolGroupChange?.(null);
      return;
    }
    const gid = parseInt(groupId, 10);
    try {
      const { data } = await api.get(`/api/tools/groups/${gid}/tools-parameters`);
      const gRows = data.tools_parameters?.rows || [];
      // Merge: keep columns, replace rows with group rows
      const merged = gRows.map((gr) => {
        const row = {};
        columns.forEach((c) => { row[c.key] = gr[c.key] ?? ''; });
        row.tool_id = gr.tool_id;
        return row;
      });
      onChange({ ...table, rows: merged });
      onToolGroupChange?.(gid);
    } catch (e) {
      console.error('Failed to load tool group', e);
    }
  };

  const addManualRow = () => {
    onChange({ ...table, rows: [...rows, emptyRowFromColumns(columns)] });
  };

  return (
    <>
      <CollapsibleSection
        title="TOOLS PARAMETERS"
        defaultOpen={false}
        t={t}
        s={s}
        summary={`${rows.length} row(s) · ${columns.length} column(s)`}
        headerExtra={(
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }} ref={pickerAnchor}>
            <button type="button" onClick={() => setShowPicker(!showPicker)} style={{
              ...s.btnAddRow, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              + Add Tool
            </button>
            <button type="button" onClick={addManualRow} style={{
              ...s.btnAddRow, fontSize: 10, opacity: 0.7,
            }} title="Add empty row (manual entry)">
              + Manual
            </button>
            {showPicker && (
              <ToolPickerDropdown
                onSelect={addToolRow}
                onQuickAdd={handleQuickAdd}
                t={t}
                inp={inp}
              />
            )}
          </div>
        )}
      >
        {/* Tool Group selector */}
        <div style={{
          marginBottom: 10, padding: '8px 10px', borderRadius: 8,
          border: `1px solid ${t.border}`, background: t.surface,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>
            Tool Group:
          </label>
          <select
            value={toolGroupId || ''}
            onChange={(e) => handleGroupSelect(e.target.value)}
            style={{ ...inp, minWidth: 200, fontSize: 12 }}
            disabled={loadingGroups}
          >
            <option value="">— None (individual tools) —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.group_code} — {g.name} ({g.member_count} tools)
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: t.textDim }}>
            Select a group to load its tools, or add tools individually above.
          </span>
        </div>

        {/* Columns editor */}
        <div style={{
          marginBottom: 10, padding: 10, borderRadius: 8,
          border: `1px solid ${t.border}`, background: t.surface,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
              Columns (rename or add — shared by all rows)
            </span>
            <button type="button" onClick={addColumn} style={s.btnAddColumn}>+ Add Column</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {columns.map((col) => (
              <div key={col.key} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 6, border: `1px solid ${t.border}`,
                background: t.surface2,
              }}>
                <input
                  value={col.label || ''}
                  onChange={(e) => updateColumnLabel(col.key, e.target.value)}
                  placeholder="Column name"
                  style={{ ...inp, width: 140, fontSize: 11 }}
                />
                {columns.length > 1 && (
                  <button type="button" onClick={() => removeColumn(col.key)}
                    style={{ cursor: 'pointer', border: 'none', background: 'transparent', color: t.textDim }}
                    title="Remove column">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }}>#</th>
                {columns.map((col) => (
                  <th key={col.key} className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }}>
                    {col.label || col.key}
                  </th>
                ))}
                <th className="wi-qc-th" style={{ ...s.thYellow, padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 2} style={{ padding: 8, color: t.textDim, fontSize: 12 }}>
                    No tools yet — click <strong>+ Add Tool</strong> to select from Tool Management, or use <strong>Tool Group</strong> to load a preset.
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i}>
                  <td style={{ padding: 4 }}>{i + 1}</td>
                  {columns.map((col) => (
                    <td key={col.key} style={{
                      padding: 4,
                      minWidth: isSpecColumn(col) || col.key === 'tools_detail' ? 160 : undefined,
                    }}>
                      {col.key === 'tools_detail' || col.key === 'tool_no' ? (
                        /* read-only if linked to tool management, else editable */
                        row.tool_id ? (
                          <span style={{ fontSize: 12, color: t.text, padding: '4px 0', display: 'block' }}
                            title="Linked from Tool Management">
                            {row[col.key] || '—'}
                          </span>
                        ) : (
                          <SymbolInput
                            value={row[col.key] ?? ''}
                            onChange={(val) => updateCell(i, col.key, val)}
                            style={inp}
                            placeholder={col.label || col.key}
                            t={t}
                            title="Insert ± / GD&T symbols"
                          />
                        )
                      ) : isSpecColumn(col) ? (
                        <SymbolInput
                          value={row[col.key] ?? ''}
                          onChange={(val) => updateCell(i, col.key, val)}
                          style={inp}
                          placeholder={col.label || col.key}
                          t={t}
                          title="Insert ± / GD&T symbols"
                        />
                      ) : (
                        <input
                          value={row[col.key] ?? ''}
                          onChange={(e) => updateCell(i, col.key, e.target.value)}
                          style={inp}
                          placeholder={col.label || col.key}
                        />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: 4 }}>
                    <button type="button" onClick={() => removeRow(i)} style={{ cursor: 'pointer' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Quick-add modal */}
      {quickAdd !== null && (
        <QuickAddToolModal
          initialCode={quickAdd}
          onCreated={handleToolCreated}
          onClose={() => setQuickAdd(null)}
          t={t}
          inp={inp}
        />
      )}
    </>
  );
}

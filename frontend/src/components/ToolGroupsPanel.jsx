/**
 * ToolGroupsPanel — Manage reusable tool groups for Part Master.
 * Used as a tab inside ToolManagement.
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export default function ToolGroupsPanel({ t, canEdit }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null); // null | group object (with members)
  const [showForm, setShowForm] = useState(false);
  const [allTools, setAllTools] = useState([]);

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13,
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/tools/groups/', { params: { active_only: true } });
      setGroups(data || []);
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.detail || e.message));
    }
    setLoading(false);
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const { data } = await api.get('/api/tools/', { params: { active_only: true, limit: 500 } });
      setAllTools(Array.isArray(data) ? data : data.tools || []);
    } catch { setAllTools([]); }
  }, []);

  useEffect(() => { load(); loadTools(); }, [load, loadTools]);

  const EMPTY = { group_code: '', name: '', description: '', members: [] };

  const openNew = () => { setEditing({ ...EMPTY }); setShowForm(true); };
  const openEdit = async (g) => {
    try {
      const { data } = await api.get(`/api/tools/groups/${g.id}`);
      setEditing(data);
      setShowForm(true);
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.detail || e.message));
    }
  };

  const save = async () => {
    if (!editing) return;
    const payload = {
      group_code: editing.group_code,
      name: editing.name,
      description: editing.description || '',
      members: (editing.members || []).map((m, i) => ({
        tool_id: m.tool_id,
        sort_order: i,
        approx_tool_life: m.approx_tool_life || '',
        rpm: m.rpm || '',
        feed_mm_rev: m.feed_mm_rev || '',
        depth_of_cut: m.depth_of_cut || '',
        cutting_speed: m.cutting_speed || '',
      })),
    };
    try {
      if (editing.id) {
        await api.put(`/api/tools/groups/${editing.id}`, payload);
      } else {
        await api.post('/api/tools/groups/', payload);
      }
      setShowForm(false);
      setEditing(null);
      setMsg('✅ Saved');
      load();
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.detail || e.message));
    }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Deactivate group "${g.group_code}"?`)) return;
    try {
      await api.delete(`/api/tools/groups/${g.id}`);
      load();
      setMsg('✅ Deactivated');
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.detail || e.message));
    }
  };

  const addMember = (toolId) => {
    if (!editing) return;
    const tid = parseInt(toolId, 10);
    if (!tid || editing.members.some((m) => m.tool_id === tid)) return;
    const tool = allTools.find((t2) => t2.id === tid);
    if (!tool) return;
    setEditing({
      ...editing,
      members: [...editing.members, {
        tool_id: tid,
        tool_code: tool.tool_code,
        tool_name: tool.tool_name,
        life_cycles_limit: tool.life_cycles_limit,
        approx_tool_life: tool.life_cycles_limit != null ? String(tool.life_cycles_limit) : '',
        rpm: '', feed_mm_rev: '', depth_of_cut: '', cutting_speed: '',
      }],
    });
  };

  const removeMember = (idx) => {
    if (!editing) return;
    setEditing({ ...editing, members: editing.members.filter((_, i) => i !== idx) });
  };

  const updateMember = (idx, key, val) => {
    if (!editing) return;
    const members = [...editing.members];
    members[idx] = { ...members[idx], [key]: val };
    setEditing({ ...editing, members });
  };

  return (
    <div>
      {msg && <div style={{ padding: 8, marginBottom: 8, fontSize: 13, color: msg.startsWith('❌') ? '#e74c3c' : '#27ae60' }}>{msg}</div>}

      {!showForm ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              Tool Groups ({groups.length})
            </span>
            {canEdit && (
              <button type="button" onClick={openNew} style={{
                padding: '7px 16px', borderRadius: 8, border: 'none',
                background: t.accent, color: '#fff', cursor: 'pointer', fontSize: 13,
              }}>+ New Group</button>
            )}
          </div>

          {loading ? <div style={{ color: t.textDim }}>Loading...</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: t.surface2 }}>
                  <th style={{ padding: 8, textAlign: 'left', color: t.text }}>Code</th>
                  <th style={{ padding: 8, textAlign: 'left', color: t.text }}>Name</th>
                  <th style={{ padding: 8, textAlign: 'center', color: t.text }}>Tools</th>
                  <th style={{ padding: 8, textAlign: 'center', color: t.text }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 12, color: t.textDim, textAlign: 'center' }}>
                    No tool groups yet. Create one to reuse across parts.
                  </td></tr>
                )}
                {groups.map((g) => (
                  <tr key={g.id} style={{ borderBottom: `1px solid ${t.border}` }}>
                    <td style={{ padding: 8, fontWeight: 600, color: t.text }}>{g.group_code}</td>
                    <td style={{ padding: 8, color: t.text }}>{g.name}</td>
                    <td style={{ padding: 8, textAlign: 'center', color: t.text }}>{g.member_count}</td>
                    <td style={{ padding: 8, textAlign: 'center' }}>
                      <button type="button" onClick={() => openEdit(g)} style={{
                        marginRight: 6, padding: '4px 10px', borderRadius: 6,
                        border: `1px solid ${t.border}`, background: t.surface2,
                        color: t.text, cursor: 'pointer', fontSize: 12,
                      }}>Edit</button>
                      {canEdit && (
                        <button type="button" onClick={() => deleteGroup(g)} style={{
                          padding: '4px 10px', borderRadius: 6,
                          border: `1px solid ${t.border}`, background: '#e74c3c22',
                          color: '#e74c3c', cursor: 'pointer', fontSize: 12,
                        }}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        /* ── Edit / Create form ── */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              {editing?.id ? `Edit Group: ${editing.group_code}` : 'New Tool Group'}
            </span>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{
              padding: '6px 14px', borderRadius: 6, border: `1px solid ${t.border}`,
              background: t.surface2, color: t.text, cursor: 'pointer', fontSize: 12,
            }}>← Back</button>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 140px', fontSize: 12, color: t.text }}>
              Group Code *
              <input value={editing?.group_code || ''} onChange={(e) => setEditing({ ...editing, group_code: e.target.value })}
                style={{ ...inp, width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ flex: '2 1 200px', fontSize: 12, color: t.text }}>
              Name *
              <input value={editing?.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                style={{ ...inp, width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ flex: '2 1 200px', fontSize: 12, color: t.text }}>
              Description
              <input value={editing?.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                style={{ ...inp, width: '100%', marginTop: 4 }} />
            </label>
          </div>

          {/* Members */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
                Members ({(editing?.members || []).length} tools)
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select onChange={(e) => { addMember(e.target.value); e.target.value = ''; }}
                  defaultValue="" style={{ ...inp, fontSize: 12, minWidth: 200 }}>
                  <option value="" disabled>+ Add tool from inventory...</option>
                  {allTools.filter((tl) => !(editing?.members || []).some((m) => m.tool_id === tl.id))
                    .map((tl) => (
                      <option key={tl.id} value={tl.id}>{tl.tool_code} — {tl.tool_name}</option>
                    ))}
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: t.surface2 }}>
                    <th style={{ padding: 6, color: t.text }}>#</th>
                    <th style={{ padding: 6, textAlign: 'left', color: t.text }}>Tool Code</th>
                    <th style={{ padding: 6, textAlign: 'left', color: t.text }}>Tool Name</th>
                    <th style={{ padding: 6, color: t.text }}>Tool Life</th>
                    <th style={{ padding: 6, color: t.text }}>RPM</th>
                    <th style={{ padding: 6, color: t.text }}>Feed mm/rev</th>
                    <th style={{ padding: 6, color: t.text }}>Depth of Cut</th>
                    <th style={{ padding: 6, color: t.text }}>Cutting Speed</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {(editing?.members || []).length === 0 && (
                    <tr><td colSpan={9} style={{ padding: 10, color: t.textDim, textAlign: 'center' }}>
                      No members — select tools from the dropdown above.
                    </td></tr>
                  )}
                  {(editing?.members || []).map((m, i) => (
                    <tr key={m.tool_id} style={{ borderBottom: `1px solid ${t.border}22` }}>
                      <td style={{ padding: 4, textAlign: 'center' }}>{i + 1}</td>
                      <td style={{ padding: 4, fontWeight: 600 }}>{m.tool_code || '—'}</td>
                      <td style={{ padding: 4 }}>{m.tool_name || '—'}</td>
                      <td style={{ padding: 4 }}>
                        <input value={m.approx_tool_life || ''} onChange={(e) => updateMember(i, 'approx_tool_life', e.target.value)}
                          style={{ ...inp, width: 70, fontSize: 11 }} placeholder="Life" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input value={m.rpm || ''} onChange={(e) => updateMember(i, 'rpm', e.target.value)}
                          style={{ ...inp, width: 60, fontSize: 11 }} placeholder="RPM" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input value={m.feed_mm_rev || ''} onChange={(e) => updateMember(i, 'feed_mm_rev', e.target.value)}
                          style={{ ...inp, width: 70, fontSize: 11 }} placeholder="Feed" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input value={m.depth_of_cut || ''} onChange={(e) => updateMember(i, 'depth_of_cut', e.target.value)}
                          style={{ ...inp, width: 70, fontSize: 11 }} placeholder="DOC" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input value={m.cutting_speed || ''} onChange={(e) => updateMember(i, 'cutting_speed', e.target.value)}
                          style={{ ...inp, width: 70, fontSize: 11 }} placeholder="Speed" />
                      </td>
                      <td style={{ padding: 4 }}>
                        <button type="button" onClick={() => removeMember(i)}
                          style={{ cursor: 'pointer', border: 'none', background: 'transparent', color: '#e74c3c', fontSize: 14 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${t.border}`,
              background: t.surface2, color: t.text, cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
            <button type="button" onClick={save} style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: t.accent, color: '#fff', cursor: 'pointer', fontSize: 13,
            }}>Save Group</button>
          </div>
        </div>
      )}
    </div>
  );
}

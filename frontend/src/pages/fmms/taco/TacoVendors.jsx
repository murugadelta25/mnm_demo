import { useEffect, useState } from 'react';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from '../fmmsUi';

const EMPTY_VENDOR = {
  vendor_code: '', name: '', vendor_type: 'calibration_lab', accreditation: 'NABL',
  contact_email: '', contact_phone: '', city: '', status: 'pending', rating: 4, turnaround_days: 7,
  pending_reason: '',
};

export default function TacoVendors() {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState('master');
  const [vendors, setVendors] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [rates, setRates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_VENDOR);
  const [mapForm, setMapForm] = useState({ vendor_id: '', asset_code: '', equipment_type: '', business_unit: 'Interior Systems', preferred: true });
  const [rateForm, setRateForm] = useState({
    vendor_id: '', service_name: '', equipment_type: '', unit_rate: '', lead_time_days: 7, status: 'active',
  });
  const [decisionDraft, setDecisionDraft] = useState({}); // { [id]: reason }
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [v, m, r] = await Promise.all([
        api.get('/api/fmms/taco/vendors'),
        api.get('/api/fmms/taco/vendor-mappings'),
        api.get('/api/fmms/taco/rate-cards'),
      ]);
      setVendors(v.data || []);
      setMappings(m.data || []);
      setRates(r.data || []);
    } catch {
      setVendors([]); setMappings([]); setRates([]);
    }
  };
  useEffect(() => { load(); }, []);

  const saveVendor = async (e) => {
    e.preventDefault();
    try {
      if (form.status === 'pending' && !String(form.pending_reason || '').trim()) {
        setMsg('Pending reason is required when status is Pending');
        return;
      }
      const rating = Math.min(5, Math.max(0, Number(form.rating) || 0));
      const turnaround_days = Math.max(1, Number(form.turnaround_days) || 7);
      await api.post('/api/fmms/taco/vendors', {
        ...form,
        rating,
        turnaround_days,
        pending_reason: form.pending_reason?.trim() || null,
      });
      setShowForm(false);
      setForm(EMPTY_VENDOR);
      setMsg('Vendor saved');
      load();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Save failed');
    }
  };

  const decideVendor = async (vendorId, action) => {
    const reason = String(decisionDraft[vendorId] || '').trim();
    if (action === 'reject' && !reason) {
      setMsg('Rejection reason is required');
      return;
    }
    try {
      await api.patch(`/api/fmms/taco/vendors/${vendorId}/decision`, {
        action,
        decision_reason: reason || null,
      });
      setDecisionDraft((prev) => {
        const next = { ...prev };
        delete next[vendorId];
        return next;
      });
      setMsg(action === 'approve' ? 'Vendor approved' : 'Vendor rejected');
      load();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Decision failed');
    }
  };

  const saveMap = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/fmms/taco/vendor-mappings', {
        ...mapForm,
        vendor_id: Number(mapForm.vendor_id),
        preferred: Boolean(mapForm.preferred),
      });
      setMapForm({ vendor_id: '', asset_code: '', equipment_type: '', business_unit: 'Interior Systems', preferred: true });
      setMsg('Mapping saved');
      load();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Mapping failed');
    }
  };

  const saveRate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/fmms/taco/rate-cards', {
        vendor_id: Number(rateForm.vendor_id),
        service_name: rateForm.service_name.trim(),
        equipment_type: rateForm.equipment_type.trim() || null,
        unit_rate: Number(rateForm.unit_rate),
        lead_time_days: Number(rateForm.lead_time_days) || 7,
        status: rateForm.status || 'active',
      });
      setRateForm({ vendor_id: '', service_name: '', equipment_type: '', unit_rate: '', lead_time_days: 7, status: 'active' });
      setMsg('Rate card saved');
      load();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Rate card save failed');
    }
  };

  const inp = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13 };
  const tabs = [
    { id: 'master', label: 'Approved Vendor Master (CAL-10)' },
    { id: 'mapping', label: 'Vendor Mapping (CAL-09)' },
    { id: 'rates', label: 'Rate Cards (CAL-11)' },
  ];

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="TACO Vendor Master & Mapping" onRefresh={load} extra={tab === 'master' ? (
        <button type="button" onClick={() => setShowForm(!showForm)} style={btn(t, true)}>{showForm ? 'Cancel' : '+ Add Vendor'}</button>
      ) : null} />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 12 }}>Approved labs, equipment mapping & rate visibility for calibration vendors</p>
      {msg && <p style={{ fontSize: 12, color: t.accent, marginBottom: 8 }}>{msg}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)} style={{ ...btn(t, tab === x.id), fontSize: 12 }}>{x.label}</button>
        ))}
      </div>

      {tab === 'master' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          {showForm && (
            <form onSubmit={saveVendor} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[['vendor_code', 'Code *'], ['name', 'Name *'], ['accreditation', 'Accreditation'], ['city', 'City'], ['contact_email', 'Email'], ['contact_phone', 'Phone']].map(([k, label]) => (
                <label key={k} style={{ fontSize: 11, color: t.textDim }}>
                  {label}
                  <input required={k === 'vendor_code' || k === 'name'} style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </label>
              ))}
              <label style={{ fontSize: 11, color: t.textDim }}>
                Type
                <select style={{ ...inp, width: '100%', marginTop: 4 }} value={form.vendor_type} onChange={(e) => setForm({ ...form, vendor_type: e.target.value })}>
                  <option value="calibration_lab">Calibration Lab</option>
                  <option value="oem">OEM</option>
                  <option value="service">Service</option>
                </select>
              </label>
              <label style={{ fontSize: 11, color: t.textDim }}>
                TAT (days) *
                <input
                  required
                  type="number"
                  min={1}
                  max={365}
                  style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                  value={form.turnaround_days}
                  onChange={(e) => setForm({ ...form, turnaround_days: e.target.value })}
                />
              </label>
              <label style={{ fontSize: 11, color: t.textDim }}>
                Rating (0–5) *
                <input
                  required
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                  value={form.rating}
                  onChange={(e) => setForm({ ...form, rating: e.target.value })}
                  title="Manual performance score. Not auto-calculated."
                />
              </label>
              <label style={{ fontSize: 11, color: t.textDim }}>
                Status
                <select style={{ ...inp, width: '100%', marginTop: 4 }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              {(form.status === 'pending' || form.pending_reason) && (
                <label style={{ fontSize: 11, color: t.textDim, gridColumn: '1 / -1' }}>
                  Pending reason {form.status === 'pending' ? '*' : ''}
                  <input
                    required={form.status === 'pending'}
                    style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                    placeholder="e.g. NABL certificate pending QA verification"
                    value={form.pending_reason}
                    onChange={(e) => setForm({ ...form, pending_reason: e.target.value })}
                  />
                </label>
              )}
              <button type="submit" style={{ ...btn(t, true), alignSelf: 'end' }}>Save Vendor</button>
            </form>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Code</th><th style={thStyle(t)}>Vendor</th><th style={thStyle(t)}>Type</th>
                  <th style={thStyle(t)}>Accreditation</th><th style={thStyle(t)}>City</th><th style={thStyle(t)}>TAT</th>
                  <th style={thStyle(t)}>Rating</th><th style={thStyle(t)}>Status / Reason</th><th style={thStyle(t)}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{v.vendor_code}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ fontWeight: 600 }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: t.textFaint }}>{v.contact_email}</div>
                    </td>
                    <td style={tdStyle(t)}>{v.vendor_type}</td>
                    <td style={tdStyle(t)}>{v.accreditation || '—'}</td>
                    <td style={tdStyle(t)}>{v.city || '—'}</td>
                    <td style={tdStyle(t)}>{v.turnaround_days}d</td>
                    <td style={tdStyle(t)}>{v.rating}</td>
                    <td style={tdStyle(t)}>
                      <FmmsBadge t={t} tone={statusTone(v.status)}>{v.status}</FmmsBadge>
                      {v.status === 'pending' && (
                        <div style={{ fontSize: 11, color: t.textDim, marginTop: 6, maxWidth: 260 }}>
                          <strong>Pending reason:</strong> {v.pending_reason || '—'}
                        </div>
                      )}
                      {v.status === 'rejected' && (
                        <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 6, maxWidth: 260 }}>
                          <strong>Rejected:</strong> {v.decision_reason || '—'}
                          {v.reviewed_by ? ` · by ${v.reviewed_by}` : ''}
                        </div>
                      )}
                      {v.status === 'approved' && v.decision_reason && (
                        <div style={{ fontSize: 11, color: t.textFaint, marginTop: 6, maxWidth: 260 }}>
                          {v.decision_reason}{v.reviewed_by ? ` · by ${v.reviewed_by}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle(t)}>
                      {v.status === 'pending' ? (
                        <div style={{ display: 'grid', gap: 6, minWidth: 180 }}>
                          <input
                            style={{ ...inp, width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                            placeholder="Decision comment (required to reject)"
                            value={decisionDraft[v.id] || ''}
                            onChange={(e) => setDecisionDraft({ ...decisionDraft, [v.id]: e.target.value })}
                          />
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" style={miniBtn(t, 'ok')} onClick={() => decideVendor(v.id, 'approve')}>Approve</button>
                            <button type="button" style={miniBtn(t, 'danger')} onClick={() => decideVendor(v.id, 'reject')}>Reject</button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: t.textFaint }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'mapping' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <form onSubmit={saveMap} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Vendor *
              <select required style={{ ...inp, width: '100%', marginTop: 4 }} value={mapForm.vendor_id} onChange={(e) => setMapForm({ ...mapForm, vendor_id: e.target.value })}>
                <option value="">Select…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>Asset Code<input style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} value={mapForm.asset_code} onChange={(e) => setMapForm({ ...mapForm, asset_code: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: t.textDim }}>Equipment Type<input style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} value={mapForm.equipment_type} onChange={(e) => setMapForm({ ...mapForm, equipment_type: e.target.value })} /></label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              BU
              <select style={{ ...inp, width: '100%', marginTop: 4 }} value={mapForm.business_unit} onChange={(e) => setMapForm({ ...mapForm, business_unit: e.target.value })}>
                {['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'].map((bu) => <option key={bu}>{bu}</option>)}
              </select>
            </label>
            <button type="submit" style={{ ...btn(t, true), alignSelf: 'end' }}>Add Mapping</button>
          </form>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Vendor</th><th style={thStyle(t)}>Asset</th><th style={thStyle(t)}>Type</th>
                <th style={thStyle(t)}>BU</th><th style={thStyle(t)}>Preferred</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle(t)}>{m.vendor_name}</td>
                  <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{m.asset_code || '—'}</td>
                  <td style={tdStyle(t)}>{m.equipment_type || '—'}</td>
                  <td style={tdStyle(t)}>{m.business_unit || '—'}</td>
                  <td style={tdStyle(t)}><FmmsBadge t={t} tone={m.preferred ? 'ok' : 'neutral'}>{m.preferred ? 'Yes' : 'No'}</FmmsBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'rates' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 12 }}>
            Enter negotiated rates manually (₹). Lead time is the promised TAT for that service — not auto-fetched from vendor master.
          </p>
          <form onSubmit={saveRate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Vendor *
              <select required style={{ ...inp, width: '100%', marginTop: 4 }} value={rateForm.vendor_id} onChange={(e) => setRateForm({ ...rateForm, vendor_id: e.target.value })}>
                <option value="">Select…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Service *
              <input required style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} placeholder="e.g. CMM Calibration" value={rateForm.service_name} onChange={(e) => setRateForm({ ...rateForm, service_name: e.target.value })} />
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Equipment
              <input style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} placeholder="e.g. CMM" value={rateForm.equipment_type} onChange={(e) => setRateForm({ ...rateForm, equipment_type: e.target.value })} />
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Rate (₹) *
              <input required type="number" min={0} step={1} style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} placeholder="18500" value={rateForm.unit_rate} onChange={(e) => setRateForm({ ...rateForm, unit_rate: e.target.value })} />
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Lead Time (days) *
              <input required type="number" min={1} style={{ ...inp, width: '100%', marginTop: 4, boxSizing: 'border-box' }} value={rateForm.lead_time_days} onChange={(e) => setRateForm({ ...rateForm, lead_time_days: e.target.value })} />
            </label>
            <label style={{ fontSize: 11, color: t.textDim }}>
              Status
              <select style={{ ...inp, width: '100%', marginTop: 4 }} value={rateForm.status} onChange={(e) => setRateForm({ ...rateForm, status: e.target.value })}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
            <button type="submit" style={{ ...btn(t, true), alignSelf: 'end' }}>Add Rate Card</button>
          </form>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Vendor</th><th style={thStyle(t)}>Service</th><th style={thStyle(t)}>Equipment</th>
                <th style={thStyle(t)}>Rate (₹)</th><th style={thStyle(t)}>Lead Time</th><th style={thStyle(t)}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle(t)}>{r.vendor_name}</td>
                  <td style={tdStyle(t)}>{r.service_name}</td>
                  <td style={tdStyle(t)}>{r.equipment_type}</td>
                  <td style={tdStyle(t)}>₹{Number(r.unit_rate).toLocaleString('en-IN')}</td>
                  <td style={tdStyle(t)}>{r.lead_time_days}d</td>
                  <td style={tdStyle(t)}><FmmsBadge t={t} tone="ok">{r.status}</FmmsBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function btn(t, primary) {
  return {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    border: `1px solid ${primary ? t.accent : t.border}`,
    background: primary ? t.accent : t.surface2,
    color: primary ? '#fff' : t.text,
  };
}

function statusTone(status) {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'critical';
  if (status === 'suspended') return 'neutral';
  return 'warn';
}

function miniBtn(t, kind) {
  const ok = kind === 'ok';
  return {
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
    border: `1px solid ${ok ? '#166534' : '#991b1b'}`,
    background: ok ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.16)',
    color: ok ? '#86efac' : '#fca5a5',
  };
}

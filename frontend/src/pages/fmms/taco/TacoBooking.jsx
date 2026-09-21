import { useEffect, useMemo, useState } from 'react';
import api from '../../../api/client';
import PageHeader from '../../../components/PageHeader';
import { useTheme } from '../../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from '../fmmsUi';

const BUS = ['Interior Systems', 'Lighting Systems', 'Seating Systems', 'HVAC Systems', 'Electronics', 'Composites'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDuration(min) {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

const EMPTY_EQ = {
  equipment_code: '', name: '', equipment_type: 'CMM', owning_bu: 'Interior Systems', location: '',
  duration_options_min: '30,60,120', default_duration_min: 60, day_start: '09:00', day_end: '18:00',
  cost_per_hour: 1000, shareable: true, status: 'available',
};

export default function TacoBooking() {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState('config');
  const [equipment, setEquipment] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [rules, setRules] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [assets, setAssets] = useState([]);
  const [bookingDate, setBookingDate] = useState(todayIso());
  const [requestingBu, setRequestingBu] = useState('Interior Systems');
  const [durationMin, setDurationMin] = useState(60);
  const [eqForm, setEqForm] = useState(EMPTY_EQ);
  const [showEqForm, setShowEqForm] = useState(false);
  const [editEq, setEditEq] = useState(null); // { id, name, duration_options_min, default_duration_min, day_start, day_end, cost_per_hour, status }
  const [bookForm, setBookForm] = useState({
    equipment_id: '', requested_by: '', asset_source: 'machine',
    asset_under_test: '', asset_under_test_name: '',
    fmms_wo_number: '', cost_amount: '', purpose: '', slot_start: '',
  });
  const [decisionDraft, setDecisionDraft] = useState({});
  const [msg, setMsg] = useState('');
  const [assetSources, setAssetSources] = useState([
    { id: 'machine', label: 'Machine (Machine Configuration)' },
    { id: 'measuring_instrument', label: 'Measuring Instruments' },
    { id: 'quality_instrument', label: 'Quality / QA Instruments' },
    { id: 'other', label: 'Other Equipment' },
  ]);
  const [owningBuFilter, setOwningBuFilter] = useState('');

  const selectedEq = useMemo(
    () => equipment.find((e) => String(e.id) === String(bookForm.equipment_id)),
    [equipment, bookForm.equipment_id],
  );

  const filteredAssets = useMemo(() => {
    const src = bookForm.asset_source || 'machine';
    return (assets || []).filter((a) => {
      const cat = String(a.category || '').toLowerCase();
      if (src === 'machine') {
        return cat === 'machine' || a.machine_id != null;
      }
      if (src === 'measuring_instrument') return cat === 'measuring_instrument';
      if (src === 'quality_instrument') return cat === 'quality_instrument';
      // other
      return cat === 'other' || (!['machine', 'measuring_instrument', 'quality_instrument'].includes(cat) && !a.machine_id);
    });
  }, [assets, bookForm.asset_source]);

  const loadMaster = async () => {
    try {
      const [eq, b, r, wo, as, meta] = await Promise.all([
        api.get('/api/fmms/taco/testing-equipment'),
        api.get('/api/fmms/taco/bookings'),
        api.get('/api/fmms/taco/reservation-rules'),
        api.get('/api/fmms/work-orders').catch(() => ({ data: [] })),
        api.get('/api/fmms/assets', { params: { equipment_only: true, page: 1, page_size: 500 } }).catch(() => ({ data: [] })),
        api.get('/api/fmms/assets/meta').catch(() => ({ data: null })),
      ]);
      setEquipment(eq.data || []);
      setBookings(b.data || []);
      setRules(r.data || []);
      setWorkOrders(Array.isArray(wo.data) ? wo.data : []);
      setAssets(as.data?.items || as.data || []);
      if (meta.data?.assetSources?.length) setAssetSources(meta.data.assetSources);
    } catch {
      setEquipment([]); setBookings([]); setRules([]);
    }
  };

  const loadSlots = async () => {
    try {
      const params = {
        booking_date: bookingDate,
        duration_min: durationMin,
        requesting_bu: requestingBu,
      };
      // Portal can narrow to selected machine; Slot Dashboard always shows all shareable equipment
      if (tab === 'portal' && bookForm.equipment_id) params.equipment_id = bookForm.equipment_id;
      const { data } = await api.get('/api/fmms/taco/slots', { params });
      setSlots(data || []);
    } catch {
      setSlots([]);
    }
  };

  useEffect(() => { loadMaster(); }, []);
  useEffect(() => {
    if (tab === 'portal' || tab === 'slots') loadSlots();
  }, [tab, bookingDate, durationMin, bookForm.equipment_id, requestingBu]);

  useEffect(() => {
    if (!selectedEq) return;
    const opts = selectedEq.duration_options_min || [60];
    if (!opts.includes(durationMin)) {
      setDurationMin(selectedEq.default_duration_min || opts[0]);
    }
    const est = (selectedEq.cost_per_hour || 0) * ((durationMin || 60) / 60);
    setBookForm((f) => ({ ...f, cost_amount: f.cost_amount === '' ? String(Math.round(est)) : f.cost_amount }));
  }, [selectedEq?.id, durationMin]);

  const saveEquipment = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/fmms/taco/testing-equipment', {
        ...eqForm,
        default_duration_min: Number(eqForm.default_duration_min),
        cost_per_hour: Number(eqForm.cost_per_hour || 0),
        shareable: Boolean(eqForm.shareable),
      });
      setShowEqForm(false);
      setEqForm(EMPTY_EQ);
      setMsg('Testing equipment configured');
      loadMaster();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Equipment save failed');
    }
  };

  const openEditEquipment = (eq) => {
    setShowEqForm(false);
    setEditEq({
      id: eq.id,
      name: eq.name,
      equipment_code: eq.equipment_code,
      duration_options_min: (eq.duration_options_min || [30, 60, 120]).join(','),
      default_duration_min: eq.default_duration_min || 60,
      day_start: eq.day_start || '09:00',
      day_end: eq.day_end || '18:00',
      cost_per_hour: eq.cost_per_hour ?? 0,
      status: eq.status || 'available',
      location: eq.location || '',
      shareable: eq.shareable !== false,
    });
  };

  const saveEditEquipment = async (e) => {
    e.preventDefault();
    if (!editEq?.id) return;
    const durations = String(editEq.duration_options_min || '')
      .split(',')
      .map((x) => Number(String(x).trim()))
      .filter((n) => n > 0);
    if (!durations.length) {
      setMsg('Enter at least one duration in minutes (e.g. 30,60,120)');
      return;
    }
    try {
      await api.patch(`/api/fmms/taco/testing-equipment/${editEq.id}`, {
        duration_options_min: durations.join(','),
        default_duration_min: Number(editEq.default_duration_min) || durations[0],
        day_start: editEq.day_start || '09:00',
        day_end: editEq.day_end || '18:00',
        cost_per_hour: Number(editEq.cost_per_hour || 0),
        status: editEq.status || 'available',
        location: editEq.location || null,
        shareable: Boolean(editEq.shareable),
      });
      setEditEq(null);
      setMsg(`Updated ${editEq.name}: durations & cost ₹${Number(editEq.cost_per_hour || 0).toLocaleString('en-IN')}/hr`);
      loadMaster();
      loadSlots();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Update failed');
    }
  };

  const submitBooking = async (e) => {
    e.preventDefault();
    if (!bookForm.equipment_id || !bookForm.slot_start) {
      setMsg('Select equipment and a start slot');
      return;
    }
    try {
      const { data } = await api.post('/api/fmms/taco/bookings', {
        equipment_id: Number(bookForm.equipment_id),
        requesting_bu: requestingBu,
        booking_date: bookingDate,
        slot_start: bookForm.slot_start,
        duration_min: Number(durationMin),
        requested_by: bookForm.requested_by.trim() || undefined,
        asset_under_test: bookForm.asset_under_test || null,
        asset_under_test_name: bookForm.asset_under_test_name || null,
        fmms_wo_number: bookForm.fmms_wo_number || null,
        cost_amount: bookForm.cost_amount === '' ? null : Number(bookForm.cost_amount),
        purpose: bookForm.purpose || 'Testing reservation',
      });
      const note = data.status === 'requested'
        ? ` — pending owning BU approval (see Approvals board)`
        : '';
      setMsg(`Booking ${data.booking_number} submitted at ${data.submitted_at}${note}`);
      setBookForm({
        equipment_id: bookForm.equipment_id, requested_by: '', asset_source: 'machine',
        asset_under_test: '', asset_under_test_name: '',
        fmms_wo_number: '', cost_amount: '', purpose: '', slot_start: '',
      });
      loadMaster();
      loadSlots();
      if (data.status === 'requested') setTab('approvals');
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Booking failed');
    }
  };

  const decideBooking = async (bookingId, action) => {
    const reason = String(decisionDraft[bookingId] || '').trim();
    if (action === 'reject' && !reason) {
      setMsg('Rejection reason is required');
      return;
    }
    try {
      await api.patch(`/api/fmms/taco/bookings/${bookingId}/decision`, {
        action,
        decision_reason: reason || null,
      });
      setDecisionDraft((prev) => {
        const next = { ...prev };
        delete next[bookingId];
        return next;
      });
      setMsg(action === 'approve' ? 'Booking approved (confirmed)' : 'Booking rejected (cancelled)');
      loadMaster();
      loadSlots();
    } catch (err) {
      setMsg(err?.response?.data?.detail || 'Decision failed');
    }
  };

  const inp = { padding: '8px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`, background: t.inp, color: t.text, fontSize: 13 };
  const confirmed = bookings.filter((b) => b.status === 'confirmed' || b.status === 'in_use').length;
  const requested = bookings.filter((b) => b.status === 'requested').length;
  const pendingApprovals = bookings.filter((b) => {
    if (b.status !== 'requested') return false;
    if (!owningBuFilter) return true;
    return b.owning_bu === owningBuFilter;
  });
  const durationChoices = selectedEq?.duration_options_min?.length
    ? selectedEq.duration_options_min
    : [30, 60, 120];

  const tabs = [
    { id: 'config', label: '1. Equipment Config' },
    { id: 'portal', label: '2. Booking Portal' },
    { id: 'slots', label: 'Slot Dashboard' },
    { id: 'approvals', label: `Approvals (${requested})` },
    { id: 'rules', label: 'Reservation Rules' },
  ];

  const slotRows = bookForm.equipment_id
    ? slots.filter((s) => String(s.id) === String(bookForm.equipment_id))
    : slots;

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Testing Equipment Booking"
        onRefresh={() => { loadMaster(); loadSlots(); }}
        extra={tab === 'config' ? (
          <button type="button" style={tabBtn(t, true)} onClick={() => setShowEqForm(!showEqForm)}>
            {showEqForm ? 'Cancel' : '+ Configure Equipment'}
          </button>
        ) : null}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 12 }}>
        Configure allowed test durations per machine · Book with WO / asset / cost / requester · Owner-BU priority rules
      </p>
      {msg && <p style={{ fontSize: 12, color: t.accent, marginBottom: 8 }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ fontSize: 11, color: t.textDim }}>CONFIRMED / IN USE</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{confirmed}</div>
        </div>
        <div
          className={surfaceClass(t)}
          style={{ ...cardStyle(t), cursor: requested ? 'pointer' : 'default' }}
          onClick={() => requested && setTab('approvals')}
          title={requested ? 'Open Approvals board' : undefined}
        >
          <div style={{ fontSize: 11, color: t.textDim }}>REQUESTED (NEED APPROVAL)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{requested}</div>
        </div>
        <div className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ fontSize: 11, color: t.textDim }}>TOTAL BOOKINGS</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{bookings.length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)} style={tabBtn(t, tab === x.id)}>{x.label}</button>
        ))}
      </div>

      {tab === 'config' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Testing Equipment Configuration</h3>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0 }}>
            Define which durations (30 min / 1 hr / 2 hr…) are allowed for each machine, operating hours, and hourly cost used when booking.
          </p>
          {showEqForm && (
            <form onSubmit={saveEquipment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              <label style={lab(t)}>Code *<input required style={inp} value={eqForm.equipment_code} onChange={(e) => setEqForm({ ...eqForm, equipment_code: e.target.value })} /></label>
              <label style={lab(t)}>Name *<input required style={inp} value={eqForm.name} onChange={(e) => setEqForm({ ...eqForm, name: e.target.value })} /></label>
              <label style={lab(t)}>Type<input style={inp} value={eqForm.equipment_type} onChange={(e) => setEqForm({ ...eqForm, equipment_type: e.target.value })} /></label>
              <label style={lab(t)}>
                Owning BU
                <select style={inp} value={eqForm.owning_bu} onChange={(e) => setEqForm({ ...eqForm, owning_bu: e.target.value })}>
                  {BUS.map((bu) => <option key={bu}>{bu}</option>)}
                </select>
              </label>
              <label style={lab(t)}>Location<input style={inp} value={eqForm.location} onChange={(e) => setEqForm({ ...eqForm, location: e.target.value })} /></label>
              <label style={lab(t)}>Durations (min) *<input required style={inp} placeholder="30,60,120" value={eqForm.duration_options_min} onChange={(e) => setEqForm({ ...eqForm, duration_options_min: e.target.value })} /></label>
              <label style={lab(t)}>Default duration (min)<input type="number" style={inp} value={eqForm.default_duration_min} onChange={(e) => setEqForm({ ...eqForm, default_duration_min: e.target.value })} /></label>
              <label style={lab(t)}>Day start<input style={inp} value={eqForm.day_start} onChange={(e) => setEqForm({ ...eqForm, day_start: e.target.value })} /></label>
              <label style={lab(t)}>Day end<input style={inp} value={eqForm.day_end} onChange={(e) => setEqForm({ ...eqForm, day_end: e.target.value })} /></label>
              <label style={lab(t)}>Cost / hour (₹)<input type="number" style={inp} value={eqForm.cost_per_hour} onChange={(e) => setEqForm({ ...eqForm, cost_per_hour: e.target.value })} /></label>
              <button type="submit" style={{ ...tabBtn(t, true), alignSelf: 'end' }}>Save Equipment</button>
            </form>
          )}
          {editEq && (
            <form
              onSubmit={saveEditEquipment}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${t.accent}`,
                background: t.surface2,
              }}
            >
              <div style={{ gridColumn: '1 / -1', fontSize: 13, fontWeight: 700 }}>
                Edit: {editEq.name}
                <span style={{ marginLeft: 8, fontFamily: 'monospace', fontWeight: 500, color: t.textFaint }}>{editEq.equipment_code}</span>
              </div>
              <label style={lab(t)}>
                Durations (min) *
                <input
                  required
                  style={inp}
                  placeholder="30,60,120"
                  value={editEq.duration_options_min}
                  onChange={(e) => setEditEq({ ...editEq, duration_options_min: e.target.value })}
                />
              </label>
              <label style={lab(t)}>
                Default duration (min)
                <input
                  type="number"
                  min={15}
                  style={inp}
                  value={editEq.default_duration_min}
                  onChange={(e) => setEditEq({ ...editEq, default_duration_min: e.target.value })}
                />
              </label>
              <label style={lab(t)}>
                Cost / hour (₹) *
                <input
                  required
                  type="number"
                  min={0}
                  step={1}
                  style={inp}
                  value={editEq.cost_per_hour}
                  onChange={(e) => setEditEq({ ...editEq, cost_per_hour: e.target.value })}
                />
              </label>
              <label style={lab(t)}>
                Day start
                <input style={inp} value={editEq.day_start} onChange={(e) => setEditEq({ ...editEq, day_start: e.target.value })} />
              </label>
              <label style={lab(t)}>
                Day end
                <input style={inp} value={editEq.day_end} onChange={(e) => setEditEq({ ...editEq, day_end: e.target.value })} />
              </label>
              <label style={lab(t)}>
                Location
                <input style={inp} value={editEq.location} onChange={(e) => setEditEq({ ...editEq, location: e.target.value })} />
              </label>
              <label style={lab(t)}>
                Status
                <select style={inp} value={editEq.status} onChange={(e) => setEditEq({ ...editEq, status: e.target.value })}>
                  <option value="available">available</option>
                  <option value="booked">booked</option>
                  <option value="maintenance">maintenance</option>
                  <option value="calibration">calibration</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <button type="submit" style={tabBtn(t, true)}>Save changes</button>
                <button type="button" style={smallBtn(t)} onClick={() => setEditEq(null)}>Cancel</button>
              </div>
            </form>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Code</th><th style={thStyle(t)}>Equipment</th><th style={thStyle(t)}>Owning BU</th>
                  <th style={thStyle(t)}>Allowed Durations</th><th style={thStyle(t)}>Hours</th>
                  <th style={thStyle(t)}>₹ / hr</th><th style={thStyle(t)}>Status</th><th style={thStyle(t)}>Edit</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((eq) => (
                  <tr key={eq.id} style={editEq?.id === eq.id ? { outline: `1px solid ${t.accent}` } : undefined}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>{eq.equipment_code}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ fontWeight: 600 }}>{eq.name}</div>
                      <div style={{ fontSize: 11, color: t.textFaint }}>{eq.location}</div>
                    </td>
                    <td style={tdStyle(t)}>{eq.owning_bu}</td>
                    <td style={tdStyle(t)}>{(eq.duration_options_min || []).map(formatDuration).join(' · ') || '—'}</td>
                    <td style={tdStyle(t)}>{eq.day_start}–{eq.day_end}</td>
                    <td style={tdStyle(t)}>₹{Number(eq.cost_per_hour || 0).toLocaleString('en-IN')}</td>
                    <td style={tdStyle(t)}><FmmsBadge t={t} tone={eq.status === 'available' ? 'ok' : 'warn'}>{eq.status}</FmmsBadge></td>
                    <td style={tdStyle(t)}>
                      <button type="button" style={smallBtn(t)} onClick={() => openEditEquipment(eq)}>Durations / Cost</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'portal' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Booking Portal</h3>
          <form onSubmit={submitBooking} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
            <label style={lab(t)}>
              Date *
              <input type="date" required style={inp} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
            </label>
            <label style={lab(t)}>
              Requesting BU *
              <select style={inp} value={requestingBu} onChange={(e) => { setRequestingBu(e.target.value); setBookForm({ ...bookForm, slot_start: '' }); }}>
                {BUS.map((bu) => <option key={bu}>{bu}</option>)}
              </select>
            </label>
            <div style={{ ...lab(t), justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, color: t.textDim, marginBottom: 4 }}>Request type (vs selected machine owner)</span>
              <RequestTypeBadge t={t} requestingBu={requestingBu} selectedEq={selectedEq} />
            </div>
            <label style={lab(t)}>
              Testing equipment *
              <select required style={inp} value={bookForm.equipment_id} onChange={(e) => setBookForm({ ...bookForm, equipment_id: e.target.value, slot_start: '' })}>
                <option value="">Select…</option>
                {equipment.filter((e) => e.shareable).map((eq) => (
                  <option key={eq.id} value={eq.id}>{eq.name} ({eq.owning_bu})</option>
                ))}
              </select>
            </label>
            <label style={lab(t)}>
              Test duration *
              <select style={inp} value={durationMin} onChange={(e) => { setDurationMin(Number(e.target.value)); setBookForm({ ...bookForm, slot_start: '', cost_amount: '' }); }}>
                {durationChoices.map((d) => <option key={d} value={d}>{formatDuration(d)}</option>)}
              </select>
            </label>
            <label style={lab(t)}>
              Requested by *
              <input required style={inp} placeholder="Name / user id" value={bookForm.requested_by} onChange={(e) => setBookForm({ ...bookForm, requested_by: e.target.value })} />
            </label>

            <div style={{ gridColumn: '1 / -1', padding: '10px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface2 }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, marginBottom: 8 }}>Asset under test — source (same as Asset Management)</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                {assetSources.map((opt) => (
                  <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: t.text, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="asset_under_test_source"
                      checked={bookForm.asset_source === opt.id}
                      onChange={() => setBookForm({
                        ...bookForm,
                        asset_source: opt.id,
                        asset_under_test: '',
                        asset_under_test_name: '',
                      })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <label style={lab(t)}>
                  Select asset (code) *
                  <select
                    style={inp}
                    value={bookForm.asset_under_test}
                    onChange={(e) => {
                      const a = filteredAssets.find((x) => x.asset_code === e.target.value);
                      setBookForm({
                        ...bookForm,
                        asset_under_test: e.target.value,
                        asset_under_test_name: a?.name || '',
                      });
                    }}
                  >
                    <option value="">— Select {assetSources.find((s) => s.id === bookForm.asset_source)?.label || 'asset'} —</option>
                    {filteredAssets.map((a) => (
                      <option key={a.id} value={a.asset_code}>
                        {a.asset_code} — {a.name}
                        {a.machine_type ? ` · ${a.machine_type}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={lab(t)}>
                  Asset / equipment name
                  <input
                    style={inp}
                    readOnly
                    value={bookForm.asset_under_test_name}
                    placeholder="Filled from selected asset"
                  />
                </label>
              </div>
              {filteredAssets.length === 0 && (
                <p style={{ fontSize: 11, color: t.textFaint, margin: '8px 0 0' }}>
                  No registered assets for this source. Add them in FMMS → Asset Management first.
                </p>
              )}
            </div>

            <label style={lab(t)}>
              FMMS Work Order
              <select style={inp} value={bookForm.fmms_wo_number} onChange={(e) => setBookForm({ ...bookForm, fmms_wo_number: e.target.value })}>
                <option value="">Map WO (optional)</option>
                {workOrders.map((w) => <option key={w.id} value={w.wo_number}>{w.wo_number} — {w.title}</option>)}
              </select>
            </label>
            <label style={lab(t)}>
              Cost (₹)
              <input type="number" min={0} style={inp} value={bookForm.cost_amount} onChange={(e) => setBookForm({ ...bookForm, cost_amount: e.target.value })} />
            </label>
            <label style={{ ...lab(t), gridColumn: '1 / -1' }}>
              Purpose
              <input style={inp} value={bookForm.purpose} onChange={(e) => setBookForm({ ...bookForm, purpose: e.target.value })} placeholder="Why is testing needed?" />
            </label>
          </form>

          <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>
            Available start times for {formatDuration(durationMin)}
            {selectedEq ? (
              <span style={{ fontWeight: 500, color: t.textDim }}>
                {' '}· viewing as {requestingBu === selectedEq.owning_bu ? 'OWNER' : 'EXTERNAL'} for {selectedEq.owning_bu}
              </span>
            ) : null}
          </h4>
          {slotRows[0]?.rule && requestingBu && (
            <p style={{ fontSize: 11, color: t.textFaint, marginTop: 0, marginBottom: 10 }}>
              Rule: priority {slotRows[0].rule.priority_window_hours}h · external cap {slotRows[0].rule.max_external_share_pct}%
              ({slotRows[0].rule.external_bookings_today}/{slotRows[0].rule.max_external_slots} external used today)
            </p>
          )}
          <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
            {slotRows.map((eq) => (
              <EquipmentSlotCard
                key={eq.id}
                eq={eq}
                t={t}
                mode="portal"
                selectedStart={bookForm.slot_start}
                selectedEqId={bookForm.equipment_id}
                onPick={(slot) => setBookForm({
                  ...bookForm,
                  equipment_id: String(eq.id),
                  slot_start: slot.slot_start,
                  cost_amount: String(Math.round(slot.estimated_cost || 0)),
                })}
              />
            ))}
            {slotRows.length === 0 && <p style={{ color: t.textFaint, fontSize: 13 }}>Select equipment / duration to see slots.</p>}
          </div>
          <button type="button" onClick={submitBooking} style={tabBtn(t, true)}>Submit Booking</button>
          <p style={{ fontSize: 11, color: t.textFaint, marginTop: 8 }}>Submission timestamp is stored automatically on the server when you book.</p>
        </section>
      )}

      {tab === 'slots' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: t.textDim, display: 'flex', gap: 6, alignItems: 'center' }}>
              Date <input type="date" style={inp} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, color: t.textDim, display: 'flex', gap: 6, alignItems: 'center' }}>
              Duration
              <select style={inp} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                {[30, 60, 90, 120, 180, 240].map((d) => <option key={d} value={d}>{formatDuration(d)}</option>)}
              </select>
            </label>
          </div>
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>
            Slot Dashboard — Available start times for {formatDuration(durationMin)}
          </h3>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 12 }}>
            Green = available · Orange = booked (shows requested / confirmed) · Select date & duration to refresh.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {(slots || []).map((eq) => (
              <EquipmentSlotCard
                key={eq.id}
                eq={eq}
                t={t}
                mode="dashboard"
                onOpenApprovals={() => setTab('approvals')}
              />
            ))}
            {(slots || []).length === 0 && (
              <p style={{ color: t.textFaint, fontSize: 13 }}>No shareable equipment / slots for this date.</p>
            )}
          </div>
        </section>
      )}

      {tab === 'approvals' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Booking Approvals Board</h3>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 12 }}>
            Cross-BU bookings land as <strong>requested</strong>. Owning-BU controllers / supervisors approve or reject here.
            Roles with access: admin, site_admin, superadmin, supervisor, maintenance, quality (TACO Booking menu).
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: t.textDim, display: 'flex', gap: 6, alignItems: 'center' }}>
              Filter by owning BU
              <select style={inp} value={owningBuFilter} onChange={(e) => setOwningBuFilter(e.target.value)}>
                <option value="">All BUs</option>
                {BUS.map((bu) => <option key={bu} value={bu}>{bu}</option>)}
              </select>
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Booking</th>
                  <th style={thStyle(t)}>Machine (Owning BU)</th>
                  <th style={thStyle(t)}>Slot</th>
                  <th style={thStyle(t)}>From BU / Requester</th>
                  <th style={thStyle(t)}>Asset / WO / Cost</th>
                  <th style={thStyle(t)}>Submitted</th>
                  <th style={thStyle(t)}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.map((b) => (
                  <tr key={b.id}>
                    <td style={{ ...tdStyle(t), fontFamily: 'monospace', fontSize: 11 }}>
                      {b.booking_number}
                      <div style={{ marginTop: 4 }}><FmmsBadge t={t} tone="warn">requested</FmmsBadge></div>
                    </td>
                    <td style={tdStyle(t)}>
                      <div style={{ fontWeight: 600 }}>{b.equipment_name}</div>
                      <div style={{ fontSize: 11, color: t.textFaint }}>{b.equipment_code} · {b.owning_bu}</div>
                    </td>
                    <td style={tdStyle(t)}>
                      {b.booking_date}<br />{b.slot_start}–{b.slot_end} ({formatDuration(b.duration_min || 60)})
                    </td>
                    <td style={tdStyle(t)}>
                      {b.requesting_bu}<br />
                      <span style={{ fontSize: 11, color: t.textFaint }}>{b.requested_by || '—'}</span>
                    </td>
                    <td style={tdStyle(t)}>
                      {b.asset_under_test || b.asset_under_test_name || '—'}<br />
                      <span style={{ fontSize: 11, color: t.textFaint }}>
                        WO: {b.fmms_wo_number || '—'} · ₹{Number(b.cost_amount || 0).toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td style={tdStyle(t)}>{b.submitted_at || '—'}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ display: 'grid', gap: 6, minWidth: 200 }}>
                        <input
                          style={{ ...inp, width: '100%', boxSizing: 'border-box', fontSize: 12 }}
                          placeholder="Comment (required to reject)"
                          value={decisionDraft[b.id] || ''}
                          onChange={(e) => setDecisionDraft({ ...decisionDraft, [b.id]: e.target.value })}
                        />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" style={miniBtn(t, 'ok')} onClick={() => decideBooking(b.id, 'approve')}>Approve</button>
                          <button type="button" style={miniBtn(t, 'danger')} onClick={() => decideBooking(b.id, 'reject')}>Reject</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {pendingApprovals.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle(t), textAlign: 'center', color: t.textFaint }}>
                      No pending requested bookings{owningBuFilter ? ` for ${owningBuFilter}` : ''}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'rules' && (
        <section className={surfaceClass(t)} style={cardStyle(t)}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Reservation Rules (TEST-09) — configure & enforce</h3>
          <p style={{ fontSize: 12, color: t.textDim, marginTop: 0, marginBottom: 8 }}>
            Edit priority window and max external share. These values drive Slot Dashboard / Booking Portal availability for external BUs.
          </p>
          <ul style={{ fontSize: 12, color: t.textDim, lineHeight: 1.55, marginTop: 0, paddingLeft: 18, marginBottom: 14 }}>
            <li><strong>Owner vs External:</strong> compare <em>Requesting BU</em> with the machine’s <em>Owning BU</em>. Same = owner request; different = external.</li>
            <li><strong>Priority Window (hours):</strong> within this many hours before slot start, external BUs cannot book (shown as owner_hold).</li>
            <li><strong>Max External Share %:</strong> once external bookings reach this % of day slots, remaining free slots are hidden/blocked for externals (share_capped).</li>
            <li><strong>Auto-approve Owner:</strong> owner request → confirmed immediately; external → requested (Approvals board).</li>
          </ul>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Rule</th>
                <th style={thStyle(t)}>Owning BU</th>
                <th style={thStyle(t)}>Priority Window (h)</th>
                <th style={thStyle(t)}>Max External Share %</th>
                <th style={thStyle(t)}>Auto-approve Owner</th>
                <th style={thStyle(t)}>Active</th>
                <th style={thStyle(t)}>Save</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <RuleEditRow key={r.id} r={r} t={t} inp={inp} onSaved={(msgText) => { setMsg(msgText); loadMaster(); loadSlots(); }} />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function lab(t) {
  return { fontSize: 11, color: t.textDim, display: 'flex', flexDirection: 'column', gap: 4 };
}
function tabBtn(t, active) {
  return {
    padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: `1px solid ${active ? t.accent : t.border}`,
    background: active ? t.accent : t.surface2,
    color: active ? '#fff' : t.text,
  };
}
function smallBtn(t) {
  return {
    padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
    border: `1px solid ${t.border}`, background: t.surface, color: t.text,
  };
}

function slotVisual(slot, { selected = false } = {}) {
  if (selected) {
    return {
      label: 'Selected',
      border: '#ca8a04',
      background: 'rgba(250,204,21,0.4)',
      color: '#facc15',
      cursor: 'pointer',
      disabled: false,
    };
  }
  if (slot.available) {
    return {
      label: 'Available',
      border: '#22c55e',
      background: 'rgba(34,197,94,0.16)',
      color: '#86efac',
      cursor: 'pointer',
      disabled: false,
    };
  }
  const st = String(slot.booking_status || 'booked').toLowerCase();
  if (st === 'owner_hold') {
    return {
      label: 'owner hold',
      border: '#7c3aed',
      background: 'rgba(124,58,237,0.18)',
      color: '#c4b5fd',
      cursor: 'not-allowed',
      disabled: true,
    };
  }
  if (st === 'share_capped') {
    return {
      label: 'share capped',
      border: '#64748b',
      background: 'rgba(100,116,139,0.2)',
      color: '#cbd5e1',
      cursor: 'not-allowed',
      disabled: true,
    };
  }
  const statusLabel = st === 'requested' || st === 'confirmed' || st === 'in_use' ? st : 'booked';
  return {
    label: statusLabel,
    border: '#ea580c',
    background: 'rgba(249,115,22,0.18)',
    color: '#fdba74',
    cursor: 'not-allowed',
    disabled: true,
  };
}

function RequestTypeBadge({ t, requestingBu, selectedEq }) {
  if (!selectedEq) {
    return <FmmsBadge t={t} tone="neutral">Select equipment</FmmsBadge>;
  }
  const isOwner = requestingBu === selectedEq.owning_bu;
  return (
    <FmmsBadge t={t} tone={isOwner ? 'ok' : 'warn'}>
      {isOwner ? `OWNER request (${requestingBu})` : `EXTERNAL request (${requestingBu} → ${selectedEq.owning_bu})`}
    </FmmsBadge>
  );
}

function RuleEditRow({ r, t, inp, onSaved }) {
  const [priority, setPriority] = useState(r.priority_window_hours);
  const [share, setShare] = useState(r.max_external_share_pct);
  const [auto, setAuto] = useState(Boolean(r.auto_approve_owner));
  const [active, setActive] = useState(Boolean(r.active));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPriority(r.priority_window_hours);
    setShare(r.max_external_share_pct);
    setAuto(Boolean(r.auto_approve_owner));
    setActive(Boolean(r.active));
  }, [r.id, r.priority_window_hours, r.max_external_share_pct, r.auto_approve_owner, r.active]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/fmms/taco/reservation-rules/${r.id}`, {
        priority_window_hours: Number(priority),
        max_external_share_pct: Number(share),
        auto_approve_owner: Boolean(auto),
        active: Boolean(active),
      });
      onSaved(`Rule updated for ${r.owning_bu}`);
    } catch (err) {
      onSaved(err?.response?.data?.detail || 'Rule update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td style={tdStyle(t)}>{r.rule_name}</td>
      <td style={tdStyle(t)}>{r.owning_bu}</td>
      <td style={tdStyle(t)}>
        <input type="number" min={0} max={720} style={{ ...inp, width: 80 }} value={priority} onChange={(e) => setPriority(e.target.value)} />
      </td>
      <td style={tdStyle(t)}>
        <input type="number" min={0} max={100} step={1} style={{ ...inp, width: 80 }} value={share} onChange={(e) => setShare(e.target.value)} />
      </td>
      <td style={tdStyle(t)}>
        <select style={inp} value={auto ? 'yes' : 'no'} onChange={(e) => setAuto(e.target.value === 'yes')}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </td>
      <td style={tdStyle(t)}>
        <select style={inp} value={active ? 'yes' : 'no'} onChange={(e) => setActive(e.target.value === 'yes')}>
          <option value="yes">Active</option>
          <option value="no">Off</option>
        </select>
      </td>
      <td style={tdStyle(t)}>
        <button type="button" style={smallBtn(t)} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </td>
    </tr>
  );
}

function EquipmentSlotCard({ eq, t, mode = 'portal', selectedStart, selectedEqId, onPick, onOpenApprovals }) {
  const freeCount = (eq.slots || []).filter((s) => s.available).length;
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 12, background: t.surface2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{eq.name}</div>
          <div style={{ fontSize: 11, color: t.textFaint }}>
            {eq.equipment_code} · Owner: {eq.owning_bu} · ₹{Number(eq.cost_per_hour || 0).toLocaleString('en-IN')}/hr
          </div>
        </div>
        <FmmsBadge t={t} tone={freeCount > 0 ? 'ok' : 'warn'}>
          {freeCount > 0 ? 'available' : 'booked'}
        </FmmsBadge>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(eq.slots || []).map((slot) => {
          const selected = mode === 'portal'
            && selectedStart === slot.slot_start
            && String(selectedEqId) === String(eq.id);
          const vis = slotVisual(slot, { selected });
          const title = !slot.available
            ? `${slot.booking_number || ''} · ${slot.booking_status || ''} · ${slot.requesting_bu || ''} · ${slot.requested_by || ''}`.trim()
            : 'Available slot';
          const isRequested = String(slot.booking_status || '').toLowerCase() === 'requested';
          return (
            <button
              key={`${eq.id}-${slot.slot_start}`}
              type="button"
              title={title}
              disabled={vis.disabled && !(mode === 'dashboard' && isRequested)}
              onClick={() => {
                if (mode === 'portal' && slot.available && onPick) onPick(slot);
                if (mode === 'dashboard' && isRequested && onOpenApprovals) onOpenApprovals();
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: (mode === 'dashboard' && isRequested) ? 'pointer' : (mode === 'dashboard' ? 'default' : vis.cursor),
                border: `1px solid ${vis.border}`,
                background: vis.background,
                color: vis.color,
              }}
            >
              {slot.slot_start}–{slot.slot_end} · {vis.label}
            </button>
          );
        })}
      </div>
    </div>
  );
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

import { useEffect, useMemo, useState } from 'react';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';

export const DEMO_INCIDENT = {
  id: 41,
  title: 'Motor Overheating on Dyno Rig',
  severity: 'critical',
  status: 'investigating',
  _demo: true,
};

const RCA_METHODS = [
  { id: '5why', label: 'Method 1: 5-Why' },
  { id: 'ishikawa', label: 'Method 2: Ishikawa (Fishbone 6M)' },
  { id: 'fmea', label: 'Method 3: FMEA' },
  { id: 'fta', label: 'Method 4: Fault Tree (FTA)' },
];

const DEMO_WHYS = [
  { q: 'Why did Dyno Rig #1 trip?', a: 'Drive motor overheated.' },
  { q: 'Why did the motor overheat?', a: 'Coolant fluid flow was restricted.' },
  { q: 'Why was flow restricted?', a: 'Coolant pump filter was clogged with debris.' },
  { q: 'Why was the filter clogged?', a: 'Preventive cleaning was missed during PM.' },
  { q: 'Why was cleaning missed? (Root Cause)', a: 'PM checklist lacked explicit pump strainer inspection clause.' },
];

/** Build 5-Why prompts from a logged incident (not the Dyno demo template). */
function whysFromIncident(inc) {
  if (!inc || inc._demo || inc.id === 41) return DEMO_WHYS.map((row) => ({ ...row }));
  const title = (inc.title || 'the failure').trim();
  const detail = (inc.description || '').trim();
  return [
    { q: `Why did "${title}" occur?`, a: detail },
    { q: 'Why did that happen?', a: '' },
    { q: 'Why was that the case?', a: '' },
    { q: 'Why was that allowed / not prevented?', a: '' },
    { q: 'Why was the underlying control missing? (Root Cause)', a: '' },
  ];
}

function emptyFish() {
  return {
    Man: '',
    Machine: '',
    Material: '',
    Method: '',
    Measurement: '',
    Milieu: '',
  };
}

const DEMO_FISH = {
  Man: 'Lack of training on new sensor calibration procedure.',
  Machine: 'Bearing wear out due to extended operating hours.',
  Material: 'O-Ring material seal degradation under high temp.',
  Method: 'Outdated lubrication checklist interval.',
  Measurement: 'Thermal sensor drifted +4°C off calibration.',
  Milieu: 'Ambient humidity exceeded 80% during test cycle.',
};

const FISH_LABELS = {
  Man: '1. Man (Labor)',
  Machine: '2. Machine (Equipment)',
  Material: '3. Material (Spares)',
  Method: '4. Method (Process)',
  Measurement: '5. Measurement',
  Milieu: '6. Milieu (Environment)',
};

const DEMO_FMEA = [
  {
    mode: 'Coolant Pump Filter Clog',
    sev: 8, occ: 5, det: 4,
    mitigation: 'Add differential pressure sensor trigger',
  },
  {
    mode: 'Bearing Failure on Shaft',
    sev: 9, occ: 3, det: 6,
    mitigation: 'Implement monthly vibration analysis',
  },
];

function incidentLabel(i) {
  if (!i) return '—';
  const id = i._demo ? 'BD-2026-041' : `BD-${String(i.id).padStart(6, '0')}`;
  return `${id} — ${i.title}`;
}

/**
 * Shared RCA workspace: pick incident + RCA tool, edit templates.
 * Used on FMMS Live Dashboard and Breakdown & RCA page.
 */
export function RcaWorkspace({ t, incidents = [], compact = false }) {
  const list = incidents.length ? incidents : [DEMO_INCIDENT];
  const [selectedId, setSelectedId] = useState(list[0]?.id);
  const [method, setMethod] = useState('5why');

  const selected = useMemo(
    () => list.find((i) => i.id === selectedId) || list[0],
    [list, selectedId],
  );

  const [whys, setWhys] = useState(() => whysFromIncident(list[0]));
  const [fish, setFish] = useState(DEMO_FISH);
  const [fmea, setFmea] = useState(DEMO_FMEA);

  useEffect(() => {
    // Seed RCA sheets from selected incident: demo keeps Dyno template; live logs use title/description
    if (selected?._demo || selected?.id === 41) {
      setWhys(DEMO_WHYS.map((row) => ({ ...row })));
      setFish({ ...DEMO_FISH });
      setFmea(DEMO_FMEA.map((row) => ({ ...row })));
    } else if (selected) {
      setWhys(whysFromIncident(selected));
      setFish(emptyFish());
      setFmea([{ mode: selected.title || '', sev: 5, occ: 5, det: 5, mitigation: '' }]);
    }
  }, [selected?.id, selected?._demo, selected?.title, selected?.description]);

  const inp = {
    padding: '7px 10px', borderRadius: 6, border: `1px solid ${t.inpBorder}`,
    background: t.inp, color: t.text, fontSize: 13, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'minmax(220px, 1fr) minmax(260px, 1.2fr)',
        gap: 10,
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: t.textDim, fontWeight: 600 }}>
          Incident log
          <select
            style={inp}
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            {list.map((i) => (
              <option key={i.id} value={i.id}>{incidentLabel(i)}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: t.textDim, fontWeight: 600 }}>
          RCA tool to analyse
          <select style={inp} value={method} onChange={(e) => setMethod(e.target.value)}>
            {RCA_METHODS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{
        padding: '8px 12px', borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`,
        fontSize: 12, color: t.text,
      }}>
        Active analysis: <strong>{incidentLabel(selected)}</strong>
        {' · '}
        <FmmsBadge t={t} tone={selected?.severity === 'critical' || selected?.severity === 'high' ? 'critical' : 'warn'}>
          {selected?.severity || 'medium'}
        </FmmsBadge>
        {' '}
        <FmmsBadge t={t} tone="info">{selected?.status || 'open'}</FmmsBadge>
      </div>

      {method === '5why' && (
        <section style={cardStyle(t)}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Method 1: 5-Why Root Cause Analysis</h4>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textDim }}>
            Incident: {incidentLabel(selected)}
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {whys.map((row, idx) => (
              <div key={idx} style={{
                background: t.surface2,
                borderLeft: `3px solid ${idx === 4 ? '#ef4444' : t.accent}`,
                padding: '8px 10px', borderRadius: '0 6px 6px 0',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.accent, marginBottom: 4 }}>
                  {idx === 4 ? 'Why 5 (Root Cause)' : `Why ${idx + 1}`}
                </div>
                <input
                  style={{ ...inp, marginBottom: 4, fontWeight: 600 }}
                  value={row.q}
                  onChange={(e) => setWhys((p) => p.map((x, i) => (i === idx ? { ...x, q: e.target.value } : x)))}
                  placeholder={`Why ${idx + 1} question`}
                />
                <input
                  style={inp}
                  value={row.a}
                  onChange={(e) => setWhys((p) => p.map((x, i) => (i === idx ? { ...x, a: e.target.value } : x)))}
                  placeholder="Answer"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {method === 'ishikawa' && (
        <section style={cardStyle(t)}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Method 2: Ishikawa (Fishbone 6M) Analysis</h4>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textDim }}>Multi-Factorial Cause Mapping</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {Object.entries(fish).map(([cat, text]) => (
              <div key={cat} style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, marginBottom: 4 }}>
                  {FISH_LABELS[cat] || cat}
                </div>
                <textarea
                  style={{ ...inp, minHeight: 64, fontSize: 12 }}
                  value={text}
                  onChange={(e) => setFish((p) => ({ ...p, [cat]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {method === 'fmea' && (
        <section style={cardStyle(t)}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Method 3: Failure Mode & Effects Analysis (FMEA)</h4>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textDim }}>Risk Priority Number (RPN) Assessment</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Failure Mode</th>
                  <th style={thStyle(t)}>Sev (1-10)</th>
                  <th style={thStyle(t)}>Occ (1-10)</th>
                  <th style={thStyle(t)}>Det (1-10)</th>
                  <th style={thStyle(t)}>RPN</th>
                  <th style={thStyle(t)}>Mitigation Action</th>
                </tr>
              </thead>
              <tbody>
                {fmea.map((row, idx) => {
                  const rpn = Number(row.sev) * Number(row.occ) * Number(row.det);
                  return (
                    <tr key={idx}>
                      <td style={tdStyle(t)}>
                        <input style={inp} value={row.mode}
                          onChange={(e) => setFmea((p) => p.map((x, i) => (i === idx ? { ...x, mode: e.target.value } : x)))} />
                      </td>
                      <td style={tdStyle(t)}>
                        <input style={{ ...inp, width: 64 }} type="number" min={1} max={10} value={row.sev}
                          onChange={(e) => setFmea((p) => p.map((x, i) => (i === idx ? { ...x, sev: Number(e.target.value) } : x)))} />
                      </td>
                      <td style={tdStyle(t)}>
                        <input style={{ ...inp, width: 64 }} type="number" min={1} max={10} value={row.occ}
                          onChange={(e) => setFmea((p) => p.map((x, i) => (i === idx ? { ...x, occ: Number(e.target.value) } : x)))} />
                      </td>
                      <td style={tdStyle(t)}>
                        <input style={{ ...inp, width: 64 }} type="number" min={1} max={10} value={row.det}
                          onChange={(e) => setFmea((p) => p.map((x, i) => (i === idx ? { ...x, det: Number(e.target.value) } : x)))} />
                      </td>
                      <td style={{ ...tdStyle(t), fontWeight: 800, color: rpn >= 100 ? '#ef4444' : t.text }}>{rpn}</td>
                      <td style={tdStyle(t)}>
                        <input style={inp} value={row.mitigation}
                          onChange={(e) => setFmea((p) => p.map((x, i) => (i === idx ? { ...x, mitigation: e.target.value } : x)))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {method === 'fta' && (
        <section style={cardStyle(t)}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Method 4: Fault Tree Analysis (FTA)</h4>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: t.textDim }}>Top-Down Logical Failure Modeling</p>
          <div style={{
            background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 8, padding: 14, fontSize: 13,
          }}>
            <div style={{
              background: 'rgba(127,29,29,0.35)', border: '1px solid #991b1b', color: '#fca5a5',
              padding: 10, borderRadius: 6, textAlign: 'center', fontWeight: 800, marginBottom: 10,
            }}>
              TOP EVENT: Dyno Drive Motor Shut-Off
            </div>
            <div style={{ textAlign: 'center', color: '#f59e0b', fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
              [ OR GATE ]
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, padding: 10, background: t.surface }}>
                <div style={{ fontWeight: 700, color: t.accent, marginBottom: 6 }}>Electrical Failure</div>
                <div style={{ color: t.textDim }}>Over-current Relay Tripped</div>
              </div>
              <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, padding: 10, background: t.surface }}>
                <div style={{ fontWeight: 700, color: t.accent, marginBottom: 6 }}>Thermal Overheat</div>
                <div style={{ color: t.textDim }}>Coolant Flow Below Threshold</div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';
import PmcPlanningPanel from './FmmsPmcPlanning';

const PLAN_ROWS = [
  { week: 'W34', craft: 'Mechanical', capacity: '40 hrs', booked: '32 hrs', util: '80%', focus: 'AMC + Breakdown buffer' },
  { week: 'W34', craft: 'Electrical', capacity: '32 hrs', booked: '28 hrs', util: '87%', focus: 'Calibration queue' },
  { week: 'W35', craft: 'Instrumentation', capacity: '24 hrs', booked: '18 hrs', util: '75%', focus: 'Sensor upgrades' },
];

const TABS = [
  { id: 'resources', label: 'Resource Allocation' },
  { id: 'pmc', label: 'PM / CALIB Planning' },
];

export default function FmmsPlanning() {
  const { theme: t } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'pmc' ? 'pmc' : 'resources';
  const [tab, setTab] = useState(initialTab);

  const tabBtn = useMemo(() => (active) => ({
    padding: '8px 16px', borderRadius: 8, border: `1px solid ${active ? t.accent : t.border}`,
    background: active ? t.accent : 'transparent', color: active ? '#fff' : t.text,
    cursor: 'pointer', fontWeight: 600, fontSize: 13,
  }), [t]);

  const linkBtn = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };

  const selectTab = (id) => {
    setTab(id);
    if (id === 'pmc') setSearchParams({ tab: 'pmc' });
    else setSearchParams({});
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Planning & Resource Allocation"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/fmms/pic-master" style={linkBtn}>PIC Master</Link>
            <Link to="/fmms/pic-assignment" style={linkBtn}>PIC Assignment</Link>
          </div>
        )}
      />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        Weekly craft capacity vs booked FMMS work, plus 6-month PM / Calibration / Issue planning with PIC assignment.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((tb) => (
          <button key={tb.id} type="button" style={tabBtn(tab === tb.id)} onClick={() => selectTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'resources' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <section className={surfaceClass(t)} style={cardStyle(t)}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Resource Allocation Board</h3>
            <table style={tableWrap(t)}>
              <thead>
                <tr>
                  <th style={thStyle(t)}>Week</th>
                  <th style={thStyle(t)}>Craft</th>
                  <th style={thStyle(t)}>Capacity</th>
                  <th style={thStyle(t)}>Booked</th>
                  <th style={thStyle(t)}>Utilization</th>
                  <th style={thStyle(t)}>Focus</th>
                </tr>
              </thead>
              <tbody>
                {PLAN_ROWS.map((r) => (
                  <tr key={`${r.week}-${r.craft}`}>
                    <td style={tdStyle(t)}>{r.week}</td>
                    <td style={tdStyle(t)}>{r.craft}</td>
                    <td style={tdStyle(t)}>{r.capacity}</td>
                    <td style={tdStyle(t)}>{r.booked}</td>
                    <td style={tdStyle(t)}><FmmsBadge t={t} tone={parseInt(r.util, 10) > 85 ? 'warn' : 'ok'}>{r.util}</FmmsBadge></td>
                    <td style={tdStyle(t)}>{r.focus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={surfaceClass(t)} style={cardStyle(t)}>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Planning Checklist</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: t.text, lineHeight: 1.7 }}>
              <li>Confirm Ringi / SOR approval before capital WOs</li>
              <li>Reserve spares from Spares Master</li>
              <li>Assign PIC via PIC Assignment / PIC Allocation Master</li>
              <li>Use the <strong>PM / C Planning</strong> tab for 6-month PM, calibration, and issue schedules</li>
              <li>Sync calibration due dates from AMC calendar</li>
              <li>Release FMMS Work Orders only within craft capacity</li>
            </ul>
          </section>
        </div>
      )}

      {tab === 'pmc' && <PmcPlanningPanel t={t} />}
    </div>
  );
}

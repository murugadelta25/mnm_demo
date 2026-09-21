import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, tableWrap, thStyle, tdStyle, FmmsBadge } from './fmmsUi';
import { RcaWorkspace, DEMO_INCIDENT } from './FmmsRcaTools';

const DELETE_ROLES = ['admin', 'superadmin', 'site_admin', 'supervisor', 'maintenance'];

export default function FmmsBreakdownRca() {
  const { theme: t } = useTheme();
  const { user } = useAuth();
  const canDelete = DELETE_ROLES.includes(user?.role);
  const [incidents, setIncidents] = useState([]);
  const [msg, setMsg] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/api/fmms/incidents');
      const list = Array.isArray(data) ? data : [];
      setIncidents(list.length ? list : [DEMO_INCIDENT]);
    } catch {
      setIncidents([DEMO_INCIDENT]);
    }
  };

  useEffect(() => { load(); }, []);

  const btn = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.surface2, color: t.text, textDecoration: 'none', fontSize: 12, fontWeight: 600,
  };
  const btnDelete = {
    padding: '4px 10px', background: 'transparent', color: '#ef4444',
    border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  };

  const handleDelete = async (inc) => {
    if (!canDelete || !inc?.id || inc._demo) return;
    const label = `BD-${String(inc.id).padStart(6, '0')} — ${inc.title}`;
    if (!window.confirm(`Delete breakdown ${label}? This also removes it from Incident Tracking.`)) return;
    setDeletingId(inc.id);
    try {
      await api.delete(`/api/fmms/incidents/${inc.id}`);
      setMsg(`✅ Deleted ${label}`);
      await load();
    } catch (err) {
      setMsg('❌ ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader
        title="Breakdown & RCA"
        onRefresh={load}
        extra={<Link to="/fmms/dashboard" style={btn}>← FMMS Dashboard</Link>}
      />

      {msg && (
        <div style={{ marginBottom: 12, padding: 8, borderRadius: 8, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 13 }}>{msg}</div>
      )}

      <section className={surfaceClass(t)} style={{ ...cardStyle(t), marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Breakdown Incident Logs</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableWrap(t)}>
            <thead>
              <tr>
                <th style={thStyle(t)}>Breakdown ID</th>
                <th style={thStyle(t)}>Title / Asset</th>
                <th style={thStyle(t)}>Severity</th>
                <th style={thStyle(t)}>Status</th>
                <th style={thStyle(t)}>Available RCA tools</th>
                {canDelete && <th style={thStyle(t)}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td style={{ ...tdStyle(t), fontWeight: 700 }}>
                    {i._demo ? 'BD-2026-041' : `BD-${String(i.id).padStart(6, '0')}`}
                  </td>
                  <td style={tdStyle(t)}>{i.title}</td>
                  <td style={tdStyle(t)}>
                    <FmmsBadge t={t} tone={i.severity === 'critical' || i.severity === 'high' ? 'critical' : 'warn'}>
                      {i.severity || 'medium'}
                    </FmmsBadge>
                  </td>
                  <td style={tdStyle(t)}><FmmsBadge t={t} tone="info">{i.status}</FmmsBadge></td>
                  <td style={tdStyle(t)}>5-Why · Ishikawa · FMEA · FTA</td>
                  {canDelete && (
                    <td style={tdStyle(t)}>
                      {i._demo ? (
                        <span style={{ fontSize: 11, color: t.textFaint }}>Demo</span>
                      ) : (
                        <button
                          type="button"
                          style={{ ...btnDelete, opacity: deletingId === i.id ? 0.6 : 1 }}
                          disabled={deletingId === i.id}
                          onClick={() => handleDelete(i)}
                        >
                          {deletingId === i.id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={surfaceClass(t)} style={cardStyle(t)}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>RCA Analysis Workspace</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: t.textDim }}>
          Select an incident, then pick an RCA method. Why 1 is seeded from the incident title / description (demo BD-2026-041 keeps the Dyno template).
        </p>
        <RcaWorkspace t={t} incidents={incidents} />
      </section>
    </div>
  );
}

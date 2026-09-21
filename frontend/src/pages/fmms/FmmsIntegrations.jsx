import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { pageClass, surfaceClass } from '../../themes/tileHelpers';
import { cardStyle, FmmsBadge } from './fmmsUi';

const LINKS = [
  { name: 'PMS Machine Configuration', status: 'Connected', detail: 'Machine map for Asset Management registration' },
  { name: 'PMS Notification Bell', status: 'Connected', detail: 'Calibration / PM threshold alerts' },
  { name: 'SAP / ERP Procurement', status: 'Planned', detail: 'PO / Ringi cost sync (future)' },
  { name: 'Thermal / IoT Meter Feeds', status: 'Planned', detail: 'Meter-based AMC triggers (future)' },
  { name: 'Document / SOR Vault', status: 'Partial', detail: 'Commercial docs attached on assets' },
];

export default function FmmsIntegrations() {
  const { theme: t } = useTheme();

  return (
    <div className={pageClass(t)} style={{ padding: 20, background: t.bg, minHeight: 'calc(100vh - 52px)', color: t.text }}>
      <PageHeader title="System Integrations" />
      <p style={{ fontSize: 12, color: t.textDim, marginTop: -6, marginBottom: 14 }}>
        FMMS sits inside PMS — integrations reuse PMS auth, machines, and notifications while keeping FMMS tables independent.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {LINKS.map((l) => (
          <section key={l.name} className={surfaceClass(t)} style={cardStyle(t)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>{l.name}</h3>
              <FmmsBadge
                t={t}
                tone={l.status === 'Connected' ? 'ok' : l.status === 'Partial' ? 'warn' : 'neutral'}
              >
                {l.status}
              </FmmsBadge>
            </div>
            <p style={{ fontSize: 12, color: t.textDim, margin: '10px 0 0' }}>{l.detail}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * App shell — CPLM Root.tsx layout (Main > AppBar + Lower > Navigator + Outlet).
 */
import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useEmbed } from '../../context/EmbedContext';
import { useTheme } from '../../context/ThemeContext';
import { useConfig } from '../../context/ConfigContext';
import { contentAreaStyle } from '../../themes/pmsThemes';
import Sidebar from '../Sidebar';
import AppBar from './AppBar';

export default function AppShell() {
  const { theme } = useTheme();
  const { config } = useConfig();
  const { isIntegration, navHidden, toggleNav } = useEmbed();
  const [navOpen, setNavOpen] = useState(true);
  const needsFactorySetup = config?.factory?.configured !== true;

  const sidebarExpanded = isIntegration ? !navHidden : navOpen;
  const onMenuClick = isIntegration ? toggleNav : () => setNavOpen((value) => !value);

  return (
    <div
      className="titan-app-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
        overflow: 'hidden',
        background: theme.bg,
        transition: 'background 0.2s',
      }}
    >
      <AppBar
        onMenuClick={onMenuClick}
        isIntegration={isIntegration}
        navVisible={sidebarExpanded}
      />

      <div
        className="titan-lower"
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <Sidebar expanded={sidebarExpanded} />
        <main
          className="titan-app-content"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            ...contentAreaStyle(theme),
          }}
        >
          {needsFactorySetup && !isIntegration && (
            <div style={{
              padding: '10px 16px', background: '#f59e0b22', borderBottom: `1px solid ${theme.border}`,
              color: theme.text, fontSize: 13,
            }}>
              Complete your plant setup: <Link to="/factory-setup" style={{ color: theme.accent, fontWeight: 600 }}>Factory Setup</Link>
            </div>
          )}
          <div className="titan-page-outlet" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getNavigationForRole } from '../navigation';
import {
  EXPAND_LESS_ICON,
  EXPAND_MORE_ICON,
  LOGOUT_ICON,
  renderNavIcon,
} from './icons/NavIcon';

export default function Sidebar({ expanded = true }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { theme: t } = useTheme();
  const [openGroups, setOpenGroups] = useState({
    Production: true,
    Maintenance: true,
    Alerts: true,
    Settings: true,
  });

  const toggleGroup = (g) => setOpenGroups((p) => ({ ...p, [g]: !p[g] }));
  const MENU = getNavigationForRole(user?.role);

  const navWidth = expanded ? 'var(--titan-nav-width)' : '0px';
  const accentNav = t.navStyle === 'accent';

  const navActiveBg = accentNav ? t.navFocus : t.bg;

  const leafStyle = (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: 40,
    padding: '0 12px',
    margin: '2px 8px',
    textDecoration: 'none',
    color: active ? t.accent : t.textMuted,
    fontSize: 13,
    borderRadius: 'var(--titan-radius-sm)',
    background: active ? navActiveBg : 'transparent',
    fontWeight: active ? 500 : 400,
    transition: 'background 0.15s, color 0.15s',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  });

  return (
    <aside
      className="titan-side-drawer"
      style={{
        width: navWidth,
        opacity: expanded ? 1 : 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.navBg || t.surface,
        borderRight: expanded ? `3px solid ${t.border}` : 'none',
        transition: 'width 0.2s ease, opacity 0.2s ease',
        flexShrink: 0,
        overflow: 'hidden',
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <nav
        className="titan-nav-list"
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 4px' }}
      >
        {MENU.map((section, si) => {
          const visibleItems = section.items;
          if (visibleItems.length === 0) return null;

          const groupActive = visibleItems.some((item) => pathname === item.path);

          return (
            <div key={si}>
              {section.group && (
                <button
                  type="button"
                  className="titan-nav-group-btn"
                  style={{
                    width: 'calc(100% - 16px)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: groupActive ? navActiveBg : 'transparent',
                    border: 'none',
                    color: groupActive ? t.accent : t.text,
                    cursor: 'pointer',
                    padding: '0 12px',
                    margin: '2px 8px',
                    height: 48,
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 'var(--titan-radius-sm)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onClick={() => toggleGroup(section.group)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {renderNavIcon(section.icon)}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{section.group}</span>
                  </span>
                  {renderNavIcon(openGroups[section.group] ? EXPAND_LESS_ICON : EXPAND_MORE_ICON)}
                </button>
              )}

              {(!section.group || openGroups[section.group]) &&
                visibleItems.map((item) => {
                  const active = pathname === item.path;
                  const isNested = Boolean(section.group);

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className="titan-nav-leaf"
                      style={{
                        ...leafStyle(active),
                        paddingLeft: isNested ? 44 : 12,
                        height: isNested ? 40 : 48,
                      }}
                    >
                      {!isNested && renderNavIcon(item.icon)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <div style={{ flexShrink: 0, padding: '4px 8px 0', borderTop: `1px solid ${t.border}` }}>
        <button
          type="button"
          className="titan-nav-leaf titan-logout-btn"
          style={{
            ...leafStyle(false),
            width: 'calc(100% - 16px)',
            border: 'none',
            cursor: 'pointer',
            color: '#ef4444',
            height: 48,
            marginTop: 4,
          }}
          onClick={() => {
            logout();
            nav('/login');
          }}
        >
          {renderNavIcon(LOGOUT_ICON)}
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

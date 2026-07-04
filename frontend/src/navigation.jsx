/**
 * Titan OEE navigation definition (CPLM dev-guide pattern).
 *
 * Keep navigation separate from routes — mirrors cplm-web-ui src/navigation.tsx.
 * Icons use Material Design glyphs aligned with CPLM @mui/icons-material choices.
 *
 * To add a page:
 *  1. Add route in App.jsx (logic unchanged)
 *  2. Add item here
 */

import { NAV_GROUP_ICONS, NAV_ICONS } from './components/icons/NavIcon';

/** @typedef {{ path: string, label: string, icon: import('react').ReactNode, roles?: string[] }} NavLeaf */
/** @typedef {{ group: string | null, icon?: import('react').ReactNode, roles?: string[], items: NavLeaf[] }} NavSection */

/** @type {NavSection[]} */
export const TITAN_NAVIGATION = [
  {
    group: null,
    items: [{ path: '/dashboard', label: 'Dashboard', icon: NAV_ICONS.dashboard }],
  },
  {
    group: 'Production',
    icon: NAV_GROUP_ICONS.production,
    roles: ['admin', 'supervisor', 'operator'],
    items: [
      { path: '/work-orders', label: 'Work Orders', icon: NAV_ICONS.workOrders, roles: ['admin', 'supervisor', 'operator'] },
      { path: '/planning', label: 'Planning', icon: NAV_ICONS.planning, roles: ['admin', 'supervisor', 'operator'] },
      { path: '/entry', label: 'Data Entry', icon: NAV_ICONS.entry, roles: ['admin', 'supervisor', 'operator'] },
      { path: '/hourly-output', label: 'Hourly Output', icon: NAV_ICONS.hourlyOutput, roles: ['admin', 'supervisor', 'operator'] },
      { path: '/model-change', label: 'Model Change', icon: NAV_ICONS.modelChange, roles: ['admin', 'supervisor', 'operator'] },
    ],
  },
  {
    group: 'QC',
    icon: NAV_GROUP_ICONS.qc,
    roles: ['admin', 'supervisor', 'operator', 'quality'],
    items: [
      { path: '/qc-approvals', label: 'QC Approvals', icon: NAV_ICONS.workInstructions, roles: ['admin', 'supervisor', 'quality', 'operator'] },
      { path: '/work-instructions', label: 'Work Instructions', icon: NAV_ICONS.workInstructions },
    ],
  },
  {
    group: 'Maintenance',
    icon: NAV_GROUP_ICONS.maintenance,
    roles: ['admin', 'supervisor', 'operator', 'maintenance'],
    items: [
      {
        path: '/breakdown',
        label: 'Breakdown',
        icon: NAV_ICONS.breakdown,
        roles: ['admin', 'supervisor', 'operator'],
      },
      {
        path: '/maintenance',
        label: 'Maintenance',
        icon: NAV_ICONS.maintenance,
        roles: ['admin', 'maintenance'],
      },
      {
        path: '/loss-tracker',
        label: 'Loss Tracker',
        icon: NAV_ICONS.lossTracker,
        roles: ['admin', 'supervisor', 'maintenance'],
      },
    ],
  },
  {
    group: 'Alerts',
    icon: NAV_GROUP_ICONS.alerts,
    roles: ['admin', 'supervisor'],
    items: [{ path: '/alerts/email', label: 'Email Alerts', icon: NAV_ICONS.emailAlerts }],
  },
  {
    group: 'Settings',
    icon: NAV_GROUP_ICONS.settings,
    roles: ['admin'],
    items: [
      { path: '/users', label: 'Users', icon: NAV_ICONS.users, roles: ['admin'] },
      { path: '/parts', label: 'Part Master', icon: NAV_ICONS.parts, roles: ['admin', 'supervisor'] },
      { path: '/wi-revisions', label: 'WI Revisions', icon: NAV_ICONS.workInstructions, roles: ['admin', 'supervisor'] },
      { path: '/machines', label: 'Machines', icon: NAV_ICONS.machines, roles: ['admin'] },
      { path: '/factory-setup', label: 'Factory Setup', icon: NAV_ICONS.config, roles: ['admin'] },
      { path: '/config', label: 'Configuration', icon: NAV_ICONS.config, roles: ['admin'] },
    ],
  },
];

/**
 * Filter navigation for the current user role.
 * @param {string | undefined} role
 * @returns {NavSection[]}
 */
export function getNavigationForRole(role) {
  const canSee = (roles) => !roles || roles.includes(role);

  return TITAN_NAVIGATION.map((section) => {
    if (!canSee(section.roles)) return null;
    const items = section.items.filter((item) => canSee(item.roles));
    if (items.length === 0) return null;
    return { ...section, items };
  }).filter(Boolean);
}

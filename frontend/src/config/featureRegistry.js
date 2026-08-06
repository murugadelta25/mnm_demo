/**
 * Feature registry utilities — reads frontend/src/config/feature-registry.json
 *
 * WHEN ADDING A NEW PAGE:
 *  1. Add route in App.jsx
 *  2. Add one entry in feature-registry.json (group item or standalone)
 *  → Navigation, route guards, and /platform/modules update automatically.
 */
import registryJson from './feature-registry.json';
import { NAV_GROUP_ICONS, NAV_ICONS } from '../components/icons/NavIcon';

export const FEATURE_REGISTRY = registryJson;

const ICON_MAP = { ...NAV_ICONS, ...NAV_GROUP_ICONS };

export function resolveNavIcon(key) {
  return ICON_MAP[key] ?? null;
}

/** All toggleable feature item ids (excludes alwaysEnabled standalone). */
export function getAllFeatureItemIds() {
  const ids = [];
  for (const item of FEATURE_REGISTRY.standalone || []) {
    if (!item.alwaysEnabled) ids.push(item.id);
  }
  for (const group of FEATURE_REGISTRY.groups || []) {
    for (const item of group.items || []) {
      ids.push(item.id);
    }
  }
  return ids;
}

export function getDefaultFeatureModules() {
  return Object.fromEntries(getAllFeatureItemIds().map(id => [id, true]));
}

function findRegistryItem(featureId) {
  if (!featureId) return null;
  for (const item of FEATURE_REGISTRY.standalone || []) {
    if (item.id === featureId) return item;
  }
  for (const group of FEATURE_REGISTRY.groups || []) {
    for (const item of group.items || []) {
      if (item.id === featureId) return item;
    }
  }
  return null;
}

/** Default role map from registry (true only for listed roles). */
export function getDefaultFeatureRoleAccess() {
  const roles = ['superadmin', 'admin', 'supervisor', 'operator', 'maintenance', 'quality'];
  const out = {};
  for (const id of getAllFeatureItemIds()) {
    const item = findRegistryItem(id);
    const allowed = new Set(item?.roles || []);
    out[id] = Object.fromEntries(roles.map(r => [r, allowed.has(r)]));
  }
  return out;
}

/**
 * Whether a role may see a feature (module must also be enabled).
 * roleAccess overrides registry defaults when provided by the API.
 */
export function canRoleAccessFeature(featureId, role, modules, roleAccess) {
  if (!featureId) return true;
  if (!isFeatureEnabled(featureId, modules)) return false;
  if (!role) return false;
  const access = roleAccess?.[featureId];
  if (access && typeof access === 'object' && role in access) {
    return access[role] === true;
  }
  const item = findRegistryItem(featureId);
  if (!item?.roles) return true;
  return item.roles.includes(role);
}

/** Path → feature item id (longest match). */
export function pathToFeatureId(pathname) {
  const path = pathname.replace(/\/$/, '') || '/';
  for (const item of FEATURE_REGISTRY.standalone || []) {
    if (item.path === path) {
      return item.alwaysEnabled ? null : item.id;
    }
  }
  let best = null;
  let bestLen = -1;
  for (const group of FEATURE_REGISTRY.groups || []) {
    for (const item of group.items || []) {
      const p = item.path;
      if (path === p || path.startsWith(`${p}/`)) {
        if (p.length > bestLen) {
          bestLen = p.length;
          best = item.id;
        }
      }
    }
  }
  return best;
}

export function isFeatureEnabled(featureId, modules) {
  if (!featureId) return true;
  const flags = modules || getDefaultFeatureModules();
  return flags[featureId] !== false;
}

export function isRouteEnabled(pathname, modules, role, roleAccess) {
  const featureId = pathToFeatureId(pathname);
  if (!featureId) return true;
  if (role != null || roleAccess != null) {
    return canRoleAccessFeature(featureId, role, modules, roleAccess);
  }
  return isFeatureEnabled(featureId, modules);
}

/**
 * Build sidebar navigation from registry + role + feature flags.
 * @param {string | undefined} role
 * @param {Record<string, boolean> | undefined} modules
 * @param {Record<string, Record<string, boolean>> | undefined} roleAccess
 */
export function buildNavigation(role, modules, roleAccess) {
  const itemVisible = (id, itemRoles) => {
    if (roleAccess?.[id] && typeof roleAccess[id] === 'object') {
      return canRoleAccessFeature(id, role, modules, roleAccess);
    }
    if (itemRoles && !itemRoles.includes(role)) return false;
    return isFeatureEnabled(id, modules);
  };
  const canSeeGroup = roles => !roles || roles.includes(role);
  const sections = [];

  for (const item of FEATURE_REGISTRY.standalone || []) {
    if (item.hideFromNav) continue;
    if (item.alwaysEnabled) {
      if (roleAccess?.[item.id] && typeof roleAccess[item.id] === 'object') {
        if (!canRoleAccessFeature(item.id, role, modules, roleAccess)) continue;
      } else if (item.roles && !item.roles.includes(role)) {
        continue;
      }
      sections.push({
        group: null,
        items: [{
          path: item.path,
          label: item.label,
          icon: resolveNavIcon(item.navIcon),
          featureId: item.id,
        }],
      });
      continue;
    }
    if (!itemVisible(item.id, item.roles)) continue;
    sections.push({
      group: null,
      items: [{
        path: item.path,
        label: item.label,
        icon: resolveNavIcon(item.navIcon),
        featureId: item.id,
      }],
    });
  }

  for (const group of FEATURE_REGISTRY.groups || []) {
    if (!canSeeGroup(group.roles)) continue;
    const items = (group.items || [])
      .filter(item => !item.hideFromNav)
      .filter(item => itemVisible(item.id, item.roles))
      .map(item => ({
        path: item.path,
        label: item.label,
        icon: resolveNavIcon(item.navIcon),
        roles: item.roles,
        featureId: item.id,
      }));
    if (items.length === 0) continue;
    sections.push({
      group: group.label,
      groupId: group.id,
      icon: resolveNavIcon(group.navIcon),
      roles: group.roles,
      items,
    });
  }

  return sections;
}

/** Group helpers for platform admin UI */
export function getRegistryGroups() {
  return FEATURE_REGISTRY.groups || [];
}

export function getRegistryStandalone() {
  return FEATURE_REGISTRY.standalone || [];
}

export function setGroupItemsEnabled(modules, groupId, enabled) {
  const group = (FEATURE_REGISTRY.groups || []).find(g => g.id === groupId);
  if (!group) return modules;
  const next = { ...modules };
  for (const item of group.items || []) {
    next[item.id] = enabled;
  }
  return next;
}

export function isGroupFullyEnabled(modules, groupId) {
  const group = (FEATURE_REGISTRY.groups || []).find(g => g.id === groupId);
  if (!group) return true;
  return (group.items || []).every(item => modules[item.id] !== false);
}

export function isGroupPartiallyEnabled(modules, groupId) {
  const group = (FEATURE_REGISTRY.groups || []).find(g => g.id === groupId);
  if (!group) return false;
  const items = group.items || [];
  const on = items.filter(item => modules[item.id] !== false).length;
  return on > 0 && on < items.length;
}

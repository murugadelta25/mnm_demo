/**
 * Feature × role access matrix (User Management).
 * Rows with registryId also drive sidebar / route access via featureRoleAccess.
 */
export const ACCESS_MATRIX_ROLES = [
  'superadmin',
  'admin',
  'supervisor',
  'operator',
  'maintenance',
  'quality',
];

/** @type {{ id: string, feature: string, registryId?: string, roles: Record<string, boolean> }[]} */
export const ACCESS_MATRIX = [
  {
    id: 'dashboard',
    feature: 'View Dashboard',
    registryId: 'dashboard',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: true, quality: false },
  },
  {
    id: 'overview.factory',
    feature: 'Factory Overview',
    registryId: 'overview.factory',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: true, quality: false },
  },
  {
    id: 'overview.line',
    feature: 'Line Overview',
    registryId: 'overview.line',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: true, quality: false },
  },
  {
    id: 'overview.equipment',
    feature: 'Equipment Overview',
    registryId: 'overview.equipment',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: true, quality: false },
  },
  {
    id: 'overview.monitor',
    feature: 'Monitor Mode',
    registryId: 'overview.monitor',
    roles: { superadmin: true, admin: true, supervisor: true, operator: false, maintenance: true, quality: false },
  },
  {
    id: 'production.planning',
    feature: 'Production Planning',
    registryId: 'production.planning',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: false, quality: false },
  },
  {
    id: 'production.data_entry',
    feature: 'Data Entry',
    registryId: 'production.data_entry',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: false, quality: false },
  },
  {
    id: 'production.model_change',
    feature: 'Model Change Request',
    registryId: 'production.model_change',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: false, quality: false },
  },
  {
    id: 'capability.approve_model_change',
    feature: 'Approve Model Change',
    roles: { superadmin: true, admin: true, supervisor: true, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'capability.raise_breakdown',
    feature: 'Raise Breakdown Ticket',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: false, quality: false },
  },
  {
    id: 'capability.ack_breakdown',
    feature: 'Acknowledge Breakdown',
    roles: { superadmin: true, admin: true, supervisor: false, operator: false, maintenance: true, quality: false },
  },
  {
    id: 'capability.resolve_breakdown',
    feature: 'Resolve Breakdown',
    roles: { superadmin: true, admin: true, supervisor: false, operator: false, maintenance: true, quality: false },
  },
  {
    id: 'alerts.email',
    feature: 'Email Alerts Config',
    registryId: 'alerts.email',
    roles: { superadmin: true, admin: true, supervisor: true, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'settings.machines',
    feature: 'Machine Configuration',
    registryId: 'settings.machines',
    roles: { superadmin: true, admin: true, supervisor: true, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'settings.users',
    feature: 'User Management',
    registryId: 'settings.users',
    roles: { superadmin: true, admin: true, supervisor: false, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'settings.configuration',
    feature: 'System Configuration',
    registryId: 'settings.configuration',
    roles: { superadmin: true, admin: true, supervisor: false, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'settings.factory_setup',
    feature: 'Factory Setup / Backup',
    registryId: 'settings.factory_setup',
    roles: { superadmin: true, admin: false, supervisor: false, operator: false, maintenance: false, quality: false },
  },
  {
    id: 'qc.approvals',
    feature: 'QC Approvals',
    registryId: 'qc.approvals',
    roles: { superadmin: true, admin: true, supervisor: true, operator: false, maintenance: false, quality: true },
  },
  {
    id: 'qc.work_instructions',
    feature: 'Work Instructions',
    registryId: 'qc.work_instructions',
    roles: { superadmin: true, admin: true, supervisor: true, operator: true, maintenance: false, quality: true },
  },
  {
    id: 'operators.my_work_hours',
    feature: 'My Work Hours',
    registryId: 'operators.my_work_hours',
    roles: { superadmin: false, admin: false, supervisor: false, operator: true, maintenance: false, quality: false },
  },
];

/** Default roleAccess map keyed by matrix id (and registryId when present). */
export function getAccessMatrixRoleDefaults() {
  const out = {};
  for (const row of ACCESS_MATRIX) {
    out[row.id] = { ...row.roles };
    if (row.registryId && row.registryId !== row.id) {
      out[row.registryId] = { ...row.roles };
    }
  }
  return out;
}

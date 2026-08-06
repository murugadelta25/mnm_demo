/** Collect production lines from factory config for machine location dropdowns. */
export function getFactoryLines(config, { includeDisabled = false } = {}) {
  const lines = [];
  for (const factory of config?.factory?.factories || []) {
    for (const dept of factory.departments || []) {
      for (const line of dept.lines || []) {
        if (!line.name) continue;
        if (!includeDisabled && line.enabled === false) continue;
        const label = [factory.name, dept.name, line.name].filter(Boolean).join(' / ');
        lines.push({
          id: line.id,
          name: line.name,
          label,
          factoryId: factory.id,
          deptId: dept.id,
          enabled: line.enabled !== false,
          stationIds: (line.stationIds || []).map(Number).filter(Number.isFinite),
        });
      }
    }
  }
  return lines;
}

/**
 * Resolve Factory / Dept / Line label for a station from Factory Setup mapping.
 * Prefers an enabled line; falls back to a disabled line if that is the only mapping.
 */
export function getLineForStation(config, stationId) {
  const sid = Number(stationId);
  if (!Number.isFinite(sid)) return null;

  let disabledMatch = null;
  for (const factory of config?.factory?.factories || []) {
    for (const dept of factory.departments || []) {
      for (const line of dept.lines || []) {
        const ids = (line.stationIds || []).map(Number);
        if (!ids.includes(sid)) continue;
        const label = [factory.name, dept.name, line.name].filter(Boolean).join(' / ');
        const hit = {
          id: line.id,
          name: line.name,
          label,
          enabled: line.enabled !== false,
        };
        if (line.enabled !== false) return hit;
        if (!disabledMatch) disabledMatch = hit;
      }
    }
  }
  return disabledMatch;
}

/** True when entity is soft-enabled (missing flag counts as enabled). */
export function isEntityEnabled(entity) {
  if (!entity) return false;
  if (entity.enabled === false) return false;
  if (entity.is_enabled === false || entity.is_enabled === 0) return false;
  return true;
}

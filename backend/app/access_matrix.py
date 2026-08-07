"""Default feature × role access matrix (mirrors frontend/src/config/accessMatrix.js)."""
from __future__ import annotations

from typing import Any

TOGGLEABLE_ROLES = [
    "superadmin",
    "admin",
    "supervisor",
    "operator",
    "maintenance",
    "quality",
]

# Each row: id, label, optional registry_id, default role flags
ACCESS_MATRIX_ROWS: list[dict[str, Any]] = [
    {
        "id": "dashboard",
        "label": "View Dashboard",
        "registry_id": "dashboard",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": True, "quality": False},
    },
    {
        "id": "overview.factory",
        "label": "Factory Overview",
        "registry_id": "overview.factory",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": True, "quality": False},
    },
    {
        "id": "overview.line",
        "label": "Line Overview",
        "registry_id": "overview.line",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": True, "quality": False},
    },
    {
        "id": "overview.equipment",
        "label": "Equipment Overview",
        "registry_id": "overview.equipment",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": True, "quality": False},
    },
    {
        "id": "overview.monitor",
        "label": "Monitor Mode",
        "registry_id": "overview.monitor",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": False, "maintenance": True, "quality": False},
    },
    {
        "id": "production.work_orders",
        "label": "Work Orders",
        "registry_id": "production.work_orders",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": False},
    },
    {
        "id": "production.planning",
        "label": "Production Planning",
        "registry_id": "production.planning",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": False},
    },
    {
        "id": "production.data_entry",
        "label": "Data Entry",
        "registry_id": "production.data_entry",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": False},
    },
    {
        "id": "production.model_change",
        "label": "Model Change Request",
        "registry_id": "production.model_change",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": False},
    },
    {
        "id": "capability.approve_model_change",
        "label": "Approve Model Change",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "capability.raise_breakdown",
        "label": "Raise Breakdown Ticket",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": False},
    },
    {
        "id": "capability.ack_breakdown",
        "label": "Acknowledge Breakdown",
        "roles": {"superadmin": True, "admin": True, "supervisor": False, "operator": False, "maintenance": True, "quality": False},
    },
    {
        "id": "capability.resolve_breakdown",
        "label": "Resolve Breakdown",
        "roles": {"superadmin": True, "admin": True, "supervisor": False, "operator": False, "maintenance": True, "quality": False},
    },
    {
        "id": "alerts.email",
        "label": "Email Alerts Config",
        "registry_id": "alerts.email",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "settings.machines",
        "label": "Machine Configuration",
        "registry_id": "settings.machines",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "settings.users",
        "label": "User Management",
        "registry_id": "settings.users",
        "roles": {"superadmin": True, "admin": True, "supervisor": False, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "settings.configuration",
        "label": "System Configuration",
        "registry_id": "settings.configuration",
        "roles": {"superadmin": True, "admin": True, "supervisor": False, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "settings.factory_setup",
        "label": "Factory Setup / Backup",
        "registry_id": "settings.factory_setup",
        "roles": {"superadmin": True, "admin": False, "supervisor": False, "operator": False, "maintenance": False, "quality": False},
    },
    {
        "id": "qc.approvals",
        "label": "QC Approvals",
        "registry_id": "qc.approvals",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": False, "maintenance": False, "quality": True},
    },
    {
        "id": "qc.work_instructions",
        "label": "Work Instructions",
        "registry_id": "qc.work_instructions",
        "roles": {"superadmin": True, "admin": True, "supervisor": True, "operator": True, "maintenance": False, "quality": True},
    },
    {
        "id": "operators.my_work_hours",
        "label": "My Work Hours",
        "registry_id": "operators.my_work_hours",
        "roles": {"superadmin": False, "admin": False, "supervisor": False, "operator": True, "maintenance": False, "quality": False},
    },
]


def access_matrix_role_defaults() -> dict[str, dict[str, bool]]:
    out: dict[str, dict[str, bool]] = {}
    for row in ACCESS_MATRIX_ROWS:
        roles = {r: bool(row["roles"].get(r, False)) for r in TOGGLEABLE_ROLES}
        out[row["id"]] = dict(roles)
        rid = row.get("registry_id")
        if rid and rid != row["id"]:
            out[rid] = dict(roles)
    return out


def access_matrix_payload() -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "label": row["label"],
            "registryId": row.get("registry_id"),
            "defaultRoles": {r: bool(row["roles"].get(r, False)) for r in TOGGLEABLE_ROLES},
        }
        for row in ACCESS_MATRIX_ROWS
    ]

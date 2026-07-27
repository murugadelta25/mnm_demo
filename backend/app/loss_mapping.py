"""Map TPM mobile losses → Data Entry / OEE fields and Loss Tracker status."""
from __future__ import annotations

from typing import List, Optional, Tuple

# oee_field values match OEEEntry / Data Entry form keys
# bucket: breaks | mgmt | downtime | none

LOSS_CODE_MAP = {
    "LOSS-1": ("break_down", "downtime", "breakdown"),
    "LOSS-2": ("setting_time", "downtime", "setting_change"),
    "LOSS-3": ("tool_change", "downtime", "setting_change"),
    "LOSS-5": ("scrap_removal", "downtime", "idle"),
    "LOSS-13": ("dimension_correction", "downtime", "idle"),
}

LOSS9_SUB_MAP = {
    "NO LOAD": ("no_load", "mgmt", "idle"),
    "NO MANPOWER": ("no_manpower_planned", "mgmt", "idle"),
    "POWER CUT": ("power_cut", "mgmt", "offline"),
    "CHIPS REMOVAL": ("scrap_removal", "downtime", "idle"),
    "MEETING": ("management_meeting", "breaks", "idle"),
    "LUNCH": ("lunch_break", "breaks", "idle"),
    "TEA": ("tea_break", "breaks", "idle"),
    "CLITA": ("tpm_cleaning", "breaks", "idle"),
    "TRAINING": ("new_model_trial", "mgmt", "idle"),
    "PERSONAL NEEDS": (None, "none", "idle"),
}

# Full Loss Assigner catalog (TPM 16 Big Losses) — keep aligned with mobile constants/losses.js
TPM_LOSS_ASSIGNER_TYPES: List[dict] = [
    {"code": "LOSS-1", "description": "FAILURE LOSS", "label": "1. Equipment Failure"},
    {"code": "LOSS-2", "description": "SETUP & ADJUSTMENT LOSS", "label": "2. Setup & Adjustment"},
    {"code": "LOSS-3", "description": "SETTING CHANGE LOSS", "label": "3. Tool Change"},
    {"code": "LOSS-4", "description": "START-UP LOSS", "label": "4. Startup Loss"},
    {"code": "LOSS-5", "description": "MINOR STOPPAGE LOSS", "label": "5. Minor Stoppages"},
    {"code": "LOSS-6", "description": "SPEED LOSS", "label": "6. Speed Loss"},
    {"code": "LOSS-7", "description": "DEFECT & REWORK LOSS", "label": "7. Defects & Rework"},
    {"code": "LOSS-8", "description": "SHUTDOWN LOSS", "label": "8. Shutdown Loss"},
    {"code": "LOSS-9", "description": "MANAGEMENT LOSS", "label": "9. Management Loss"},
    {"code": "LOSS-10", "description": "MOTION LOSS", "label": "10. Operating Motion"},
    {"code": "LOSS-11", "description": "LINE ORGANIZATION LOSS", "label": "11. Line Organization"},
    {"code": "LOSS-12", "description": "DISTRIBUTION LOSS", "label": "12. Logistics Loss"},
    {"code": "LOSS-13", "description": "MEASUREMENT & ADJUSTMENT LOSS", "label": "13. Measurement & Adj."},
    {"code": "LOSS-14", "description": "ENERGY LOSS", "label": "14. Energy Loss"},
    {"code": "LOSS-15", "description": "TOOL LOSS", "label": "15. Die/Mold/Tool Wear"},
    {"code": "LOSS-16", "description": "YIELD LOSS", "label": "16. Yield/Material Loss"},
]


def map_loss_to_oee(
    loss_code: str,
    sub_division: Optional[str] = None,
) -> Tuple[Optional[str], str, str]:
    """
    Returns (oee_field, bucket, machine_status).
    oee_field may be None if not mapped to Data Entry.
    """
    code = (loss_code or "").strip().upper()
    sub = (sub_division or "").strip().upper()
    if code == "LOSS-9":
        return LOSS9_SUB_MAP.get(sub, (None, "none", "idle"))
    return LOSS_CODE_MAP.get(code, (None, "none", "idle"))


DOWNTIME_FIELDS = (
    "setting_time",
    "tool_change",
    "dimension_correction",
    "scrap_removal",
    "break_down",
)
MGMT_FIELDS = (
    "no_load",
    "new_model_trial",
    "power_cut",
    "planned_maintenance",
    "no_manpower_planned",
)
BREAK_FIELDS = (
    "lunch_break",
    "tea_break",
    "tpm_cleaning",
    "other_cleaning",
    "management_meeting",
)

ALL_OEE_LOSS_FIELDS = DOWNTIME_FIELDS + MGMT_FIELDS + BREAK_FIELDS

"""
Registry for machine-family telemetry modules.

Servo Press, AH/generic PLC, Linear Motor, and SPM Screw Driver stay in separate
files. resolve_module(profile_id) returns exactly one family — aliases and
enrichment never cross-load another device's map.
"""
from __future__ import annotations

from typing import Any, List, Optional

from .base import TelemetryFamilyModule
from .servo_press import ServoPressTelemetryModule
from .generic_plc import GenericPlcTelemetryModule
from .linear_motor import LinearMotorTelemetryModule
from .spm_screw_driver import (
    SpmScrewDriverTelemetryModule,
    apply_screw_driver_production,
    update_screw_driver_runtime,
)

# Order: first match wins (profiles are mutually exclusive by id)
_MODULES: List[TelemetryFamilyModule] = [
    ServoPressTelemetryModule(),
    GenericPlcTelemetryModule(),
    LinearMotorTelemetryModule(),
    SpmScrewDriverTelemetryModule(),
]


def list_modules() -> List[dict]:
    return [m.describe() for m in _MODULES]


def resolve_module(profile_id: str = "") -> Optional[TelemetryFamilyModule]:
    """Return the telemetry module for this profile only (or None)."""
    for mod in _MODULES:
        if mod.matches(profile_id=profile_id):
            return mod
    return None


def aliases_for_profile(profile_id: str, db_aliases: Optional[dict] = None) -> dict[str, str]:
    """
    Family base aliases + DB Config Tags aliases.
    DB wins on conflict so Machine Config edits override defaults.
    Never merges another family's base map.
    """
    mod = resolve_module(profile_id)
    base = mod.base_aliases() if mod else {}
    return {**base, **(db_aliases or {})}


def enrich_for_profile(profile_id: str, mapped: dict[str, Any]) -> dict[str, Any]:
    """Run only the matching family's enrich_mapped (no-op if unknown profile)."""
    mod = resolve_module(profile_id)
    if not mod:
        if isinstance(mapped, dict):
            mapped = dict(mapped)
            mapped["telemetry_module"] = None
        return mapped
    out = mod.enrich_mapped(mapped)
    if isinstance(out, dict):
        out["telemetry_module"] = mod.module_id
    return out


__all__ = [
    "TelemetryFamilyModule",
    "list_modules",
    "resolve_module",
    "aliases_for_profile",
    "enrich_for_profile",
    "update_screw_driver_runtime",
    "apply_screw_driver_production",
]

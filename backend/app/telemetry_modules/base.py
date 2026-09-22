"""
Shared contract for machine-family telemetry mapping modules.

Each family (Servo Press, AH/generic PLC, Linear Motor, SPM Screw Driver) owns its
Node-RED aliases and dashboard enrichment. resolve_module(profile_id) returns only
that family's module — never merge another family's tags into the active map.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional


class TelemetryFamilyModule(ABC):
    """One module per machine telemetry profile — aliases + UI enrichment only for that family."""

    module_id: str = "base"
    label: str = "Telemetry"
    profile_ids: tuple = ()

    def matches(self, *, profile_id: str = "") -> bool:
        pid = (profile_id or "").strip().lower()
        return bool(pid) and pid in {p.lower() for p in self.profile_ids}

    @abstractmethod
    def describe(self) -> dict:
        """UI / debug metadata."""

    @abstractmethod
    def base_aliases(self) -> dict[str, str]:
        """Node-RED reading.name → tag_key for this family only (no other profiles)."""

    def enrich_mapped(self, mapped: dict[str, Any]) -> dict[str, Any]:
        """
        Optional post-pass: Current Values tiles, Machine Status rows, trend helpers.
        Default: return mapped unchanged (catalog-driven tiles from shared mapper are enough).
        """
        return mapped

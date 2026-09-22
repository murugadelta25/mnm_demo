"""Servo Linear Motor telemetry — aliases isolated from Press / PLC / SPM Screw Driver."""
from __future__ import annotations

from typing import Any

from .base import TelemetryFamilyModule

LINEAR_MOTOR_ALIASES: dict[str, str] = {
    "device type": "device_type",
    "device_type": "device_type",
    "devicetype": "device_type",
    "live position": "live_position",
    "live_position": "live_position",
    "current position": "live_position",
    "position": "live_position",
    "alarm": "alarm_code",
    "alarm code": "alarm_code",
    "alarm_code": "alarm_code",
    "power enable status": "power_enable_status",
    "dc voltage": "dc_voltage",
    "home done": "home_done",
    "forward limit": "forward_limit",
    "forword limit": "forward_limit",
    "reverse limit": "reverse_limit",
    "clear alarm": "clear_alarm",
    "home cycle running": "home_cycle_running",
    "positive power limit": "positive_power_limit",
    "negative power limit": "negative_power_limit",
    "run time": "run_time",
    "enable": "set_enable",
    "set position": "set_position",
    "set speed": "set_speed",
    "acc": "set_acc",
    "decc": "set_decc",
    "home enable": "home_enable",
    "break enable": "brake_enable",
    "brake enable": "brake_enable",
}


class LinearMotorTelemetryModule(TelemetryFamilyModule):
    module_id = "servo_linear_motor"
    label = "Servo Linear Motor"
    profile_ids = ("servo_linear_motor",)

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "screens": ["Live Status", "Setpoints (Write)"],
            "note": "Linear servo %MW map — does not load press Result steps or ScrewDriver torque.",
        }

    def base_aliases(self) -> dict[str, str]:
        return dict(LINEAR_MOTOR_ALIASES)

    def enrich_mapped(self, mapped: dict[str, Any]) -> dict[str, Any]:
        return mapped

"""Servo Press Modbus §8.4.2 — aliases and enrichment isolated from PLC / SPM / Linear Motor."""
from __future__ import annotations

from typing import Any

from .base import TelemetryFamilyModule

# Press-only Edge / Node-RED names. Do NOT include PLC coils, ScrewDriver TorqueValue, etc.
SERVO_PRESS_ALIASES: dict[str, str] = {
    "live position": "live_position",
    "live_position": "live_position",
    "position": "live_position",
    "live force": "live_force",
    "live_force": "live_force",
    "force": "live_force",
    "load": "live_force",
    "live velocity": "live_velocity",
    "live_velocity": "live_velocity",
    "velocity": "live_velocity",
    "status": "status",
    "status*1": "status",
    "status*": "status",
    "live mode": "live_mode",
    "live_mode": "live_mode",
    "mode": "live_mode",
    "total steps": "total_steps",
    "total_steps": "total_steps",
    "live step": "live_step",
    "live_step": "live_step",
    "recipe number": "recipe_number",
    "recipe_number": "recipe_number",
    "recipe": "recipe_number",
    "total amount": "total_amount",
    "total_amount": "total_amount",
    "total count": "total_amount",
    "pass amount": "pass_amount",
    "pass_amount": "pass_amount",
    "good count": "pass_amount",
    "good amount": "pass_amount",
    "ng amount": "ng_amount",
    "ng_amount": "ng_amount",
    "reject count": "ng_amount",
    "reject amount": "ng_amount",
    "standby time": "standby_time",
    "standby_time": "standby_time",
    "pressing time": "pressing_time",
    "pressing_time": "pressing_time",
    "production time": "production_time",
    "production_time": "production_time",
    "cycle time": "production_time",
    "alarm code": "alarm_code",
    "alarm_code": "alarm_code",
    "alarm": "alarm_code",
    "pressing result": "pressing_result",
    "pressing_result": "pressing_result",
    "result": "pressing_result",
    "pressed position (step 1)": "pressed_position_step1",
    "pressed position step 1": "pressed_position_step1",
    "pressed_position_step1": "pressed_position_step1",
    "pressed pos1": "pressed_position_step1",
    "pressed_pos1": "pressed_position_step1",
    "pressed pos": "pressed_position",
    "pressed_pos": "pressed_position",
    "pressed force": "pressed_force",
    "pressed_force": "pressed_force",
    "pressed force1": "pressed_force",
    "pressed_force1": "pressed_force",
    "pressed position (step 2)": "pressed_position_step2",
    "pressed position step 2": "pressed_position_step2",
    "pressed_position_step2": "pressed_position_step2",
    "pressed pos2": "pressed_position_step2",
    "pressed_pos2": "pressed_position_step2",
    "pressed position (step 3)": "pressed_position_step3",
    "pressed position step 3": "pressed_position_step3",
    "pressed_position_step3": "pressed_position_step3",
    "pressed pos3": "pressed_position_step3",
    "pressed_pos3": "pressed_position_step3",
    "pressed position (step 4)": "pressed_position_step4",
    "pressed position step 4": "pressed_position_step4",
    "pressed_position_step4": "pressed_position_step4",
    "pressed_position_step_4": "pressed_position_step4",
    "pressed pos4": "pressed_position_step4",
    "pressed_pos4": "pressed_position_step4",
    "pressed position (step 5)": "pressed_position_step5",
    "pressed position step 5": "pressed_position_step5",
    "pressed_position_step5": "pressed_position_step5",
    "pressed_position_step_5": "pressed_position_step5",
    "pressed pos5": "pressed_position_step5",
    "pressed_pos5": "pressed_position_step5",
    "device type": "device_type",
    "device_type": "device_type",
    "devicetype": "device_type",
}


class ServoPressTelemetryModule(TelemetryFamilyModule):
    module_id = "servo_press"
    label = "Servo Press"
    profile_ids = ("servo_press",)

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "screens": ["Live Status", "Pressing Result"],
            "note": "Modbus §8.4.2 — isolated from AH PLC / Linear Motor / SPM Screw Driver.",
        }

    def base_aliases(self) -> dict[str, str]:
        return dict(SERVO_PRESS_ALIASES)

    def enrich_mapped(self, mapped: dict[str, Any]) -> dict[str, Any]:
        # Press UI blocks are built by the shared mapper from the §8.4.2 catalog.
        return mapped

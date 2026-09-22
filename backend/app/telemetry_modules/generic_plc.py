"""AH / generic PLC telemetry — aliases isolated from Servo Press / Linear Motor / SPM Screw Driver."""
from __future__ import annotations

from typing import Any

from .base import TelemetryFamilyModule

PLC_ALIASES: dict[str, str] = {
    "device type": "device_type",
    "device_type": "device_type",
    "devicetype": "device_type",
    "pressure": "pressure",
    "flow": "flow",
    "tank level": "tank_level",
    "tank_level": "tank_level",
    "tanklevel": "tank_level",
    "temperature": "temperature",
    "plc status": "plc_status",
    "plc_status": "plc_status",
    "plcstatus": "plc_status",
    "digital input status": "digital_input_status",
    "digital_input_status": "digital_input_status",
    "digitalinput": "digital_input_status",
    "digital output status": "digital_output_status",
    "digital_output_status": "digital_output_status",
    "digitaloutput": "digital_output_status",
    "pump": "do_pump",
    "blower": "do_blower",
    "chiller": "do_chiller",
    "motor": "do_motor",
    "boiler": "do_boiler",
    "furnace": "do_furnace",
    "conveyor": "do_conveyor",
    "electric_generators": "do_generators",
    "electric generators": "do_generators",
    "generators": "do_generators",
    "digital_input1": "di_1",
    "digital_input2": "di_2",
    "digital_input3": "di_3",
    "digital_input4": "di_4",
    "digital_input5": "di_5",
    "digital_input6": "di_6",
    "digital_input7": "di_7",
    "digital_input8": "di_8",
    "digital_input_1": "di_1",
    "digital_input_2": "di_2",
    "digital_input_3": "di_3",
    "digital_input_4": "di_4",
    "digital_input_5": "di_5",
    "digital_input_6": "di_6",
    "digital_input_7": "di_7",
    "digital_input_8": "di_8",
}


class GenericPlcTelemetryModule(TelemetryFamilyModule):
    module_id = "generic_plc"
    label = "AH / Generic PLC"
    profile_ids = ("generic_plc",)

    def describe(self) -> dict:
        return {
            "module_id": self.module_id,
            "label": self.label,
            "profile_ids": list(self.profile_ids),
            "screens": ["Live Tags", "Result Tags"],
            "note": "AH PLC kit (pressure/flow/tank/temp + coils) — does not load press or screwdriver maps.",
        }

    def base_aliases(self) -> dict[str, str]:
        return dict(PLC_ALIASES)

    def enrich_mapped(self, mapped: dict[str, Any]) -> dict[str, Any]:
        return mapped

"""
Simulate AH PLC kit Modbus readings for SPM_AH_PLC (machine_id=8 by default).

Posts to POST /api/machines/{id}/telemetry so Pressure / Flow / Tank Level /
Temperature charts and the Parameters / Machine Status panels populate without
waiting on Node-RED.

Usage (from repo root or backend/):
  python tools/simulate_ah_plc_telemetry.py
  python tools/simulate_ah_plc_telemetry.py --machine-id 8 --samples 30 --interval 1
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import time
from pathlib import Path

try:
    import urllib.request
    import json
except ImportError:
    raise SystemExit("Python 3 required")


def build_readings(tick: int) -> list[dict]:
    """Varying process values + coil booleans matching Node-RED AH PLC flow names."""
    t = tick * 0.35
    pressure = round(45 + 12 * math.sin(t) + random.uniform(-1.5, 1.5), 1)
    flow = round(28 + 8 * math.sin(t * 0.7 + 1.2) + random.uniform(-1.0, 1.0), 1)
    tank = round(62 + 15 * math.sin(t * 0.25 + 0.4) + random.uniform(-0.8, 0.8), 1)
    temperature = round(38 + 6 * math.sin(t * 0.4 + 2.1) + random.uniform(-0.5, 0.5), 1)
    plc_status = 1  # healthy — still posted for Live Tags, not shown on Machine Status
    # Flip a few coils so DI/DO indicators visibly change
    phase = (tick // 3) % 2 == 0
    return [
        {"name": "pressure", "value": pressure},
        {"name": "flow", "value": flow},
        {"name": "tankLevel", "value": tank},
        {"name": "temperature", "value": temperature},
        {"name": "plcStatus", "value": plc_status},
        {"name": "Pump", "value": phase},
        {"name": "Blower", "value": True},
        {"name": "Chiller", "value": phase},
        {"name": "Motor", "value": False},
        {"name": "Boiler", "value": False},
        {"name": "Furnace", "value": True},
        {"name": "Conveyor", "value": not phase},
        {"name": "Electric_Generators", "value": True},
        {"name": "Digital_Input1", "value": True},
        {"name": "Digital_Input2", "value": phase},
        {"name": "Digital_Input3", "value": True},
        {"name": "Digital_Input4", "value": False},
        {"name": "Digital_Input5", "value": True},
        {"name": "Digital_Input6", "value": not phase},
        {"name": "Digital_Input7", "value": False},
        {"name": "Digital_Input8", "value": True},
    ]


def post_sample(base: str, machine_id: int, tick: int, device_name: str) -> dict:
    body = {
        "syncBy": "MODBUS",
        "origin": int(time.time() * 1000),
        "deviceName": device_name,
        "machine_id": machine_id,
        "readings": build_readings(tick),
    }
    data = json.dumps(body).encode("utf-8")
    url = f"{base.rstrip('/')}/api/machines/{machine_id}/telemetry"
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main() -> int:
    parser = argparse.ArgumentParser(description="Simulate AH PLC telemetry for SPM_AH_PLC")
    parser.add_argument("--base", default="http://127.0.0.1:8010", help="PMS API base URL")
    parser.add_argument("--machine-id", type=int, default=8, help="Target machine id")
    parser.add_argument("--device-name", default="SPM_AH_PLC", help="machines.name match")
    parser.add_argument("--samples", type=int, default=24, help="How many samples to post")
    parser.add_argument("--interval", type=float, default=0.35, help="Seconds between posts")
    parser.add_argument("--loop", action="store_true", help="Keep posting forever")
    args = parser.parse_args()

    tick = 0
    posted = 0
    print(f"Posting AH PLC sim -> {args.base} machine_id={args.machine_id} ({args.device_name})")
    try:
        while True:
            tick += 1
            try:
                result = post_sample(args.base, args.machine_id, tick, args.device_name)
                posted += 1
                scaled = (result.get("scaled") or {}) if isinstance(result, dict) else {}
                # API may return a thin ack — print tick either way
                print(
                    f"  [{posted}] ok machine={result.get('machine_id', args.machine_id)} "
                    f"tick={tick}"
                    + (f" P={scaled.get('pressure')} F={scaled.get('flow')}" if scaled else "")
                )
            except Exception as exc:
                print(f"  [{posted + 1}] FAIL: {exc}", file=sys.stderr)
                return 1
            if not args.loop and posted >= args.samples:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    print(f"Done - {posted} sample(s). Reload SPM_AH_PLC Equipment Overview to see the charts.")
    return 0


if __name__ == "__main__":
    # Allow running from repo root: python backend/tools/...
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    raise SystemExit(main())

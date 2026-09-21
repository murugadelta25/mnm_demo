"""Chroma-key a solid-green machine render into a transparent PNG.

Usage:
    python tools/make_transparent_png.py <src.png> <dst.png>

Keeps the machine pixels, drops the green backdrop, removes green spill on the
edges and trims the empty border so the artwork fills the UI frame.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Greenness thresholds: below LOW stays opaque, above HIGH becomes fully clear.
LOW = 30
HIGH = 90


def key_out_green(src: Path, dst: Path) -> None:
    img = Image.open(src).convert("RGBA")
    arr = np.asarray(img).astype(np.int32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

    greenness = g - np.maximum(r, b)
    alpha = np.clip((HIGH - greenness) * 255 // (HIGH - LOW), 0, 255)
    alpha = np.minimum(a, alpha)

    # De-spill: pull green back to the neighbouring channels on edge pixels.
    edge = (greenness > 0) & (alpha > 0)
    g = np.where(edge, np.maximum(r, b), g)

    out = np.dstack([r, g, b, alpha]).astype(np.uint8)
    result = Image.fromarray(out)

    bbox = result.split()[3].getbbox()
    if bbox:
        result = result.crop(bbox)

    dst.parent.mkdir(parents=True, exist_ok=True)
    result.save(dst, "PNG", optimize=True)
    print(f"{dst} {result.size[0]}x{result.size[1]}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    key_out_green(Path(sys.argv[1]), Path(sys.argv[2]))

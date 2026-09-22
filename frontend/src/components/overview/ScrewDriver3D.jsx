import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * CSS 3D Delta inline screwdriver (ECM-SD style).
 * Pure CSS — works on Windows and Ubuntu (Chrome / Firefox / Edge).
 *
 * RunningStatus:
 *   4 Ready · 8 Running · 5 Ready and OK
 * Spin only when status === 8.
 * PositionValue > 0 → clockwise · < 0 → anti-clockwise.
 */
const STATUS_LABELS = {
  4: 'Ready',
  8: 'Running',
  5: 'Ready OK',
};

export default function ScrewDriver3D({
  positionValue = null,
  torque = null,
  resultLabel = null,
  resultOk = null,
  runningStatus = null,
  height = 220,
}) {
  const pos = positionValue == null || positionValue === '' ? null : Number(positionValue);
  const hasPos = pos != null && !Number.isNaN(pos);
  const direction = hasPos ? (pos > 0 ? 1 : pos < 0 ? -1 : 0) : 0;

  const statusCode = runningStatus == null || runningStatus === ''
    ? null
    : Number(runningStatus);
  const isRunning = statusCode === 8;
  const spinning = isRunning && direction !== 0;

  const statusLabel = STATUS_LABELS[statusCode] || (statusCode != null && !Number.isNaN(statusCode)
    ? `Status ${statusCode}`
    : null);

  const speedSec = useMemo(() => {
    if (!spinning || !hasPos) return 1.2;
    const mag = Math.min(Math.abs(pos), 2000);
    return Math.max(0.45, 1.8 - mag / 1400);
  }, [spinning, hasPos, pos]);

  const animName = direction > 0 ? 'sd-spin-cw' : direction < 0 ? 'sd-spin-ccw' : 'none';
  const [tick, setTick] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (spinning) return undefined;
    let t0 = performance.now();
    const loop = (t) => {
      setTick((t - t0) / 1000);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [spinning]);

  const idleTilt = spinning ? 0 : Math.sin(tick * 1.2) * 3;

  const resultColor = resultOk === true
    ? '#22c55e'
    : resultOk === false
      ? '#ef4444'
      : '#94a3b8';

  const arrowColor = direction > 0 ? '#38bdf8' : '#fbbf24';
  return (
    <div
      className="sd3d-root"
      style={{
        height,
        width: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        perspective: 900,
        background: 'transparent',
        borderRadius: 10,
      }}
      title={
        isRunning
          ? `Running · Pos ${hasPos ? pos : '—'} · ${direction > 0 ? 'CW' : direction < 0 ? 'CCW' : '—'}`
          : (statusLabel || 'Awaiting RunningStatus')
      }
    >
      <style>{SD3D_CSS}</style>

      <div
        className="sd3d-scene"
        style={{
          transform: `rotateX(8deg) rotateY(${idleTilt}deg)`,
          transformStyle: 'preserve-3d',
        }}
      >
        <div className="sd3d-loop" />

        <div className="sd3d-body">
          <div className="sd3d-cap" />
          <div className="sd3d-upper">
            <span className="sd3d-btn" />
            <span className="sd3d-brand">DELTA</span>
          </div>
          <div className="sd3d-grip" />
          <div className="sd3d-flare" />
          <div className="sd3d-neck" />
        </div>

        {/* Direction arrow in neck→bit gap — only while RunningStatus === 8 */}
        {spinning && (
          <div
            className="sd3d-arrow-zone sd3d-arrow-live"
            style={{ color: arrowColor }}
            aria-hidden
          >
            <DirectionArrow cw={direction > 0} />
          </div>
        )}

        <div
          className="sd3d-rotor"
          style={
            spinning
              ? {
                  // No inline transform — avoids fighting @keyframes on Ubuntu Chromium
                  animationName: animName,
                  animationDuration: `${speedSec}s`,
                  animationTimingFunction: 'linear',
                  animationIterationCount: 'infinite',
                  willChange: 'transform',
                }
              : { animation: 'none', willChange: 'auto' }
          }
        >
          <div className="sd3d-chuck" />
          <div className="sd3d-bit">
            <span className="sd3d-bit-flat" />
            <span className="sd3d-bit-tip" />
          </div>
        </div>
      </div>

      <div className="sd3d-hud">
        <span className={`sd3d-pill ${spinning ? 'on' : ''}`}>
          {spinning
            ? (direction > 0 ? '↻ CW' : '↺ CCW')
            : (isRunning ? '■ RUN 0' : (statusLabel ? `■ ${statusLabel}` : '■ IDLE'))}
        </span>
        {statusLabel && (
          <span className={`sd3d-pill ${isRunning ? 'on' : 'muted'}`}>
            {statusCode} · {statusLabel}
          </span>
        )}
        {torque != null && torque !== '' && (
          <span className="sd3d-pill muted">T {torque} Nm</span>
        )}
        {hasPos && (
          <span className="sd3d-pill muted">Pos {pos}°</span>
        )}
        {resultLabel && resultLabel !== '—' && (
          <span className="sd3d-pill" style={{ color: resultColor, borderColor: `${resultColor}88` }}>
            {resultLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function DirectionArrow({ cw }) {
  // Circular arrow in the neck→bit gap: CW when PositionValue > 0, CCW when < 0
  return (
    <svg
      className="sd3d-arrow-svg"
      viewBox="0 0 32 32"
      width="30"
      height="30"
    >
      {cw ? (
        <>
          <path
            d="M 16 5 A 11 11 0 1 1 7 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <polygon points="16,2 20,8 12,8" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d="M 16 5 A 11 11 0 1 0 25 22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <polygon points="16,2 20,8 12,8" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

const SD3D_CSS = `
@keyframes sd-spin-cw {
  from { transform: translateZ(0) rotateY(0deg); }
  to { transform: translateZ(0) rotateY(360deg); }
}
@keyframes sd-spin-ccw {
  from { transform: translateZ(0) rotateY(0deg); }
  to { transform: translateZ(0) rotateY(-360deg); }
}
@keyframes sd-arrow-pulse {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.08); }
}
.sd3d-scene {
  position: relative;
  width: 56px;
  height: 190px;
  transform-style: preserve-3d;
  transition: transform 0.4s ease;
}
.sd3d-loop {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 22px;
  height: 14px;
  margin-left: -11px;
  border: 2.5px solid #a8b0b8;
  border-radius: 12px 12px 4px 4px;
  background: transparent;
  box-shadow: inset 0 0 2px rgba(255,255,255,0.5);
  z-index: 5;
}
.sd3d-body {
  position: absolute;
  inset: 10px 0 56px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform-style: preserve-3d;
}
.sd3d-cap {
  width: 28px;
  height: 10px;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(90deg, #0a0a0a, #2a2a2a 40%, #111 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.sd3d-upper {
  position: relative;
  width: 30px;
  height: 36px;
  border-radius: 3px;
  background: linear-gradient(90deg, #0d0d0d 0%, #1f1f1f 35%, #2c2c2c 50%, #1a1a1a 65%, #0a0a0a 100%);
  box-shadow:
    inset -4px 0 6px rgba(255,255,255,0.06),
    inset 4px 0 8px rgba(0,0,0,0.45);
}
.sd3d-btn {
  position: absolute;
  top: 10px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f3f4f6, #9ca3af 55%, #6b7280);
  box-shadow: 0 0 0 1px #374151;
}
.sd3d-brand {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%) rotate(-90deg);
  font-size: 5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.28);
  white-space: nowrap;
}
.sd3d-grip {
  width: 28px;
  height: 34px;
  border-radius: 2px;
  background:
    repeating-linear-gradient(
      90deg,
      #111 0px, #111 2px,
      #1c1c1c 2px, #1c1c1c 4px
    );
  box-shadow: inset 0 0 8px rgba(0,0,0,0.55);
}
.sd3d-flare {
  width: 34px;
  height: 18px;
  border-radius: 2px 2px 8px 8px;
  background:
    repeating-linear-gradient(
      90deg,
      #0f0f0f 0px, #0f0f0f 2px,
      #222 2px, #222 4px
    ),
    linear-gradient(180deg, #1a1a1a, #0a0a0a);
  box-shadow: 0 2px 4px rgba(0,0,0,0.35);
}
.sd3d-neck {
  width: 18px;
  height: 10px;
  border-radius: 2px;
  background: linear-gradient(90deg, #0a0a0a, #252525 50%, #0a0a0a);
}
/* Gap between neck and chuck — direction arrow lives here */
.sd3d-arrow-zone {
  position: absolute;
  left: 50%;
  bottom: 44px;
  width: 32px;
  height: 32px;
  margin-left: -16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8;
  pointer-events: none;
}
.sd3d-arrow-live {
  animation: sd-arrow-pulse 0.9s ease-in-out infinite;
}
.sd3d-arrow-svg {
  display: block;
  filter: drop-shadow(0 0 3px currentColor);
}
.sd3d-rotor {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 20px;
  margin-left: -10px;
  height: 48px;
  transform-style: preserve-3d;
  transform-origin: 50% 8%;
  backface-visibility: hidden;
}
.sd3d-chuck {
  width: 16px;
  height: 10px;
  margin: 0 auto;
  border-radius: 2px;
  background: linear-gradient(90deg, #111, #333 45%, #111);
  box-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.sd3d-bit {
  position: relative;
  width: 6px;
  height: 36px;
  margin: 0 auto;
  border-radius: 1px;
  background: linear-gradient(90deg, #8a9099, #e8eaed 40%, #c0c4c8 55%, #6b7280);
  box-shadow: 1px 0 0 rgba(255,255,255,0.35), -1px 0 2px rgba(0,0,0,0.25);
}
.sd3d-bit-flat {
  position: absolute;
  left: 0;
  top: 8px;
  width: 2px;
  height: 16px;
  background: rgba(0,0,0,0.22);
  border-radius: 1px;
}
.sd3d-bit-tip {
  position: absolute;
  left: 50%;
  bottom: -2px;
  width: 0;
  height: 0;
  margin-left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 8px solid #9ca3af;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.25));
}
.sd3d-hud {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  pointer-events: none;
}
.sd3d-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.55);
  background: rgba(15, 23, 42, 0.55);
  color: #e2e8f0;
  letter-spacing: 0.02em;
}
.sd3d-pill.on {
  border-color: #3b82f6;
  color: #93c5fd;
  background: rgba(30, 64, 175, 0.35);
}
.sd3d-pill.muted {
  color: #cbd5e1;
  font-weight: 600;
}
`;

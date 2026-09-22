import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from 'recharts';
import api from '../../api/client';
import { assetUrl } from '../../api/config';
import ScrewDriver3D from './ScrewDriver3D';
import screwDriverTorqueIcon from '../../assets/screw-driver-torque.svg';

/**
 * Servo Press equipment overview.
 * Compact Production + OEE donut on the main screen.
 * Full OEE KPI panel opens when the donut is clicked.
 */
const TREND_SERIES = [
  { key: 'position', name: 'Position (mm)', color: '#3b82f6', axis: 'left', unit: 'mm' },
  { key: 'load', name: 'Force (kgf)', color: '#f59e0b', axis: 'left', unit: 'kgf' },
  { key: 'velocity', name: 'Velocity (mm/s)', color: '#22c55e', axis: 'right', unit: 'mm/s' },
  { key: 'torque', name: 'Torque (Nm)', color: '#f59e0b', axis: 'left', unit: 'Nm' },
  { key: 'screw_position', name: 'Position (°)', color: '#3b82f6', axis: 'left', unit: '°' },
];

/** Edge TorqueValue Int16 → Nm (raw milli-newton-metres). */
function screwTorqueNm(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return n / 1000;
}

function fmtScrewTorqueNm(raw) {
  const v = screwTorqueNm(raw);
  if (v == null) return null;
  const rounded = Math.round(v * 1000) / 1000;
  return String(rounded);
}

function fmtScrewPositionDeg(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return String(n);
}
/** Trend series are fed by these catalog keys — a machine without them has no trend. */
const TREND_REGISTER_BY_SERIES = {
  position: 'live_position',
  load: 'live_force',
  velocity: 'live_velocity',
  torque: 'torque',
  screw_position: 'position_value',
};

/** AH PLC process charts — replace Production tiles on the PLC overview. */
const PLC_PARAM_CHARTS = [
  { key: 'pressure', name: 'Pressure', color: '#3b82f6' },
  { key: 'flow', name: 'Flow', color: '#22c55e' },
  { key: 'tank_level', name: 'Tank Level', color: '#f59e0b' },
  { key: 'temperature', name: 'Temperature', color: '#ef4444' },
];

/** LSL / USL tags for SPM_AH_PLC Parameters threshold alarms. */
const PLC_THRESHOLD_TAGS = [
  { key: 'pressure', label: 'Pressure', unit: 'kPa' },
  { key: 'flow', label: 'Flow', unit: 'L/min' },
  { key: 'tank_level', label: 'Tank Level', unit: '%' },
  { key: 'temperature', label: 'Temperature', unit: '°C' },
];

function emptyThresholdDraft() {
  return Object.fromEntries(
    PLC_THRESHOLD_TAGS.map(({ key }) => [key, { lsl: '', usl: '', enabled: true }]),
  );
}

function draftFromThresholds(thresholds) {
  const src = thresholds && typeof thresholds === 'object' ? thresholds : {};
  const out = emptyThresholdDraft();
  for (const { key } of PLC_THRESHOLD_TAGS) {
    const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
    out[key] = {
      lsl: row.lsl != null && row.lsl !== '' ? String(row.lsl) : '',
      usl: row.usl != null && row.usl !== '' ? String(row.usl) : '',
      enabled: row.enabled !== false,
    };
  }
  return out;
}

/** Status / I/O words stay on Machine Status — not the Parameters strip. */
const OVERVIEW_PARAM_EXCLUDE = new Set([
  'plc_status',
  'digital_input_status',
  'digital_output_status',
  'do_pump', 'do_blower', 'do_chiller', 'do_motor',
  'do_boiler', 'do_furnace', 'do_conveyor', 'do_generators',
  'di_1', 'di_2', 'di_3', 'di_4', 'di_5', 'di_6', 'di_7', 'di_8',
]);
const OVERVIEW_PARAM_EXCLUDE_LABELS = new Set([
  'plc status',
  'digital input status',
  'digital output status',
]);

const PLC_DI_FALLBACK = Array.from({ length: 8 }, (_, i) => ({
  key: `di_${i + 1}`,
  label: `D I/O ${i + 1}`,
  on: null,
}));
const PLC_DO_FALLBACK = [
  { key: 'do_pump', label: 'Pump', icon: 'pump', on: null },
  { key: 'do_blower', label: 'Blower', icon: 'blower', on: null },
  { key: 'do_chiller', label: 'Chiller', icon: 'chiller', on: null },
  { key: 'do_motor', label: 'Motor', icon: 'motor', on: null },
  { key: 'do_boiler', label: 'Boiler', icon: 'boiler', on: null },
  { key: 'do_furnace', label: 'Furnace', icon: 'furnace', on: null },
  { key: 'do_conveyor', label: 'Conveyor', icon: 'conveyor', on: null },
  { key: 'do_generators', label: 'Generators', icon: 'generator', on: null },
];

function StatusLed({ on, size = 16, badge = false }) {
  const state = on === true ? 'on' : on === false ? 'off' : 'unk';
  return (
    <span
      className={`plc-led plc-led-${state}${badge ? ' plc-led-badge' : ''}`}
      style={{ width: size, height: size }}
      title={on === true ? 'ON' : on === false ? 'OFF' : 'No signal'}
    />
  );
}

function LiveEndDot({ cx, cy, index, dataLen, color }) {
  if (cx == null || cy == null || index !== dataLen - 1) return null;
  return (
    <g>
      <circle className="plc-chart-pulse" cx={cx} cy={cy} r={7} fill={color} />
      <circle cx={cx} cy={cy} r={3.2} fill={color} stroke="#ffffff" strokeWidth={1.2} />
    </g>
  );
}

function DoEquipmentIcon({ icon, on, dark, size = 56 }) {
  const stroke = on === true
    ? (dark ? '#7dffb2' : '#16a34a')
    : on === false
      ? (dark ? '#ff9aa2' : '#f87171')
      : (dark ? '#94a3b8' : '#94a3b8');
  const fill = on === true
    ? (dark ? 'rgba(57, 255, 20, 0.22)' : '#dcfce7')
    : on === false
      ? (dark ? 'rgba(255, 107, 107, 0.18)' : '#fee2e2')
      : (dark ? 'rgba(15, 23, 42, 0.45)' : '#f1f5f9');
  const common = {
    width: size,
    height: Math.round(size * 0.8),
    viewBox: '0 0 40 32',
    style: { display: 'block', margin: '0 auto' },
  };
  if (icon === 'pump') {
    return (
      <svg {...common}>
        <rect x="6" y="10" width="18" height="14" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <circle cx="28" cy="17" r="7" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <circle cx="28" cy="17" r="2.5" fill={stroke} />
      </svg>
    );
  }
  if (icon === 'blower') {
    return (
      <svg {...common}>
        <ellipse cx="20" cy="16" rx="12" ry="10" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <path d="M20 8 L24 16 L20 24 L16 16 Z" fill={stroke} opacity="0.55" />
      </svg>
    );
  }
  if (icon === 'chiller') {
    return (
      <svg {...common}>
        <rect x="8" y="6" width="24" height="20" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <path d="M14 12 H26 M14 16 H26 M14 20 H26" stroke={stroke} strokeWidth="1.2" />
      </svg>
    );
  }
  if (icon === 'motor') {
    return (
      <svg {...common}>
        <rect x="10" y="8" width="20" height="16" rx="3" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <circle cx="20" cy="16" r="4" fill={stroke} opacity="0.45" />
      </svg>
    );
  }
  if (icon === 'boiler') {
    return (
      <svg {...common}>
        <rect x="12" y="8" width="16" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <path d="M16 14 H24 M16 18 H24" stroke={stroke} strokeWidth="1.2" />
        <path d="M18 4 H22 V8" stroke={stroke} strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  if (icon === 'furnace') {
    return (
      <svg {...common}>
        <path d="M8 26 V12 Q20 4 32 12 V26 Z" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <path d="M16 22 Q20 14 24 22" fill="none" stroke="#f97316" strokeWidth="1.5" />
      </svg>
    );
  }
  if (icon === 'conveyor') {
    return (
      <svg {...common}>
        <rect x="4" y="14" width="32" height="6" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
        <circle cx="10" cy="24" r="3" fill={stroke} />
        <circle cx="30" cy="24" r="3" fill={stroke} />
      </svg>
    );
  }
  // generator
  return (
    <svg {...common}>
      <rect x="10" y="10" width="20" height="14" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <path d="M16 8 H24 V10" stroke={stroke} strokeWidth="1.5" fill="none" />
      <path d="M17 15 H23 M20 12 V18" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

function DigitalIoStatusPanel({ digitalIo, t }) {
  const inputs = (digitalIo?.inputs?.length ? digitalIo.inputs : PLC_DI_FALLBACK);
  const outputs = (digitalIo?.outputs?.length ? digitalIo.outputs : PLC_DO_FALLBACK);
  const dark = Boolean(t.isDark);
  const panelStyle = {
    flex: 1,
    minWidth: 0,
    border: `1px solid ${t.border || (dark ? 'rgba(34,202,231,0.45)' : '#e2e8f0')}`,
    borderRadius: 10,
    padding: '10px 12px 12px',
    background: t.surface2 || t.inp || (dark ? 'rgba(4, 20, 59, 0.72)' : '#f8fafc'),
  };
  const titleStyle = {
    fontSize: 15,
    fontWeight: 800,
    color: t.titleColor || t.text || (dark ? '#ffffff' : '#0f172a'),
    marginBottom: 10,
    letterSpacing: 0.2,
  };
  const diChipBg = dark
    ? (t.inp || 'rgba(3, 19, 58, 0.92)')
    : '#1e3a5f';
  const diChipBorder = dark ? `1px solid ${t.accent || '#22cae7'}` : 'none';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={panelStyle}>
        <div style={titleStyle}>Digital Input Status</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 10,
        }}
        >
          {inputs.map((item) => (
            <div key={item.key} style={{ textAlign: 'center' }}>
              <div style={{
                background: diChipBg,
                color: '#f59e0b',
                border: diChipBorder,
                fontSize: 12,
                fontWeight: 700,
                padding: '6px 4px',
                borderRadius: 5,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              >
                {item.label}
              </div>
              <StatusLed on={item.on} size={28} />
            </div>
          ))}
        </div>
      </div>
      <div style={panelStyle}>
        <div style={titleStyle}>Digital Output Status</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 10,
        }}
        >
          {outputs.map((item) => (
            <div key={item.key} style={{ textAlign: 'center', position: 'relative' }}>
              <div style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                minHeight: 48,
              }}
              >
                <DoEquipmentIcon icon={item.icon || 'motor'} on={item.on} dark={dark} size={56} />
                <span style={{
                  position: 'absolute',
                  top: -4,
                  right: 'calc(50% - 34px)',
                }}
                >
                  <StatusLed on={item.on} size={18} badge />
                </span>
              </div>
              <div style={{
                fontSize: 12,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: '#f59e0b',
                marginTop: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              >
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const SUB_NAV = [
  { id: 'overview', label: 'Production Overview', icon: '▣' },
  { id: 'live', label: 'Live Status', icon: '◉' },
  { id: 'result', label: 'Pressing Result', icon: '◫' },
  { id: 'alarms', label: 'Alarms', icon: '⚑' },
  { id: 'history', label: 'History', icon: '◷' },
];

/** Format a scaled Modbus number for the HMI-style Pressing Result panel. */
function fmtHmi(value, digits = 3) {
  if (value == null || value === '') return '-';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toFixed(digits);
}

/** If backend returned raw Modbus integers, apply HMI scales for display. */
function hmiPositionMm(rawOrScaled) {
  if (rawOrScaled == null || rawOrScaled === '') return null;
  const n = Number(rawOrScaled);
  if (Number.isNaN(n)) return null;
  // Raw Int32 is typically thousands (e.g. 25000 → 25.000 mm)
  return Math.abs(n) >= 500 ? n * 0.001 : n;
}

function hmiForceKgf(rawOrScaled) {
  if (rawOrScaled == null || rawOrScaled === '') return null;
  const n = Number(rawOrScaled);
  if (Number.isNaN(n)) return null;
  // Raw Int32 force often hundreds (e.g. 206 → 20.6 kgf)
  return Math.abs(n) >= 80 ? n * 0.1 : n;
}

/**
 * HMI-like Pressing Result panel (Stats + Step positions + Pressed Result).
 */
function PressingResultHmi({
  production,
  stepPositions,
  pressedPositionMm,
  pressedForceKgf,
  standbySec,
  pressingSec,
  productionSec,
  resultLabel,
  resultOk,
  resultReason,
  statusPrompt,
  statusDisplay,
  resultReady,
  t,
}) {
  const okColor = '#16a34a';
  const ngColor = '#dc2626';
  const muted = t.textMuted || '#64748b';
  const border = t.border || '#cbd5e1';
  const surface = t.surface2 || t.surface || '#f1f5f9';
  const resultColor = resultOk === true ? okColor : (resultOk === false ? ngColor : muted);
  const promptBg = resultOk === false
    ? 'rgba(220,38,38,0.12)'
    : (resultReady ? 'rgba(22,163,74,0.12)' : surface);
  const steps = Array.isArray(stepPositions) && stepPositions.length
    ? stepPositions
    : [1, 2, 3, 4, 5].map((n) => ({ step: n, mm: null }));

  const cell = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '14px 10px',
    borderRight: `1px solid ${border}`,
    boxSizing: 'border-box',
  };

  const sideCol = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    background: surface,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, 160px) minmax(200px, 280px) 1fr',
      gap: 12,
      padding: 14,
      flex: '1 1 auto',
      minHeight: 0,
      boxSizing: 'border-box',
    }}
    >
      {/* Stats column */}
      <div style={sideCol}>
        <div style={{
          padding: '10px 12px',
          fontWeight: 800,
          fontSize: 15,
          borderBottom: `1px solid ${border}`,
          color: t.text,
          textAlign: 'center',
        }}
        >
          Stats
        </div>
        {[
          { label: 'Total', value: production?.total, color: '#2563eb' },
          { label: 'Pass', value: production?.good, color: okColor },
          { label: 'NG', value: production?.reject, color: ngColor },
        ].map((row) => (
          <div
            key={row.label}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '12px 8px',
              borderBottom: `1px solid ${border}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: muted }}>{row.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: row.color, lineHeight: 1.05 }}>
              {row.value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Pressed position Step 1–5 — column next to Stats */}
      <div style={sideCol}>
        <div style={{
          padding: '10px 12px',
          fontWeight: 800,
          fontSize: 14,
          borderBottom: `1px solid ${border}`,
          color: t.text,
          textAlign: 'center',
        }}
        >
          Pressed Position
        </div>
        {steps.map((row, idx) => (
          <div
            key={row.step || idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 12px',
              borderBottom: idx === steps.length - 1 ? 'none' : `1px solid ${border}`,
              flex: 1,
              minHeight: 36,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: muted, lineHeight: 1.25 }}>
              {`Step ${row.step}`}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.text, whiteSpace: 'nowrap' }}>
              {row.mm == null || row.mm === '' ? '—' : `${fmtHmi(row.mm, 3)} mm`}
            </div>
          </div>
        ))}
      </div>

      {/* Pressed Result — HMI bottom panel */}
      <div style={{
        border: `1px solid ${border}`,
        borderRadius: 10,
        background: t.surface || '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}
      >
        <div style={{
          padding: '10px 14px',
          fontWeight: 800,
          fontSize: 15,
          borderBottom: `1px solid ${border}`,
          color: t.text,
        }}
        >
          Pressed Result
        </div>

        <div style={{
          display: 'flex',
          flex: '1 1 auto',
          borderBottom: `1px solid ${border}`,
          minHeight: 120,
        }}
        >
          <div style={cell}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
              Pressed Position (mm)
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, color: t.text, lineHeight: 1.05 }}>
              {fmtHmi(pressedPositionMm, 3)}
            </div>
          </div>
          <div style={{ ...cell, background: resultOk == null ? surface : (resultOk ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)') }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted }}>Result</div>
            <div style={{ fontSize: 48, fontWeight: 900, color: resultColor, lineHeight: 1 }}>
              {resultLabel || '—'}
            </div>
            {resultReason ? (
              <div style={{ fontSize: 12, fontWeight: 600, color: muted, textAlign: 'center', marginTop: 2 }}>
                {resultReason}
              </div>
            ) : null}
          </div>
          <div style={{ ...cell, borderRight: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
              Pressed Force (kgf)
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, color: t.text, lineHeight: 1.05 }}>
              {fmtHmi(pressedForceKgf, 1)}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${border}`,
          minHeight: 88,
        }}
        >
          {[
            { label: 'Standby Time (s)', value: fmtHmi(standbySec, 1) },
            { label: 'Pressing Time (s)', value: fmtHmi(pressingSec, 1) },
            { label: 'Production Time (s)', value: fmtHmi(productionSec, 2) },
          ].map((row, idx, arr) => (
            <div
              key={row.label}
              style={{
                ...cell,
                borderRight: idx === arr.length - 1 ? 'none' : `1px solid ${border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
                {row.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: t.text }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{
          margin: 12,
          padding: '12px 16px',
          borderRadius: 8,
          background: promptBg,
          border: `1px solid ${border}`,
          textAlign: 'center',
          fontSize: 18,
          fontWeight: 700,
          color: resultOk === false ? ngColor : (t.text || '#0f172a'),
        }}
        >
          {statusPrompt || statusDisplay || '—'}
          {statusCodeHint(statusDisplay, resultReady)}
        </div>
      </div>
    </div>
  );
}

/**
 * HMI-like Live Status panel (mirrors Pressing Result layout) + register values.
 */
function LiveStatusHmi({
  production,
  livePositionMm,
  liveForceKgf,
  liveVelocity,
  liveMode,
  liveStep,
  totalSteps,
  recipeNumber,
  statusPrompt,
  statusDisplay,
  statusOk,
  t,
}) {
  const okColor = '#16a34a';
  const ngColor = '#dc2626';
  const muted = t.textMuted || '#64748b';
  const border = t.border || '#cbd5e1';
  const surface = t.surface2 || t.surface || '#f1f5f9';
  const statusColor = statusOk === true ? okColor : (statusOk === false ? ngColor : (t.accent || '#2563eb'));

  const cell = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '14px 10px',
    borderRight: `1px solid ${border}`,
    boxSizing: 'border-box',
  };

  const sideCol = {
    border: `1px solid ${border}`,
    borderRadius: 10,
    background: surface,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  };

  const stepText = liveStep != null
    ? (totalSteps != null ? `${liveStep} / ${totalSteps}` : String(liveStep))
    : '—';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, 160px) 1fr',
      gap: 12,
      padding: 14,
      flex: '1 1 auto',
      minHeight: 0,
      boxSizing: 'border-box',
    }}
    >
      <div style={sideCol}>
        <div style={{
          padding: '10px 12px',
          fontWeight: 800,
          fontSize: 15,
          borderBottom: `1px solid ${border}`,
          color: t.text,
          textAlign: 'center',
        }}
        >
          Stats
        </div>
        {[
          { label: 'Total', value: production?.total, color: '#2563eb' },
          { label: 'Pass', value: production?.good, color: okColor },
          { label: 'NG', value: production?.reject, color: ngColor },
        ].map((row) => (
          <div
            key={row.label}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '12px 8px',
              borderBottom: `1px solid ${border}`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: muted }}>{row.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: row.color, lineHeight: 1.05 }}>
              {row.value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        border: `1px solid ${border}`,
        borderRadius: 10,
        background: t.surface || '#fff',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}
      >
        <div style={{
          padding: '10px 14px',
          fontWeight: 800,
          fontSize: 15,
          borderBottom: `1px solid ${border}`,
          color: t.text,
        }}
        >
          Live Status
        </div>

        <div style={{
          display: 'flex',
          flex: '1 1 auto',
          borderBottom: `1px solid ${border}`,
          minHeight: 110,
        }}
        >
          <div style={cell}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
              Live Position (mm)
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: t.text, lineHeight: 1.05 }}>
              {fmtHmi(livePositionMm, 3)}
            </div>
          </div>
          <div style={cell}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
              Live Force (kgf)
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: t.text, lineHeight: 1.05 }}>
              {fmtHmi(liveForceKgf, 1)}
            </div>
          </div>
          <div style={{ ...cell, borderRight: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
              Live Velocity (mm/s)
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: t.text, lineHeight: 1.05 }}>
              {fmtHmi(liveVelocity, 1)}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${border}`,
          minHeight: 88,
        }}
        >
          {[
            { label: 'Live Mode', value: liveMode != null && liveMode !== '' ? String(liveMode) : '—' },
            { label: 'Live Step', value: stepText },
            { label: 'Recipe', value: recipeNumber != null && recipeNumber !== '' ? String(recipeNumber) : '—' },
          ].map((row, idx, arr) => (
            <div
              key={row.label}
              style={{
                ...cell,
                borderRight: idx === arr.length - 1 ? 'none' : `1px solid ${border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: muted, textAlign: 'center' }}>
                {row.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: t.text }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{
          margin: 12,
          padding: '12px 16px',
          borderRadius: 8,
          background: surface,
          border: `1px solid ${border}`,
          textAlign: 'center',
          fontSize: 18,
          fontWeight: 700,
          color: statusColor,
        }}
        >
          {statusPrompt || statusDisplay || '—'}
          {statusDisplay ? (
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: muted, marginTop: 4 }}>
              {statusDisplay}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function statusCodeHint(statusDisplay, resultReady) {
  if (!statusDisplay) return null;
  return (
    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginTop: 4 }}>
      {resultReady ? 'Pressing Result registers valid' : 'Awaiting Status 4–8 for a new cycle result'}
      {' · '}
      {statusDisplay}
    </span>
  );
}

/**
 * Fallback catalog order for the Servo Press profile only. Other profiles (PLC,
 * Servo Linear Motor, SPM) show the tags configured in Machine Config → Config Tags;
 * borrowing press registers would label a PLC screen with "live force" and "live step".
 */
const DEFAULT_PROFILE_GROUPS = {
  live: [
    'live_position', 'live_force', 'live_velocity', 'status',
    'live_mode', 'total_steps', 'live_step', 'recipe_number',
  ],
  result: [
    'total_amount', 'pass_amount', 'ng_amount',
    'standby_time', 'pressing_time', 'production_time',
    'alarm_code', 'pressing_result',
    'pressed_position', 'pressed_force',
    'pressed_position_step1', 'pressed_position_step2', 'pressed_position_step3',
    'pressed_position_step4', 'pressed_position_step5',
  ],
};

function isTruthyStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'running' || s.includes('run');
}

function buildPreviewTrend() {
  const now = Date.now();
  const pts = [];
  for (let i = 14; i >= 0; i -= 1) {
    const d = new Date(now - i * 60_000);
    const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    pts.push({
      t: label,
      position: null,
      load: null,
      velocity: null,
      pressure: null,
      flow: null,
      tank_level: null,
      temperature: null,
    });
  }
  return pts;
}

function ParamMiniChart({ series, data, t }) {
  const latest = [...(data || [])].reverse().find((p) => p[series.key] != null);
  const latestVal = latest?.[series.key];
  const unit = series.unit || '';
  const dataLen = (data || []).length;
  const gradId = `plcFill-${series.key}`;
  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return undefined;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.floor(r.width));
      const h = Math.max(0, Math.floor(r.height));
      // Ignore collapsed layout frames (Recharts warns on -1 / 0)
      if (w < 8 || h < 8) return;
      setChartSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => apply())
      : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', apply);
    const id = window.requestAnimationFrame(apply);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener('resize', apply);
      if (ro) ro.disconnect();
    };
  }, []);

  const ready = chartSize.w >= 8 && chartSize.h >= 8;

  return (
    <div
      className="plc-live-chart"
      style={{
        minHeight: 120,
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 10px 4px',
        boxSizing: 'border-box',
        borderRight: series.borderRight ? `1px solid ${t.border || '#eef2f7'}` : 'none',
        borderBottom: series.borderBottom ? `1px solid ${t.border || '#eef2f7'}` : 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 2, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.text || '#0f172a' }}>{series.name}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: series.color, lineHeight: 1 }}>
          {latestVal != null ? Number(latestVal).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
          {unit ? <span style={{ fontSize: 11, fontWeight: 600, color: t.textMuted || '#64748b', marginLeft: 3 }}>{unit}</span> : null}
        </div>
      </div>
      <div
        ref={chartRef}
        style={{ flex: 1, minHeight: 96, width: '100%', minWidth: 0, position: 'relative' }}
      >
        {ready ? (
          <LineChart
            width={chartSize.w}
            height={chartSize.h}
            data={data}
            margin={{ top: 8, right: 6, left: 2, bottom: 14 }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border || '#e5e7eb'} />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: t.textMuted || '#64748b' }}
              interval="preserveStartEnd"
              minTickGap={24}
              height={36}
              label={{
                value: 'X: Time',
                position: 'insideBottom',
                offset: -2,
                style: { fontSize: 10, fill: t.textMuted || '#64748b', fontWeight: 600 },
              }}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: t.textMuted || '#64748b' }}
              width={48}
              label={{
                value: unit ? `Y: ${unit}` : `Y: ${series.name}`,
                angle: -90,
                position: 'insideLeft',
                offset: 8,
                style: { fontSize: 10, fill: t.textMuted || '#64748b', fontWeight: 600, textAnchor: 'middle' },
              }}
            />
            <Tooltip
              formatter={(v) => [
                v != null ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}` : '—',
                series.name,
              ]}
              labelFormatter={(lbl) => `Time: ${lbl}`}
            />
            <Area
              type="monotone"
              dataKey={series.key}
              stroke="none"
              fill={`url(#${gradId})`}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stroke={series.color}
              strokeWidth={2.5}
              connectNulls={false}
              isAnimationActive={false}
              dot={(dotProps) => (
                <LiveEndDot {...dotProps} dataLen={dataLen} color={series.color} />
              )}
              activeDot={{ r: 5, stroke: '#fff', strokeWidth: 1 }}
            />
          </LineChart>
        ) : null}
      </div>
    </div>
  );
}

function pctColor(v) {
  const n = Number(v) || 0;
  if (n >= 85) return '#10b981';
  if (n >= 60) return '#f59e0b';
  return '#ef4444';
}

function roundPct(v) {
  return Math.round(Math.min(100, Number(v) || 0));
}

/** OEE from the same capped AR/PR/QR the tiles show, so AR×PR×QR always matches. */
function oeeFromRates(ar, pr, qr) {
  return Math.round(roundPct(ar) * roundPct(pr) * roundPct(qr) / 10000);
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
function shade(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const mix = (channel) => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  };
  const r = mix((num >> 16) & 255);
  const g = mix((num >> 8) & 255);
  const b = mix(num & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Extruded bar: front face plus a lit top face and a shaded right face,
 * so the alarm distribution reads as a 3D column instead of a flat rectangle.
 */
function Bar3D({ x, y, width, height, fill, baseColor, topColor, payload }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return null;
  const depth = Math.max(6, Math.min(16, w * 0.28));
  const left = Number(x) || 0;
  const top = Number(y) || 0;
  const right = left + w;
  const bottom = top + h;
  const solid = payload?.baseColor || baseColor || fill;
  return (
    <g>
      <polygon
        points={`${left},${top} ${left + depth},${top - depth} ${right + depth},${top - depth} ${right},${top}`}
        fill={shade(payload?.topColor || topColor || solid, 0.32)}
      />
      <polygon
        points={`${right},${top} ${right + depth},${top - depth} ${right + depth},${bottom - depth} ${right},${bottom}`}
        fill={shade(solid, -0.3)}
      />
      <rect x={left} y={top} width={w} height={h} fill={fill} />
      <rect x={left} y={top} width={Math.max(1, w * 0.18)} height={h} fill="#ffffff" opacity={0.16} />
    </g>
  );
}

/**
 * Horizontal x-axis tick. Long categories ("Result ready | code 5") wrap onto a
 * second line instead of being tilted, so every label reads straight.
 */
function AxisTick({ x, y, payload, fill }) {
  const text = String(payload?.value ?? '');
  const segments = text.includes('|')
    ? text.split('|').map((part) => part.trim()).filter(Boolean)
    : [text];
  const lines = [];
  for (const segment of segments) {
    let line = '';
    for (const word of segment.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > 14) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return (
    <g transform={`translate(${x},${y})`}>
      {lines.map((line, idx) => (
        <text
          key={`${line}-${idx}`}
          x={0}
          y={0}
          dy={14 + idx * 14}
          textAnchor="middle"
          fontSize={13}
          fill={fill}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** Raised 3D press effect for the sub-screen tabs. */
const TAB3D_CSS = `
.sp-tab3d{transition:transform .08s ease,box-shadow .08s ease;}
.sp-tab3d:hover{transform:translateY(-1px);}
.sp-tab3d:active{transform:translateY(3px);box-shadow:inset 0 2px 4px rgba(2,6,23,0.45);}
.plc-limit-input{
  background:#ffffff !important;
  color:#0f172a !important;
  -webkit-text-fill-color:#0f172a !important;
  caret-color:#0f172a !important;
  border:1px solid #64748b !important;
}
.plc-limit-input::placeholder{color:#64748b !important;-webkit-text-fill-color:#64748b !important;}
.plc-led{
  display:block;
  border-radius:50%;
  position:relative;
  margin:5px auto 0;
}
.plc-led-badge{margin:0;display:block;}
.plc-led::after{
  content:'';
  position:absolute;
  top:14%;
  left:20%;
  width:36%;
  height:26%;
  border-radius:50%;
  background:rgba(255,255,255,0.82);
  pointer-events:none;
}
.plc-led-on{
  background:radial-gradient(circle at 32% 28%, #f0fff0 0%, #86efac 16%, #4ade80 42%, #22c55e 72%, #16a34a 100%);
  box-shadow:
    inset -2px -3px 4px rgba(22,163,74,0.45),
    inset 1px 1px 3px rgba(255,255,255,0.85),
    0 2px 0 #15803d,
    0 4px 8px rgba(0,0,0,0.28),
    0 0 14px rgba(34,197,94,0.95),
    0 0 24px rgba(74,222,128,0.55);
  animation:plc-led-glow 1.5s ease-in-out infinite;
}
.plc-led-off{
  background:radial-gradient(circle at 32% 28%, #fff5f5 0%, #fda4af 16%, #fb7185 42%, #f43f5e 72%, #e11d48 100%);
  box-shadow:
    inset -2px -3px 4px rgba(225,29,72,0.45),
    inset 1px 1px 3px rgba(255,255,255,0.85),
    0 2px 0 #be123c,
    0 4px 8px rgba(0,0,0,0.28),
    0 0 14px rgba(244,63,94,0.9),
    0 0 24px rgba(251,113,133,0.5);
}
.plc-led-unk{
  background:radial-gradient(circle at 32% 30%, #ffffff 0%, #e2e8f0 42%, #94a3b8 100%);
  box-shadow:inset -2px -3px 4px rgba(15,23,42,0.25), 0 2px 3px rgba(0,0,0,0.2);
}
@keyframes plc-led-glow{
  0%,100%{filter:brightness(1);}
  50%{filter:brightness(1.28);}
}
.plc-chart-pulse{
  transform-box:fill-box;
  transform-origin:center;
  animation:plc-ring 1.35s ease-out infinite;
}
@keyframes plc-ring{
  0%{transform:scale(0.55);opacity:0.55;}
  100%{transform:scale(2.1);opacity:0;}
}
.plc-live-chart .recharts-line-curve,
.plc-trend-chart .recharts-line-curve{
  filter:drop-shadow(0 0 3px rgba(59,130,246,0.35));
}
@keyframes plc-warn-blink{
  0%,100%{
    background:#fff7ed;
    border-color:#f59e0b;
    box-shadow:0 0 0 0 rgba(245,158,11,0.55);
    opacity:1;
  }
  50%{
    background:#fecaca;
    border-color:#ef4444;
    box-shadow:0 0 14px 2px rgba(239,68,68,0.55);
    opacity:1;
  }
}
@keyframes plc-warn-badge-blink{
  0%,100%{
    background:#f59e0b;
    color:#1c1917;
    transform:scale(1);
  }
  50%{
    background:#ef4444;
    color:#ffffff;
    transform:scale(1.06);
  }
}
.plc-warn-banner{
  animation:plc-warn-blink 1.1s ease-in-out infinite;
}
.plc-warn-badge{
  display:inline-block;
  animation:plc-warn-badge-blink 1.1s ease-in-out infinite;
}
`;

/** Normalize legacy "Result ready (5)" / "Idle / Standby" into "phase | code N". */
function normalizeStatusLabel(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '—') return '—';
  if (/\|?\s*code\s*\d+/i.test(s) && !/\(\d+\)/.test(s)) return s.replace(/\s*\|\s*/g, ' | ');
  let m = s.match(/result\s*ready\s*(?:\(?\s*(\d+)\s*\)?)?/i);
  if (m) return `Result ready | code ${m[1] || 5}`;
  m = s.match(/idle\s*\/?\s*standby\s*(?:\(?\s*(\d+)\s*\)?)?/i);
  if (m) return `Idle / Standby | code ${m[1] != null ? m[1] : 0}`;
  m = s.match(/pressing\s*(?:\(?\s*(\d+)\s*\)?)?/i);
  if (m) return `Pressing | code ${m[1] || 3}`;
  return s;
}

function bumpCount(map, key, extra = {}) {
  const k = String(key || '—');
  const cur = map.get(k) || { x: k, count: 0, ...extra };
  cur.count += 1;
  map.set(k, cur);
}

/**
 * Alarm type names + handling per Modbus Alarm Code (manufacturer table §9.1, codes 001–012).
 */
const SERVO_PRESS_ALARM_CATALOG = {
  1: {
    message: 'Light Curtain or Safety Signal Alarm',
    handling: '1. Remove any obstructions blocking the light curtain. After resetting, resume the pressing operation.\n2. The safety signal must be under external control. After resetting the safety system, resume the pressing operation.',
  },
  2: {
    message: 'Negative Limit Error',
    handling: 'Initialize the machine after resetting.',
  },
  3: {
    message: 'Positive Limit Error',
    handling: 'Initialize the machine after resetting.',
  },
  4: {
    message: 'Emergency Stop',
    handling: 'Release the emergency stop and initialize the machine after resetting.',
  },
  5: {
    message: 'Overloaded, please check the velocity or abnormal collision',
    handling: 'Reconfirm the pressing parameters to prevent the pressing force from exceeding the limit.',
  },
  6: {
    message: 'Please release ON when switching mode',
    handling: 'Switch off the internal/external control knob after deactivation.',
  },
  7: {
    message: 'Hits workpiece in High-speed section',
    handling: 'When moving to the ready position, the pressure exceeds the machine\'s protection threshold (default is 10% of the maximum pressure):\n1. Check if the pressing parameter [Ready Position] is set appropriately.\n2. Check for any material stacking issues.\n3. Check the mechanism beneath the press load cell for linearity and ensure there is no damping or resistance during vertical movement.',
  },
  8: {
    message: 'Currency overloaded, please check the velocity or abnormal collision',
    handling: 'Motor Current Exceeds 100%:\n1. Reconfirm the pressing parameters to avoid excessive pressing force.\n2. Ensure the motor brake is released.\n3. Check for foreign objects when moving to the working position.\n4. Verify the lower fixture is not too heavy; after an emergency stop or light curtain trigger, inertial force may cause motor overload.',
  },
  9: {
    message: 'Motor Alarm. If reset is not working, please restart the servo press',
    handling: 'Refer to Chapter 9.2 Motor Alarm.',
  },
  10: {
    message: 'Servo Communication Error',
    handling: 'RS485 Communication Interrupted Between Servo and PLC:\n1. Power cycle the system. If the issue persists, contact the distributor.\n2. For electric cylinder types, check whether the wiring between the PLC and the driver is loose or incorrectly connected.',
  },
  11: {
    message: 'Light curtain alarm, please reset then go home',
    handling: 'The light curtain was triggered accidentally. After resetting, the spindle returns to the working origin and waits for the pressing signal again.',
  },
  12: {
    message: 'Two hand buttons released, please reset then go home',
    handling: 'Release the two-hand switch. After resetting, the spindle returns to the working origin and waits for the pressing signal again.',
  },
};

const ALARM_TYPE_LABELS = Object.fromEntries(
  Object.entries(SERVO_PRESS_ALARM_CATALOG).map(([code, row]) => [Number(code), row.message]),
);

function alarmCatalogEntry(code) {
  const n = code != null && code !== '' && !Number.isNaN(Number(code)) ? Number(code) : null;
  if (n == null || n === 0) return null;
  const row = SERVO_PRESS_ALARM_CATALOG[n];
  if (row) {
    return {
      code: n,
      codeLabel: String(n).padStart(3, '0'),
      message: row.message,
      handling: row.handling,
    };
  }
  return {
    code: n,
    codeLabel: String(n).padStart(3, '0'),
    message: `Alarm Code ${String(n).padStart(3, '0')}`,
    handling: null,
  };
}

/**
 * Normalize Pressed Result to OK / NG only.
 * Never show Alarm Code digits (e.g. 4 / 004 Emergency Stop) in the Result cell.
 */
function normalizeHmiResult(pressingResultInfo, statusInfo) {
  const info = pressingResultInfo || {};
  const status = statusInfo || {};
  const label = String(info.label || '').trim();
  const isDigitOnly = /^\d+$/.test(label);
  if (label && label !== '—' && label !== '-' && !isDigitOnly) {
    const upper = label.toUpperCase();
    if (upper === 'OK' || upper.startsWith('OK')) {
      return { label: 'OK', ok: true, reason: info.reason || null };
    }
    if (upper === 'NG' || upper.startsWith('NG')) {
      return { label: 'NG', ok: false, reason: info.reason || null };
    }
    return {
      label,
      ok: info.ok != null ? info.ok : null,
      reason: info.reason || null,
    };
  }
  if (info.ok === true) return { label: 'OK', ok: true, reason: info.reason || null };
  if (info.ok === false) return { label: 'NG', ok: false, reason: info.reason || null };
  if (status.ok === true || Number(status.code) === 4) {
    return { label: 'OK', ok: true, reason: status.prompt || 'Pressing - OK' };
  }
  const sc = Number(status.code);
  if (status.ok === false || (sc >= 5 && sc <= 8)) {
    return {
      label: 'NG',
      ok: false,
      reason: status.prompt || info.reason || null,
    };
  }
  return { label: '—', ok: null, reason: null };
}

/** Pressing result tones: OK is green, NG is pink. */
const RESULT_TONES = {
  OK: { from: '#86efac', to: '#16a34a', baseColor: '#16a34a', topColor: '#4ade80' },
  NG: { from: '#f9a8d4', to: '#db2777', baseColor: '#db2777', topColor: '#f472b6' },
};

/** Distinct bar tones so every bar inside one panel gets its own colour. */
const BAR_TONES = [
  { from: '#fdba74', to: '#ea580c', baseColor: '#ea580c', topColor: '#fdba74' },
  { from: '#fca5a5', to: '#dc2626', baseColor: '#dc2626', topColor: '#fca5a5' },
  { from: '#c4b5fd', to: '#7c3aed', baseColor: '#7c3aed', topColor: '#c4b5fd' },
  { from: '#7dd3fc', to: '#0284c7', baseColor: '#0284c7', topColor: '#7dd3fc' },
  { from: '#fde68a', to: '#d97706', baseColor: '#d97706', topColor: '#fde68a' },
  { from: '#6ee7b7', to: '#059669', baseColor: '#059669', topColor: '#6ee7b7' },
  { from: '#f9a8d4', to: '#db2777', baseColor: '#db2777', topColor: '#f9a8d4' },
  { from: '#cbd5e1', to: '#475569', baseColor: '#475569', topColor: '#cbd5e1' },
];

const AMBER_TONE = { from: '#fde68a', to: '#d97706', baseColor: '#d97706', topColor: '#fde68a' };
const GREEN_TONE = { from: '#6ee7b7', to: '#059669', baseColor: '#059669', topColor: '#6ee7b7' };
const RED_TONE = { from: '#fca5a5', to: '#dc2626', baseColor: '#dc2626', topColor: '#fca5a5' };
const BLUE_TONE = { from: '#7dd3fc', to: '#0284c7', baseColor: '#0284c7', topColor: '#7dd3fc' };
const SLATE_TONE = { from: '#cbd5e1', to: '#475569', baseColor: '#475569', topColor: '#cbd5e1' };

/** raised = amber, cleared = green. */
function eventTone(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'raised' || n === 'active') return AMBER_TONE;
  if (n === 'cleared') return GREEN_TONE;
  return SLATE_TONE;
}

/** Status* tone follows the PMS status palette (alarm red, pressing green, idle amber). */
function statusTone(label) {
  const n = String(label || '').toLowerCase();
  if (n.includes('alarm')) return RED_TONE;
  if (n.includes('pressing')) return GREEN_TONE;
  if (n.includes('result')) return BLUE_TONE;
  if (n.includes('idle') || n.includes('standby')) return AMBER_TONE;
  return SLATE_TONE;
}

/** Human alarm type for one Alarm Code, e.g. "Emergency Stop (004)". */
function alarmTypeLabel(code, eventLabel) {
  const cat = alarmCatalogEntry(code);
  if (cat) return `${cat.message} (${cat.codeLabel})`;
  const raw = String(eventLabel || '').trim();
  const generic = !raw || /^no alarm$/i.test(raw) || /^alarm(\s*code)?\s*\d*$/i.test(raw);
  const codeLabel = code != null ? String(code).padStart(3, '0') : '?';
  return generic ? `Code ${codeLabel}` : `${raw} (${codeLabel})`;
}

/**
 * Alarm distribution for chart:
 *  - Alarm type: one bar per distinct Alarm Code, counting how often that issue occurred
 *  - Event (raised / cleared)
 *  - Status* phase|code (e.g. Result ready | code 5)
 *  - Pressing result (OK / NG)
 */
function buildAlarmDistribution(alarms) {
  const byCode = new Map();
  const byEvent = new Map();
  const byStatus = new Map();
  const byResult = new Map();
  let raised = 0;
  let cleared = 0;

  for (const a of alarms || []) {
    const codeRaw = a.event_id || a.code;
    const codeNum = codeRaw != null && codeRaw !== '' && !Number.isNaN(Number(codeRaw))
      ? Number(codeRaw)
      : null;
    const event = String(a.event || '').toLowerCase() || 'unknown';
    const status = normalizeStatusLabel(a.status);
    const resultRaw = String(a.pressing_result || '').trim();
    // Result is OK/NG only — never map Alarm Code digits into the result chart
    const result = /^(ok|pass|1|4)$/i.test(resultRaw)
      ? 'OK'
      : /^(ng|fail|nok|2|[5-8])$/i.test(resultRaw)
        ? 'NG'
        : (/^\d+$/.test(resultRaw) || !resultRaw ? '—' : resultRaw);

    if (a.kind === 'plc_threshold' || (typeof codeRaw === 'string' && String(codeRaw).startsWith('EVT-'))) {
      const key = a.label || a.tag_key || String(codeRaw);
      const cur = byCode.get(key)
        || { x: key, kind: 'code', code: codeRaw, count: 0, raised: 0, cleared: 0, events: 0 };
      cur.events += 1;
      if (event === 'raised' || event === 'active') cur.raised += 1;
      if (event === 'cleared') cur.cleared += 1;
      cur.count = cur.raised || cur.events;
      byCode.set(key, cur);
    } else if (codeNum != null && Number.isFinite(codeNum) && codeNum !== 0) {
      const key = alarmTypeLabel(codeNum, a.label);
      const cur = byCode.get(key)
        || { x: key, kind: 'code', code: codeNum, count: 0, raised: 0, cleared: 0, events: 0 };
      cur.events += 1;
      if (event === 'raised' || event === 'active') cur.raised += 1;
      if (event === 'cleared') cur.cleared += 1;
      // How many times the issue occurred (a raise + its clear is one occurrence).
      cur.count = cur.raised || cur.events;
      byCode.set(key, cur);
    }
    bumpCount(byEvent, event, { kind: 'event', ...eventTone(event) });
    bumpCount(byStatus, status, { kind: 'status', ...statusTone(status) });
    bumpCount(byResult, result, { kind: 'result', ...(RESULT_TONES[result] || SLATE_TONE) });

    if (event === 'raised' || event === 'active') raised += 1;
    if (event === 'cleared') cleared += 1;
  }

  const sortDesc = (arr) => arr.sort((a, b) => b.count - a.count || String(a.x).localeCompare(String(b.x)));
  const toneByIndex = (arr) => arr.map((row, i) => ({ ...BAR_TONES[i % BAR_TONES.length], ...row }));
  return {
    byCode: toneByIndex(sortDesc([...byCode.values()])),
    byEvent: sortDesc([...byEvent.values()]),
    byStatus: sortDesc([...byStatus.values()]),
    byResult: sortDesc([...byResult.values()]),
    totals: {
      events: (alarms || []).length,
      raised,
      cleared,
      codes: byCode.size,
      statuses: byStatus.size,
    },
  };
}

const AR_COLOR = '#4fc3f7';
const PR_COLOR = '#fb7185';
const QR_COLOR = '#34d399';

function StatTile({ icon, iconSrc, label, value, unit, accent, t, large, centered }) {
  const valueFs = large ? (centered ? 44 : 40) : 25;
  const unitFs = large ? 22 : 15;
  const labelFs = large ? (centered ? 20 : 18) : 15;
  const iconBox = large ? (centered ? 64 : 56) : 44;
  const iconFs = large ? 28 : 23;
  return (
    <div style={{
      background: t.surface || '#fff',
      border: `1px solid ${t.border || '#e5e7eb'}`,
      borderRadius: 12,
      padding: large ? (centered ? '18px 16px' : '16px 18px') : '12px 14px',
      display: 'flex',
      flexDirection: centered ? 'column' : 'row',
      alignItems: 'center',
      justifyContent: centered ? 'center' : 'flex-start',
      textAlign: centered ? 'center' : 'left',
      gap: large ? (centered ? 10 : 14) : 12,
      minHeight: large ? (centered ? 120 : 96) : 72,
      height: '100%',
      boxSizing: 'border-box',
    }}
    >
      <div style={{
        width: iconBox,
        height: iconBox,
        borderRadius: 10,
        background: centered ? 'transparent' : `${accent}18`,
        color: accent,
        display: 'grid',
        placeItems: 'center',
        fontSize: iconFs,
        flexShrink: 0,
        overflow: 'hidden',
      }}
      >
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            style={{
              width: centered ? '100%' : '85%',
              height: centered ? '100%' : '85%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        ) : icon}
      </div>
      <div style={{ minWidth: 0, width: centered ? '100%' : undefined }}>
        <div style={{ fontSize: labelFs, color: t.textMuted || '#64748b', fontWeight: 700 }}>{label}</div>
        <div style={{
          fontSize: valueFs,
          fontWeight: 800,
          color: t.text,
          lineHeight: 1.15,
          marginTop: centered ? 4 : 0,
        }}
        >
          {value ?? '—'}
          {unit ? <span style={{ fontSize: unitFs, fontWeight: 600, marginLeft: 6, color: t.textMuted }}>{unit}</span> : null}
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, value, ok, t, large, compact }) {
  // Neutral values use the theme text colour — muted slate is hard to read on light panels.
  const valueColor = ok === true ? '#16a34a' : ok === false ? '#dc2626' : (t.text || '#0f172a');
  const labelColor = t.text || '#0f172a';
  const fs = large ? 20 : (compact ? 17 : 16);
  const valFs = large ? 23 : (compact ? 19 : 16);
  const pad = large ? '12px 0' : (compact ? '8px 0' : '12px 0');
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: pad,
      borderBottom: `1px solid ${t.border || '#e5e7eb'}`,
      flex: compact && !large ? '0 0 auto' : '1 1 0',
      minHeight: 0,
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 10 }}>
        <span style={{
          width: large ? 12 : (compact ? 11 : 12),
          height: large ? 12 : (compact ? 11 : 12),
          borderRadius: '50%',
          background: ok == null ? (t.accent || '#3b82f6') : valueColor,
          boxShadow: ok == null ? 'none' : `0 0 8px ${valueColor}88`,
          flexShrink: 0,
        }}
        />
        <span style={{ fontSize: fs, fontWeight: 700, color: labelColor }}>{label}</span>
      </div>
      <span style={{ fontSize: valFs, fontWeight: 800, color: valueColor }}>{value ?? '—'}</span>
    </div>
  );
}

export default function ServoPressEquipmentView({
  detail,
  theme: t,
  onNavigateLine,
}) {
  const [tab, setTab] = useState('overview');
  const [oeeOpen, setOeeOpen] = useState(false);
  const [trendSeries, setTrendSeries] = useState('all');
  const [thresholdDraft, setThresholdDraft] = useState(emptyThresholdDraft);
  const [thresholdEditing, setThresholdEditing] = useState(false);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdMsg, setThresholdMsg] = useState('');
  const [emailBanner, setEmailBanner] = useState(null);
  const [selectedAlarm, setSelectedAlarm] = useState(null);
  const activeTab = (tab === 'production' || tab === 'parameters') ? 'overview' : tab;
  const info = detail?.equipment_info || {};
  const machine = detail?.machine || {};
  const plan = detail?.plan || {};
  // PLC / Servo Linear Motor / SPM machines share this screen, so the title follows the type
  const machineTypeLabel = String(machine.machine_type || info.type || 'Servo Press').trim() || 'Servo Press';
  const kpiPanel = detail?.kpi_panel; // classic PMS KPI (unchanged formulas)
  const servoOee = detail?.servo_oee; // dedicated Servo Press Modbus OEE
  const tel = detail?.telemetry || {};
  const telOk = Boolean(tel.available);
  const profile = tel.profile || {};
  const isServoPressProfile = (profile.id || 'servo_press') === 'servo_press';
  const isPlcProfile = (profile.id || '') === 'generic_plc'
    || String(machine.machine_type || info.type || '').trim().toUpperCase() === 'PLC';
  const isSpmProfile = (profile.id || '') === 'spm'
    || String(machine.machine_type || info.type || '').trim().toUpperCase() === 'SPM';
  // Servo Press screen uses servo_oee; SPM Screw Driver prefers modbus_kpi from Result counters
  const activeKpiPanel = isSpmProfile
    ? (tel.modbus_kpi || servoOee || kpiPanel)
    : (servoOee || kpiPanel);
  const k = activeKpiPanel?.kpi || {};
  const kpiSource = servoOee
    ? 'servo_press'
    : (activeKpiPanel?.source === 'modbus' ? 'modbus' : 'pms');

  const statusInfo = tel.status || {};
  const resultReady = Boolean(statusInfo.result_ready || tel.result_ready);
  const statusDisplay = statusInfo.display
    || (statusInfo.phase_label && statusInfo.code != null
      ? `${statusInfo.phase_label} | code ${statusInfo.code}`
      : statusInfo.label)
    || null;

  // Prefer Modbus phase for badge when telemetry is live; fall back to PMS status
  const modbusPhase = String(statusInfo.phase || '').toLowerCase();
  const statusCode = statusInfo.code != null ? Number(statusInfo.code) : null;
  const alarmScaled = tel.scaled?.alarm_code;
  const alarmActive = alarmScaled != null && Number(alarmScaled) !== 0;
  const statusPrompt = statusInfo.prompt || statusDisplay;
  let displayStatusKey = info.status_key || info.status || 'idle';
  let displayStatusLabel = info.status || '—';
  if (telOk && (statusInfo.phase || statusInfo.code != null || alarmActive)) {
    if (alarmActive) {
      displayStatusKey = 'alarm';
      const alarmCat = alarmCatalogEntry(alarmScaled);
      displayStatusLabel = alarmCat
        ? `Alarm ${alarmCat.codeLabel} · ${alarmCat.message}`
        : `Alarm | code ${Number(alarmScaled)}`;
    } else if (statusInfo.ok === false || (statusCode != null && statusCode >= 5 && statusCode <= 8)) {
      displayStatusKey = 'alarm';
      displayStatusLabel = statusDisplay || statusInfo.label || 'NG';
    } else if (modbusPhase === 'pressing') {
      displayStatusKey = 'running';
      displayStatusLabel = statusDisplay || 'Pressing';
    } else if (modbusPhase === 'result') {
      displayStatusKey = 'running';
      displayStatusLabel = statusDisplay || 'Pressing - OK';
    } else if (modbusPhase === 'idle') {
      displayStatusKey = 'idle';
      displayStatusLabel = statusDisplay || statusInfo.label || 'Waiting';
    } else if (statusDisplay) {
      displayStatusLabel = statusDisplay;
    }
  }
  const running = isTruthyStatus(displayStatusKey);

  const oeeDisp = (k.ar != null || k.pr != null || k.qr != null)
    ? oeeFromRates(k.ar, k.pr, k.qr)
    : roundPct(k.oee);
  const hasOee = activeKpiPanel != null && (k.oee != null || k.ar != null);
  const alarms = useMemo(
    () => ((telOk && Array.isArray(tel.alarms)) ? tel.alarms : []),
    [telOk, tel.alarms],
  );
  const historyRows = useMemo(
    () => ((telOk && Array.isArray(tel.history)) ? tel.history : []),
    [telOk, tel.history],
  );
  const alarmDist = useMemo(() => buildAlarmDistribution(alarms), [alarms]);
  const alarmTypeTotals = alarmDist.totals;
  const alarmsTableRows = useMemo(() => alarms.slice(0, 40), [alarms]);

  // Overview Production tiles follow device Modbus Total/Pass/NG (same as Pressing Result /
  // HMI). SPM Screw Driver: total = good + reject from Result OK/NG edge counts.
  // Shift-delta counters stay on the OEE panel (servo_oee / shift_production).
  const sdLive = (telOk && tel.screw_driver && typeof tel.screw_driver === 'object')
    ? tel.screw_driver
    : null;
  const production = {
    total: sdLive?.total_count != null
      ? sdLive.total_count
      : (telOk && tel.production?.total != null
        ? tel.production.total
        : (telOk && tel.scaled?.total_amount != null
          ? tel.scaled.total_amount
          : (servoOee?.actual_qty != null
            ? servoOee.actual_qty
            : (kpiPanel?.actual_qty ?? plan.actual_qty ?? null)))),
    good: sdLive?.good_count != null
      ? sdLive.good_count
      : (telOk && tel.production?.good != null
        ? tel.production.good
        : (telOk && tel.scaled?.pass_amount != null
          ? tel.scaled.pass_amount
          : (servoOee?.good_qty != null
            ? servoOee.good_qty
            : (kpiPanel?.good_qty ?? null)))),
    reject: sdLive?.reject_count != null
      ? sdLive.reject_count
      : (telOk && tel.production?.reject != null
        ? tel.production.reject
        : (telOk && tel.scaled?.ng_amount != null
          ? tel.scaled.ng_amount
          : (servoOee?.defect_qty != null
            ? servoOee.defect_qty
            : (kpiPanel?.defect_qty ?? null)))),
  };

  // OK / NG bars follow the same device counters as the Production tiles.
  // Counting the alarm event log here would over-report NG.
  const goodQty = Number(production.good) || 0;
  const rejectQty = Number(production.reject) || 0;
  const qualityResultData = [
    { x: 'OK', count: goodQty, kind: 'result', ...RESULT_TONES.OK },
    { x: 'NG', count: rejectQty, kind: 'result', ...RESULT_TONES.NG },
  ].sort((a, b) => b.count - a.count);
  const hasQualityData = goodQty > 0 || rejectQty > 0;

  // The backend names these rows from the machine's own catalog; the press list is only
  // used for Servo Press when it sends nothing at all. Hide PLC Status here — it is not a Machine Status row.
  const ioStatusRaw = (Array.isArray(tel.io_status) && tel.io_status.length)
    ? tel.io_status
    : (isServoPressProfile
      ? [
        { label: 'Press Status', value: null, ok: null },
        { label: 'Live Mode', value: null, ok: null },
        { label: 'Live Step', value: null, ok: null },
        { label: 'Pressing Result', value: null, ok: null },
        { label: 'Alarm', value: running ? 'No Alarm' : null, ok: running ? true : null },
      ]
      : isSpmProfile
        ? [
          { label: 'Torque', value: null, ok: null },
          { label: 'Position', value: null, ok: null },
          { label: 'Result', value: null, ok: null },
          { label: 'Device Type', value: null, ok: null },
        ]
        : []);
  const ioStatus = ioStatusRaw
    .filter((row) => String(row.label || '').trim().toLowerCase() !== 'plc status')
    .map((row) => {
      if (!isSpmProfile) return row;
      const label = String(row.label || '').trim().toLowerCase();
      if (label === 'torque') {
        const raw = tel.scaled?.torque ?? sdLive?.torque ?? row.value;
        const nm = fmtScrewTorqueNm(raw);
        return { ...row, value: nm != null ? `${nm} Nm` : row.value };
      }
      if (label === 'position') {
        const raw = tel.scaled?.position_value ?? sdLive?.position_value ?? row.value;
        const deg = fmtScrewPositionDeg(raw);
        return { ...row, value: deg != null ? `${deg} °` : row.value };
      }
      return row;
    });

  const pressingResultInfo = tel.pressing_result || {};
  // Prefer live Edge Pressed Pos / Force from this snapshot (scaled → raw → param row)
  const hmiPressedPos = (() => {
    const scaled = tel.scaled || {};
    const raw = tel.raw || {};
    if (scaled.pressed_position != null && scaled.pressed_position !== '') {
      return scaled.pressed_position;
    }
    if (raw.pressed_position != null && raw.pressed_position !== '') {
      return raw.pressed_position;
    }
    const fromRow = (tel.param_rows || []).find((r) => r.key === 'pressed_position');
    if (fromRow?.scaled != null && fromRow.scaled !== '') return fromRow.scaled;
    return scaled.pressed_position_step2 ?? scaled.pressed_position_step1 ?? null;
  })();
  const hmiPressedForce = (() => {
    const scaled = tel.scaled || {};
    const raw = tel.raw || {};
    if (scaled.pressed_force != null && scaled.pressed_force !== '') {
      return scaled.pressed_force;
    }
    if (raw.pressed_force != null && raw.pressed_force !== '') {
      return raw.pressed_force;
    }
    const fromRow = (tel.param_rows || []).find((r) => r.key === 'pressed_force');
    if (fromRow?.scaled != null && fromRow.scaled !== '') return fromRow.scaled;
    return null;
  })();
  const hmiResultNorm = normalizeHmiResult(pressingResultInfo, statusInfo);
  const hmiResultLabel = hmiResultNorm.label;
  const hmiResultOk = hmiResultNorm.ok;
  const hmiResultReason = hmiResultNorm.reason;
  const hmiStepPositions = [1, 2, 3, 4, 5].map((step) => {
    const key = `pressed_position_step${step}`;
    const scaled = tel.scaled || {};
    const raw = tel.raw || {};
    let val = null;
    if (scaled[key] != null && scaled[key] !== '') val = scaled[key];
    else if (raw[key] != null && raw[key] !== '') val = raw[key];
    else {
      const fromRow = (tel.param_rows || []).find((r) => r.key === key);
      if (fromRow?.scaled != null && fromRow.scaled !== '') val = fromRow.scaled;
    }
    return { step, mm: hmiPositionMm(val) };
  });
  const hmiLivePosition = hmiPositionMm(
    tel.scaled?.live_position ?? tel.raw?.live_position ?? tel.current?.position_mm ?? null,
  );
  const hmiLiveForce = hmiForceKgf(
    tel.scaled?.live_force ?? tel.raw?.live_force ?? tel.current?.force_kgf ?? null,
  );
  const hmiLiveVelocity = (() => {
    const v = tel.scaled?.live_velocity ?? tel.raw?.live_velocity ?? tel.current?.velocity_mm_s ?? null;
    if (v == null || v === '') return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return Math.abs(n) >= 500 ? n * 0.001 : n;
  })();

  const current = {
    position_mm: tel.current?.position_mm ?? null,
    force_kgf: tel.current?.force_kgf ?? null,
    velocity_mm_s: tel.current?.velocity_mm_s ?? null,
    cycle_time_sec: tel.current?.cycle_time_sec
      ?? plan.cycle_time_sec
      ?? detail?.live_cycle?.live_cycle_sec
      ?? null,
  };

  const trendData = useMemo(() => {
    if (telOk && Array.isArray(tel.trend) && tel.trend.length) {
      return tel.trend.map((p) => ({
        t: p.t,
        position: p.position,
        load: p.load,
        velocity: p.velocity,
        pressure: p.pressure,
        flow: p.flow,
        tank_level: p.tank_level,
        temperature: p.temperature,
        // SPM: Edge torque is milli-Nm → chart in Nm
        torque: p.torque == null || p.torque === '' ? p.torque : (Number(p.torque) / 1000),
        screw_position: p.screw_position,
      }));
    }
    return buildPreviewTrend();
  }, [telOk, tel.trend, machine.id]);

  const sdTorqueRaw = tel.scaled?.torque ?? sdLive?.torque ?? null;
  const sdPositionRaw = tel.scaled?.position_value ?? sdLive?.position_value ?? null;
  const sdTorqueNm = fmtScrewTorqueNm(sdTorqueRaw);
  const sdPositionDeg = fmtScrewPositionDeg(sdPositionRaw);
  const rateItems = [
    { label: 'Availability Rate', value: k.ar, color: AR_COLOR, icon: '⏱' },
    { label: 'Performance Rate', value: k.pr, color: PR_COLOR, icon: '⚡' },
    { label: 'Quality Rate', value: k.qr, color: QR_COLOR, icon: '✅' },
    { label: 'Machine Utilization', value: k.machine_utilization, color: '#818cf8', icon: '⚙' },
    { label: 'Production Yield', value: k.production_yield, color: '#34d399', icon: '📈' },
    { label: 'TEEP', value: k.teep, color: '#fb923c', icon: '📊' },
  ];

  const oeeStatRows = [
    ['Available Time', `${activeKpiPanel?.available_time_min ?? 0} min`],
    ['Uptime (Running)', `${activeKpiPanel?.uptime_min ?? activeKpiPanel?.machining_time_min ?? 0} min`],
    ['Operating Time', `${activeKpiPanel?.operating_time_min ?? 0} min`],
    ['Downtime', `${activeKpiPanel?.downtime_min ?? 0} min`],
    ['MTTR', activeKpiPanel?.mttr_min != null ? `${activeKpiPanel.mttr_min} min` : '—'],
    ['MTBF', activeKpiPanel?.mtbf_min != null ? `${activeKpiPanel.mtbf_min} min` : '—'],
    ['Actual Production Time', `${activeKpiPanel?.actual_production_time_min ?? 0} min`],
    ['Planned Qty', activeKpiPanel?.planned_qty ?? plan.planned_qty ?? 0],
    ['Expected Qty', activeKpiPanel?.expected_qty ?? 0],
    ['Actual Qty', activeKpiPanel?.actual_qty ?? plan.actual_qty ?? 0],
    ['Good Qty', activeKpiPanel?.good_qty ?? 0],
    ['Defect Qty', activeKpiPanel?.defect_qty ?? 0],
    ['Theoretical Qty', activeKpiPanel?.theoretical_qty ?? 0],
  ];

  const shiftLabel = activeKpiPanel?.shift_name
    || detail?.hourly_output?.shift_name
    || (activeKpiPanel?.shift ? `Shift ${activeKpiPanel.shift}` : null);
  const shiftWindow = activeKpiPanel?.shift_start && activeKpiPanel?.shift_end
    ? `(${activeKpiPanel.shift_start} – ${activeKpiPanel.shift_end})`
    : detail?.hourly_output?.shift_start && detail?.hourly_output?.shift_end
      ? `(${detail.hourly_output.shift_start} – ${detail.hourly_output.shift_end})`
      : '';

  const recipeLabel = tel.scaled?.recipe_number != null
    ? `Recipe ${tel.scaled.recipe_number}`
    : (plan.program || plan.part_name || null);

  const modbusParamRows = useMemo(
    () => ((telOk && Array.isArray(tel.param_rows)) ? tel.param_rows : []),
    [telOk, tel.param_rows],
  );

  const thresholdBreaches = useMemo(
    () => ((telOk && tel.threshold_breaches && typeof tel.threshold_breaches === 'object')
      ? tel.threshold_breaches
      : {}),
    [telOk, tel.threshold_breaches],
  );

  useEffect(() => {
    if (!isPlcProfile) return;
    if (thresholdEditing) return;
    setThresholdDraft(draftFromThresholds(tel.thresholds));
  }, [isPlcProfile, tel.thresholds, thresholdEditing]);

  // Show email send/fail status under the dashboard header for 30 seconds
  const emailKeyRef = useRef('');
  useEffect(() => {
    if (!isPlcProfile) return undefined;
    const status = tel.email_alert_status;
    if (!status || typeof status !== 'object' || !status.status) return undefined;
    const key = `${status.sent_at || ''}|${status.status || ''}|${(status.event_ids || []).join(',')}`;
    if (emailKeyRef.current === key) return undefined;
    emailKeyRef.current = key;
    setEmailBanner({ ...status, _key: key });
    const id = window.setTimeout(() => {
      setEmailBanner((prev) => (prev && prev._key === key ? null : prev));
    }, 30000);
    return () => window.clearTimeout(id);
  }, [isPlcProfile, tel.email_alert_status]);

  const savePlcThresholds = async () => {
    const machineId = machine.id;
    if (!machineId) return;
    setThresholdSaving(true);
    setThresholdMsg('');
    try {
      const payload = {};
      for (const { key } of PLC_THRESHOLD_TAGS) {
        const row = thresholdDraft[key] || {};
        const lsl = row.lsl === '' || row.lsl == null ? null : Number(row.lsl);
        const usl = row.usl === '' || row.usl == null ? null : Number(row.usl);
        payload[key] = {
          lsl: Number.isFinite(lsl) ? lsl : null,
          usl: Number.isFinite(usl) ? usl : null,
          enabled: row.enabled !== false,
        };
      }
      const res = await api.put(`/api/machines/${machineId}/telemetry/thresholds`, {
        thresholds: payload,
      });
      const next = res?.data?.thresholds || payload;
      setThresholdDraft(draftFromThresholds(next));
      setThresholdEditing(false);
      setThresholdMsg('Thresholds saved — breaches raise alarms with event id & time');
    } catch (e) {
      setThresholdMsg(e.response?.data?.detail || e.message || 'Failed to save thresholds');
    } finally {
      setThresholdSaving(false);
    }
  };

  /** Dynamic groups from the machine's configured tags (not hardcoded keys). */
  const profileKeys = useMemo(() => {
    const regs = tel.registers || {};
    const live = [];
    const result = [];
    const other = [];
    Object.entries(regs).forEach(([key, meta]) => {
      const g = meta?.group;
      if (g === 'result') result.push(key);
      else if (g === 'live') live.push(key);
      // Tags left as "other" (or with no group) are read on the live screen
      else other.push(key);
    });
    const liveKeys = [...live, ...other];
    // Press registers are a sensible fallback only for the press itself
    if (!isServoPressProfile) return { live: liveKeys, result };
    return {
      live: liveKeys.length ? liveKeys : DEFAULT_PROFILE_GROUPS.live,
      result: result.length ? result : DEFAULT_PROFILE_GROUPS.result,
    };
  }, [tel.registers, isServoPressProfile]);

  /** Screen names come from the profile, so a PLC does not read "Pressing Result". */
  const findScreen = (groupId) => (profile.screens || []).find((sc) => (sc.group || sc.id) === groupId);
  const screenLabel = (groupId, fallback) => findScreen(groupId)?.label || fallback;
  const screenRule = (groupId) => findScreen(groupId)?.rule || '';
  const liveScreenLabel = screenLabel('live', 'Live Status');
  const resultScreenLabel = screenLabel('result', 'Pressing Result');
  const subNav = SUB_NAV.map((item) => {
    if (item.id === 'overview' && isPlcProfile) return { ...item, label: 'Overview' };
    if (item.id === 'live') return { ...item, label: isPlcProfile ? 'Live Tags' : liveScreenLabel };
    if (item.id === 'result') return { ...item, label: resultScreenLabel };
    return item;
  }).filter((item) => {
    // PLC Machine Dashboard — no Servo Press Result / OEE tabs
    if (!isPlcProfile) return true;
    return item.id !== 'result';
  });
  const rowsForGroup = (groupKeys, groupName) => {
    const byKey = Object.fromEntries(
      (modbusParamRows || []).filter((r) => r.key).map((r) => [r.key, r]),
    );
    const fromProfile = groupKeys.map((key) => byKey[key] || {
      key,
      label: (tel.registers?.[key]?.item) || key.replace(/_/g, ' '),
      value: '—',
      modbus: tel.registers?.[key]?.modbus || '—',
      eip_pn: tel.registers?.[key]?.eip_pn || '—',
      type: tel.registers?.[key]?.type || '—',
      unit: tel.registers?.[key]?.unit || '—',
      note: tel.registers?.[key]?.note || '',
      group: groupName,
    });
    // Also surface unmapped PLC tags for this group / other
    const extras = (modbusParamRows || []).filter(
      (r) => !r.key || (!groupKeys.includes(r.key) && (r.group === groupName || (groupName === 'live' && r.group === 'other'))),
    );
    const seen = new Set(fromProfile.map((r) => r.key || r.label));
    for (const row of extras) {
      const id = row.key || row.label;
      if (seen.has(id)) continue;
      seen.add(id);
      fromProfile.push(row);
    }
    return fromProfile;
  };

  const liveStatusRows = useMemo(
    () => rowsForGroup(profileKeys.live, 'live'),
    [modbusParamRows, profileKeys.live, tel.registers],
  );

  const pressingResultRows = useMemo(
    () => rowsForGroup(profileKeys.result, 'result'),
    [modbusParamRows, profileKeys.result, tel.registers],
  );

  // Compact side list on Production Overview — the machine's own configured tags.
  // PLC Status / DI / DO belong in Machine Status, not this Parameters strip.
  const overviewLiveRows = liveStatusRows.filter((r) => {
    const key = String(r.key || '').toLowerCase();
    const label = String(r.label || '').trim().toLowerCase();
    return !OVERVIEW_PARAM_EXCLUDE.has(key) && !OVERVIEW_PARAM_EXCLUDE_LABELS.has(label);
  });
  const paramRows = [
    ...overviewLiveRows.slice(0, 8).map((r) => ({
      label: r.label,
      value: r.key === 'status' ? (statusDisplay || '—') : r.value,
      title: r.note,
    })),
    ...(overviewLiveRows.length ? [] : [{
      label: 'No tags configured',
      value: 'Machine Config → Config Tags',
      title: `Add ${liveScreenLabel} tags for ${machineTypeLabel}`,
    }]),
    ...(isPlcProfile ? [] : [{ label: 'OEE', value: hasOee ? `${oeeDisp}%` : '—' }]),
  ];

  const plcChartSeries = useMemo(() => {
    const regs = tel.registers || {};
    return PLC_PARAM_CHARTS.map((sr, idx) => {
      const meta = regs[sr.key] || {};
      return {
        ...sr,
        name: meta.item || sr.name,
        unit: meta.unit || '',
        borderRight: idx % 2 === 0,
        borderBottom: idx < 2,
      };
    });
  }, [tel.registers]);

  const img = info.image_url ? assetUrl(info.image_url) : null;
  const statusColor = (
    displayStatusKey === 'alarm' || displayStatusKey === 'breakdown'
      ? '#ef4444'
      : (displayStatusKey === 'idle' || String(displayStatusKey).toLowerCase() === 'idle')
        ? '#f59e0b'
        : (info.status_color || (running ? '#22c55e' : '#f59e0b'))
  );

  // SPM_AH_PLC page only: Machine Overview Status from plcStatus (1=Master, 2=Slave)
  const plcRoleFromTelemetry = (() => {
    if (!isPlcProfile) return null;
    const raw = tel.scaled?.plc_status;
    if (raw == null || raw === '') return null;
    const code = Number(raw);
    if (code === 1) return { label: 'PLC 1 Master', color: '#22c55e' };
    if (code === 2) return { label: 'PLC 2 Master', color: '#fde047' }; // yellow
    return { label: `PLC Status ${code}`, color: '#f59e0b' };
  })();
  const plcOverviewStatusLabel = plcRoleFromTelemetry?.label || displayStatusLabel;
  const plcOverviewStatusColor = plcRoleFromTelemetry?.color || statusColor;

  const card = {
    background: t.surface || '#fff',
    border: `1px solid ${t.border || '#e2e8f0'}`,
    borderRadius: 14,
    boxShadow: t.isDark ? 'none' : '0 1px 3px rgba(15,23,42,0.06)',
  };

  /**
   * Trend series are strictly family-scoped:
   *   Servo Press  → position / force / velocity
   *   SPM          → torque / screw_position
   *   Linear/other → only registers present in that machine's Config Tags catalog
   * Never mix SPM torque series onto a press, or press force onto a screwdriver.
   */
  const trendDefs = useMemo(() => {
    const regs = tel.registers || {};
    const PRESS_KEYS = new Set(['position', 'load', 'velocity']);
    const SPM_KEYS = new Set(['torque', 'screw_position']);
    return TREND_SERIES.filter((sr) => {
      if (isServoPressProfile) return PRESS_KEYS.has(sr.key);
      if (isSpmProfile) {
        return SPM_KEYS.has(sr.key) && Boolean(regs[TREND_REGISTER_BY_SERIES[sr.key]]);
      }
      if (SPM_KEYS.has(sr.key)) return false;
      return Boolean(regs[TREND_REGISTER_BY_SERIES[sr.key]]);
    }).map((sr) => {
      const meta = regs[TREND_REGISTER_BY_SERIES[sr.key]];
      if (!meta?.item) return sr;
      const unit = meta.unit || sr.unit;
      return { ...sr, name: `${meta.item}${unit ? ` (${unit})` : ''}`, unit };
    });
  }, [tel.registers, isServoPressProfile, isSpmProfile]);

  const visibleTrend = trendDefs.filter((sr) => trendSeries === 'all' || trendSeries === sr.key);
  const leftTrend = visibleTrend.filter((sr) => sr.axis === 'left');
  const rightTrend = visibleTrend.filter((sr) => sr.axis === 'right');
  const leftAxisLabel = leftTrend.map((sr) => sr.unit).join(' / ');
  const trendNames = trendDefs.map((sr) => sr.name).join(' / ');

  /** Current Values follows the catalog: press motion tiles, or the machine's own tags. */
  const currentTiles = (Array.isArray(tel.current_tiles) && tel.current_tiles.length)
    ? tel.current_tiles
    : null;
  const showPressCurrentTiles = isServoPressProfile && !currentTiles;
  // Screw Driver tiles only on SPM profile — never infer from stray scaled keys on other families
  const showScrewDriverTiles = isSpmProfile && !currentTiles && !showPressCurrentTiles;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 0,
      flex: '0 0 auto',
    }}
    >
      <style>{TAB3D_CSS}</style>
      <div style={{
        ...card,
        padding: 0,
        background: t.headerBg || t.sidebarBg || '#1e293b',
        color: '#fff',
        border: 'none',
        overflow: 'hidden',
      }}
      >
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{machineTypeLabel}</div>
              <div style={{ fontSize: 14, opacity: 0.8 }}>Machine Dashboard</div>
            </div>
          </div>

          <div style={{
            flex: '1 1 auto',
            display: 'flex',
            justifyContent: 'center',
          }}
          >
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: `${(isPlcProfile ? plcOverviewStatusColor : statusColor)}22`,
              border: `1px solid ${isPlcProfile ? plcOverviewStatusColor : statusColor}`,
              color: isPlcProfile ? plcOverviewStatusColor : statusColor,
              borderRadius: 999,
              padding: '8px 16px',
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: 0.5,
              whiteSpace: 'nowrap',
            }}
            >
              <span style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isPlcProfile ? plcOverviewStatusColor : statusColor,
                boxShadow: `0 0 10px ${isPlcProfile ? plcOverviewStatusColor : statusColor}`,
              }}
              />
              {(isPlcProfile ? plcOverviewStatusLabel : displayStatusLabel || '—').toUpperCase()}
            </div>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
          }}
          >
            <nav style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
            >
              {subNav.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="sp-tab3d"
                    onClick={() => setTab(item.id)}
                    style={{
                      border: `1px solid ${active ? shade(t.accent || '#3b82f6', -0.2) : 'rgba(255,255,255,0.22)'}`,
                      cursor: 'pointer',
                      borderRadius: 12,
                      padding: '8px 14px',
                      background: active
                        ? `linear-gradient(180deg, ${shade(t.accent || '#3b82f6', 0.28)} 0%, ${t.accent || '#3b82f6'} 55%, ${shade(t.accent || '#3b82f6', -0.18)} 100%)`
                        : 'linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 55%, rgba(2,6,23,0.18) 100%)',
                      color: active ? '#fff' : (t.sidebarText || '#cbd5e1'),
                      boxShadow: active
                        ? `inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 0 ${shade(t.accent || '#3b82f6', -0.45)}, 0 7px 12px rgba(2,6,23,0.45)`
                        : 'inset 0 1px 0 rgba(255,255,255,0.28), 0 4px 0 rgba(2,6,23,0.55), 0 6px 10px rgba(2,6,23,0.35)',
                      textShadow: '0 1px 1px rgba(2,6,23,0.45)',
                      fontSize: 14,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div style={{ fontSize: 14, opacity: 0.85, textAlign: 'right' }}>
              <div>
                Line:{' '}
                {detail?.line ? (
                  <button
                    type="button"
                    onClick={() => onNavigateLine?.(detail.line.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#93c5fd',
                      cursor: 'pointer',
                      fontWeight: 700,
                      padding: 0,
                    }}
                  >
                    {detail.line.name}
                  </button>
                ) : '—'}
              </div>
              <div>Device: {info.name || machine.name || '—'}</div>
            </div>
          </div>
        </div>

      </div>

      {isPlcProfile && Object.keys(thresholdBreaches).length > 0 && (
        <div
          role="status"
          className="plc-warn-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid #f59e0b',
            background: '#fff7ed',
            color: '#9a3412',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          <span
            className="plc-warn-badge"
            style={{
              flexShrink: 0,
              background: '#f59e0b',
              color: '#1c1917',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
            }}
          >
            WARNING
          </span>
          <span>
            {Object.values(thresholdBreaches).map((br) => {
              const side = br.side === 'high' ? 'above USL' : 'below LSL';
              const limit = br.side === 'high' ? br.usl : br.lsl;
              const unit = br.unit ? ` ${br.unit}` : '';
              return `${br.label || br.tag_key} ${br.value}${unit} ${side}${limit != null ? ` (${limit})` : ''}`;
            }).join('  ·  ')}
          </span>
        </div>
      )}

      {isPlcProfile && emailBanner && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 10,
            border: `1px solid ${emailBanner.status === 'sent' ? '#22c55e' : '#ef4444'}`,
            background: emailBanner.status === 'sent' ? '#f0fdf4' : '#fef2f2',
            color: emailBanner.status === 'sent' ? '#166534' : '#991b1b',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <span style={{
            flexShrink: 0,
            background: emailBanner.status === 'sent' ? '#22c55e' : '#ef4444',
            color: '#fff',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.4,
          }}
          >
            {emailBanner.status === 'sent' ? 'EMAIL SENT' : 'EMAIL FAILED'}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            {emailBanner.message
              || (emailBanner.status === 'sent'
                ? `Deviation alert sent from ${emailBanner.from_email || 'learncode612000@gmail.com'}`
                : 'Deviation alert email was not sent')}
            {emailBanner.sent_at ? ` · ${emailBanner.sent_at}` : ''}
            {' · auto-hides in 30s'}
          </span>
          <button
            type="button"
            aria-label="Dismiss email status"
            onClick={() => setEmailBanner(null)}
            style={{
              flexShrink: 0,
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 6,
              opacity: 0.85,
            }}
          >
            ×
          </button>
        </div>
      )}

      {activeTab === 'overview' && isPlcProfile && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)',
          gap: 12,
          alignItems: 'start',
          width: '100%',
        }}
        >
          {/* Left: Machine Overview on top, Parameters below — narrower column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, maxWidth: 260 }}>
            <section style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: t.text || '#0f172a', flexShrink: 0 }}>Machine Overview</div>
              <div style={{
                flex: '0 0 auto',
                height: 'clamp(100px, 14vh, 140px)',
                borderRadius: 12,
                border: `2px solid ${statusColor}`,
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                marginBottom: 8,
                padding: 8,
                boxSizing: 'border-box',
              }}
              >
                {img ? (
                  <img
                    src={img}
                    alt={info.name || 'PLC'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      objectPosition: 'center',
                      display: 'block',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 40, opacity: 0.35, color: '#64748b' }}>⚙</span>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  {[
                    ['Machine Name', info.name || machine.name],
                    ['Model', [info.make, info.model].filter(Boolean).join(' ') || info.model],
                    ['Line', detail?.line?.name],
                    ['Device ID', info.name || machine.name],
                    ['Status', plcOverviewStatusLabel],
                    ['Current Program', recipeLabel],
                    ['Operator', info.operator_name || info.operator_code || '—'],
                    ['Type', info.type],
                  ].map(([rowK, v]) => (
                    <tr key={rowK} style={{ borderTop: `1px solid ${t.border || '#e5e7eb'}` }}>
                      <td style={{ padding: '5px 0', color: t.textMuted || '#64748b', fontWeight: 600, width: '44%' }}>{rowK}</td>
                      <td style={{ padding: '5px 0', color: t.text || '#0f172a', fontWeight: 700 }}>
                        {rowK === 'Status' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: plcOverviewStatusColor }} />
                            {v || '—'}
                          </span>
                        ) : (v || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              flex: '0 0 auto',
              maxHeight: thresholdEditing ? 420 : 320,
            }}
            >
              <div style={{
                padding: '8px 12px',
                borderBottom: `1px solid ${t.border || '#e5e7eb'}`,
                fontSize: 17,
                fontWeight: 800,
                color: t.text || '#0f172a',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
              >
                <span>Parameters</span>
                {isPlcProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setThresholdEditing((v) => !v);
                      setThresholdMsg('');
                      if (thresholdEditing) {
                        setThresholdDraft(draftFromThresholds(tel.thresholds));
                      }
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 8,
                      border: `1px solid ${t.border || '#cbd5e1'}`,
                      background: thresholdEditing ? '#eff6ff' : (t.surface2 || '#f8fafc'),
                      color: '#1d4ed8',
                      cursor: 'pointer',
                    }}
                  >
                    {thresholdEditing ? 'Cancel' : 'Set Limits'}
                  </button>
                )}
              </div>
              <div style={{
                overflow: 'auto',
                maxHeight: thresholdEditing ? 380 : 280,
              }}
              >
                {isPlcProfile ? (
                  <>
                    {PLC_THRESHOLD_TAGS.map((tag, idx) => {
                      const scaledVal = tel.scaled?.[tag.key];
                      const display = scaledVal != null && scaledVal !== ''
                        ? `${scaledVal} ${tag.unit}`
                        : '—';
                      const thr = (tel.thresholds && tel.thresholds[tag.key]) || {};
                      const breach = thresholdBreaches[tag.key];
                      const draft = thresholdDraft[tag.key] || { lsl: '', usl: '', enabled: true };
                      const valueColor = breach
                        ? '#ef4444'
                        : (t.text || '#0f172a');
                      return (
                        <div
                          key={tag.key}
                          style={{
                            padding: '8px 12px',
                            borderBottom: idx < PLC_THRESHOLD_TAGS.length - 1
                              ? `1px solid ${t.border || '#eef2f7'}`
                              : 'none',
                            background: breach ? 'rgba(239,68,68,0.08)' : 'transparent',
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            fontSize: 14,
                            lineHeight: 1.2,
                          }}
                          >
                            <span style={{ color: t.textMuted || '#64748b', fontWeight: 700, flexShrink: 0 }}>
                              {tag.label}
                            </span>
                            <span
                              style={{
                                color: valueColor,
                                fontWeight: 800,
                                textAlign: 'right',
                              }}
                              title={breach
                                ? `${breach.side === 'high' ? 'Above USL' : 'Below LSL'}: ${breach.value}`
                                : display}
                            >
                              {display}
                              {breach ? (
                                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700 }}>
                                  {breach.side === 'high' ? '↑ USL' : '↓ LSL'}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          {thresholdEditing ? (
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr auto',
                              gap: 6,
                              marginTop: 6,
                              alignItems: 'center',
                            }}
                            >
                              <label style={{ fontSize: 11, color: t.textMuted, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                LSL ({tag.unit})
                                <input
                                  className="plc-limit-input"
                                  type="number"
                                  step="any"
                                  value={draft.lsl}
                                  onChange={(e) => setThresholdDraft((prev) => ({
                                    ...prev,
                                    [tag.key]: { ...prev[tag.key], lsl: e.target.value },
                                  }))}
                                  style={{
                                    padding: '4px 6px',
                                    borderRadius: 6,
                                    border: '1px solid #94a3b8',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    caretColor: '#0f172a',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    width: '100%',
                                    boxSizing: 'border-box',
                                  }}
                                />
                              </label>
                              <label style={{ fontSize: 11, color: t.textMuted, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                USL ({tag.unit})
                                <input
                                  className="plc-limit-input"
                                  type="number"
                                  step="any"
                                  value={draft.usl}
                                  onChange={(e) => setThresholdDraft((prev) => ({
                                    ...prev,
                                    [tag.key]: { ...prev[tag.key], usl: e.target.value },
                                  }))}
                                  style={{
                                    padding: '4px 6px',
                                    borderRadius: 6,
                                    border: '1px solid #94a3b8',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    caretColor: '#0f172a',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    width: '100%',
                                    boxSizing: 'border-box',
                                  }}
                                />
                              </label>
                              <label style={{
                                fontSize: 11,
                                color: t.textMuted,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                marginTop: 14,
                                whiteSpace: 'nowrap',
                              }}
                              >
                                <input
                                  type="checkbox"
                                  checked={draft.enabled !== false}
                                  onChange={(e) => setThresholdDraft((prev) => ({
                                    ...prev,
                                    [tag.key]: { ...prev[tag.key], enabled: e.target.checked },
                                  }))}
                                />
                                On
                              </label>
                            </div>
                          ) : (
                            <div style={{
                              marginTop: 3,
                              fontSize: 11,
                              color: t.textMuted || '#64748b',
                              fontWeight: 600,
                            }}
                            >
                              LSL {thr.lsl != null ? thr.lsl : '—'}
                              {' · '}
                              USL {thr.usl != null ? thr.usl : '—'}
                              {thr.enabled === false ? ' · off' : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {thresholdEditing && (
                      <div style={{
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        borderTop: `1px solid ${t.border || '#eef2f7'}`,
                      }}
                      >
                        <button
                          type="button"
                          disabled={thresholdSaving}
                          onClick={savePlcThresholds}
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: 'none',
                            background: '#2563eb',
                            color: '#fff',
                            cursor: thresholdSaving ? 'wait' : 'pointer',
                            opacity: thresholdSaving ? 0.7 : 1,
                          }}
                        >
                          {thresholdSaving ? 'Saving…' : 'Save Limits'}
                        </button>
                        {thresholdMsg ? (
                          <span style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: thresholdMsg.startsWith('Thresholds saved') ? '#16a34a' : '#dc2626',
                          }}
                          >
                            {thresholdMsg}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: t.textMuted }}>
                            Breach raises alarm with event id + time
                          </span>
                        )}
                      </div>
                    )}
                    {!thresholdEditing && thresholdMsg ? (
                      <div style={{
                        padding: '6px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: thresholdMsg.startsWith('Thresholds saved') ? '#16a34a' : '#dc2626',
                      }}
                      >
                        {thresholdMsg}
                      </div>
                    ) : null}
                  </>
                ) : (
                  paramRows.map((row, idx) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 12px',
                        borderBottom: idx < paramRows.length - 1
                          ? `1px solid ${t.border || '#eef2f7'}`
                          : 'none',
                        fontSize: 14,
                        lineHeight: 1.2,
                      }}
                    >
                      <span style={{ color: t.textMuted || '#64748b', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          color: t.text || '#0f172a',
                          fontWeight: 800,
                          textAlign: 'right',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                        title={String(row.title || row.value || '')}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          {/* Right: Machine Status (larger) + Live Parameters auto-fits remaining space */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
            height: 'clamp(420px, calc(100vh - 148px), 100vh)',
            maxHeight: 'calc(100vh - 132px)',
            boxSizing: 'border-box',
          }}
          >
            <section style={{
              ...card,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              flex: '0 0 auto',
              boxSizing: 'border-box',
            }}
            >
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, color: t.text || '#0f172a' }}>Machine Status</div>
              <div style={{ fontSize: 13, color: t.textMuted || '#475569', marginBottom: 10, fontWeight: 600 }}>
                {telOk
                  ? `Modbus live · ${tel.updated_at || 'just now'}`
                  : 'Awaiting Node-RED Modbus readings'}
              </div>
              {isPlcProfile ? (
                <DigitalIoStatusPanel digitalIo={tel.digital_io} t={t} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {ioStatus.length ? ioStatus.map((row) => (
                    <StatusRow key={row.label} label={row.label} value={row.value} ok={row.ok} t={t} compact />
                  )) : (
                    <div style={{ padding: '6px 0', color: t.textMuted || '#64748b', fontSize: 14 }}>No status tags configured</div>
                  )}
                </div>
              )}
            </section>

            <section style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              flex: '1 1 auto',
              minHeight: 'clamp(160px, 28vh, 420px)',
            }}
            >
              <div style={{
                padding: '8px 14px',
                borderBottom: `1px solid ${t.border || '#e5e7eb'}`,
                fontSize: 16,
                fontWeight: 800,
                color: t.text || '#0f172a',
                flexShrink: 0,
              }}
              >
                Live Parameters
              </div>
              <div style={{
                flex: 1,
                minHeight: 'clamp(140px, 24vh, 360px)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: 0,
                overflow: 'hidden',
              }}
              >
                {plcChartSeries.map((sr) => (
                  <ParamMiniChart key={sr.key} series={sr} data={trendData} t={t} />
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === 'overview' && !isPlcProfile && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
            alignItems: 'stretch',
          }}
          >
            <section style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: t.text, flexShrink: 0 }}>Machine Overview</div>
              <div style={{
                flex: '0 0 auto',
                height: 'clamp(160px, 28vh, 220px)',
                borderRadius: 12,
                border: `2px solid ${statusColor}`,
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                marginBottom: 8,
                padding: isSpmProfile ? 0 : 10,
                boxSizing: 'border-box',
              }}
              >
                {isSpmProfile ? (
                  <ScrewDriver3D
                    positionValue={sdPositionRaw}
                    torque={sdTorqueNm}
                    runningStatus={tel.scaled?.running_status ?? sdLive?.running_status}
                    resultLabel={
                      (tel.pressing_result && tel.pressing_result.label)
                      || sdLive?.result_label
                      || null
                    }
                    resultOk={
                      tel.pressing_result?.ok != null
                        ? tel.pressing_result.ok
                        : sdLive?.result_ok
                    }
                    height={210}
                  />
                ) : img ? (
                  <img
                    src={img}
                    alt={info.name || 'Servo Press'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      objectPosition: 'center',
                      display: 'block',
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 48, opacity: 0.35, color: '#64748b' }}>⚙</span>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 17, flex: 1 }}>
                <tbody>
                  {[
                    ['Machine Name', info.name || machine.name],
                    ['Model', [info.make, info.model].filter(Boolean).join(' ') || info.model],
                    ['Line', detail?.line?.name],
                    ['Device ID', info.name || machine.name],
                    ['Status', displayStatusLabel],
                    ['Current Program', recipeLabel],
                    ['Operator', info.operator_name || info.operator_code || '—'],
                    ['Type', info.type],
                  ].map(([rowK, v]) => (
                    <tr key={rowK} style={{ borderTop: `1px solid ${t.border || '#e5e7eb'}` }}>
                      <td style={{ padding: '7px 0', color: t.textMuted, fontWeight: 600, width: '42%' }}>{rowK}</td>
                      <td style={{ padding: '7px 0', color: t.text, fontWeight: 700 }}>
                        {rowK === 'Status' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                            {v || '—'}
                          </span>
                        ) : (v || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 380,
            }}
            >
              <div style={{
                padding: '10px 12px',
                borderBottom: `1px solid ${t.border || '#e5e7eb'}`,
                fontSize: 20,
                fontWeight: 800,
                color: t.text,
                flexShrink: 0,
              }}
              >
                Production
              </div>
              <div style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: '1fr 1fr',
                gap: 0,
                overflow: 'hidden',
              }}
              >
                {[
                  { label: 'Total Count', value: production.total, unit: 'pcs', accent: '#3b82f6' },
                  { label: 'Good Count', value: production.good, unit: 'pcs', accent: '#22c55e' },
                  { label: 'Reject Count', value: production.reject, unit: 'pcs', accent: '#ef4444' },
                ].map((row, idx) => (
                  <div
                    key={row.label}
                    style={{
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: 12,
                      borderRight: idx % 2 === 0 ? `1px solid ${t.border || '#eef2f7'}` : 'none',
                      borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 700, color: t.textMuted, textAlign: 'center' }}>
                      {row.label}
                    </div>
                    <div style={{ fontSize: 52, fontWeight: 800, color: row.accent, lineHeight: 1.05, textAlign: 'center' }}>
                      {row.value ?? '—'}
                      <span style={{ fontSize: 22, fontWeight: 600, color: t.textMuted, marginLeft: 4 }}>
                        {row.unit}
                      </span>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setOeeOpen(true)}
                  title="Open Overall Equipment Effectiveness"
                  style={{
                    minHeight: 0,
                    border: 'none',
                    background: t.surface2 || t.surface || '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: 12,
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <svg width="96" height="96" viewBox="0 0 64 64" aria-hidden>
                    <circle cx="32" cy="32" r="24" fill="none" stroke={t.border || '#e2e8f0'} strokeWidth="6" />
                    <circle
                      cx="32"
                      cy="32"
                      r="24"
                      fill="none"
                      stroke={pctColor(oeeDisp)}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${(oeeDisp / 100) * 150.8} 150.8`}
                      transform="rotate(-90 32 32)"
                    />
                    <text x="32" y="38" textAnchor="middle" fontSize="18" fontWeight="800" fill={t.text}>
                      {hasOee ? `${oeeDisp}%` : '—'}
                    </text>
                  </svg>
                  <div style={{ fontSize: 22, fontWeight: 700, color: t.textMuted }}>OEE</div>
                  <div style={{ fontSize: 42, fontWeight: 800, color: pctColor(oeeDisp), lineHeight: 1.05 }}>
                    {hasOee ? `${oeeDisp}%` : '—'}
                  </div>
                  <div style={{ fontSize: 16, color: t.accent || '#38bdf8', fontWeight: 700 }}>
                    Click for details
                  </div>
                </button>
              </div>
            </section>

            <section style={{
              ...card,
              padding: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
            }}
            >
              <div style={{
                padding: '10px 12px',
                borderBottom: `1px solid ${t.border || '#e5e7eb'}`,
                fontSize: 20,
                fontWeight: 800,
                color: t.text,
                flexShrink: 0,
              }}
              >
                {isSpmProfile ? 'Current Values' : 'Parameters'}
              </div>
              {isSpmProfile ? (
                <div style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'center',
                  gap: 14,
                  padding: 14,
                  boxSizing: 'border-box',
                }}
                >
                  <StatTile
                    iconSrc={screwDriverTorqueIcon}
                    label="Torque"
                    value={sdTorqueNm}
                    unit="Nm"
                    accent="#f59e0b"
                    t={t}
                    large
                    centered
                  />
                  <StatTile
                    icon="↕"
                    label="Position in degree"
                    value={sdPositionDeg}
                    unit="°"
                    accent="#3b82f6"
                    t={t}
                    large
                    centered
                  />
                </div>
              ) : (
                <div style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
                >
                  {paramRows.map((row, idx) => (
                    <div
                      key={row.label}
                      style={{
                        flex: '1 1 0',
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '0 12px',
                        borderBottom: idx < paramRows.length - 1
                          ? `1px solid ${t.border || '#eef2f7'}`
                          : 'none',
                        fontSize: 17,
                        lineHeight: 1.2,
                      }}
                    >
                      <span style={{
                        color: t.textMuted,
                        fontWeight: 700,
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                      >
                        {row.label}
                      </span>
                      <span style={{
                        color: t.text,
                        fontWeight: 800,
                        textAlign: 'right',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                      title={String(row.title || row.value || '')}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'overview' && !isPlcProfile && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isSpmProfile
              ? 'minmax(0, 1.35fr) minmax(280px, 1fr)'
              : 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 12,
            alignItems: 'stretch',
            ...(isSpmProfile ? {
              height: 'clamp(260px, calc(100vh - 520px), 420px)',
              minHeight: 260,
            } : {}),
          }}
          >
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              minWidth: 0,
              minHeight: 0,
              height: isSpmProfile ? '100%' : undefined,
            }}
            >
              <section style={{
                ...card,
                padding: isSpmProfile ? 12 : 14,
                minHeight: isSpmProfile ? 0 : 260,
                flex: isSpmProfile ? '1 1 auto' : undefined,
                height: isSpmProfile ? '100%' : undefined,
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: isSpmProfile ? 4 : 8,
                  flexWrap: 'wrap',
                  flexShrink: 0,
                }}
                >
                  <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>Live Trend</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(trendDefs.length > 1
                      ? [{ key: 'all', name: 'All Parameters', color: t.accent || '#3b82f6' }, ...trendDefs]
                      : trendDefs
                    ).map((sr) => {
                      const active = trendSeries === sr.key;
                      return (
                        <button
                          key={sr.key}
                          type="button"
                          onClick={() => setTrendSeries(sr.key)}
                          title={sr.key === 'all' ? 'Show every parameter' : `Show only ${sr.name}`}
                          style={{
                            cursor: 'pointer',
                            borderRadius: 999,
                            padding: isSpmProfile ? '4px 10px' : '6px 12px',
                            fontSize: isSpmProfile ? 12 : 14,
                            fontWeight: 700,
                            border: `1px solid ${active ? sr.color : (t.border || '#e2e8f0')}`,
                            background: active ? `${sr.color}1f` : 'transparent',
                            color: active ? sr.color : (t.textMuted || '#64748b'),
                          }}
                        >
                          {sr.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {!isSpmProfile && (
                <div style={{ fontSize: 14, color: t.textMuted, marginBottom: 6, flexShrink: 0 }}>
                  {trendDefs.length === 0
                    ? `${machineTypeLabel} has no trend tags — map Torque / Position (or live position, force, velocity) in Machine Config → ⚙ Config Tags to chart it`
                    : telOk
                      ? 'Pick a parameter (or a legend entry) to show it alone · Velocity uses the right axis'
                      : `${trendNames} — waiting for Modbus feed`}
                </div>
                )}
                {trendDefs.length === 0 ? (
                  <div style={{
                    flex: isSpmProfile ? 1 : undefined,
                    height: isSpmProfile ? undefined : 200,
                    minHeight: isSpmProfile ? 0 : 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    border: `1px dashed ${t.border || '#e2e8f0'}`,
                    color: t.textMuted,
                    fontSize: 14,
                    textAlign: 'center',
                    padding: 12,
                  }}
                  >
                    The {liveScreenLabel} table below carries this machine&apos;s live values
                  </div>
                ) : (
                <div
                  className="plc-trend-chart"
                  style={{
                    width: '100%',
                    flex: isSpmProfile ? '1 1 auto' : undefined,
                    height: isSpmProfile ? undefined : 240,
                    minWidth: 0,
                    minHeight: isSpmProfile ? 0 : 240,
                    position: 'relative',
                  }}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    debounce={50}
                  >
                    <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={t.border || '#e5e7eb'} />
                      <XAxis dataKey="t" tick={{ fontSize: 12, fill: t.textMuted }} />
                      {leftTrend.length > 0 && (
                        <YAxis
                          yAxisId="left"
                          domain={['auto', 'auto']}
                          tick={{ fontSize: 12, fill: t.textMuted }}
                          label={{ value: leftAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: t.textMuted } }}
                        />
                      )}
                      {rightTrend.length > 0 && (
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={['auto', 'auto']}
                          tick={{ fontSize: 12, fill: '#16a34a' }}
                          label={{ value: 'mm/s', angle: 90, position: 'insideRight', style: { fontSize: 12, fill: '#16a34a' } }}
                        />
                      )}
                      <Tooltip />
                      <Legend
                        wrapperStyle={{ fontSize: 13, cursor: 'pointer' }}
                        onClick={(entry) => {
                          const hit = trendDefs.find((sr) => sr.name === entry?.value);
                          setTrendSeries((prev) => (hit && prev !== hit.key ? hit.key : 'all'));
                        }}
                      />
                      {visibleTrend.map((sr) => (
                        <Line
                          key={sr.key}
                          yAxisId={sr.axis}
                          type="monotone"
                          dataKey={sr.key}
                          name={sr.name}
                          stroke={sr.color}
                          strokeWidth={3.5}
                          connectNulls={false}
                          isAnimationActive
                          animationDuration={1200}
                          animationEasing="ease-out"
                          dot={(dotProps) => (
                            <LiveEndDot {...dotProps} dataLen={trendData.length} color={sr.color} />
                          )}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 1 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                )}
              </section>

              {!isSpmProfile && (
              <section style={{ ...card, padding: 14 }}>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10, color: t.text }}>Current Values</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                  {currentTiles ? currentTiles.map((tile) => (
                    <StatTile
                      key={tile.key || tile.label}
                      icon={tile.key === 'torque' ? '⚖' : tile.key === 'position_value' ? '↕' : tile.key === 'pressing_result' ? '◎' : '◎'}
                      label={tile.label}
                      value={tile.value}
                      unit={tile.unit || ''}
                      accent={tile.accent || '#3b82f6'}
                      t={t}
                    />
                  )) : showPressCurrentTiles ? (
                    <>
                      <StatTile
                        icon="↕"
                        label="Position"
                        value={current.position_mm != null ? Number(current.position_mm).toFixed(3) : null}
                        unit="mm"
                        accent="#3b82f6"
                        t={t}
                      />
                      <StatTile
                        icon="⚖"
                        label="Force"
                        value={current.force_kgf != null ? Number(current.force_kgf).toFixed(1) : null}
                        unit="kgf"
                        accent="#f59e0b"
                        t={t}
                      />
                      <StatTile
                        icon="⇢"
                        label="Velocity"
                        value={current.velocity_mm_s != null ? Number(current.velocity_mm_s).toFixed(3) : null}
                        unit="mm/s"
                        accent="#22c55e"
                        t={t}
                      />
                      <StatTile
                        icon="⏱"
                        label="Cycle Time"
                        value={current.cycle_time_sec != null ? Number(current.cycle_time_sec).toFixed(2) : null}
                        unit="sec"
                        accent="#8b5cf6"
                        t={t}
                      />
                    </>
                  ) : (
                    <>
                      <StatTile
                        icon="↕"
                        label="Position"
                        value={current.position_mm != null ? Number(current.position_mm).toFixed(3) : null}
                        unit="mm"
                        accent="#3b82f6"
                        t={t}
                      />
                      <StatTile
                        icon="⚖"
                        label="Force"
                        value={current.force_kgf != null ? Number(current.force_kgf).toFixed(1) : null}
                        unit="kgf"
                        accent="#f59e0b"
                        t={t}
                      />
                      <StatTile
                        icon="⇢"
                        label="Velocity"
                        value={current.velocity_mm_s != null ? Number(current.velocity_mm_s).toFixed(3) : null}
                        unit="mm/s"
                        accent="#22c55e"
                        t={t}
                      />
                      <StatTile
                        icon="⏱"
                        label="Cycle Time"
                        value={current.cycle_time_sec != null ? Number(current.cycle_time_sec).toFixed(2) : null}
                        unit="sec"
                        accent="#8b5cf6"
                        t={t}
                      />
                    </>
                  )}
                </div>
              </section>
              )}
            </div>

            <section style={{
              ...card,
              padding: isSpmProfile ? 12 : 14,
              height: '100%',
              minHeight: 0,
              overflow: isSpmProfile ? 'hidden' : undefined,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
            >
              <div style={{ fontSize: isSpmProfile ? 20 : 17, fontWeight: 800, marginBottom: 6, color: t.text, flexShrink: 0 }}>Machine Status</div>
              <div style={{ fontSize: isSpmProfile ? 15 : 14, color: t.textMuted, marginBottom: 4, flexShrink: 0 }}>
                {telOk
                  ? `Modbus live · ${tel.updated_at || 'just now'}`
                  : `Awaiting Node-RED Modbus readings (${ioStatus.map((r) => r.label).join(' / ') || 'no status tags configured'})`}
              </div>
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: isSpmProfile ? 'auto' : undefined,
              }}
              >
                {ioStatus.map((row) => (
                  <StatusRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    ok={row.ok}
                    t={t}
                    large={isSpmProfile}
                    compact={isSpmProfile}
                  />
                ))}
              </div>
            </section>
          </div>
        )}        {(activeTab === 'live' || activeTab === 'result') && (
          <section style={{
            ...card,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
          }}
          >
            <div style={{
              padding: '10px 14px',
              fontWeight: 800,
              borderBottom: `1px solid ${t.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
            >
              <span>{activeTab === 'live' ? liveScreenLabel : resultScreenLabel}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: t.textMuted }}>
                {activeTab === 'live'
                  ? `${profile.label || 'Modbus §8.4.2'} · readable anytime`
                  : (!isServoPressProfile
                    ? (profile.label || 'Configured tags')
                    : (resultReady
                      ? `Cycle result · ${statusDisplay}`
                      : `${statusPrompt || statusDisplay}`))}
              </span>
            </div>
            {!(isServoPressProfile && (activeTab === 'result' || activeTab === 'live')) && (
            <div style={{
              padding: '8px 14px',
              fontSize: 14,
              color: t.textMuted,
              borderBottom: `1px solid ${t.border || '#eef2f7'}`,
              flexShrink: 0,
              lineHeight: 1.45,
            }}
            >
              {!isServoPressProfile ? (
                <>
                  {screenRule(activeTab === 'live' ? 'live' : 'result')}
                  {' Parameters and addresses come from '}
                  <b style={{ color: t.text }}>Machine Config → Config Tags</b>
                  {` (${profile.label || 'this machine type'}), so editing a tag there changes this table.`}
                </>
              ) : (
                <>
                  Live Status registers (position, force, velocity, Status*, mode, steps, recipe) can be read at any time.
                  {' '}
                  <b style={{ color: t.text }}>Status*</b>
                  {': 0 Not Activated · 1 Activating · 2 Waiting · 3 Pressing · 4 OK · 5–8 NG (force/position limits).'}
                </>
              )}
            </div>
            )}
            {isServoPressProfile && (activeTab === 'result' || activeTab === 'live') ? (
              <div style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}>
                {activeTab === 'result' ? (
                  <PressingResultHmi
                    production={production}
                    stepPositions={hmiStepPositions}
                    pressedPositionMm={hmiPositionMm(hmiPressedPos)}
                    pressedForceKgf={hmiForceKgf(hmiPressedForce)}
                    standbySec={tel.scaled?.standby_time}
                    pressingSec={tel.scaled?.pressing_time}
                    productionSec={tel.scaled?.production_time}
                    resultLabel={hmiResultLabel}
                    resultOk={hmiResultOk}
                    resultReason={hmiResultReason}
                    statusPrompt={statusPrompt}
                    statusDisplay={statusDisplay}
                    resultReady={resultReady}
                    t={t}
                  />
                ) : (
                  <LiveStatusHmi
                    production={production}
                    livePositionMm={hmiLivePosition}
                    liveForceKgf={hmiLiveForce}
                    liveVelocity={hmiLiveVelocity}
                    liveMode={tel.scaled?.live_mode}
                    liveStep={tel.scaled?.live_step}
                    totalSteps={tel.scaled?.total_steps}
                    recipeNumber={tel.scaled?.recipe_number}
                    statusPrompt={statusPrompt}
                    statusDisplay={statusDisplay}
                    statusOk={statusInfo.ok}
                    t={t}
                  />
                )}
                <div style={{
                  padding: '8px 14px 12px',
                  borderTop: `1px solid ${t.border || '#eef2f7'}`,
                  maxHeight: '36vh',
                  overflow: 'auto',
                }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted, marginBottom: 8 }}>
                    Register detail
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead style={{ position: 'sticky', top: 0, background: t.surface2 || t.surface || '#f8fafc', zIndex: 1 }}>
                      <tr style={{ textAlign: 'left' }}>
                        {['Item', 'Value', 'Modbus', 'EIP/PN', 'Type', 'Unit', 'Note'].map((h) => (
                          <th key={h} style={{ padding: '6px 10px', color: t.textMuted, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(activeTab === 'live' ? liveStatusRows : pressingResultRows).map((row) => (
                        <tr
                          key={row.key || row.label}
                          style={{
                            borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                            opacity: activeTab === 'result' && !resultReady && row.value !== '—' ? 0.75 : 1,
                          }}
                        >
                          <td style={{ padding: '6px 10px', fontWeight: 700, color: t.text }}>{row.label}</td>
                          <td style={{
                            padding: '6px 10px',
                            fontWeight: 800,
                            color: row.key === 'status' ? (t.accent || '#38bdf8') : t.text,
                            whiteSpace: 'nowrap',
                          }}
                          >
                            {row.key === 'status' ? (statusDisplay || row.value || '—') : (row.value ?? '—')}
                          </td>
                          <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{row.modbus || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{row.eip_pn || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{row.type || '—'}</td>
                          <td style={{ padding: '6px 10px' }}>{row.unit || '—'}</td>
                          <td style={{ padding: '6px 10px', color: t.textMuted, fontSize: 13 }}>{row.note || '—'}</td>
                        </tr>
                      ))}
                      {!(activeTab === 'live' ? liveStatusRows : pressingResultRows).length && (
                        <tr>
                          <td colSpan={7} style={{ padding: '14px 10px', color: t.textMuted, fontSize: 14 }}>
                            No tags configured for this group. Add them in Machine Config → Config Tags.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
            <div style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0, maxHeight: '60vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                <thead style={{ position: 'sticky', top: 0, background: t.surface2 || t.surface || '#f8fafc', zIndex: 1 }}>
                  <tr style={{ textAlign: 'left' }}>
                    {['Item', 'Value', 'Modbus', 'EIP/PN', 'Type', 'Unit', 'Note'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', color: t.textMuted, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(activeTab === 'live' ? liveStatusRows : pressingResultRows).map((row) => (
                    <tr
                      key={row.key || row.label}
                      style={{
                        borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                        opacity: activeTab === 'result' && !resultReady && row.value !== '—' ? 0.75 : 1,
                      }}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: t.text }}>{row.label}</td>
                      <td style={{
                        padding: '10px 12px',
                        fontWeight: 800,
                        color: row.key === 'status' ? (t.accent || '#38bdf8') : t.text,
                        whiteSpace: 'nowrap',
                      }}
                      >
                        {row.key === 'status' ? statusDisplay : (row.value ?? '—')}
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>{row.modbus || '—'}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 14 }}>{row.eip_pn || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{row.type || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>{row.unit || '—'}</td>
                      <td style={{ padding: '10px 12px', color: t.textMuted, fontSize: 14 }}>{row.note || '—'}</td>
                    </tr>
                  ))}
                  {!(activeTab === 'live' ? liveStatusRows : pressingResultRows).length && (
                    <tr>
                      <td colSpan={7} style={{ padding: '18px 12px', color: t.textMuted, fontSize: 15 }}>
                        No tags configured for
                        {' '}
                        <b style={{ color: t.text }}>{machineTypeLabel}</b>
                        {' in this group. Add them in Machine Config → ⚙ Config Tags '}
                        {`(screen group "${activeTab === 'live' ? liveScreenLabel : resultScreenLabel}").`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </section>
        )}

        {(activeTab === 'alarms' || activeTab === 'history') && (
          <section style={{
            ...card,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
          }}
          >
            <div style={{
              padding: '10px 14px',
              fontWeight: 800,
              borderBottom: `1px solid ${t.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}
            >
              <span>{activeTab === 'alarms' ? 'Alarms' : 'History'}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: t.textMuted }}>
                {activeTab === 'alarms'
                  ? (isPlcProfile
                    ? `${alarms.length} event${alarms.length === 1 ? '' : 's'} · Threshold LSL/USL breaches`
                    : `${alarms.length} event${alarms.length === 1 ? '' : 's'} · Modbus Alarm Code`)
                  : isPlcProfile
                    ? `${historyRows.length} sample${historyRows.length === 1 ? '' : 's'} · Pressure / Flow / Tank / Temperature`
                    : `${historyRows.length} snapshot${historyRows.length === 1 ? '' : 's'} · status / production`}
              </span>
            </div>
            {activeTab === 'alarms' && (
              <>
                {!isPlcProfile && (
                <div style={{
                  padding: '8px 14px',
                  fontSize: 14,
                  color: t.textMuted,
                  borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                  flexShrink: 0,
                }}
                >
                  <b style={{ color: t.text }}>Status* split</b>
                  {': '}
                  <b style={{ color: t.text }}>{statusInfo.phase_label || '—'}</b>
                  {' = phase | '}
                  <b style={{ color: t.text }}>code {statusInfo.code ?? '—'}</b>
                  {' (shown as '}
                  <b style={{ color: t.text }}>{statusDisplay}</b>
                  ). Codes
                  {' '}
                  <b style={{ color: t.text }}>4</b>
                  {' = OK · '}
                  <b style={{ color: t.text }}>5–8</b>
                  {' = NG (force/position limits). Status '}
                  <b style={{ color: t.text }}>3</b>
                  {' = Pressing.'}
                </div>
                )}

                {isPlcProfile && (
                <div style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  color: t.textMuted,
                  borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                  flexShrink: 0,
                }}
                >
                  Threshold alarms raise when Pressure / Flow / Tank Level / Temperature cross configured
                  {' '}
                  <b style={{ color: t.text }}>LSL</b>
                  {' or '}
                  <b style={{ color: t.text }}>USL</b>
                  . Each breach gets an
                  {' '}
                  <b style={{ color: t.text }}>event id</b>
                  {' with raise / clear times. Configure limits under Parameters → Set Limits.'}
                </div>
                )}

                {!isPlcProfile && (
                <div style={{
                  padding: '10px 14px 12px',
                  borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                  flexShrink: 0,
                }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    marginBottom: 10,
                    flexWrap: 'wrap',
                  }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>
                      Alarm distribution
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.textMuted }}>
                      {alarmTypeTotals.events}
                      {' events · '}
                      <span style={{ color: '#f59e0b' }}>{alarmTypeTotals.raised} raised</span>
                      {' · '}
                      <span style={{ color: '#22c55e' }}>{alarmTypeTotals.cleared} cleared</span>
                      {' · '}
                      <span style={{ color: '#ef4444' }}>{alarmTypeTotals.codes} code(s)</span>
                    </div>
                  </div>
                  {alarmTypeTotals.events === 0 && !hasQualityData ? (
                    <div style={{ padding: '20px 8px', textAlign: 'center', color: t.textMuted, fontSize: 15 }}>
                      No alarm events yet. Chart fills when Alarm Code raises / clears.
                    </div>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                      gap: 12,
                    }}
                    >
                      {[
                        {
                          key: 'code',
                          title: 'Alarm Type',
                          data: alarmDist.byCode,
                          color: '#ef4444',
                          color2: '#fb923c',
                          hint: 'occurrences per alarm code',
                          xLabel: 'Alarm type (code)',
                          yLabel: 'Occurrences',
                          unit: 'occurrence',
                        },
                        {
                          key: 'event',
                          title: 'Event',
                          data: alarmDist.byEvent,
                          color: '#f59e0b',
                          color2: '#fde047',
                          hint: 'raised / cleared',
                          xLabel: 'Event type',
                          yLabel: 'Event count',
                          unit: 'event',
                        },
                        {
                          key: 'status',
                          title: 'Status*',
                          data: alarmDist.byStatus,
                          color: '#3b82f6',
                          color2: '#22d3ee',
                          hint: 'Status* when the alarm event happened',
                          xLabel: 'Status* phase | code',
                          yLabel: 'Event count',
                          unit: 'event',
                        },
                        {
                          key: 'result',
                          title: 'Quality Result',
                          data: qualityResultData,
                          color: '#16a34a',
                          color2: '#86efac',
                          hint: 'OK / NG pieces this shift',
                          xLabel: 'Pressing result',
                          yLabel: 'Pieces (shift)',
                          unit: 'pc',
                        },
                      ].map((panel) => (
                        <div
                          key={panel.title}
                          style={{
                            border: `1px solid ${t.border || '#e5e7eb'}`,
                            borderRadius: 10,
                            padding: '10px 12px 6px',
                            background: t.surface2 || t.surface || '#fff',
                            minWidth: 0,
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 10,
                            marginBottom: 6,
                            flexWrap: 'wrap',
                          }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>
                                {panel.title}
                              </div>
                              <div style={{ fontSize: 13, color: t.textMuted }}>{panel.hint}</div>
                            </div>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              gap: 3,
                            }}
                            >
                              {panel.data.slice(0, 5).map((item) => (
                                <span
                                  key={item.x}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: t.textMuted,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 4,
                                    background: `linear-gradient(180deg, ${item.from || panel.color2} 0%, ${item.to || panel.color} 100%)`,
                                    boxShadow: '0 1px 2px rgba(2,6,23,0.35)',
                                  }}
                                  />
                                  {item.x}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div style={{ width: '100%', height: 300, minWidth: 0 }}>
                            <ResponsiveContainer width="100%" height={300} minWidth={0} debounce={50}>
                              <BarChart
                                data={panel.data}
                                margin={{ top: 8, right: 12, left: 4, bottom: 46 }}
                              >
                                <defs>
                                  {panel.data.map((row, rowIdx) => (
                                    <linearGradient
                                      key={`${panel.key}-${rowIdx}`}
                                      id={`alarmGrad-${panel.key}-${rowIdx}`}
                                      x1="0"
                                      y1="0"
                                      x2="0"
                                      y2="1"
                                    >
                                      <stop offset="0%" stopColor={row.from || panel.color2} stopOpacity={0.98} />
                                      <stop offset="100%" stopColor={row.to || panel.color} stopOpacity={1} />
                                    </linearGradient>
                                  ))}
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke={t.border || '#e5e7eb'} />
                                <XAxis
                                  dataKey="x"
                                  interval={0}
                                  height={66}
                                  tickLine={false}
                                  tick={<AxisTick fill={t.textMuted} />}
                                  label={{
                                    value: panel.xLabel,
                                    position: 'insideBottom',
                                    offset: -30,
                                    style: { fontSize: 13, fontWeight: 700, fill: t.textMuted },
                                  }}
                                />
                                <YAxis
                                  allowDecimals={false}
                                  tick={{ fontSize: 13, fill: t.textMuted }}
                                  width={52}
                                  label={{
                                    value: panel.yLabel,
                                    angle: -90,
                                    position: 'insideLeft',
                                    offset: 8,
                                    style: { fontSize: 13, fontWeight: 700, fill: t.textMuted, textAnchor: 'middle' },
                                  }}
                                />
                                <Tooltip
                                  formatter={(value, _name, item) => {
                                    const d = item?.payload || {};
                                    if (panel.key === 'code' && d.raised != null) {
                                      return [
                                        `${value} occurrence${value === 1 ? '' : 's'} (${d.raised} raised / ${d.cleared} cleared)`,
                                        panel.title,
                                      ];
                                    }
                                    return [`${value} ${panel.unit}${value === 1 ? '' : 's'}`, panel.title];
                                  }}
                                  contentStyle={{ fontSize: 14 }}
                                />
                                <Bar
                                  dataKey="count"
                                  name={panel.series}
                                  fill={`url(#alarmGrad-${panel.key})`}
                                  maxBarSize={56}
                                  shape={<Bar3D baseColor={panel.color} topColor={panel.color2} />}
                                  isAnimationActive
                                  animationBegin={80}
                                  animationDuration={1100}
                                  animationEasing="ease-out"
                                >
                                  {panel.data.map((row, rowIdx) => (
                                    <Cell
                                      key={`${row.x}-${rowIdx}`}
                                      fill={`url(#alarmGrad-${panel.key}-${rowIdx})`}
                                    />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}

                {alarms.length === 0 ? (
                  <div style={{ padding: 28, textAlign: 'center', color: t.textMuted }}>
                    {isPlcProfile
                      ? 'No threshold alarms yet. Set LSL/USL under Parameters, then breaches raise events with id and timing.'
                      : 'No alarm events yet. Events appear when Modbus Alarm Code changes (non-zero raise / clear to 0).'}
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: selectedAlarm && !isPlcProfile ? 'minmax(0, 1.2fr) minmax(280px, 0.8fr)' : '1fr',
                    gap: 0,
                    flex: '1 1 auto',
                    minHeight: 0,
                    maxHeight: '60vh',
                  }}
                  >
                  <div style={{ overflow: 'auto', minHeight: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                      <thead style={{ position: 'sticky', top: 0, background: t.surface2 || t.surface || '#f8fafc', zIndex: 1 }}>
                        <tr style={{ textAlign: 'left' }}>
                          {(isPlcProfile
                            ? ['Time', 'Event ID', 'Tag', 'Event', 'Value', 'LSL', 'USL', 'Started', 'Cleared']
                            : ['Time', 'Code', 'Alarm Message', 'Event', 'Status*']
                          ).map((h) => (
                            <th key={h} style={{ padding: '10px 14px', color: t.textMuted, fontWeight: 700 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {alarmsTableRows.map((a, idx) => (
                          isPlcProfile ? (
                            <tr key={`${a.event_id || a.ts}-${idx}`} style={{ borderBottom: `1px solid ${t.border || '#eef2f7'}` }}>
                              <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.t || a.ts || '-'}</td>
                              <td style={{
                                padding: '10px 14px',
                                fontWeight: 800,
                                color: a.active || a.event === 'raised' ? '#ef4444' : '#22c55e',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 12,
                              }}
                              >
                                {a.event_id || a.code || '-'}
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                                {a.label || a.tag_key || '-'}
                              </td>
                              <td style={{
                                padding: '10px 14px',
                                textTransform: 'capitalize',
                                fontWeight: 700,
                                color: a.event === 'cleared' ? '#16a34a' : '#dc2626',
                              }}
                              >
                                {a.event || '-'}
                                {a.side ? ` (${a.side})` : ''}
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                                {a.value != null ? `${a.value}${a.unit ? ` ${a.unit}` : ''}` : '-'}
                              </td>
                              <td style={{ padding: '10px 14px' }}>{a.lsl != null ? a.lsl : '-'}</td>
                              <td style={{ padding: '10px 14px' }}>{a.usl != null ? a.usl : '-'}</td>
                              <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 13 }}>
                                {a.started_at || (a.event === 'raised' ? (a.ts || a.t) : '-') || '-'}
                              </td>
                              <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 13 }}>
                                {a.cleared_at || (a.event === 'cleared' ? (a.ts || a.t) : '-') || '-'}
                              </td>
                            </tr>
                          ) : (
                            <tr
                              key={`${a.ts}-${a.code}-${idx}`}
                              onClick={() => {
                                const cat = alarmCatalogEntry(a.code);
                                setSelectedAlarm({
                                  ...a,
                                  codeLabel: a.code_label || cat?.codeLabel,
                                  message: a.message || cat?.message || a.label,
                                  handling: a.handling || cat?.handling,
                                });
                              }}
                              style={{
                                borderBottom: `1px solid ${t.border || '#eef2f7'}`,
                                cursor: 'pointer',
                                background: selectedAlarm
                                  && selectedAlarm.code === a.code
                                  && selectedAlarm.ts === a.ts
                                  ? 'rgba(59,130,246,0.08)'
                                  : 'transparent',
                              }}
                            >
                              <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.t || a.ts || '-'}</td>
                              <td style={{ padding: '10px 14px', fontWeight: 800, color: a.active || a.event === 'raised' ? '#ef4444' : '#22c55e' }}>
                                {a.code_label || (a.code != null ? String(a.code).padStart(3, '0') : '-')}
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 600, maxWidth: 280 }}>
                                {a.message || a.label || alarmCatalogEntry(a.code)?.message || '-'}
                              </td>
                              <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{a.event || '-'}</td>
                              <td style={{ padding: '10px 14px' }}>{normalizeStatusLabel(a.status)}</td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                    {alarms.length > alarmsTableRows.length ? (
                      <div style={{ padding: '8px 14px', fontSize: 14, color: t.textMuted }}>
                        Showing latest {alarmsTableRows.length} of {alarms.length} events
                      </div>
                    ) : null}
                  </div>
                  {selectedAlarm && !isPlcProfile ? (
                    <div style={{
                      borderLeft: `1px solid ${t.border || '#e5e7eb'}`,
                      padding: 14,
                      overflow: 'auto',
                      background: t.surface2 || '#f8fafc',
                    }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>
                          Alarm
                          {' '}
                          {selectedAlarm.codeLabel || (selectedAlarm.code != null ? String(selectedAlarm.code).padStart(3, '0') : '')}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedAlarm(null)}
                          style={{
                            border: `1px solid ${t.border || '#cbd5e1'}`,
                            background: t.surface || '#fff',
                            borderRadius: 6,
                            padding: '4px 10px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, marginBottom: 4 }}>Alarm Message</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 14, lineHeight: 1.4 }}>
                        {selectedAlarm.message || '-'}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, marginBottom: 4 }}>Handling Approach</div>
                      <div style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: t.text,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                        padding: 12,
                        borderRadius: 8,
                        border: `1px solid ${t.border || '#e5e7eb'}`,
                        background: t.surface || '#fff',
                      }}
                      >
                        {selectedAlarm.handling || 'No handling guidance for this code.'}
                      </div>
                      <div style={{ marginTop: 12, fontSize: 12, color: t.textMuted }}>
                        Event:
                        {' '}
                        <b style={{ color: t.text }}>{selectedAlarm.event || '-'}</b>
                        {' · '}
                        {selectedAlarm.t || selectedAlarm.ts || '-'}
                      </div>
                    </div>
                  ) : null}
                  </div>
                )}
              </>
            )}
            {activeTab === 'history' && (
              historyRows.length === 0 ? (
                <div style={{ padding: 28, textAlign: 'center', color: t.textMuted }}>
                  {isPlcProfile
                    ? 'No history yet. Samples are stored when Pressure, Flow, Tank Level or Temperature change.'
                    : 'No history yet. Snapshots are stored when Status*, production counters, or alarm/result change.'}
                </div>
              ) : isPlcProfile ? (
                <div style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0, maxHeight: '60vh' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                    <thead style={{ position: 'sticky', top: 0, background: t.surface2 || t.surface || '#f8fafc', zIndex: 1 }}>
                      <tr style={{ textAlign: 'left' }}>
                        {['Time', 'Pressure', 'Flow', 'Tank Level', 'Temperature', 'DI Status', 'DO Status'].map((h) => (
                          <th key={h} style={{ padding: '10px 14px', color: t.textMuted, fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((h, idx) => (
                        <tr key={`${h.ts}-${idx}`} style={{ borderBottom: `1px solid ${t.border || '#eef2f7'}` }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h.t || h.ts || '—'}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>{h.pressure ?? '—'}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>{h.flow ?? '—'}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>{h.tank_level ?? '—'}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 700 }}>{h.temperature ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.digital_input_status ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.digital_output_status ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0, maxHeight: '60vh' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                    <thead style={{ position: 'sticky', top: 0, background: t.surface2 || t.surface || '#f8fafc', zIndex: 1 }}>
                      <tr style={{ textAlign: 'left' }}>
                        {['Time', 'Status', 'Total', 'Good', 'NG', 'Cycle', 'Alarm', 'Result'].map((h) => (
                          <th key={h} style={{ padding: '10px 14px', color: t.textMuted, fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((h, idx) => (
                        <tr key={`${h.ts}-${idx}`} style={{ borderBottom: `1px solid ${t.border || '#eef2f7'}` }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h.t || h.ts || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.status || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.total ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.good ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>{h.reject ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {h.cycle_time_sec != null ? `${h.cycle_time_sec}s` : '—'}
                          </td>
                          <td style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            color: Number(h.alarm_code) ? '#ef4444' : t.text,
                          }}
                          >
                            {h.alarm_code ?? '—'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>{h.pressing_result || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </section>
        )}

      {oeeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Overall Equipment Effectiveness"
          onClick={() => setOeeOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.55)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...card,
              width: 'min(520px, 100%)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.text }}>Overall Equipment Effectiveness</div>
              <button
                type="button"
                onClick={() => setOeeOpen(false)}
                style={{
                  border: `1px solid ${t.border}`,
                  background: t.surface2 || t.surface,
                  color: t.text,
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            {!hasOee && !activeKpiPanel ? (
              <div style={{ padding: 24, color: t.textMuted, textAlign: 'center' }}>
                KPI data unavailable for this shift. Create a production plan, or keep Node-RED posting so Modbus OEE can accumulate.
              </div>
            ) : (
              <>
                <div style={{ textAlign: 'center', padding: '4px 8px 12px' }}>
                  <div style={{ fontSize: 52, fontWeight: 800, color: pctColor(oeeDisp), lineHeight: 1.1 }}>
                    {hasOee ? `${oeeDisp}%` : '—'}
                  </div>
                  <div style={{ fontSize: 15, color: t.textMuted, marginTop: 6 }}>
                    {kpiSource === 'servo_press'
                      ? `Servo Press OEE (Modbus) · ${activeKpiPanel?.entry_date || ''}${shiftLabel ? ` · ${shiftLabel}` : ''}`
                      : kpiSource === 'modbus'
                        ? 'Modbus OEE (Status* timing + production counters)'
                        : (activeKpiPanel?.entry_date
                          ? `${activeKpiPanel.entry_date}${shiftLabel ? ` · ${shiftLabel}${shiftWindow ? ` ${shiftWindow}` : ''}` : ''}`
                          : (shiftLabel ? `${shiftLabel}${shiftWindow ? ` ${shiftWindow}` : ''}` : 'PMS OEE formulas'))}
                  </div>
                  <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
                    OEE = AR × PR × QR ({roundPct(k.ar)}% × {roundPct(k.pr)}% × {roundPct(k.qr)}%)
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginBottom: 12,
                }}
                >
                  {rateItems.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        border: `1px solid ${t.border || '#e2e8f0'}`,
                        borderRadius: 10,
                        padding: '12px 6px',
                        textAlign: 'center',
                        background: t.surface2 || t.surface || '#fff',
                      }}
                    >
                      <div style={{ fontSize: 20 }}>{item.icon}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: item.color }}>
                        {roundPct(item.value)}%
                      </div>
                      <div style={{ fontSize: 14, color: t.textMuted, fontWeight: 600 }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
                  <tbody>
                    {oeeStatRows.map(([lbl, val]) => (
                      <tr key={lbl} style={{ borderTop: `1px solid ${t.border || '#eef2f7'}` }}>
                        <td style={{ padding: '9px 0', color: t.textMuted, fontWeight: 600 }}>{lbl}</td>
                        <td style={{ padding: '9px 0', color: t.text, fontWeight: 800, textAlign: 'right' }}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Machine types that use this dashboard instead of the generic equipment tiles.
 * Servo Linear Motor, PLC and SPM feed the same Live / Result parameters through
 * mapped Node-RED tags, so they get the same screen.
 * Mirrors is_telemetry_dashboard_type() in backend/app/machine_telemetry_profiles.py.
 */
export function usesTelemetryDashboard(type) {
  const tokens = String(type || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  if (tokens.includes('servopress')) return true;
  if (tokens.includes('servo') && (tokens.includes('press') || tokens.includes('linear'))) return true;
  return tokens.includes('plc') || tokens.includes('spm');
}

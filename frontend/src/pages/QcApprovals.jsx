import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PageHeader from '../components/PageHeader';
import QcInspectionSheet from '../components/QcInspectionSheet';
import QcSpcChart from '../components/QcSpcChart';
import { pageClass, surfaceClass } from '../themes/tileHelpers';
import { getWorkInstructionStyles } from '../themes/workInstructionStyles';
import { INSTANCE_STATUS_LABEL } from '../utils/qcShiftHours';

const STATUS_STYLE = {
  green: { bg: '#e8f5e9', color: '#2e7d32' },
  yellow: { bg: '#fff8e1', color: '#f57f17' },
  red: { bg: '#ffebee', color: '#c62828' },
  gray: { bg: '#eeeeee', color: '#757575' },
  neutral: { bg: '#f5f5f5', color: '#616161' },
};

function statusPill(status, statusColor) {
  const st = STATUS_STYLE[statusColor] || STATUS_STYLE.neutral;
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: st.bg, color: st.color,
    }}
    >
      {INSTANCE_STATUS_LABEL[status] || status}
    </span>
  );
}

export default function QcApprovals() {
  const { user } = useAuth();
  const { theme: t } = useTheme();
  const s = getWorkInstructionStyles(t);
  const navigate = useNavigate();

  const isInspector = ['quality', 'supervisor', 'admin'].includes(user?.role);
  const isSupervisor = ['supervisor', 'admin'].includes(user?.role);
  const defaultTab = isSupervisor && user?.role !== 'quality' ? 'incharge' : 'inspector';
  const [tab, setTab] = useState(defaultTab);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [reviewContext, setReviewContext] = useState(null);
  const [spcRow, setSpcRow] = useState(null);
  const [spcData, setSpcData] = useState(null);
  const [spcLoading, setSpcLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const queue = tab === 'operator' ? 'operator' : tab;
      const { data } = await api.get('/api/qc-inspection/pending-approvals', { params: { queue } });
      setRows(data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const openReview = async (row) => {
    try {
      const { data: report } = await api.get(`/api/qc-inspection/${row.report_id}`);
      const { data: ctx } = await api.get('/api/operator-dashboard/context', {
        params: {
          machine_id: report.machine_id,
          shift: report.shift,
          entry_date: report.inspection_date,
        },
      });
      setReviewContext(ctx);
      setReview(row);
    } catch {
      navigate(`/work-instructions?machine_id=${row.machine_id || ''}`);
    }
  };

  const openSpc = async (row) => {
    setSpcRow(row);
    setSpcLoading(true);
    setSpcData(null);
    try {
      const { data } = await api.get(`/api/qc-inspection/${row.report_id}/spc-data`);
      setSpcData(data);
    } catch {
      setSpcData(null);
    } finally {
      setSpcLoading(false);
    }
  };

  const quickApprove = async (row, action) => {
    const key = `${row.report_id}-${action}`;
    setActionBusy(key);
    try {
      if (action === 'inspector-all') {
        await api.post(`/api/qc-inspection/${row.report_id}/approve-inspector-all`);
      } else if (action === 'incharge-all') {
        await api.post(`/api/qc-inspection/${row.report_id}/approve-incharge-all`);
      }
      await load();
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Approval failed');
    } finally {
      setActionBusy(null);
    }
  };

  const queueLabel = tab === 'inspector'
    ? 'Awaiting QC'
    : tab === 'incharge'
      ? 'Awaiting Supervisor'
      : 'Status';

  return (
    <div className={pageClass(t)}>
      <PageHeader
        title="QC Approvals"
        subtitle="Consolidated shift review — optional inspector verification, SPC charts per part"
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {isInspector && (
          <button
            type="button"
            style={tab === 'inspector' ? s.btnAccent : s.btnSecondary}
            onClick={() => setTab('inspector')}
          >
            QC Pending
          </button>
        )}
        {isSupervisor && (
          <button
            type="button"
            style={tab === 'incharge' ? s.btnAccent : s.btnSecondary}
            onClick={() => setTab('incharge')}
          >
            Supervisor Pending
          </button>
        )}
        <button
          type="button"
          style={tab === 'operator' ? s.btnAccent : s.btnSecondary}
          onClick={() => setTab('operator')}
        >
          My Submissions
        </button>
      </div>

      <div className={surfaceClass(t)} style={{ overflowX: 'auto' }}>
        <table style={{ ...s.table, width: '100%' }}>
          <thead>
            <tr>
              <th className="wi-qc-th" style={s.thYellow}>Station</th>
              <th className="wi-qc-th" style={s.thYellow}>Machine</th>
              <th className="wi-qc-th" style={s.thYellow}>Part No</th>
              <th className="wi-qc-th" style={s.thYellow}>Pending</th>
              <th className="wi-qc-th" style={s.thYellow}>Operator</th>
              <th className="wi-qc-th" style={s.thYellow}>Shift</th>
              <th className="wi-qc-th" style={s.thYellow}>Date</th>
              <th className="wi-qc-th" style={s.thYellow}>{queueLabel}</th>
              <th className="wi-qc-th" style={s.thYellow}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={s.td}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} style={s.td}>No items in this queue.</td></tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={`${row.report_id}-${row.instance_key}`}>
                <td style={s.td}>{row.station_name || '—'}</td>
                <td style={s.td}>{row.machine_name || '—'}</td>
                <td style={s.td}>
                  {row.article_no ? (
                    <button
                      type="button"
                      onClick={() => openSpc(row)}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: t.accent || '#1565c0', fontWeight: 600, textDecoration: 'underline',
                      }}
                      title="View SPC chart for this part / shift"
                    >
                      {row.article_no}
                    </button>
                  ) : '—'}
                </td>
                <td style={s.td}>
                  {row.consolidated && tab !== 'operator'
                    ? (
                      <span title={row.pending_instances?.join(', ')}>
                        {row.pending_count || 1} instance(s)
                        {tab === 'incharge' && row.pending_instances?.length > 0 && (
                          <div style={{ fontSize: 10, color: t.textDim, marginTop: 2 }}>
                            Next: {row.pending_instances[0] === 'first' ? '1st piece' : `H${row.pending_instances[0]}`}
                          </div>
                        )}
                      </span>
                    )
                    : (row.instance_label || row.instance_key)}
                </td>
                <td style={s.td}>{row.operator_username || '—'}</td>
                <td style={s.td}>{row.shift}</td>
                <td style={s.td}>{row.inspection_date}</td>
                <td style={s.td}>{statusPill(row.status, row.status_color || 'yellow')}</td>
                <td style={s.td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" style={s.btnSecondary} onClick={() => openReview(row)}>
                      Review
                    </button>
                    {tab === 'inspector' && row.consolidated && (
                      <button
                        type="button"
                        style={s.btnAccent}
                        disabled={actionBusy === `${row.report_id}-inspector-all`}
                        onClick={() => quickApprove(row, 'inspector-all')}
                      >
                        {actionBusy === `${row.report_id}-inspector-all` ? '…' : 'Approve All QC'}
                      </button>
                    )}
                    {tab === 'incharge' && row.consolidated && (
                      <button
                        type="button"
                        style={s.btnAccent}
                        disabled={actionBusy === `${row.report_id}-incharge-all`}
                        onClick={() => quickApprove(row, 'incharge-all')}
                      >
                        {actionBusy === `${row.report_id}-incharge-all` ? '…' : 'Approve Shift'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {review && reviewContext && (
        <QcInspectionSheet
          context={reviewContext}
          initialReportId={review.report_id}
          reviewingInstanceKey={review.consolidated ? null : review.instance_key}
          onClose={() => { setReview(null); setReviewContext(null); load(); }}
          onSubmitted={load}
        />
      )}

      {spcRow && !spcLoading && spcData && (
        <QcSpcChart
          reportMeta={{
            article_no: spcRow.article_no,
            shift: spcRow.shift,
            inspection_date: spcRow.inspection_date,
            machine_name: spcRow.machine_name,
          }}
          spcData={spcData}
          theme={t}
          onClose={() => { setSpcRow(null); setSpcData(null); }}
        />
      )}

      {spcRow && spcLoading && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}
        >
          <div style={{ background: t.surface, padding: 24, borderRadius: 8 }}>Loading SPC chart…</div>
        </div>
      )}
    </div>
  );
}

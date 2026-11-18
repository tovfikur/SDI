import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { usePermissions } from '../../auth-context';
import { attendance, hr } from '../../api';
import { Modal } from '../../components/Modal';

interface Employee {
  id: string;
  full_name: string;
  employee_code: string;
}

function toIsoLocal(dt: string): string {
  return new Date(dt).toISOString();
}

export function AttendanceFormTab(): ReactElement {
  const { can } = usePermissions();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    employeeId: '',
    eventTime: new Date().toISOString().slice(0, 16),
    source: 'manual',
  });
  const [manualForm, setManualForm] = useState({
    employeeId: '',
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
    timeIn: '',
    timeOut: '',
  });
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await hr.employees({ perPage: 100 });
        setEmployees((res.data as { items: Employee[] }).items);
      } catch {
        /* optional */
      }
    }
    void load();
  }, []);

  const record = async () => {
    if (!form.employeeId || !form.eventTime) {
      setError('Employee and event time are required');
      return;
    }
    setSubmitting(true);
    setError('');
    setOk('');
    try {
      await attendance.createEvent({
        employeeId: form.employeeId,
        eventTime: toIsoLocal(form.eventTime),
        source: form.source,
      });
      setOk('Attendance event recorded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record event');
    } finally {
      setSubmitting(false);
    }
  };

  const saveManual = async () => {
    if (!manualForm.employeeId || !manualForm.timeIn || !manualForm.timeOut) {
      setError('Employee, time in and time out are required');
      return;
    }
    setSubmitting(true);
    setError('');
    setOk('');
    try {
      await attendance.manualEntry({
        employeeId: manualForm.employeeId,
        year: Number(manualForm.year),
        month: Number(manualForm.month),
        timeIn: toIsoLocal(manualForm.timeIn),
        timeOut: toIsoLocal(manualForm.timeOut),
      });
      setManualOpen(false);
      setOk('Manual monthly entry recorded and recalculated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save manual entry');
    } finally {
      setSubmitting(false);
    }
  };

  const runBulk = async () => {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const events = lines
      .map((line) => {
        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 2) return null;
        return {
          employeeId: parts[0],
          eventTime: toIsoLocal(parts[1]),
          source: parts[2] || 'manual-bulk',
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    if (events.length === 0) {
      setError('Enter at least one line: employeeId, eventTime[, source]');
      return;
    }
    setSubmitting(true);
    setError('');
    setOk('');
    try {
      const res = await attendance.bulkCreate({ events });
      setBulkResult(`Inserted: ${(res as { inserted: number }).inserted}`);
      setBulkOpen(false);
      setOk(`Bulk import done. Inserted ${(res as { inserted: number }).inserted} event(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk import failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="panel-clay" style={{ maxWidth: 720 }}>
        <h3>Record Attendance Event</h3>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">
              Employee <span className="form-required">*</span>
            </label>
            <select
              className="form-control-clay"
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            >
              <option value="">— Select employee —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} ({e.employee_code})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Event Time <span className="form-required">*</span>
            </label>
            <input
              type="datetime-local"
              className="form-control-clay"
              value={form.eventTime}
              onChange={(e) => setForm({ ...form, eventTime: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Source</label>
            <select
              className="form-control-clay"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="manual">Manual</option>
              <option value="device">Device</option>
              <option value="mobile">Mobile</option>
              <option value="web">Web</option>
            </select>
          </div>
        </div>
        {error && <div className="form-error-text">{error}</div>}
        {ok && (
          <div className="form-help-text" style={{ color: 'var(--clay-success)' }}>
            {ok}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {can('hr.attendance.manage') && (
            <button className="btn-clay btn-clay-primary" onClick={record} disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Event'}
            </button>
          )}
          {can('hr.attendance.manage') && (
            <button
              className="btn-clay btn-clay-secondary"
              onClick={() => {
                setManualOpen(true);
                setError('');
                setOk('');
              }}
            >
              Monthly Manual Entry
            </button>
          )}
          {can('hr.attendance.manage') && (
            <button
              className="btn-clay btn-clay-secondary"
              onClick={() => {
                setBulkOpen(true);
                setError('');
                setOk('');
              }}
            >
              Bulk Import
            </button>
          )}
        </div>
      </div>

      <Modal
        title="Monthly Manual Entry"
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmit={saveManual}
        submitting={submitting}
        submitLabel="Save & Recalculate"
        wide
      >
        <div className="form-group">
          <label className="form-label">
            Employee <span className="form-required">*</span>
          </label>
          <select
            className="form-control-clay"
            value={manualForm.employeeId}
            onChange={(e) => setManualForm({ ...manualForm, employeeId: e.target.value })}
          >
            <option value="">— Select employee —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Year</label>
            <input
              type="number"
              className="form-control-clay"
              value={manualForm.year}
              onChange={(e) => setManualForm({ ...manualForm, year: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Month</label>
            <select
              className="form-control-clay"
              value={manualForm.month}
              onChange={(e) => setManualForm({ ...manualForm, month: e.target.value })}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {new Date(0, i).toLocaleString('en', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Time In <span className="form-required">*</span>
            </label>
            <input
              type="datetime-local"
              className="form-control-clay"
              value={manualForm.timeIn}
              onChange={(e) => setManualForm({ ...manualForm, timeIn: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Time Out <span className="form-required">*</span>
            </label>
            <input
              type="datetime-local"
              className="form-control-clay"
              value={manualForm.timeOut}
              onChange={(e) => setManualForm({ ...manualForm, timeOut: e.target.value })}
            />
          </div>
        </div>
        {error && <div className="form-error-text">{error}</div>}
      </Modal>

      <Modal
        title="Bulk Import Events"
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSubmit={runBulk}
        submitting={submitting}
        submitLabel="Import"
        wide
      >
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          One event per line: <code>employeeId, eventTime (ISO), source(optional)</code>
        </p>
        <textarea
          className="form-control-clay"
          rows={8}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'<uuid>,2026-08-16T09:05:00Z,device\n<uuid>,2026-08-16T17:30:00Z,device'}
        />
        {bulkResult && <div className="form-help-text">{bulkResult}</div>}
        {error && <div className="form-error-text">{error}</div>}
      </Modal>
    </div>
  );
}

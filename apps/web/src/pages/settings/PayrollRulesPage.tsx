import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { payroll } from '../../api';
import type { PayrollSettings } from '../../api';
import { PageHeader } from '../../components/PageHeader';

const SAMPLE_GROSS = 50000;

// Calendar days in a month (YYYY-MM-DD of the first day)
function daysInMonth(monthFirst: string): number {
  const [y, m] = monthFirst.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Scheduled working days: weekdays (Mon–Thu) minus public holidays on those days.
// Weekend is Fri/Sat (dow 5/6) for Bangladesh
function scheduledWorkingDays(monthFirst: string, holidays: string[]): number {
  const [y, m] = monthFirst.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const holidaySet = new Set(holidays);
  let count = 0;
  for (let d = 1; d <= last; d += 1) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 5 || dow === 6) continue; // Fri/Sat weekend (BD)
    const iso = `${monthFirst.slice(0, 7)}-${String(d).padStart(2, '0')}`;
    if (holidaySet.has(iso)) continue;
    count += 1;
  }
  return count;
}

const parseCents = (value: unknown): bigint => {
  if (value === null || value === undefined || value === '') return 0n;
  const s = String(value).trim();
  if (s === '') return 0n;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error('money.invalid_amount');
  const neg = s.startsWith('-');
  const t = neg ? s.slice(1) : s;
  const [wholeRaw, fracRaw = ''] = t.split('.');
  const whole = /^\d+$/.test(wholeRaw) ? wholeRaw : '0';
  const frac = /^\d+$/.test(fracRaw) ? (fracRaw + '00').slice(0, 2) : '00';
  const cents = BigInt(whole) * 100n + BigInt(frac);
  return neg ? -cents : cents;
};

const centsToString = (cents: bigint): string => {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
};

const dailyRateCents = (gross: bigint, workingDays: number): bigint => {
  if (workingDays <= 0) return 0n;
  const abs = gross < 0n ? -gross : gross;
  const div = abs / BigInt(workingDays);
  const rem = abs % BigInt(workingDays);
  const rounded = rem * 2n >= BigInt(workingDays) ? div + 1n : div;
  return gross < 0n ? -rounded : rounded;
};

function computeWorkingDays(calculation: PayrollSettings['working_day_calculation'], monthFirst: string): number {
  if (calculation === 'scheduled_working_days') {
    return scheduledWorkingDays(monthFirst, []);
  }
  return daysInMonth(monthFirst);
}

function computeDailyRate(gross: number, workingDays: number): string {
  if (workingDays <= 0) return '0.00';
  return centsToString(dailyRateCents(parseCents(String(gross)), workingDays));
}

export function PayrollRulesPage(): ReactElement {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const now = new Date();
  const currentMonthFirst = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const workingDays = useMemo(
    () => (settings ? computeWorkingDays(settings.working_day_calculation, currentMonthFirst) : 0),
    [settings?.working_day_calculation]
  );
  const dailyRate = useMemo(
    () => (settings ? computeDailyRate(SAMPLE_GROSS, workingDays) : '0.00'),
    [settings?.working_day_calculation]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await payroll.settings();
      setSettings(res.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payroll rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (key: keyof PayrollSettings) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: !settings[key] });
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await payroll.updateSettings(settings);
      setSettings(res.data);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payroll rules');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Payroll Rules" subtitle="Payroll calculation and payment preferences." />
        <div className="panel-clay">
          <div className="empty-state">Loading payroll rules...</div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div>
        <PageHeader title="Payroll Rules" subtitle="Payroll calculation and payment preferences." />
        <div className="panel-clay">
          <div className="empty-state">{error || 'Payroll rules unavailable.'}</div>
        </div>
      </div>
    );
  }

  const label = (key: string) =>
    key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div>
      <PageHeader
        title="Payroll Rules"
        subtitle="Payroll calculation and payment preferences."
        actions={
          <button className="btn-clay btn-clay-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save Rules'}
          </button>
        }
      />
      {saved && (
        <div className="alert-box alert-box-success" style={{ marginBottom: 12 }}>
          Payroll rules saved successfully.
        </div>
      )}
      {error && <div className="alert-box alert-box-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="panel-clay">
        <div className="panel-title">Calculation</div>
        <div className="rules-grid">
          <div className="rules-field">
            <label className="form-label">Salary Calculation Basis</label>
            <select
              className="form-input"
              value={settings.salary_calculation_basis}
              onChange={(e) => setSettings({ ...settings, salary_calculation_basis: e.target.value as PayrollSettings['salary_calculation_basis'] })}
            >
              <option value="gross_salary">Gross Salary</option>
              <option value="basic_salary">Basic Salary</option>
            </select>
          </div>
          <div className="rules-field">
            <label className="form-label">Working Day Calculation</label>
            <select
              className="form-input"
              value={settings.working_day_calculation}
              onChange={(e) => setSettings({ ...settings, working_day_calculation: e.target.value as PayrollSettings['working_day_calculation'] })}
            >
              <option value="calendar_days">Calendar Days</option>
              <option value="scheduled_working_days">Scheduled Working Days</option>
            </select>
            {settings && (
              <div className="rules-preview" style={{ marginTop: 8, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 13, lineHeight: 1.6 }}>
                <strong>Live preview for {new Date(currentMonthFirst).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}:</strong>
                <br />
                Working days: <b>{workingDays}</b> (vs {daysInMonth(currentMonthFirst)} calendar days)
                <br />
                Sample daily rate (৳{SAMPLE_GROSS.toLocaleString()} gross): <b>৳{Number(dailyRate).toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>
                <br />
                <span className="muted-text">Absence/leave deductions use this daily rate × days.</span>
              </div>
            )}
          </div>
          <div className="rules-field">
            <label className="form-label">Rounding Rule</label>
            <select
              className="form-input"
              value={settings.rounding_rule}
              onChange={(e) => setSettings({ ...settings, rounding_rule: e.target.value as PayrollSettings['rounding_rule'] })}
            >
              <option value="nearest">Nearest Taka</option>
              <option value="ceil">Ceiling (round up)</option>
              <option value="floor">Floor (round down)</option>
            </select>
          </div>
          <div className="rules-field">
            <label className="form-label">Default Payment Day</label>
            <input
              className="form-input"
              type="number"
              min="1"
              max="28"
              value={settings.default_payment_day}
              onChange={(e) => setSettings({ ...settings, default_payment_day: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="rules-toggle-list">
          {(
            [
              ['attendance_deduction', 'Deduct for absent days'],
              ['late_deduction', 'Deduct for late days'],
              ['overtime_enabled', 'Enable overtime'],
              ['unpaid_leave_deduction', 'Deduct unpaid leave days'],
            ] as Array<[keyof PayrollSettings, string]>
          ).map(([key, text]) => (
            <label key={key} className="rules-toggle">
              <input type="checkbox" checked={Boolean(settings[key])} onChange={() => toggle(key)} />
              <span className="checkbox-label">{text}</span>
            </label>
          ))}
        </div>
        <div className="rules-grid">
          <div className="rules-field">
            <label className="form-label">Period Label</label>
            <input
              className="form-input"
              type="text"
              value={settings.period_label}
              onChange={(e) => setSettings({ ...settings, period_label: e.target.value })}
            />
          </div>
          <div className="rules-field">
            <label className="form-label">Default Currency</label>
            <input
              className="form-input"
              type="text"
              value={settings.default_currency}
              onChange={(e) => setSettings({ ...settings, default_currency: e.target.value.toUpperCase() })}
            />
          </div>
        </div>
        <div className="panel-footer-meta muted-text">
          {label(settings.salary_calculation_basis)} basis · {label(settings.rounding_rule)} rounding ·{' '}
          {label(settings.working_day_calculation)}
        </div>
      </div>
    </div>
  );
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { Icon, Icons } from '../../components/Icon';
import { ChartCard } from '../../components/charts/ChartCard';
import { VerticalBarChart } from '../../components/charts/charts';

interface Holiday {
  id: string;
  name: string;
  date: string;
  is_recurring?: boolean;
}

interface Notice {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
}

interface Policy {
  id: string;
  title: string;
  body: string;
  category: string | null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDay(d: Date | null): string {
  return d ? String(d.getDate()) : '—';
}

function formatMonthShort(d: Date | null): string {
  return d ? d.toLocaleDateString(undefined, { month: 'short' }) : '—';
}

function formatLongDate(d: Date | null): string {
  return d ? d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', day: 'numeric', month: 'long' }) : '—';
}

export function MyOrganizationPage(): ReactElement {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [hRes, nRes, pRes] = await Promise.allSettled([
        hr.holidays({}),
        hr.notices(),
        hr.policies(),
      ]);
      if (hRes.status === 'fulfilled') setHolidays((hRes.value.data as { items: Holiday[] }).items);
      if (nRes.status === 'fulfilled') setNotices(nRes.value.data as Notice[]);
      if (pRes.status === 'fulfilled') setPolicies(pRes.value.data as Policy[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organization info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const holidaysByMonth = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const counts = months.map((m) => ({ month: m, holidays: 0 }));
    for (const h of holidays) {
      const d = parseDate(h.date);
      if (!d) continue;
      counts[d.getMonth()].holidays += 1;
    }
    return counts;
  }, [holidays]);

  const validHolidayCount = useMemo(
    () => holidays.filter((h) => parseDate(h.date) !== null).length,
    [holidays]
  );

  if (loading) return <div className="data-table-state">Loading…</div>;
  if (error) return <div className="data-table-state data-table-error">{error}</div>;

  return (
    <div>
      <PageHeader title="Holidays & Notices" subtitle="Company-wide information" />

      <div className="kpi-grid hrdash-kpi-grid">
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#8b5cf61f', color: '#8b5cf6' }}>
            <Icon icon={Icons.CalendarMinus} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{holidays.length}</span>
            <span className="hrdash-kpi-label">Holidays Published</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#0ea5e91f', color: '#0ea5e9' }}>
            <Icon icon={Icons.Bullhorn} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{notices.length}</span>
            <span className="hrdash-kpi-label">Active Notices</span>
          </span>
        </div>
        <div className="hrdash-kpi">
          <span className="hrdash-kpi-icon" style={{ background: '#f59e0b1f', color: '#f59e0b' }}>
            <Icon icon={Icons.ShieldHalved} size="lg" />
          </span>
          <span className="hrdash-kpi-body">
            <span className="hrdash-kpi-value">{policies.length}</span>
            <span className="hrdash-kpi-label">Company Policies</span>
          </span>
        </div>
      </div>

      <ChartCard
        title="Holidays by Month"
        loading={loading}
        empty={validHolidayCount === 0}
        emptyMessage="No holidays with valid dates published."
      >
        <VerticalBarChart data={holidaysByMonth} xKey="month" barKey="holidays" color="#8b5cf6" height={200} />
      </ChartCard>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Icon icon={Icons.CalendarDays} size="sm" /> Holidays
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {holidays.length === 0 && <div className="empty-state">No holidays published.</div>}
            {holidays.map((h) => {
              const d = parseDate(h.date);
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 10, background: 'rgba(139,92,246,0.06)' }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: '#8b5cf6',
                      color: '#fff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <strong style={{ fontSize: '0.8rem', lineHeight: 1 }}>{formatDay(d)}</strong>
                    <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>{formatMonthShort(d)}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{h.name}</div>
                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {formatLongDate(d)}
                    </div>
                  </div>
                  {h.is_recurring && <span className="badge-soft" style={{ color: '#8b5cf6', background: '#8b5cf61a' }}>Recurring</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title">
                <Icon icon={Icons.Bullhorn} size="sm" /> Notices
              </div>
            </div>
            <div className="card-body">
              {notices.length === 0 && <div className="empty-state">No notices published.</div>}
              {notices.map((n) => (
                <div key={n.id} className="notice-card" style={{ marginBottom: 12 }}>
                  <div className="notice-card-title">
                    {n.title}
                    {n.category && <span className="badge" style={{ marginLeft: 8 }}>{n.category}</span>}
                  </div>
                  <div className="notice-card-meta">{new Date(n.created_at).toLocaleString()}</div>
                  <div className="notice-card-body" style={{ whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Icon icon={Icons.ShieldHalved} size="sm" /> Policies
              </div>
            </div>
            <div className="card-body">
              {policies.length === 0 && <div className="empty-state">No policies published.</div>}
              {policies.map((p) => (
                <div key={p.id} className="notice-card" style={{ marginBottom: 12 }}>
                  <div className="notice-card-title">
                    {p.title}
                    {p.category && <span className="badge" style={{ marginLeft: 8 }}>{p.category}</span>}
                  </div>
                  <div className="notice-card-body" style={{ whiteSpace: 'pre-wrap' }}>
                    {p.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
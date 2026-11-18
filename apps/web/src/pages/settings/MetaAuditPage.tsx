import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { audit } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';

interface MetaAuditEntry {
  id: string;
  action: string;
  actor_user_id: string | null;
  target_log_id: string | null;
  created_at: string;
}

const formatDate = (value: string | null | undefined): string => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM';
  const h = d.getHours() % 12 || 12;
  return `${dd}-${mm}-${d.getFullYear()} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
};

export function MetaAuditPage(): ReactElement {
  const [rows, setRows] = useState<MetaAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await audit.meta({ page, perPage });
      const data = res.data as { items: MetaAuditEntry[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meta audit data');
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataColumn<MetaAuditEntry>[] = [
    { key: 'action', header: 'Action', sortable: true },
    { key: 'actor_user_id', header: 'Actor User ID' },
    { key: 'target_log_id', header: 'Target Log ID' },
    {
      key: 'created_at',
      header: 'Recorded At',
      sortable: true,
      render: (r) => formatDate(r.created_at),
    },
  ];

  return (
    <div>
      <div className="panel-clay">
        <h3>Meta Audit</h3>
        <p className="software-setup-subtitle">
          Administrator-only trail of actions performed against activity log records. For security
          and audit integrity, activity records themselves are never modified in place.
        </p>
      </div>
      <DataTable
        columns={columns as unknown as DataColumn<Record<string, unknown>>[]}
        rows={rows as unknown as Record<string, unknown>[]}
        rowKey={(r) => String(r.id)}
        loading={loading}
        error={error}
        page={page}
        perPage={perPage}
        total={total}
        onPageChange={setPage}
        onPerPageChange={(p) => {
          setPerPage(p);
          setPage(1);
        }}
        emptyMessage="No meta audit entries found."
      />
    </div>
  );
}

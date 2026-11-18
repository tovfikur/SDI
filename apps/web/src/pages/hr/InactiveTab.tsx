import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { StatusBadge } from '../../components/StatusBadge';

interface Row {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  department_name: string | null;
  position_name: string | null;
  status: string;
}

export function InactiveTab(): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.inactiveEmployees({ page, perPage, search });
      const data = res.data as { items: Row[]; total: number };
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inactive employees');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const reactivate = async (row: Row) => {
    try {
      await hr.setEmployeeStatus(row.id, { status: 'active' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reactivate employee');
    }
  };

  const columns: DataColumn<Row>[] = [
    { key: 'employee_code', header: 'Employee ID', sortable: true, render: (r) => <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{r.employee_code}</span> },
    { key: 'full_name', header: 'Name', sortable: true, render: (r) => <strong>{r.full_name}</strong> },
    { key: 'department_name', header: 'Department', render: (r) => r.department_name ?? '—' },
    { key: 'position_name', header: 'Position', render: (r) => r.position_name ?? '—' },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (r) => (
        <button className="btn-clay btn-clay-sm btn-clay-success" onClick={() => reactivate(r)}>
          Reactivate
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '0.6rem' }}>
        <div>
          <div className="page-title">Inactive Employees</div>
          <div className="page-subtitle">Employees whose employment is currently inactive.</div>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
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
        search={search}
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Search inactive employees..."
        csvFilename="inactive-employees.csv"
        excelFilename="inactive-employees.xls"
        printable
        emptyMessage="No inactive employees."
      />
    </div>
  );
}
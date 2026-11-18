/**
 * HR Sub-Modules: ID Cards, Resignations, Notices, Loans, HR Policies
 * Tables already exist in DB; these functions provide the CRUD operations.
 */

import { query, withTransaction } from '@jsk/shared-kernel';

// ---------------------------------------------------------------------------
// ID Cards (FR-041)
// ---------------------------------------------------------------------------

export async function listIdCards(filters: { employee_id?: string | undefined } = {}) {
  const wheres: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.employee_id) { wheres.push(`c.employee_id = $${idx++}`); params.push(filters.employee_id); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const { rows } = await query(`SELECT c.* FROM id_cards c ${where} ORDER BY c.created_at DESC`, params);
  return rows;
}

export async function createIdCard(data: { employee_id: string; card_number: string; issued_date?: string; expiry_date?: string }) {
  const { rows } = await query(
    `INSERT INTO id_cards (employee_id, card_number, issued_date, expiry_date, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
    [data.employee_id, data.card_number, data.issued_date ?? new Date().toISOString().slice(0, 10), data.expiry_date ?? null]
  );
  return rows[0];
}

export async function removeIdCard(id: string) {
  await query('DELETE FROM id_cards WHERE id = $1::uuid', [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Resignations (FR-042) — columns: notice_date, effective_date, reason, status
// ---------------------------------------------------------------------------

export interface ListParams {
  page?: number | undefined;
  per_page?: number | undefined;
  status?: string | undefined;
}

/** Canonical paginated envelope shared by the list endpoints. */
export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export async function listResignations(
  filters: { status?: string | undefined; search?: string | undefined; employee_id?: string | undefined } = {},
  pagination: { page?: number; per_page?: number } = {}
): Promise<PaginatedList<Record<string, unknown>>> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.status) {
    wheres.push(`r.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.employee_id) {
    wheres.push(`r.employee_id = $${idx++}::uuid`);
    params.push(filters.employee_id);
  }
  if (filters.search) {
    wheres.push(`(COALESCE(e.full_name, '') ILIKE $${idx++} OR COALESCE(r.reason, '') ILIKE $${idx++})`);
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const page = pagination.page ?? 1;
  const perPage = pagination.per_page ?? 10;
  const offset = (page - 1) * perPage;
  const totalRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM resignations r LEFT JOIN employees e ON e.id = r.employee_id ${where}`,
    params
  );
  const total = totalRes.rows[0]?.n ?? 0;
  const { rows } = await query(
    `SELECT r.*, COALESCE(e.full_name, 'Unknown employee') AS full_name, COALESCE(e.employee_code, '—') AS employee_code
       FROM resignations r
       LEFT JOIN employees e ON e.id = r.employee_id ${where}
      ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  return { items: rows, total, page, per_page: perPage };
}

export async function createResignation(data: { employee_id: string; notice_date: string; effective_date: string; reason?: string }) {
  const { rows } = await query(
    `INSERT INTO resignations (employee_id, notice_date, effective_date, reason, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
    [data.employee_id, data.notice_date, data.effective_date, data.reason ?? '']
  );
  return rows[0];
}

export async function updateResignationStatus(id: string, status: string) {
  const { rows } = await query(
    `UPDATE resignations SET status = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Notices (FR-043) — columns: title, body, category, published_at, is_active
// ---------------------------------------------------------------------------

export async function listNotices() {
  const { rows } = await query(
    `SELECT n.* FROM notices n WHERE n.deleted_at IS NULL ORDER BY n.created_at DESC`
  );
  return rows;
}

export async function createNotice(data: { title: string; body: string; category?: string }) {
  const { rows } = await query(
    `INSERT INTO notices (title, body, category, published_at)
     VALUES ($1, $2, $3, now()) RETURNING *`,
    [data.title, data.body, data.category ?? 'general']
  );
  return rows[0];
}

export async function updateNotice(id: string, data: { title?: string; body?: string; category?: string; is_active?: boolean }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (data.title !== undefined) { sets.push(`title = $${idx++}`); params.push(data.title); }
  if (data.body !== undefined) { sets.push(`body = $${idx++}`); params.push(data.body); }
  if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category); }
  if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.is_active); }
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await query(`UPDATE notices SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND deleted_at IS NULL RETURNING *`, params);
  return rows[0] ?? null;
}

export async function removeNotice(id: string) {
  await query('UPDATE notices SET deleted_at = now() WHERE id = $1::uuid', [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Loans (FR-044) — columns: amount, interest_rate, monthly_deduction, loan_date, start_month, end_month, status
// ---------------------------------------------------------------------------

export async function listLoans(
  filters: { employee_id?: string | undefined; status?: string | undefined; search?: string | undefined } = {},
  pagination: { page?: number; per_page?: number } = {}
): Promise<PaginatedList<Record<string, unknown>>> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.employee_id) {
    wheres.push(`l.employee_id = $${idx++}`);
    params.push(filters.employee_id);
  }
  if (filters.status) {
    wheres.push(`l.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.search) {
    wheres.push(`(COALESCE(e.full_name, '') ILIKE $${idx++} OR COALESCE(l.notes, '') ILIKE $${idx++})`);
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const page = pagination.page ?? 1;
  const perPage = pagination.per_page ?? 10;
  const offset = (page - 1) * perPage;
  const totalRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM loans l LEFT JOIN employees e ON e.id = l.employee_id ${where}`,
    params
  );
  const total = totalRes.rows[0]?.n ?? 0;
  const { rows } = await query(
    `SELECT l.*, COALESCE(e.full_name, 'Unknown employee') AS full_name, COALESCE(e.employee_code, '—') AS employee_code
       FROM loans l
       LEFT JOIN employees e ON e.id = l.employee_id ${where}
      ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );
  return { items: rows, total, page, per_page: perPage };
}

export async function createLoan(data: { employee_id: string; amount: number; interest_rate: number; loan_date: string; start_month?: string; installment_count: number; deduction_day: number; notes?: string; status?: string }) {
  return withTransaction(async (client) => {
    const amount = Math.max(0, Number(data.amount));
    const interestRate = Math.max(0, Number(data.interest_rate));
    const loanDate = data.loan_date; // 'YYYY-MM-DD'
    const installmentCount = Math.max(1, Math.floor(Number(data.installment_count)));
    const deductionDay = Math.max(1, Math.min(31, Math.floor(Number(data.deduction_day))));

    // Flat interest: total interest = principal × rate / 100 (rate is flat total, not annualized)
    const interestAmount = Math.round((amount * interestRate) / 100 * 100) / 100;
    const totalPayable = Math.round((amount + interestAmount) * 100) / 100;

    // Equal monthly installments (may have a different final installment due to rounding)
    const monthlyInstallment = Math.round((totalPayable / installmentCount) * 100) / 100;
    const finalInstallment = Math.round((totalPayable - monthlyInstallment * (installmentCount - 1)) * 100) / 100;

    // Compute first deduction date: deduction day of the month after loan_date
    const [loanYear, loanMonth] = loanDate.split('-').map(Number);
    const startYear = loanMonth === 12 ? loanYear + 1 : loanYear;
    const startMonth = loanMonth === 12 ? 1 : loanMonth + 1;
    const lastDay = new Date(startYear, startMonth, 0).getDate();
    const dueDay = Math.min(deductionDay, lastDay);
    const firstDueDate = new Date(startYear, startMonth - 1, dueDay).toISOString().slice(0, 10);

    // Final deduction date = first_due + (count-1) months
    const finalDue = new Date(firstDueDate);
    finalDue.setMonth(finalDue.getMonth() + installmentCount - 1);
    const endMonth = finalDue.toISOString().slice(0, 7); // 'YYYY-MM'

    // 1. Insert loan master with computed fields
    const { rows: loanRows } = await client.query(
      `INSERT INTO loans (employee_id, amount, interest_rate, monthly_deduction, loan_date, start_month, end_month, notes, status, interest_amount, total_payable, installment_mode, installment_count, monthly_installment_amount, deduction_day)
       VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5::date, $6, $7, $8, $9, $10::numeric, $11::numeric, 'count', $12::integer, $13::numeric, $14::integer)
       RETURNING *`,
      [
        data.employee_id,
        amount,
        interestRate,
        monthlyInstallment,
        loanDate,
        data.start_month ?? null,
        endMonth,
        data.notes ?? null,
        data.status ?? 'active',
        interestAmount,
        totalPayable,
        installmentCount,
        monthlyInstallment,
        deductionDay,
      ]
    );
    const loan = loanRows[0];

    // 2. Insert installment schedule rows
    let due = new Date(firstDueDate);
    for (let i = 1; i <= installmentCount; i++) {
      const iAmount = i === installmentCount ? finalInstallment : monthlyInstallment;
      const iCents = Math.round(iAmount * 100);

      // due_date = firstDue + (i-1) months
      const d = new Date(due);
      d.setMonth(d.getMonth() + (i - 1));
      const dueDateISO = d.toISOString().slice(0, 10);

      await client.query(
        `INSERT INTO loan_installments (loan_id, installment_no, due_date, amount, principal_component, interest_component, status)
         VALUES ($1::uuid, $2::integer, $3::date, $4::numeric, $5::numeric, $6::numeric, 'pending')`,
        [loan.id, i, dueDateISO, iCents, 0, 0]
      );

      // advance due by one month for next iteration
      due = d;
    }

    return loan;
  });
}

export async function updateLoanStatus(id: string, status: string) {
  const { rows } = await query(
    `UPDATE loans SET status = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// HR Policies (FR-045) — columns: title, body, category, effective_date, is_active
// ---------------------------------------------------------------------------

export async function listPolicies(filters: { category?: string | undefined } = {}) {
  const wheres: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.category) { wheres.push(`p.category = $${idx++}`); params.push(filters.category); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const { rows } = await query(`SELECT p.* FROM hr_policies p ${where} ORDER BY p.created_at DESC`, params);
  return rows;
}

export async function createPolicy(data: { title: string; body: string; category?: string }) {
  const { rows } = await query(
    `INSERT INTO hr_policies (title, body, category, is_active)
     VALUES ($1, $2, $3, true) RETURNING *`,
    [data.title, data.body, data.category ?? 'general']
  );
  return rows[0];
}

export async function updatePolicy(id: string, data: { title?: string; body?: string; category?: string; is_active?: boolean }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (data.title !== undefined) { sets.push(`title = $${idx++}`); params.push(data.title); }
  if (data.body !== undefined) { sets.push(`body = $${idx++}`); params.push(data.body); }
  if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category); }
  if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.is_active); }
  if (sets.length === 0) return null;
  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await query(`UPDATE hr_policies SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND deleted_at IS NULL RETURNING *`, params);
  return rows[0] ?? null;
}

export async function removePolicy(id: string) {
  await query('UPDATE hr_policies SET deleted_at = now() WHERE id = $1::uuid', [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Employee self-service profile update (ESS) — whitelisted fields only
// ---------------------------------------------------------------------------

export const SELF_PROFILE_EMPLOYEE_FIELDS = [
  'mobile',
  'work_phone',
  'whatsapp',
  'marital_status',
  'blood_group',
  'nid_passport',
] as const;

export const SELF_PROFILE_BANK_FIELDS = [
  'bank_name',
  'account_name',
  'account_number',
  'branch',
  'routing_number',
  'iban',
] as const;

export const SELF_PROFILE_ADDRESS_FIELDS = [
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'country',
  'district',
  'thana',
] as const;

export async function updateMyProfile(
  employeeId: string,
  patch: {
    employee?: Record<string, unknown>;
    bank?: Record<string, unknown>;
    address?: Record<string, unknown>;
  }
): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const empPatch = patch.employee ?? {};
    const empKeys = Object.keys(empPatch).filter((k) =>
      (SELF_PROFILE_EMPLOYEE_FIELDS as readonly string[]).includes(k)
    );
    if (empKeys.length > 0) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const k of empKeys) {
        const v = empPatch[k];
        sets.push(`${k} = $${idx++}`);
        params.push(v === '' ? null : v);
      }
      sets.push('updated_at = now()');
      params.push(employeeId);
      await client.query(
        `UPDATE employees SET ${sets.join(', ')} WHERE id = $${idx}::uuid AND deleted_at IS NULL`,
        params
      );
    }

    const bankPatch = patch.bank ?? {};
    const bankKeys = Object.keys(bankPatch).filter((k) =>
      (SELF_PROFILE_BANK_FIELDS as readonly string[]).includes(k)
    );
    if (bankKeys.length > 0) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const k of bankKeys) {
        const v = bankPatch[k];
        sets.push(`${k} = $${idx++}`);
        params.push(v === '' ? null : v);
      }
      sets.push('updated_at = now()');
      params.push(employeeId);
      await client.query(
        `UPDATE employee_banks SET ${sets.join(', ')} WHERE employee_id = $${idx}::uuid`,
        params
      );
    }

    const addrPatch = patch.address ?? {};
    const addrKeys = Object.keys(addrPatch).filter((k) =>
      (SELF_PROFILE_ADDRESS_FIELDS as readonly string[]).includes(k)
    );
    if (addrKeys.length > 0) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (const k of addrKeys) {
        const v = addrPatch[k];
        sets.push(`${k} = $${idx++}`);
        params.push(v === '' ? null : v);
      }
      sets.push('updated_at = now()');
      params.push(employeeId);
      await client.query(
        `UPDATE employee_addresses SET ${sets.join(', ')} WHERE employee_id = $${idx}::uuid`,
        params
      );
    }

    const detail = await getEmployeeDetailByClient(client, employeeId);
    return detail;
  });
}

async function getEmployeeDetailByClient(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  employeeId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query('SELECT * FROM employees WHERE id = $1::uuid AND deleted_at IS NULL', [employeeId]);
  if (!rows[0]) return null;
  const [banks, addresses] = await Promise.all([
    client.query('SELECT * FROM employee_banks WHERE employee_id = $1::uuid', [employeeId]),
    client.query('SELECT * FROM employee_addresses WHERE employee_id = $1::uuid', [employeeId]),
  ]);
  return { ...(rows[0] as Record<string, unknown>), banks: banks.rows, addresses: addresses.rows };
}

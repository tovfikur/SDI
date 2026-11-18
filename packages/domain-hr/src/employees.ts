/**
 * Employee domain (Spec FR-030..038, BR-003, BR-012, SM-3).
 * 9-step wizard create is a single transaction across all sub-entities; update
 * uses optimistic concurrency (version); deletes are soft (status = deleted).
 */

import {
  list,
  query,
  getById,
  insertRow,
  updateRow,
  softDeleteRow,
  withTransaction,
  parsePagination,
} from '@jsk/shared-kernel';
import type { PaginatedResponse, Queryable } from '@jsk/shared-kernel';
import { EMPLOYEE_COLUMNS, EMPLOYEE_JOINS, EMPLOYEE_SELECT, listEmployees } from './masters';
import type { ListInput } from './masters';

export interface EmployeeBase {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  blood_group: string | null;
  contract_type: string | null;
  joining_date: string | null;
  contract_end_date: string | null;
  department_id: string | null;
  sub_department_id: string | null;
  position_id: string | null;
  employee_type_id: string | null;
  setup_rule_id: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  status: string;
  version: number;
  photo_url: string | null;
  nid_passport: string | null;
  supervisor_id: string | null;
  probation_months: number | null;
  workplace: string | null;
  work_phone: string | null;
  whatsapp: string | null;
  device_id: string | null;
  basic_salary: string | null;
  working_days: number | null;
  joining_letter_url: string | null;
  appointment_letter_file_id: string | null;
  photo_file_id: string | null;
}

export interface EmployeeDetail extends EmployeeBase {
  banks: Record<string, unknown>[];
  addresses: Record<string, unknown>[];
  emergencyContacts: Record<string, unknown>[];
  academics: Record<string, unknown>[];
  extraCurriculars: Record<string, unknown>[];
  experiences: Record<string, unknown>[];
  familyMembers: Record<string, unknown>[];
}

export interface BankInfo {
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  branch: string | null;
  iban: string | null;
  salary_receiving_method: string | null;
  routing_number: string | null;
}

export interface AddressInfo {
  type: string;
  country: string | null;
  state: string | null;
  district: string | null;
  city: string | null;
  thana: string | null;
  zip: string | null;
  address_line1: string | null;
  address_line2: string | null;
}

export interface EmergencyContactInfo {
  name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface AcademicInfo {
  degree: string | null;
  field_of_study: string | null;
  institution: string | null;
  board: string | null;
  result: string | null;
  start_year: number | null;
  end_year: number | null;
  grade: string | null;
  attachment_url: string | null;
}

export interface ExtraCurricularInfo {
  activity: string | null;
  description: string | null;
  year: number | null;
  attachment_url: string | null;
}

export interface ExperienceInfo {
  company: string | null;
  designation: string | null;
  start_date: string | null;
  end_date: string | null;
  salary: string | null;
  responsibilities: string | null;
  separation_reason: string | null;
  attachment_url: string | null;
}

export interface FamilyMemberInfo {
  name: string | null;
  relationship: string | null;
  date_of_birth: string | null;
  occupation: string | null;
  phone: string | null;
  email: string | null;
  attachment_url: string | null;
}

export interface EmployeeWizardPayload {
  employee: Omit<EmployeeBase, 'id' | 'version' | 'status'>;
  banks?: BankInfo[];
  addresses?: AddressInfo[];
  emergencyContacts?: EmergencyContactInfo[];
  academics?: AcademicInfo[];
  extraCurriculars?: ExtraCurricularInfo[];
  experiences?: ExperienceInfo[];
  familyMembers?: FamilyMemberInfo[];
}

export type EmployeeCreatePayload =
  | EmployeeWizardPayload
  | (Omit<EmployeeWizardPayload['employee'], 'id' | 'version' | 'status'> & {
      banks?: BankInfo[];
      addresses?: AddressInfo[];
      emergencyContacts?: EmergencyContactInfo[];
      academics?: AcademicInfo[];
      extraCurriculars?: ExtraCurricularInfo[];
      experiences?: ExperienceInfo[];
      familyMembers?: FamilyMemberInfo[];
    });

export async function listEmployeesPage(input: ListInput & { status?: 'active' | 'inactive' }): Promise<PaginatedResponse<Record<string, unknown>>> {
  if (input.status === 'inactive') {
    const filters = [...(input.filters ?? []), { field: 'status', value: 'inactive', operator: 'eq' as const }];
    return list({
      table: 'employees e',
      columns: EMPLOYEE_COLUMNS,
      joins: EMPLOYEE_JOINS,
      select: EMPLOYEE_SELECT,
      filters,
      search: input.search,
      searchableColumns: ['full_name', 'employee_code', 'email'],
      sort: input.sort,
      defaultSort: { field: 'full_name', direction: 'asc' },
      activeOnly: true,
      pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
    });
  }
  return listEmployees(input);
}

export async function getEmployee(id: string, q?: Queryable): Promise<EmployeeDetail | null> {
  const load = async (client: Queryable): Promise<EmployeeDetail | null> => {
    const employee = await getById<EmployeeBase>('employees', id, '*', client);
    if (!employee) {
      return null;
    }
    const sub = async (table: string): Promise<Record<string, unknown>[]> =>
      (await client.query(`SELECT * FROM ${table} WHERE employee_id = $1 ORDER BY created_at`, [id])).rows;
    const [banks, addresses, emergencyContacts, academics, extraCurriculars, experiences, familyMembers] =
      await Promise.all([
        sub('employee_banks'),
        sub('employee_addresses'),
        sub('employee_emergency_contacts'),
        sub('employee_academic'),
        sub('employee_extra_curriculars'),
        sub('employee_experiences'),
        sub('employee_family_members'),
      ]);
    return {
      ...employee,
      banks,
      addresses,
      emergencyContacts,
      academics,
      extraCurriculars,
      experiences,
      familyMembers,
    };
  };
  return q ? load(q) : withTransaction(load);
}

export async function nextEmployeeCode(client: { query: (s: string, p?: unknown[]) => Promise<{ rows: Array<{ max: string | null }> }> }): Promise<string> {
  const { rows } = await client.query(`SELECT max(employee_code) AS max FROM employees`);
  const max = rows[0]?.max ?? 'SDI-0000';
  const num = Number(max.replace(/\D+/g, '')) + 1;
  return `SDI-${String(num).padStart(4, '0')}`;
}

const assertDateOrder = (employee: Pick<EmployeeWizardPayload['employee'], 'joining_date' | 'contract_end_date'>): void => {
  const { joining_date, contract_end_date } = employee;
  if (joining_date && contract_end_date && contract_end_date < joining_date) {
    throw new Error('employees.contract_end_before_joining');
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (v: unknown): boolean =>
  typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Validates an employee create payload (flat or wizard shape) against the
 * actual schema: required fields, date formats/order, FK references and the
 * unique employee_code constraint. Returns a map of field -> friendly message.
 */
export async function validateEmployeeCreate(payload: EmployeeCreatePayload): Promise<Record<string, string>> {
  const wizardShape = 'employee' in payload && payload.employee !== undefined;
  const employee = wizardShape
    ? payload.employee
    : (payload as Omit<EmployeeWizardPayload['employee'], 'id' | 'version' | 'status'>);
  const errors: Record<string, string> = {};

  if (!employee.full_name || !employee.full_name.trim()) {
    errors.full_name = 'Full Name is required.';
  }

  for (const f of ['joining_date', 'contract_end_date', 'date_of_birth'] as const) {
    const v = employee[f];
    if (v === undefined || v === null || v === '') continue;
    if (!isValidIsoDate(v)) {
      errors[f] = 'Invalid date. Use YYYY-MM-DD format.';
    }
  }

  const { joining_date, contract_end_date } = employee;
  if (joining_date && contract_end_date && contract_end_date < joining_date) {
    errors.contract_end_date = 'Contract End Date cannot be before Joining Date.';
  }

  const fkChecks: { field: string; table: string; label: string; activeOnly?: boolean }[] = [
    { field: 'department_id', table: 'departments', label: 'Department' },
    { field: 'sub_department_id', table: 'sub_departments', label: 'Sub Department' },
    { field: 'position_id', table: 'positions', label: 'Position' },
    { field: 'employee_type_id', table: 'employee_types', label: 'Employee Type' },
    { field: 'setup_rule_id', table: 'setup_rules', label: 'Setup Rule', activeOnly: true },
  ];

  for (const c of fkChecks) {
    const v = (employee as Record<string, unknown>)[c.field];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !UUID_RE.test(v)) {
      errors[c.field] = `Invalid ${c.label} selected.`;
      continue;
    }
    const { rows } = await query(
      `SELECT id FROM ${c.table} WHERE id = $1::uuid AND deleted_at IS NULL${c.activeOnly ? ' AND is_active = true' : ''}`,
      [v]
    );
    if (rows.length === 0) {
      errors[c.field] = c.activeOnly ? `${c.label} not found or inactive.` : `${c.label} not found.`;
    }
  }

  if (
    employee.sub_department_id &&
    employee.department_id &&
    !errors.department_id &&
    !errors.sub_department_id
  ) {
    const { rows } = await query('SELECT department_id FROM sub_departments WHERE id = $1::uuid', [
      employee.sub_department_id,
    ]);
    if (rows.length > 0 && rows[0].department_id !== employee.department_id) {
      errors.sub_department_id = 'Sub Department does not belong to the selected Department.';
    }
  }

  if (employee.employee_code) {
    const { rows } = await query('SELECT id FROM employees WHERE employee_code = $1', [employee.employee_code]);
    if (rows.length > 0) {
      errors.employee_code = 'Employee ID already exists.';
    }
  }

  return errors;
}

export async function createEmployee(payload: EmployeeCreatePayload): Promise<EmployeeDetail> {
  const wizardShape = 'employee' in payload && payload.employee !== undefined;
  const employee = wizardShape
    ? payload.employee
    : (payload as Omit<EmployeeWizardPayload['employee'], 'id' | 'version' | 'status'>);
  const subEntities = payload as Pick<EmployeeWizardPayload, 'banks' | 'addresses' | 'emergencyContacts' | 'academics' | 'extraCurriculars' | 'experiences' | 'familyMembers'>;

  assertDateOrder(employee);
  return withTransaction(async (client) => {
    const employeeData: Record<string, unknown> = { ...employee };
    if (!employeeData.employee_code) {
      employeeData.employee_code = await nextEmployeeCode(client);
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO employees (employee_code, full_name, email, mobile, date_of_birth, gender,
         marital_status, blood_group, contract_type, joining_date, contract_end_date,
         department_id, sub_department_id, position_id, employee_type_id, setup_rule_id, status,
         photo_url, nid_passport, supervisor_id, probation_months, workplace, work_phone, whatsapp,
         device_id, basic_salary, working_days, joining_letter_url, appointment_letter_file_id,
         photo_file_id, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',
         $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING id`,
      [
        employeeData.employee_code,
        employee.full_name,
        employee.email ?? null,
        employee.mobile ?? null,
        employee.date_of_birth ?? null,
        employee.gender ?? null,
        employee.marital_status ?? null,
        employee.blood_group ?? null,
        employee.contract_type ?? null,
        employee.joining_date ?? null,
        employee.contract_end_date ?? null,
        employee.department_id ?? null,
        employee.sub_department_id ?? null,
        employee.position_id ?? null,
        employee.employee_type_id ?? null,
        employee.setup_rule_id ?? null,
        employeeData.photo_url ?? null,
        employeeData.nid_passport ?? null,
        employeeData.supervisor_id ?? null,
        employeeData.probation_months ?? null,
        employeeData.workplace ?? null,
        employeeData.work_phone ?? null,
        employeeData.whatsapp ?? null,
        employeeData.device_id ?? null,
        employeeData.basic_salary ?? null,
        employeeData.working_days ?? 26,
        employeeData.joining_letter_url ?? null,
        employeeData.appointment_letter_file_id ?? null,
        employeeData.photo_file_id ?? null,
        employee.branch_id ?? null,
      ]
    );
    const employeeId = rows[0].id;

    const insertSub = async (table: string, rowsIn: Array<Record<string, unknown>>): Promise<void> => {
      for (const row of rowsIn) {
        const data = { employee_id: employeeId, ...row };
        await insertRow(table, data, client);
      }
    };

    await insertSub('employee_banks', (subEntities.banks ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_addresses', (subEntities.addresses ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_emergency_contacts', (subEntities.emergencyContacts ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_academic', (subEntities.academics ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_extra_curriculars', (subEntities.extraCurriculars ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_experiences', (subEntities.experiences ?? []) as unknown as Array<Record<string, unknown>>);
    await insertSub('employee_family_members', (subEntities.familyMembers ?? []) as unknown as Array<Record<string, unknown>>);

    return (await getEmployee(employeeId, client))!;
  });
}

export async function updateEmployee(
  id: string,
  data: Partial<EmployeeWizardPayload['employee']> & { version?: number }
): Promise<EmployeeBase | null> {
  const { version, ...rest } = data;
  for (const [k, v] of Object.entries(rest)) {
    if (v === '') (rest as Record<string, unknown>)[k] = null;
  }
  if (rest.joining_date && rest.contract_end_date && rest.contract_end_date < rest.joining_date) {
    throw new Error('employees.contract_end_before_joining');
  }
  return updateRow<EmployeeBase>(
    'employees',
    id,
    { ...rest, ...(version !== undefined ? { version } : {}) },
    { versioned: version !== undefined }
  );
}

export async function removeEmployee(id: string): Promise<boolean> {
  return softDeleteRow('employees', id, { status: 'deleted' });
}

export async function listInactive(input: ListInput): Promise<PaginatedResponse<Record<string, unknown>>> {
  return list({
    table: 'employees e',
    columns: EMPLOYEE_COLUMNS,
    joins: EMPLOYEE_JOINS,
    select: EMPLOYEE_SELECT,
    filters: [{ field: 'status', value: 'inactive', operator: 'eq' }],
    search: input.search,
    searchableColumns: ['full_name', 'employee_code'],
    sort: input.sort,
    defaultSort: { field: 'full_name', direction: 'asc' },
    pagination: { page: input.page ?? 1, per_page: (input.per_page as 10 | 25 | 50 | 100) ?? 10 },
  });
}

export async function setEmployeeStatus(id: string, status: 'active' | 'inactive'): Promise<EmployeeBase | null> {
  return updateRow<EmployeeBase>('employees', id, { status });
}

// ---------------------------------------------------------------------------
// Performance (FR-036) / Performance Appraisal System (Spec 1.3, Sections A-F)
// ---------------------------------------------------------------------------

export type AppraisalSection = 'A' | 'B';
export type AppraisalRating = 'Poor' | 'Need Improvement' | 'Good' | 'Very Good' | 'Excellent';

export const APPRAISAL_SECTION_A_CRITERIA = [
  'Knowledge of Duties & Quality of Work',
  'Timeliness of Delivery',
  'Impact of Achievement',
  'Overall Achievement of Goals',
  'Going Beyond Call of Duty',
] as const;

export const APPRAISAL_SECTION_B_CRITERIA = [
  'Interpersonal Skills & Teamwork',
  'Attendance & Punctuality',
  'Communication Skills',
  'Contribution to Mission',
] as const;

export const APPRAISAL_SCALE_A: Record<AppraisalRating, number> = {
  Poor: 0,
  'Need Improvement': 3,
  Good: 6,
  'Very Good': 9,
  Excellent: 12,
};

export const APPRAISAL_SCALE_B: Record<AppraisalRating, number> = {
  Poor: 2,
  'Need Improvement': 4,
  Good: 6,
  'Very Good': 9,
  Excellent: 10,
};

export const APPRAISAL_SECTION_A_MAX = 60;
export const APPRAISAL_SECTION_B_MAX = 40;
export const APPRAISAL_TOTAL_MAX = 100;

export const APPRAISAL_RATINGS: AppraisalRating[] = [
  'Poor',
  'Need Improvement',
  'Good',
  'Very Good',
  'Excellent',
];

export type PerformanceClassification = 'EE' | 'AE' | 'UE';

/** Auto-classification (Spec 1.3, Section C): EE 80+, AE 75-79, UE below 75. */
export function classifyPerformance(totalScore: number): PerformanceClassification {
  if (totalScore >= 80) return 'EE';
  if (totalScore >= 75) return 'AE';
  return 'UE';
}

/** Points awarded for a rating within a section (A: max 12/row, B: max 10/row). */
export function appraisalRatingScore(section: AppraisalSection, rating: AppraisalRating): number {
  return section === 'A' ? APPRAISAL_SCALE_A[rating] : APPRAISAL_SCALE_B[rating];
}

/** Section D: employee comments are capped at 500 words (Spec 1.3). */
export function countWords(text: string | null | undefined): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export interface AppraisalScore {
  section: AppraisalSection;
  criterion: string;
  rating: AppraisalRating;
  notes?: string;
}

export interface AppraisalDevelopmentPlan {
  improvement_area?: string;
  expected_outcome?: string;
  mentor_name?: string;
  start_date?: string;
  end_date?: string;
}

export interface AppraisalNextGoal {
  goal?: string;
  target_period?: string;
}

export interface PerformancePayload {
  employee_id: string;
  position_title?: string;
  position_date?: string;
  performance_date?: string;
  reviewer_name?: string;
  evaluator_name?: string;
  reviewer_signature?: string;
  next_review_date?: string;
  reviewer_recommendations?: string;
  employee_comments?: string;
  notes?: string;
  section_a?: AppraisalScore[];
  section_b?: AppraisalScore[];
  scores?: Array<{
    criterion: string;
    score: number;
    max_score?: number;
    notes?: string;
    section?: AppraisalSection;
    rating?: AppraisalRating;
  }>;
  development_plans?: AppraisalDevelopmentPlan[];
  next_goals?: AppraisalNextGoal[];
}

export interface PerformanceUpdatePayload {
  position_title?: string;
  position_date?: string;
  performance_date?: string;
  reviewer_name?: string;
  evaluator_name?: string;
  reviewer_signature?: string;
  next_review_date?: string;
  reviewer_recommendations?: string;
  employee_comments?: string;
  notes?: string;
  total_score?: number;
  section_a?: AppraisalScore[];
  section_b?: AppraisalScore[];
  scores?: Array<{
    criterion: string;
    score: number;
    max_score?: number;
    notes?: string;
    section?: AppraisalSection;
    rating?: AppraisalRating;
  }>;
  development_plans?: AppraisalDevelopmentPlan[];
  next_goals?: AppraisalNextGoal[];
}

interface NormalizedScore {
  criterion: string;
  score: number;
  max_score: number;
  notes: string | null;
  section: AppraisalSection;
  rating: AppraisalRating | null;
}

type ScoreInput = {
  section?: AppraisalSection;
  criterion?: string;
  score?: number;
  max_score?: number;
  notes?: string;
  rating?: AppraisalRating;
};

function normalizeScores(payload: PerformancePayload | PerformanceUpdatePayload): NormalizedScore[] {
  const rows: NormalizedScore[] = [];
  const push = (s: ScoreInput): void => {
    const section = (s.section ?? 'A') as AppraisalSection;
    const criterion = String(s.criterion ?? '').trim();
    if (!criterion) return;
    const rating = (s.rating ?? null) as AppraisalRating | null;
    const maxScore = section === 'A' ? 12 : 10;
    const score = rating !== null
      ? appraisalRatingScore(section, rating)
      : Number(s.score ?? 0);
    rows.push({
      criterion,
      score,
      max_score: Number(s.max_score ?? maxScore),
      notes: String(s.notes ?? '').trim() || null,
      section,
      rating,
    });
  };
  for (const s of payload.section_a ?? []) push(s);
  for (const s of payload.section_b ?? []) push(s);
  if ((payload.section_a === undefined || payload.section_b === undefined) && payload.scores) {
    for (const s of payload.scores) push(s);
  }
  return rows;
}

function computeAppraisalTotal(rows: NormalizedScore[]): number {
  return Math.round(rows.reduce((sum, r) => sum + r.score, 0) * 100) / 100;
}

export async function createPerformance(payload: PerformancePayload): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const scoreRows = normalizeScores(payload);
    const totalScore = computeAppraisalTotal(scoreRows);
    const classification = classifyPerformance(totalScore);
    const reviewerName = payload.reviewer_name ?? payload.evaluator_name ?? null;
    const { rows } = await client.query(
      `INSERT INTO employee_performances (
         employee_id, position_title, position_date, performance_date,
         evaluator_name, total_score, notes, employee_comments, classification,
         reviewer_recommendations, reviewer_signature, next_review_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        payload.employee_id,
        payload.position_title ?? null,
        payload.position_date ?? null,
        payload.performance_date ?? null,
        reviewerName,
        totalScore,
        payload.notes ?? null,
        payload.employee_comments ?? null,
        classification,
        payload.reviewer_recommendations ?? null,
        payload.reviewer_signature ?? null,
        payload.next_review_date ?? null,
      ]
    );
    const performanceId = rows[0].id;
    for (const score of scoreRows) {
      await client.query(
        `INSERT INTO employee_performance_scores (performance_id, section, criterion, rating, score, max_score, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [performanceId, score.section, score.criterion, score.rating, score.score, score.max_score, score.notes]
      );
    }
    for (const plan of payload.development_plans ?? []) {
      await client.query(
        `INSERT INTO employee_performance_development_plans
           (performance_id, improvement_area, expected_outcome, mentor_name, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          performanceId,
          plan.improvement_area ?? null,
          plan.expected_outcome ?? null,
          plan.mentor_name ?? null,
          plan.start_date ?? null,
          plan.end_date ?? null,
        ]
      );
    }
    for (const goal of payload.next_goals ?? []) {
      await client.query(
        `INSERT INTO employee_performance_next_goals (performance_id, goal, target_period)
         VALUES ($1,$2,$3)`,
        [performanceId, goal.goal ?? null, goal.target_period ?? null]
      );
    }
    return (await client.query(`SELECT * FROM employee_performances WHERE id = $1`, [performanceId])).rows[0];
  });
}

export async function listPerformances(employeeId?: string): Promise<Record<string, unknown>[]> {
  const sql = employeeId
    ? `SELECT ep.*, e.full_name FROM employee_performances ep
       JOIN employees e ON e.id = ep.employee_id
       WHERE ep.employee_id = $1 ORDER BY ep.performance_date DESC`
    : `SELECT ep.*, e.full_name FROM employee_performances ep
       JOIN employees e ON e.id = ep.employee_id ORDER BY ep.performance_date DESC`;
  const { rows } = await query(sql, employeeId ? [employeeId] : []);
  return rows;
}

export interface PerformanceListFilters {
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface PerformanceSummary {
  total_reviews: number;
  avg_score: number | null;
  reviewed_employees: number;
  pending_reviews: number;
}

/** Paginated performance list (used by the employee performance page).
 *  Uses LEFT JOIN + COALESCE so orphaned/missing employee relations render
 *  safely instead of crashing or vanishing. */
export async function listPerformancesPage(
  filters: PerformanceListFilters = {},
  pagination: { page?: number; per_page?: number } = {}
): Promise<PaginatedResponse<Record<string, unknown>> & { summary: PerformanceSummary }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (filters.employee_id) {
    wheres.push(`ep.employee_id = $${idx++}::uuid`);
    params.push(filters.employee_id);
  }
  if (filters.date_from) {
    wheres.push(`ep.performance_date >= $${idx++}::date`);
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    wheres.push(`ep.performance_date <= $${idx++}::date`);
    params.push(filters.date_to);
  }
  if (filters.search && filters.search.trim() !== '') {
    const term = `%${filters.search.trim()}%`;
    wheres.push(
      `(COALESCE(e.full_name, '') ILIKE $${idx++}
        OR COALESCE(e.employee_code, '') ILIKE $${idx++}
        OR COALESCE(ep.evaluator_name, '') ILIKE $${idx++})`
    );
    params.push(term, term, term);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const joins = `LEFT JOIN employees e ON e.id = ep.employee_id
                 LEFT JOIN positions p ON p.id = e.position_id
                 LEFT JOIN departments d ON d.id = e.department_id`;
  const page = pagination.page ?? 1;
  const perPage = pagination.per_page ?? 10;
  const offset = (page - 1) * perPage;
  const { page: pageClamped, per_page: perPageClamped } = parsePagination(page, perPage);

  const totalRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employee_performances ep ${joins} ${where}`,
    params
  );
  const total = totalRes.rows[0]?.n ?? 0;

  const { rows } = await query(
    `SELECT ep.*,
            COALESCE(e.full_name, 'Unknown employee') AS full_name,
            COALESCE(e.employee_code, '—') AS employee_code,
            p.name AS position_name,
            d.name AS department_name
       FROM employee_performances ep
       ${joins}
       ${where}
      ORDER BY ep.performance_date DESC NULLS LAST, ep.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, offset]
  );

  const sumRes = await query<{ reviews: number; avg: string | null; distinct_employees: number }>(
    `SELECT count(*)::int AS reviews,
            round(avg(ep.total_score)::numeric, 2)::text AS avg,
            count(DISTINCT ep.employee_id)::int AS distinct_employees
       FROM employee_performances ep ${joins} ${where}`,
    params
  );
  const s = sumRes.rows[0];
  const activeRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM employees WHERE status = 'active'`
  );
  const reviewed = s?.distinct_employees ?? 0;
  const pending = Math.max(0, (activeRes.rows[0]?.n ?? 0) - reviewed);

  const summary: PerformanceSummary = {
    total_reviews: s?.reviews ?? 0,
    avg_score: s?.avg != null ? Number(s.avg) : null,
    reviewed_employees: reviewed,
    pending_reviews: pending,
  };

  return {
    items: rows,
    total,
    page: pageClamped,
    per_page: perPageClamped,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
    summary,
  };
}

export async function getPerformanceScores(performanceId: string, queryable?: Queryable): Promise<Record<string, unknown>[]> {
  const { rows } = await query(
    `SELECT * FROM employee_performance_scores WHERE performance_id = $1 ORDER BY section, created_at`,
    [performanceId],
    queryable
  );
  return rows;
}

export async function getPerformance(performanceId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query(
    `SELECT ep.*, e.full_name FROM employee_performances ep
     JOIN employees e ON e.id = ep.employee_id WHERE ep.id = $1`,
    [performanceId]
  );
  if (rows.length === 0) return null;
  const [scores, developmentPlans, nextGoals] = await Promise.all([
    getPerformanceScores(performanceId),
    query(`SELECT * FROM employee_performance_development_plans WHERE performance_id = $1 ORDER BY created_at`, [performanceId]),
    query(`SELECT * FROM employee_performance_next_goals WHERE performance_id = $1 ORDER BY created_at`, [performanceId]),
  ]);
  return {
    ...rows[0],
    scores: scores,
    development_plans: developmentPlans.rows,
    next_goals: nextGoals.rows,
  };
}

export async function updatePerformance(
  performanceId: string,
  payload: PerformanceUpdatePayload
): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    const hasScores =
      payload.section_a !== undefined ||
      payload.section_b !== undefined ||
      payload.scores !== undefined;
    if (payload.position_title !== undefined) { sets.push(`position_title = $${idx++}`); params.push(payload.position_title); }
    if (payload.position_date !== undefined) { sets.push(`position_date = $${idx++}`); params.push(payload.position_date); }
    if (payload.performance_date !== undefined) { sets.push(`performance_date = $${idx++}`); params.push(payload.performance_date); }
    if (payload.reviewer_name !== undefined || payload.evaluator_name !== undefined) {
      sets.push(`evaluator_name = $${idx++}`);
      params.push(payload.reviewer_name ?? payload.evaluator_name);
    }
    if (payload.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(payload.notes); }
    if (payload.employee_comments !== undefined) { sets.push(`employee_comments = $${idx++}`); params.push(payload.employee_comments); }
    if (payload.reviewer_recommendations !== undefined) {
      sets.push(`reviewer_recommendations = $${idx++}`);
      params.push(payload.reviewer_recommendations);
    }
    if (payload.reviewer_signature !== undefined) { sets.push(`reviewer_signature = $${idx++}`); params.push(payload.reviewer_signature); }
    if (payload.next_review_date !== undefined) { sets.push(`next_review_date = $${idx++}`); params.push(payload.next_review_date); }
    if (hasScores) {
      const scoreRows = normalizeScores(payload);
      const totalScore = computeAppraisalTotal(scoreRows);
      sets.push(`total_score = $${idx++}`);
      params.push(totalScore);
      sets.push(`classification = $${idx++}`);
      params.push(classifyPerformance(totalScore));
    } else if (payload.total_score !== undefined) {
      sets.push(`total_score = $${idx++}`);
      params.push(payload.total_score);
      sets.push(`classification = $${idx++}`);
      params.push(classifyPerformance(payload.total_score));
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = now()');
    params.push(performanceId);
    const { rows } = await client.query(
      `UPDATE employee_performances SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
      params
    );
    if (rows.length === 0) return null;
    if (hasScores) {
      await client.query(`DELETE FROM employee_performance_scores WHERE performance_id = $1`, [performanceId]);
      const scoreRows = normalizeScores(payload);
      for (const score of scoreRows) {
        await client.query(
          `INSERT INTO employee_performance_scores (performance_id, section, criterion, rating, score, max_score, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [performanceId, score.section, score.criterion, score.rating, score.score, score.max_score, score.notes]
        );
      }
    }
    if (payload.development_plans !== undefined) {
      await client.query(`DELETE FROM employee_performance_development_plans WHERE performance_id = $1`, [performanceId]);
      for (const plan of payload.development_plans) {
        await client.query(
          `INSERT INTO employee_performance_development_plans
             (performance_id, improvement_area, expected_outcome, mentor_name, start_date, end_date)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            performanceId,
            plan.improvement_area ?? null,
            plan.expected_outcome ?? null,
            plan.mentor_name ?? null,
            plan.start_date ?? null,
            plan.end_date ?? null,
          ]
        );
      }
    }
    if (payload.next_goals !== undefined) {
      await client.query(`DELETE FROM employee_performance_next_goals WHERE performance_id = $1`, [performanceId]);
      for (const goal of payload.next_goals) {
        await client.query(
          `INSERT INTO employee_performance_next_goals (performance_id, goal, target_period)
           VALUES ($1,$2,$3)`,
          [performanceId, goal.goal ?? null, goal.target_period ?? null]
        );
      }
    }
    return {
      ...rows[0],
      scores: await getPerformanceScores(performanceId, client),
      development_plans: payload.development_plans !== undefined
        ? await (async () => {
            const r = await client.query(
              `SELECT * FROM employee_performance_development_plans WHERE performance_id = $1 ORDER BY created_at`,
              [performanceId]
            );
            return r.rows;
          })()
        : undefined,
      next_goals: payload.next_goals !== undefined
        ? await (async () => {
            const r = await client.query(
              `SELECT * FROM employee_performance_next_goals WHERE performance_id = $1 ORDER BY created_at`,
              [performanceId]
            );
            return r.rows;
          })()
        : undefined,
    };
  });
}

export async function removePerformance(performanceId: string): Promise<boolean> {
  await query(`DELETE FROM employee_performances WHERE id = $1::uuid`, [performanceId]);
  return true;
}
// ---------------------------------------------------------------------------
// Transfers (FR-037/038)
// ---------------------------------------------------------------------------

export interface TransferPayload {
  employee_id: string;
  transfer_type: 'in' | 'out';
  from_entity?: string;
  to_entity?: string;
  transfer_date?: string;
  reason?: string;
}

export async function createTransfer(payload: TransferPayload & { from_department?: string; to_department?: string; status?: string }): Promise<Record<string, unknown>> {
  return insertRow('transfers', {
    employee_id: payload.employee_id,
    transfer_type: payload.transfer_type,
    transfer_date: payload.transfer_date ?? new Date().toISOString().slice(0, 10),
    reason: payload.reason ?? null,
    from_entity: payload.from_entity ?? payload.from_department ?? null,
    to_entity: payload.to_entity ?? payload.to_department ?? null,
    status: payload.status ?? 'pending',
  });
}

export async function listTransfers(employeeId?: string): Promise<Record<string, unknown>[]> {
  const sql = employeeId
    ? `SELECT t.*, e.full_name FROM transfers t JOIN employees e ON e.id = t.employee_id
       WHERE t.employee_id = $1 ORDER BY t.transfer_date DESC`
    : `SELECT t.*, e.full_name FROM transfers t JOIN employees e ON e.id = t.employee_id ORDER BY t.transfer_date DESC`;
  const { rows } = await query(sql, employeeId ? [employeeId] : []);
  return rows;
}

export async function updateTransferStatus(id: string, status: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query(
    `UPDATE transfers SET status = $2, updated_at = now() WHERE id = $1::uuid RETURNING *`,
    [id, status]
  );
  return rows[0] ?? null;
}

/**
 * Workforce analytics (BR-018): factual headcount distribution by department,
 * employee type, and employment status.
 */
export async function employeeAnalytics(): Promise<Record<string, unknown>> {
  const [byDepartment, byBranch, byType, byStatus, joiners] = await Promise.all([
    query(
      `SELECT d.id, d.name, COUNT(*)::int AS n
         FROM employees e LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.status = 'active'
        GROUP BY d.id, d.name ORDER BY n DESC`
    ),
    query(
      `SELECT b.id, b.name, COUNT(*)::int AS n
         FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
        WHERE e.status = 'active'
        GROUP BY b.id, b.name ORDER BY n DESC`
    ),
    query(
      `SELECT t.id, t.name, COUNT(*)::int AS n
         FROM employees e LEFT JOIN employee_types t ON t.id = e.employee_type_id
        WHERE e.status = 'active'
        GROUP BY t.id, t.name ORDER BY n DESC`
    ),
    query(`SELECT status, COUNT(*)::int AS n FROM employees GROUP BY status ORDER BY n DESC`),
    query(
      `SELECT to_char(date_trunc('month', joining_date), 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM employees
        WHERE status = 'active' AND joining_date IS NOT NULL
          AND joining_date >= CURRENT_DATE - 365
        GROUP BY month ORDER BY month`
    ),
  ]);
  return { byDepartment: byDepartment.rows, byBranch: byBranch.rows, byType: byType.rows, byStatus: byStatus.rows, joiners: joiners.rows };
}

/**
 * Performance analytics (BR-018): average review score trend by month from
 * actual employee_performances records.
 */
export async function performanceTrend(): Promise<Record<string, unknown>> {
  const [trendRes, byDepartmentRes, byRatingRes] = await Promise.all([
    query(
      `SELECT to_char(COALESCE(performance_date, created_at::date), 'YYYY-MM') AS period,
              round(avg(total_score)::numeric, 1)::float8 AS avg_score,
              COUNT(*)::int AS reviews
         FROM employee_performances
        GROUP BY period ORDER BY period`
    ),
    query(
      `SELECT COALESCE(d.name, 'Unassigned') AS name,
              round(avg(ep.total_score)::numeric, 1)::float8 AS avg_score,
              COUNT(*)::int AS reviews
         FROM employee_performances ep
         JOIN employees e ON e.id = ep.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
        GROUP BY d.name ORDER BY avg_score DESC`
    ),
    query(
      `SELECT CASE
                WHEN total_score >= 90 THEN '90+'
                WHEN total_score >= 80 THEN '80-90'
                WHEN total_score >= 70 THEN '70-80'
                WHEN total_score >= 60 THEN '60-70'
                ELSE 'Under 60'
              END AS bucket,
              COUNT(*)::int AS n
         FROM employee_performances
        GROUP BY bucket ORDER BY bucket`
    ),
  ]);
  return { trend: trendRes.rows, byDepartment: byDepartmentRes.rows, byRating: byRatingRes.rows };
}

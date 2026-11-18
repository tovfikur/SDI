/**
 * API client for the SDI HRM & PM frontend.
 * Handles cookie-based auth, CSRF tokens, and typed fetch calls.
 */

const API_ORIGIN =
  import.meta.env.VITE_API_URL ??
  (typeof window !== 'undefined' && window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : '');

const API_BASE = API_ORIGIN;

export { API_BASE };

let csrfToken = '';

/** Error from the API client carrying status code and structured payload. */
export class ApiError extends Error {
  status: number;
  code?: string | undefined;
  fieldErrors?: Record<string, string> | undefined;

  constructor(
    status: number,
    message: string,
    code?: string | undefined,
    fieldErrors?: Record<string, string> | undefined
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function fetchCsrf() {
  const res = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken ?? '';
  return csrfToken;
}

export async function api<T = unknown>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    params?: Record<string, string | number | undefined> | undefined;
  } = {}
): Promise<T> {
  let url = `${API_BASE}${path}`;
  if (opts.params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
  });

  if (!res.ok) {
    const raw = await res.json().catch(() => ({}));
    const err = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const message =
      typeof err.message === 'string' && err.message
        ? err.message
        : `Request failed with status ${res.status}`;
    const fieldErrors =
      err.fieldErrors && typeof err.fieldErrors === 'object'
        ? (err.fieldErrors as Record<string, string>)
        : undefined;
    throw new ApiError(
      res.status,
      message,
      typeof err.code === 'string' ? err.code : undefined,
      fieldErrors
    );
  }
  return res.json();
}

/** DELETE with the admin delete password (protected deletes). */
function del(path: string, deletePassword?: string): Promise<unknown> {
  return api(path, {
    method: 'DELETE',
    body: deletePassword ? { deletePassword } : undefined,
  });
}

export interface EmployeeCredentials {
  username: string;
  email: string | null;
  temporary_password: string;
  must_change_password?: boolean;
  note?: string;
}

export type UserCredentials = EmployeeCredentials;

export interface CredentialsUpdateBody {
  password?: string;
  forceChange?: boolean;
  note?: string;
}

export interface Branch {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_meters?: number | null;
  is_active: boolean;
  created_at?: string;
}

export interface CreateEmployeeResult {
  employee: Record<string, unknown>;
  credentials: EmployeeCredentials | null;
}

export async function login(username: string, password: string) {
  const data = await api<{ success: boolean; user: unknown; mustChangePassword?: boolean }>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  await fetchCsrf();
  invalidateMeCache();
  return data;
}

export async function setPassword(newPassword: string) {
  return api<{ success: boolean }>('/api/auth/set-password', {
    method: 'POST',
    body: { newPassword },
  });
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    invalidateMeCache();
  }
}

export async function forgotPassword(email: string) {
  return api<{ success: boolean; message: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: { email },
  });
}

export async function verifyResetCode(email: string, code: string) {
  return api<{ success: boolean }>('/api/auth/verify-reset-code', {
    method: 'POST',
    body: { email, code },
  });
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  return api<{ success: boolean }>('/api/auth/reset-password', {
    method: 'POST',
    body: { email, code, newPassword },
  });
}

export interface PublicBranding {
  company_title: string | null;
  footer_text: string | null;
  login_bg_url: string | null;
}

export async function getBranding() {
  return api<{ data: PublicBranding }>('/api/branding');
}

export interface WorkScheduleRow {
  id: string;
  title: string;
  employee_type_id: string | null;
  employee_type_name?: string | null;
  work_pattern: string;
  daily_working_hour: string;
  office_start_time: string;
  office_end_time: string;
  grace_period_minutes: number;
  working_days: string[];
  auto_calc_hours: boolean;
  is_active: boolean;
}

export interface AppraisalScore {
  section: 'A' | 'B';
  criterion: string;
  rating: 'Poor' | 'Need Improvement' | 'Good' | 'Very Good' | 'Excellent';
  notes?: string | null;
}

export interface AppraisalDevelopmentPlan {
  improvement_area?: string | null;
  expected_outcome?: string | null;
  mentor_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface AppraisalNextGoal {
  goal?: string | null;
  target_period?: string | null;
}

export interface AppraisalPayload {
  position_title?: string | null;
  position_date?: string | null;
  performance_date?: string | null;
  reviewer_name?: string | null;
  reviewer_signature?: string | null;
  next_review_date?: string | null;
  reviewer_recommendations?: string | null;
  employee_comments?: string | null;
  notes?: string | null;
  section_a: AppraisalScore[];
  section_b: AppraisalScore[];
  development_plans: AppraisalDevelopmentPlan[];
  next_goals: AppraisalNextGoal[];
}

export interface AppraisalRow {
  id: string;
  employee_id: string | null;
  full_name?: string;
  employee_code?: string;
  position_title?: string | null;
  position_name?: string | null;
  position_date?: string | null;
  department_name?: string | null;
  performance_date?: string | null;
  evaluator_name?: string | null;
  reviewer_recommendations?: string | null;
  reviewer_signature?: string | null;
  next_review_date?: string | null;
  employee_comments?: string | null;
  total_score?: number | null;
  classification?: string | null;
  notes?: string | null;
  scores?: Array<AppraisalScore & { score: number; max_score: number }>;
  development_plans?: AppraisalDevelopmentPlan[];
  next_goals?: AppraisalNextGoal[];
}

export interface TodoRow {
  id: string;
  employee_id: string;
  todo_date: string;
  title: string;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface WorkLogRow {
  id: string;
  employee_id: string;
  project_id: string | null;
  task_id: string | null;
  work_date: string;
  status: string;
  work_description: string;
  hours: string;
  full_name: string;
  employee_code: string;
  project_name: string | null;
  task_name: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  attachment_ids: string[];
  approved_by_name?: string | null;
  rejected_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkLogSummary {
  today_hours: number;
  week_hours: number;
  pending: number;
  approved: number;
}

export interface MeResponse {
  authenticated: boolean;
  user: {
    id: string;
    username: string;
    fullName: string;
    email: string;
    isSuperAdmin: boolean;
    employeeId: string | null;
    mustChangePassword: boolean;
    roles: string[];
    permissions: string[];
  } | null;
}

export async function getMe() {
  return api<MeResponse>('/api/auth/me');
}

let mePromise: Promise<MeResponse> | null = null;

/** Deduplicates concurrent /api/auth/me calls (e.g. StrictMode double-mount). */
export function getMeCached(): Promise<MeResponse> {
  if (!mePromise) {
    mePromise = getMe().catch((err: unknown) => {
      mePromise = null;
      throw err;
    });
  }
  return mePromise;
}

/** Must be called after login/logout so the cached session state is refreshed. */
export function invalidateMeCache(): void {
  mePromise = null;
}

let currentUserId: string | null = null;

export async function getCurrentUserId(): Promise<string | null> {
  if (currentUserId) return currentUserId;
  try {
    const res = await getMe();
    if (res.authenticated && res.user) {
      currentUserId = res.user.id;
      return currentUserId;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Convenience typed helpers
export const hr = {
  me: () => api<{ data: Record<string, unknown> }>('/api/hr/me'),
  updateMyProfile: (body: {
    employee?: Record<string, unknown>;
    bank?: Record<string, unknown>;
    address?: Record<string, unknown>;
  }) => api<{ success: boolean; data: Record<string, unknown> }>('/api/hr/me/profile', { method: 'PUT', body }),
  departments: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/departments', { params }),
  createDepartment: (body: Record<string, unknown>) =>
    api('/api/hr/departments', { method: 'POST', body }),
  updateDepartment: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/departments/${id}`, { method: 'PUT', body }),
  deleteDepartment: (id: string, deletePassword?: string) => del(`/api/hr/departments/${id}`, deletePassword),
  branches: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: Branch[]; total: number } }>('/api/hr/branches', { params }),
  createBranch: (body: Record<string, unknown>) =>
    api('/api/hr/branches', { method: 'POST', body }),
  updateBranch: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/branches/${id}`, { method: 'PUT', body }),
  deleteBranch: (id: string, deletePassword?: string) => del(`/api/hr/branches/${id}`, deletePassword),
  positions: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/positions', { params }),
  createPosition: (body: Record<string, unknown>) =>
    api('/api/hr/positions', { method: 'POST', body }),
  updatePosition: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/positions/${id}`, { method: 'PUT', body }),
  deletePosition: (id: string, deletePassword?: string) => del(`/api/hr/positions/${id}`, deletePassword),
  subDepartments: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/sub-departments', { params }),
  createSubDepartment: (body: Record<string, unknown>) =>
    api('/api/hr/sub-departments', { method: 'POST', body }),
  updateSubDepartment: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/sub-departments/${id}`, { method: 'PUT', body }),
  deleteSubDepartment: (id: string, deletePassword?: string) => del(`/api/hr/sub-departments/${id}`, deletePassword),
  employeeTypes: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/employee-types', { params }),
  createEmployeeType: (body: Record<string, unknown>) =>
    api('/api/hr/employee-types', { method: 'POST', body }),
  updateEmployeeType: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/employee-types/${id}`, { method: 'PUT', body }),
  deleteEmployeeType: (id: string, deletePassword?: string) => del(`/api/hr/employee-types/${id}`, deletePassword),
  holidays: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/holidays', { params }),
  createHoliday: (body: Record<string, unknown>) =>
    api('/api/hr/holidays', { method: 'POST', body }),
  updateHoliday: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/holidays/${id}`, { method: 'PUT', body }),
  deleteHoliday: (id: string, deletePassword?: string) => del(`/api/hr/holidays/${id}`, deletePassword),
  setupRules: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/setup-rules', { params }),
  createSetupRule: (body: Record<string, unknown>) =>
    api('/api/hr/setup-rules', { method: 'POST', body }),
  updateSetupRule: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/setup-rules/${id}`, { method: 'PUT', body }),
  deleteSetupRule: (id: string, deletePassword?: string) => del(`/api/hr/setup-rules/${id}`, deletePassword),
  employees: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/employees', { params }),
  inactiveEmployees: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/hr/employees/inactive', { params }),
  employeesExportUrl: `${API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')}/api/hr/employees/export`,
  employee: (id: string) => api<{ data: Record<string, unknown> }>(`/api/hr/employees/${id}`),
  createEmployee: (body: Record<string, unknown>) =>
    api<{ success: boolean; data: CreateEmployeeResult }>('/api/hr/employees', { method: 'POST', body }),
  createEmployeeWizard: (body: Record<string, unknown>) =>
    api<{ success: boolean; data: CreateEmployeeResult }>('/api/hr/employees/wizard', { method: 'POST', body }),
  resetLoginPassword: (id: string, body?: { password?: string; forceChange?: boolean }) =>
    api<{ success: boolean; data: EmployeeCredentials }>(`/api/hr/employees/${id}/reset-login-password`, { method: 'POST', body }),
  getCredentials: (id: string) =>
    api<{ success: boolean; data: UserCredentials }>(`/api/hr/employees/${id}/credentials`),
  updateCredentials: (id: string, body: CredentialsUpdateBody) =>
    api<{ success: boolean; data: UserCredentials }>(`/api/hr/employees/${id}/credentials`, { method: 'PUT', body }),
  updateEmployee: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/employees/${id}`, { method: 'PUT', body }),
  deleteEmployee: (id: string, deletePassword?: string) => del(`/api/hr/employees/${id}`, deletePassword),
  setEmployeeStatus: (id: string, body: { status: string }) =>
    api(`/api/hr/employees/${id}/status`, { method: 'POST', body }),
  workforceAnalytics: () => api<{ data: Record<string, unknown> }>('/api/hr/analytics/employees'),
  performanceTrend: () => api<{ data: Record<string, unknown> }>('/api/hr/analytics/performance'),
  dashboard: (params?: Record<string, string | number | undefined>) =>
    api<{ data: HrDashboardData }>('/api/hr/dashboard', { params }),
  performances: (id: string) => api<{ data: unknown[] }>(`/api/hr/employees/${id}/performance`),
  performance: (id: string, perfId: string) =>
    api<{ data: Record<string, unknown> }>(`/api/hr/employees/${id}/performance/${perfId}`),
  performanceRecords: (params?: Record<string, string | number | undefined>) =>
    api<{
      data: {
        items: unknown[];
        total: number;
        page: number;
        per_page: number;
        summary: {
          total_reviews: number;
          avg_score: number | null;
          reviewed_employees: number;
          pending_reviews: number;
        };
      };
    }>('/api/hr/performances', { params }),
  createPerformance: (id: string, body: AppraisalPayload) =>
    api(`/api/hr/employees/${id}/performance`, { method: 'POST', body }),
  updatePerformance: (id: string, perfId: string, body: AppraisalPayload) =>
    api(`/api/hr/employees/${id}/performance/${perfId}`, { method: 'PUT', body }),
  deletePerformance: (id: string, perfId: string, deletePassword?: string) =>
    del(`/api/hr/employees/${id}/performance/${perfId}`, deletePassword),
  transfers: (id: string) => api<{ data: unknown[] }>(`/api/hr/employees/${id}/transfers`),
  allTransfers: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/hr/transfers', { params }),
  createTransfer: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/employees/${id}/transfers`, { method: 'POST', body }),
  updateTransferStatus: (id: string, body: { status: string }) =>
    api(`/api/hr/transfers/${id}/status`, { method: 'PUT', body }),
  idCards: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/hr/id-cards', { params }),
  createIdCard: (body: Record<string, unknown>) =>
    api('/api/hr/id-cards', { method: 'POST', body }),
  deleteIdCard: (id: string, deletePassword?: string) => del(`/api/hr/id-cards/${id}`, deletePassword),
  resignations: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number; page: number; per_page: number } }>(
      '/api/hr/resignations',
      { params }
    ),
  createResignation: (body: Record<string, unknown>) =>
    api('/api/hr/resignations', { method: 'POST', body }),
  updateResignationStatus: (id: string, body: { status: string }) =>
    api(`/api/hr/resignations/${id}/status`, { method: 'PUT', body }),
  notices: () => api<{ data: unknown[] }>('/api/hr/notices'),
  createNotice: (body: Record<string, unknown>) => api('/api/hr/notices', { method: 'POST', body }),
  updateNotice: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/notices/${id}`, { method: 'PUT', body }),
  deleteNotice: (id: string, deletePassword?: string) => del(`/api/hr/notices/${id}`, deletePassword),
  loans: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number; page: number; per_page: number } }>(
      '/api/hr/loans',
      { params }
    ),
  createLoan: (body: Record<string, unknown>) => api('/api/hr/loans', { method: 'POST', body }),
  createLoanSelf: (body: Record<string, unknown>) => api('/api/hr/loans/self', { method: 'POST', body }),
  updateLoanStatus: (id: string, body: { status: string }) =>
    api(`/api/hr/loans/${id}/status`, { method: 'PUT', body }),
  policies: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/hr/policies', { params }),
  createPolicy: (body: Record<string, unknown>) =>
    api('/api/hr/policies', { method: 'POST', body }),
  updatePolicy: (id: string, body: Record<string, unknown>) =>
    api(`/api/hr/policies/${id}`, { method: 'PUT', body }),
  deletePolicy: (id: string, deletePassword?: string) => del(`/api/hr/policies/${id}`, deletePassword),
  settings: () => api<{ data: Record<string, unknown> }>('/api/hr/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    api('/api/hr/settings', { method: 'PUT', body }),
};

export const attendance = {
  events: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/attendance/days', { params }),
  createEvent: (body: Record<string, unknown>) =>
    api('/api/attendance/events', { method: 'POST', body }),
  bulkCreate: (body: Record<string, unknown>) =>
    api('/api/attendance/events/bulk', { method: 'POST', body }),
  manualEntry: (body: Record<string, unknown>) =>
    api('/api/attendance/manual-entry', { method: 'POST', body }),
  recalculate: (body: Record<string, unknown>) =>
    api('/api/attendance/recalculate', { method: 'POST', body }),
  recalcRange: (body: Record<string, unknown>) =>
    api('/api/attendance/recalculate/range', { method: 'POST', body }),
  dailyLog: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/attendance/days', { params }),
  analytics: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Record<string, unknown> }>('/api/attendance/analytics', { params }),
  missing: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/attendance/missing', { params }),
  pending: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/attendance/pending', { params }),
  approvePending: (id: string, body: Record<string, unknown>) =>
    api(`/api/attendance/pending/${id}/approve`, { method: 'POST', body }),
  rejectPending: (id: string, body: Record<string, unknown>) =>
    api(`/api/attendance/pending/${id}/reject`, { method: 'POST', body }),
  pendingGeo: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/attendance/pending-geo', { params }),
  geoCheckin: (body: Record<string, unknown>) =>
    api('/api/attendance/geo-checkin', { method: 'POST', body }),
  reports: {
    late: (params?: Record<string, string | number | undefined>) =>
      api<{ data: unknown[] }>('/api/attendance/reports/late', { params }),
    dailyPresent: (params?: Record<string, string | number | undefined>) =>
      api<{ data: unknown[] }>('/api/attendance/reports/daily-present', { params }),
    monthlySummary: (params?: Record<string, string | number | undefined>) =>
      api<{ data: unknown[] }>('/api/attendance/reports/monthly-summary', { params }),
    monthlyDetail: (params?: Record<string, string | number | undefined>) =>
      api<{ data: { items: unknown[] } }>('/api/attendance/reports/monthly-detail', { params }),
    worksheet: (params?: Record<string, string | number | undefined>) =>
      api<{ data: { items: unknown[] } }>('/api/attendance/reports/worksheet', { params }),
  },
  deviceMappings: () => api<{ data: unknown[] }>('/api/attendance/device-mappings'),
  createDeviceMapping: (body: Record<string, unknown>) =>
    api('/api/attendance/device-mappings', { method: 'POST', body }),
};

export const leave = {
  types: () => api<{ data: { items: unknown[] } }>('/api/leave/types'),
  createType: (body: Record<string, unknown>) => api('/api/leave/types', { method: 'POST', body }),
  updateType: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/types/${id}`, { method: 'PUT', body }),
  deleteType: (id: string, deletePassword?: string) => del(`/api/leave/types/${id}`, deletePassword),
  applications: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/leave/applications', { params }),
  application: (id: string) =>
    api<{ data: Record<string, unknown> }>(`/api/leave/applications/${id}`),
  createApplication: (body: Record<string, unknown>) =>
    api('/api/leave/applications', { method: 'POST', body }),
  approve: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/applications/${id}/approve`, { method: 'POST', body }),
  reject: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/applications/${id}/reject`, { method: 'POST', body }),
  withdraw: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/applications/${id}/withdraw`, { method: 'POST', body }),
  balances: (params?: Record<string, string | number | undefined>) =>
    api<{ data: unknown[] }>('/api/leave/balances', { params }),
  updateBalance: (id: string, body: { total?: number; taken?: number; due?: number }) =>
    api<{ success: boolean; data: unknown }>(`/api/leave/balances/${id}`, { method: 'PUT', body }),
  createBalance: (body: { employee_id: string; leave_type_id: string; year: number; total: number; taken?: number; due?: number }) =>
    api<{ success: boolean; data: unknown }>('/api/leave/balances', { method: 'POST', body }),
  analytics: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Record<string, unknown> }>('/api/leave/analytics', { params }),
  generate: (body: Record<string, unknown>) => api('/api/leave/generate', { method: 'POST', body }),
  shortLeaves: () => api<{ data: unknown[] }>('/api/leave/short-leaves'),
  createShortLeave: (body: Record<string, unknown>) =>
    api('/api/leave/short-leaves', { method: 'POST', body }),
  approveShort: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/short-leaves/${id}/approve`, { method: 'POST', body }),
  rejectShort: (id: string, body: Record<string, unknown>) =>
    api(`/api/leave/short-leaves/${id}/reject`, { method: 'POST', body }),
};

export const files = {
  createUploadSession: (body: {
    module: string;
    entity_type: string;
    entity_id?: string;
    original_filename: string;
    mime_type?: string;
    size_bytes?: number;
  }) =>
    api<{ success: boolean; session_id: string; storage_key: string; upload_url: string; expires_at: string }>(
      '/api/files/sessions',
      { method: 'POST', body }
    ),
  confirmUpload: (sessionId: string) =>
    api<{ success: boolean; data: { id: string; original_filename: string } }>('/api/files/confirm', {
      method: 'POST',
      body: { sessionId },
    }),
  fileDownload: (id: string) => api<{ data: { url: string; filename: string } }>(`/api/files/${id}/download`),
};

export const projects = {
  list: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/projects', { params }),
  get: (id: string) => api<{ data: Record<string, unknown> }>(`/api/projects/${id}`),
  create: (body: Record<string, unknown>) => api('/api/projects', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/projects/${id}`, { method: 'PUT', body }),
  remove: (id: string, deletePassword?: string) => del(`/api/projects/${id}`, deletePassword),
  updateGeoLocation: (projectId: string, body: Record<string, unknown>) =>
    api(`/api/projects/${projectId}/geo-location`, { method: 'PUT', body }),
  dashboard: () => api<{ data: Record<string, unknown> }>('/api/projects/dashboard'),
  analytics: () => api<{ data: Record<string, unknown> }>('/api/projects/analytics'),
  reports: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Record<string, unknown> }>('/api/projects/reports', { params }),
  clients: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/projects/clients', { params }),
  createClient: (body: Record<string, unknown>) =>
    api('/api/projects/clients', { method: 'POST', body }),
  updateClient: (id: string, body: Record<string, unknown>) =>
    api(`/api/projects/clients/${id}`, { method: 'PUT', body }),
  deleteClient: (id: string, deletePassword?: string) => del(`/api/projects/clients/${id}`, deletePassword),
  tasks: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/projects/tasks', { params }),
  createTask: (body: Record<string, unknown>) =>
    api('/api/projects/tasks', { method: 'POST', body }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    api(`/api/projects/tasks/${id}`, { method: 'PUT', body }),
  removeTask: (id: string, deletePassword?: string) => del(`/api/projects/tasks/${id}`, deletePassword),
  taskCounts: (projectId: string) =>
    api<{ data: Record<string, number> }>(`/api/projects/${projectId}/task-counts`),
  dailyTasks: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: WorkLogRow[]; total: number } }>('/api/projects/daily-tasks', { params }),
  dailyTasksSummary: () =>
    api<{ data: { today_hours: number; week_hours: number; pending: number; approved: number } }>(
      '/api/projects/daily-tasks/summary'
    ),
  createDailyTask: (body: Record<string, unknown>) =>
    api('/api/projects/daily-tasks', { method: 'POST', body }),
  updateDailyTask: (id: string, body: Record<string, unknown>) =>
    api(`/api/projects/daily-tasks/${id}`, { method: 'PUT', body }),
  removeDailyTask: (id: string, deletePassword?: string) => del(`/api/projects/daily-tasks/${id}`, deletePassword),
  submitDailyTasks: (ids: string[]) =>
    api('/api/projects/daily-tasks/submit', { method: 'POST', body: { ids } }),
  approveDailyTasks: (ids: string[], action: 'approve' | 'reject', rejectionReason?: string) =>
    api('/api/projects/daily-tasks/approve', {
      method: 'POST',
      body: { ids, action, rejection_reason: rejectionReason ?? '' },
    }),
  meetings: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[]; total: number } }>('/api/projects/meetings', { params }),
  meeting: (id: string) => api<{ data: Record<string, unknown> }>(`/api/projects/meetings/${id}`),
  createMeeting: (body: Record<string, unknown>) =>
    api('/api/projects/meetings', { method: 'POST', body }),
  updateMeeting: (id: string, body: Record<string, unknown>) =>
    api(`/api/projects/meetings/${id}`, { method: 'PUT', body }),
  removeMeeting: (id: string, deletePassword?: string) => del(`/api/projects/meetings/${id}`, deletePassword),
  sprints: (projectId: string) => api<{ data: unknown[] }>(`/api/projects/${projectId}/sprints`),
  createSprint: (projectId: string, body: Record<string, unknown>) =>
    api(`/api/projects/${projectId}/sprints`, { method: 'POST', body }),
};

export const training = {
  list: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/training', { params }),
  get: (id: string) => api<{ data: Record<string, unknown> }>(`/api/training/${id}`),
  create: (body: Record<string, unknown>) => api('/api/training', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/training/${id}`, { method: 'PUT', body }),
  remove: (id: string, deletePassword?: string) => del(`/api/training/${id}`, deletePassword),
  assign: (id: string, body: Record<string, unknown>) =>
    api(`/api/training/${id}/assign`, { method: 'POST', body }),
  complete: (id: string, body: Record<string, unknown>) =>
    api(`/api/training/assignments/${id}/complete`, { method: 'POST', body }),
  certificates: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/training/certificates', { params }),
  createCertificate: (body: Record<string, unknown>) =>
    api('/api/training/certificates', { method: 'POST', body }),
  removeCertificate: (id: string, deletePassword?: string) => del(`/api/training/certificates/${id}`, deletePassword),
  myTrainings: (employeeId: string) =>
    api<{ data: unknown[] }>(`/api/training/my?employeeId=${employeeId}`),
};

export const audit = {
  logs: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/audit/logs', { params }),
  log: (id: string) => api<{ data: Record<string, unknown> }>(`/api/audit/logs/${id}`),
  deleteLogs: (ids: string[], deletePassword?: string) =>
    api<{ success: boolean; deleted: number }>('/api/audit/logs', {
      method: 'DELETE',
      body: deletePassword ? { ids, deletePassword } : { ids },
    }),
  createLog: (body: Record<string, unknown>) => api('/api/audit/logs', { method: 'POST', body }),
  meta: (params?: Record<string, string | number | undefined>) =>
    api<{ data: { items: unknown[] } }>('/api/audit/meta', { params }),
};

export const notifications = {
  mine: (params?: Record<string, string | number | undefined>) =>
    api<{ success: boolean; data: { items: InAppNotificationItem[]; total: number } }>('/api/notifications/my', {
      params,
    }),
  unreadCount: () =>
    api<{ success: boolean; data: { count: number } }>('/api/notifications/my/unread-count'),
  markRead: (id: string) =>
    api<{ success: boolean; data: { updated: boolean } }>(`/api/notifications/my/${id}/read`, {
      method: 'POST',
    }),
  markAllRead: () =>
    api<{ success: boolean; data: { updated: number } }>('/api/notifications/my/read-all', { method: 'POST' }),
};

export interface InAppNotificationItem {
  id: string;
  recipient_user_id: string;
  title: string;
  message: string | null;
  action_url: string | null;
  event_type: string;
  created_at: string;
  read_at: string | null;
}

export interface FieldTrackingPointBody {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  capturedAt?: string;
  batteryLevel?: number | null;
}

export interface FieldTrackingSession {
  id: string;
  employee_id: string;
  check_in_event_id: string | null;
  check_out_event_id: string | null;
  started_at: string;
  ended_at: string | null;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  status: 'active' | 'completed';
  device_id: string | null;
}

export interface FieldTrackingStatusData {
  checkedIn: boolean;
  trackingActive: boolean;
  employee: { id: string; full_name: string; employee_code: string } | null;
  session: {
    id: string;
    started_at: string;
    start_latitude: number;
    start_longitude: number;
    last_location_at: string | null;
    last_latitude: number | null;
    last_longitude: number | null;
  } | null;
  geofence: {
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
    status: 'inside' | 'outside' | 'unknown' | null;
    inside: boolean | null;
    checkInRestricted: boolean;
    checkOutRestricted: boolean;
    monitored: boolean;
    distance_meters: number | null;
  } | null;
  todayAttendance?: {
    work_date: string;
    first_in: string | null;
    last_out: string | null;
    total_work_minutes?: number | null | undefined;
    total_worked_minutes?: number | null | undefined;
    status: string | null;
  } | null;
}

export interface FieldTrackingLiveEntry {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  position_name: string | null;
  department_name: string | null;
  branch_id?: string | null | undefined;
  branch_name?: string | null | undefined;
  session_id: string;
  started_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  last_seen_at: string | null;
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
    status: 'inside' | 'outside' | 'unknown' | null;
    inside: boolean | null;
    flag_exit: boolean;
  } | null;
}

export interface FieldTrackingRoutePoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  captured_at: string;
  received_at: string;
  battery_level: number | null;
}

export interface FieldTrackingRouteSession {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  check_in_event_id: string | null;
  check_out_event_id: string | null;
  points: FieldTrackingRoutePoint[];
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
  } | null;
  geofence_events: {
    event_type: 'entered' | 'exited';
    latitude: number;
    longitude: number;
    accuracy: number | null;
    occurred_at: string;
  }[];
}

export interface FieldTrackingRouteData {
  employee: {
    id: string;
    full_name: string;
    employee_code: string;
    position_name: string | null;
    department_name: string | null;
  } | null;
  sessions: FieldTrackingRouteSession[];
  geofence: {
    id: string;
    name: string;
    center_latitude: number;
    center_longitude: number;
    radius_meters: number;
  } | null;
}

export interface Geofence {
  id: string;
  name: string;
  description: string;
  type: 'circle';
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  assignments_count?: number;
}

export type GeofenceScopeType = 'employee' | 'department' | 'employee_type' | 'setup_rule';

export interface GeofenceAssignment {
  id: string;
  geofence_id: string;
  employee_id: string | null;
  department_id: string | null;
  employee_type_id: string | null;
  setup_rule_id: string | null;
  scope_type: GeofenceScopeType;
  scope_name: string;
  enabled: boolean;
  restrict_check_in: boolean;
  restrict_check_out: boolean;
  monitor_exit: boolean;
  flag_exit: boolean;
}

export interface GeofenceEvent {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  tracking_session_id: string | null;
  geofence_id: string;
  geofence_name: string;
  event_type: 'entered' | 'exited';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  occurred_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface FieldTrackingSessionListItem {
  id: string;
  employee_id: string;
  full_name: string;
  employee_code: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number | null;
  end_longitude: number | null;
  point_count: number;
}

export const fieldTracking = {
  analytics: () => api<{ data: Record<string, unknown> }>('/api/attendance/field/analytics'),
  checkIn: (body: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    capturedAt?: string;
    deviceId?: string;
  }) =>
    api<{ success: boolean; data: FieldTrackingSession }>('/api/field-tracking/check-in', {
      method: 'POST',
      body,
    }),
  checkOut: (body: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    capturedAt?: string;
  }) =>
    api<{ success: boolean; data: FieldTrackingSession }>('/api/field-tracking/check-out', {
      method: 'POST',
      body,
    }),
  location: (body: FieldTrackingPointBody) =>
    api<{ success: boolean; saved: boolean; received_at: string }>('/api/field-tracking/location', {
      method: 'POST',
      body,
    }),
  locationsBatch: (body: { points: FieldTrackingPointBody[] }) =>
    api<{ success: boolean; saved: number; received_at: string }>(
      '/api/field-tracking/locations/batch',
      { method: 'POST', body }
    ),
  myStatus: () => api<{ data: FieldTrackingStatusData }>('/api/field-tracking/me/status'),
  live: () => api<{ data: FieldTrackingLiveEntry[] }>('/api/field-tracking/live'),
  route: (employeeId: string, params?: Record<string, string | number | undefined>) =>
    api<{ data: FieldTrackingRouteData }>(`/api/field-tracking/employees/${employeeId}/route`, {
      params,
    }),
  sessions: (params?: Record<string, string | number | undefined>) =>
    api<{
      data: {
        items: FieldTrackingSessionListItem[];
        total: number;
        page: number;
        per_page: number;
        total_pages: number;
      };
    }>('/api/field-tracking/sessions', { params }),
};

export const geofence = {
  list: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Paginated<Geofence> }>('/api/geofences', { params }),
  detail: (id: string) =>
    api<{ data: Geofence & { assignments: GeofenceAssignment[] } }>(`/api/geofences/${id}`),
  create: (body: {
    name: string;
    description?: string;
    centerLatitude: number;
    centerLongitude: number;
    radiusMeters: number;
  }) => api<{ success: boolean; data: Geofence }>('/api/geofences', { method: 'POST', body }),
  update: (
    id: string,
    body: {
      name?: string;
      description?: string;
      centerLatitude?: number;
      centerLongitude?: number;
      radiusMeters?: number;
      status?: 'active' | 'inactive';
    }
  ) => api<{ success: boolean; data: Geofence }>(`/api/geofences/${id}`, { method: 'PATCH', body }),
  deactivate: (id: string, deletePassword?: string) =>
    api<{ success: boolean; data: { id: string; status: string } }>(`/api/geofences/${id}`, {
      method: 'DELETE',
      body: deletePassword ? { deletePassword } : undefined,
    }),
  assignments: (id: string) =>
    api<{ data: GeofenceAssignment[] }>(`/api/geofences/${id}/assignments`),
  createAssignment: (
    geofenceId: string,
    body: {
      scopeType: GeofenceScopeType;
      scopeId: string;
      enabled?: boolean;
      restrictCheckIn?: boolean;
      restrictCheckOut?: boolean;
      monitorExit?: boolean;
      flagExit?: boolean;
    }
  ) =>
    api<{ success: boolean; data: GeofenceAssignment }>(
      `/api/geofences/${geofenceId}/assignments`,
      { method: 'POST', body }
    ),
  updateAssignment: (
    assignmentId: string,
    body: {
      enabled?: boolean;
      restrictCheckIn?: boolean;
      restrictCheckOut?: boolean;
      monitorExit?: boolean;
      flagExit?: boolean;
    }
  ) =>
    api<{ success: boolean; data: GeofenceAssignment }>(
      `/api/geofences/assignments/${assignmentId}`,
      { method: 'PATCH', body }
    ),
  removeAssignment: (assignmentId: string, deletePassword?: string) =>
    api<{ success: boolean; data: { id: string; removed: boolean } }>(
      `/api/geofences/assignments/${assignmentId}`,
      { method: 'DELETE', body: deletePassword ? { deletePassword } : undefined }
    ),
  breaches: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Paginated<GeofenceEvent> }>('/api/geofences/breaches', { params }),
  liveSummary: () =>
    api<{
      data: {
        trackingNow: number;
        inside: number;
        outside: number;
        noGeofence: number;
        flaggedOutside: number;
      };
    }>('/api/geofences/live/summary'),
};

// ---------------------------------------------------------------------------
// Payroll module
// ---------------------------------------------------------------------------

export interface PayrollRun {
  id: string;
  period_month: string;
  status: 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';
  payment_date: string | null;
  payment_method: string | null;
  payment_reference: string;
  payment_notes: string;
  gross_total: string;
  earnings_total: string;
  deductions_total: string;
  net_total: string;
  calculated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  employee_count?: number | undefined;
  paid_count?: number | undefined;
}

export interface PayrollEntryLine {
  id: string;
  salary_component_id: string | null;
  name: string;
  type: 'earning' | 'deduction';
  amount: string;
  source: string;
  description: string;
}

export interface PayrollEntry {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  period_month: string;
  gross_pay: string;
  total_earnings: string;
  total_deductions: string;
  net_pay: string;
  attendance_deduction: string;
  late_deduction: string;
  unpaid_leave_deduction: string;
  loan_deduction: string;
  adjustment_earnings: string;
  adjustment_deductions: string;
  working_days: number;
  payable_days: number;
  absent_days: number;
  late_days: number;
  unpaid_leave_days: string;
  payment_status: 'unpaid' | 'paid';
  approved_at: string | null;
  paid_at: string | null;
  snapshot: unknown;
  employee_code?: string | undefined;
  employee_name?: string | undefined;
  department_name?: string | null | undefined;
  position_name?: string | null | undefined;
  payment_date?: string | null | undefined;
  lines?: PayrollEntryLine[] | undefined;
}

export interface SalaryComponent {
  id: string;
  name: string;
  code: string;
  type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percentage' | 'formula';
  percentage_of_component: string | null;
  default_amount: string | null;
  taxable: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface StructureComponentRow {
  id: string;
  component_id: string;
  name: string;
  code: string;
  type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percentage' | 'formula';
  percentage_of_component: string | null;
  amount: string | null;
  sort_order: number;
}

export interface SalaryStructure {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  components: StructureComponentRow[];
}

export interface EmployeeSalary {
  id: string;
  employee_id: string;
  salary_structure_id: string;
  gross_salary: string;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  status: 'active' | 'inactive';
  structure_name?: string | undefined;
  overrides?: Array<{ id: string; component_id: string; amount: string; component_name?: string | undefined }> | undefined;
}

export interface PayrollAdjustment {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  salary_component_id: string | null;
  type: 'earning' | 'deduction';
  amount: string;
  reason: string;
  created_at: string;
  employee_code?: string | undefined;
  employee_name?: string | undefined;
  component_name?: string | null | undefined;
}

export interface PayrollSettings {
  period_label: string;
  salary_calculation_basis: 'gross_salary' | 'basic_salary';
  attendance_deduction: boolean;
  late_deduction: boolean;
  overtime_enabled: boolean;
  unpaid_leave_deduction: boolean;
  rounding_rule: 'nearest' | 'ceil' | 'floor';
  working_day_calculation: 'calendar_days' | 'scheduled_working_days';
  default_payment_day: number;
  default_currency: string;
}

export interface PayrollDashboardData {
  latest_period: string | null;
  latest_status: string | null;
  month_net_total: string;
  month_employee_count: number;
  month_paid_count: number;
  month_gross_total: string;
  month_deductions_total: string;
  month_attendance_deduction: string;
  month_leave_deduction: string;
  month_loan_deduction: string;
  month_adjustment_earnings: string;
  month_adjustment_deductions: string;
  year_net_total: string;
  total_runs: number;
  total_employees: number;
  month_trend: Array<{ period: string; gross_total: string; net_total: string }>;
  department_breakdown: Array<{ department_name: string; net_total: string }>;
  earnings_vs_deductions: Array<{ period: string; earnings_total: string; deductions_total: string }>;
  payment_status: Array<{ status: string; employee_count: number; net_total: string }>;
}

export interface PayrollCandidate {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  salary_id: string;
  structure_id: string;
  structure_name: string;
  gross_salary: string;
  effective_from: string;
}

export interface PayrollReportRow {
  [key: string]: string | number | null;
}

export interface HrDashboardData {
  todayKpis: {
    totalActive: number;
    presentToday: number;
    lateToday: number;
    absentToday: number;
    onLeaveToday: number;
    pendingLeaveRequests: number;
    newHires30: number;
  };
  todayByDepartment: Array<{
    department_id: string;
    name: string;
    present: number;
    late: number;
    absent: number;
    leave: number;
    total: number;
    attendance_pct: number;
  }>;
  attendanceTrend: Array<Record<string, unknown>>;
  workforce: Record<string, unknown>;
  leaveOverview: Array<{ status: string; n: number }>;
  performance: Record<string, unknown>;
  notices: Array<{ id: string; title: string; body: string; category?: string; is_active: boolean; created_at: string }>;
  pendingLeaves: {
    total: number;
    items: Array<{
      id: string;
      employee_id: string;
      full_name: string;
      employee_code: string;
      position_name: string;
      department_name: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      requested_days: number;
      reason: string;
      status: string;
      created_at: string;
    }>;
  };
  recentHires: Array<{
    id: string;
    full_name: string;
    employee_code: string;
    joining_date: string;
    position_name: string;
    department_name: string;
    photo_file_id: string | null;
  }>;
  hiresByPosition: Array<{ position_id: string | null; position_name: string; count: number; latest_joining_date: string }>;
  loanRecovery: {
    active_loans: number;
    active_amount: number;
    total_payable: number;
    paid_total: number;
    paid_this_month: number;
    outstanding: number;
    overdue_count: number;
    overdue_amount: number;
    installment_count: number;
    paid_count: number;
    progress_pct: number;
  };
  shortLeaves: Array<{
    id: string;
    employee_id: string;
    full_name: string;
    employee_code: string;
    department_name?: string;
    work_date: string;
    minutes: number;
    reason: string;
    status: string;
  }>;
  attention: {
    expiringContracts: Array<{ id: string; full_name: string; employee_code: string; label: string; date: string }>;
    upcomingBirthdays: Array<{ id: string; full_name: string; employee_code: string; label: string; date: string }>;
    upcomingAnniversaries: Array<{ id: string; full_name: string; employee_code: string; label: string; date: string }>;
    pendingAttendanceApprovals: number;
  };
}

export const payroll = {
  dashboard: () => api<{ data: PayrollDashboardData }>('/api/payroll/dashboard'),
  settings: () => api<{ data: PayrollSettings }>('/api/payroll/settings'),
  updateSettings: (body: Partial<PayrollSettings>) =>
    api<{ success: boolean; data: PayrollSettings }>('/api/payroll/settings', { method: 'PUT', body }),
  components: (params?: Record<string, string | undefined>) =>
    api<{ data: SalaryComponent[] }>('/api/payroll/salary-components', { params }),
  createComponent: (body: Record<string, unknown>) =>
    api<{ success: boolean; data: SalaryComponent }>('/api/payroll/salary-components', { method: 'POST', body }),
  updateComponent: (id: string, body: Record<string, unknown>) =>
    api<{ success: boolean; data: SalaryComponent }>(`/api/payroll/salary-components/${id}`, { method: 'PATCH', body }),
  deactivateComponent: (id: string, deletePassword?: string) =>
    api<{ success: boolean }>(`/api/payroll/salary-components/${id}`, {
      method: 'DELETE',
      body: deletePassword ? { deletePassword } : undefined,
    }),
  structures: () => api<{ data: SalaryStructure[] }>('/api/payroll/salary-structures'),
  createStructure: (body: Record<string, unknown>) =>
    api<{ success: boolean; data: SalaryStructure }>('/api/payroll/salary-structures', { method: 'POST', body }),
  updateStructure: (id: string, body: Record<string, unknown>) =>
    api<{ success: boolean; data: SalaryStructure }>(`/api/payroll/salary-structures/${id}`, { method: 'PATCH', body }),
  deactivateStructure: (id: string, deletePassword?: string) =>
    api<{ success: boolean }>(`/api/payroll/salary-structures/${id}`, {
      method: 'DELETE',
      body: deletePassword ? { deletePassword } : undefined,
    }),
  employees: () =>
    api<{ data: Array<{ id: string; employee_code: string; full_name: string; department_name: string | null }> }>(
      '/api/payroll/employees'
    ),
  employeeSalaries: (params?: Record<string, string | undefined>) =>
    api<{ data: EmployeeSalary[] }>('/api/payroll/employee-salaries', { params }),
  assignSalary: (body: Record<string, unknown>) =>
    api<{ success: boolean; data: EmployeeSalary }>('/api/payroll/employee-salaries', { method: 'POST', body }),
  setSalaryOverrides: (id: string, overrides: Array<{ componentId: string; amount: string }>) =>
    api<{ success: boolean; data: EmployeeSalary }>(`/api/payroll/employee-salaries/${id}/overrides`, {
      method: 'PATCH',
      body: { overrides },
    }),
  deactivateSalary: (id: string, deletePassword?: string) =>
    api<{ success: boolean }>(`/api/payroll/employee-salaries/${id}`, {
      method: 'DELETE',
      body: deletePassword ? { deletePassword } : undefined,
    }),
  runs: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Paginated<PayrollRun> }>('/api/payroll/runs', { params }),
  run: (id: string) => api<{ data: PayrollRun }>(`/api/payroll/runs/${id}`),
  createRun: (period: string) =>
    api<{ success: boolean; data: PayrollRun }>('/api/payroll/runs', { method: 'POST', body: { period } }),
  candidates: (id: string) => api<{ data: PayrollCandidate[] }>(`/api/payroll/runs/${id}/candidates`),
  calculate: (id: string) =>
    api<{ success: boolean; data: PayrollRun }>(`/api/payroll/runs/${id}/calculate`, { method: 'POST' }),
  approve: (id: string) =>
    api<{ success: boolean; data: PayrollRun }>(`/api/payroll/runs/${id}/approve`, { method: 'POST' }),
  pay: (id: string, body: { paymentDate: string; paymentMethod: string; paymentReference?: string; paymentNotes?: string }) =>
    api<{ success: boolean; data: PayrollRun }>(`/api/payroll/runs/${id}/pay`, { method: 'POST', body }),
  cancel: (id: string) =>
    api<{ success: boolean; data: PayrollRun }>(`/api/payroll/runs/${id}/cancel`, { method: 'POST' }),
  entries: (id: string, params?: Record<string, string | undefined>) =>
    api<{ data: PayrollEntry[] }>(`/api/payroll/runs/${id}/entries`, { params }),
  adjustments: (id: string) => api<{ data: PayrollAdjustment[] }>(`/api/payroll/runs/${id}/adjustments`),
  addAdjustment: (
    id: string,
    body: {
      employeeId: string;
      type: 'earning' | 'deduction';
      amount: string;
      salaryComponentId?: string;
      reason?: string;
    }
  ) => api<{ success: boolean; data: PayrollAdjustment }>(`/api/payroll/runs/${id}/adjustments`, { method: 'POST', body }),
  payslips: (params?: Record<string, string | number | undefined>) =>
    api<{ data: Paginated<PayrollEntry> }>('/api/payroll/payslips', { params }),
  payslip: (id: string) => api<{ data: PayrollEntry }>(`/api/payroll/payslips/${id}`),
  report: (kind: string, params?: Record<string, string | undefined>) =>
    api<{ data: PayrollReportRow[] }>(`/api/payroll/reports/${kind}`, { params }),
};

export const security = {
  deletePasswordStatus: () =>
    api<{ success: boolean; data: { configured: boolean; updated_at: string | null } }>(
      '/api/security/delete-password'
    ),
  setDeletePassword: (password: string) =>
    api<{ success: boolean; data: { configured: true; updated_at: string } }>(
      '/api/security/delete-password',
      { method: 'POST', body: { password } }
    ),
};

export const todos = {
  list: (date?: string) =>
    api<{ data: TodoRow[] }>('/api/todos', { params: date ? { date } : undefined }),
  listForEmployeeToday: (employeeId: string) =>
    api<{ data: TodoRow[] }>(`/api/todos/employees/${employeeId}`),
  create: (body: { title: string; todo_date?: string }) =>
    api<{ data: TodoRow }>('/api/todos', { method: 'POST', body }),
  update: (id: string, body: { title?: string; is_completed?: boolean }) =>
    api<{ data: TodoRow }>(`/api/todos/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => api(`/api/todos/${id}`, { method: 'DELETE' }),
};

/* ─── Messaging ───────────────────────────────────────────────────────────── */

export interface MessagingUser {
  id: string;
  username: string;
  full_name: string;
  email: string;
  designation: string | null;
  department: string | null;
}

export interface MessageAttachment {
  id: string;
  file_id: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  conversation_id: string;
  sender_user_id: string;
  sender_name: string | null;
  body: string;
  message_type: 'text' | 'file' | 'system';
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  attachments: MessageAttachment[];
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  archived_at: string | null;
  my_role: 'owner' | 'admin' | 'member';
  muted: boolean;
  unread_count: number;
  member_count: number;
  participants: { user_id: string; full_name: string }[];
  latest_message: {
    id: string;
    seq: number;
    sender_user_id: string;
    sender_name: string | null;
    body: string;
    message_type: string;
    created_at: string;
    deleted: boolean;
  } | null;
}

export interface ConversationMember {
  user_id: string;
  username: string;
  full_name: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

export interface ConversationDetail extends Omit<ConversationSummary, 'latest_message' | 'unread_count'> {
  members: ConversationMember[];
  other_participant: { user_id: string; full_name: string } | null;
}

export const messages = {
  conversations: (params?: { page?: number; perPage?: number }) =>
    api<{ success: boolean; data: { items: ConversationSummary[]; total: number } }>('/api/messages/conversations', { params }),
  startDirect: (userId: string) =>
    api<{ success: boolean; data: { id: string } }>('/api/messages/direct', { method: 'POST', body: { userId } }),
  createGroup: (name: string, memberIds: string[]) =>
    api<{ success: boolean; data: { id: string } }>('/api/messages/groups', { method: 'POST', body: { name, memberIds } }),
  conversation: (id: string) =>
    api<{ success: boolean; data: ConversationDetail }>(`/api/messages/conversations/${id}`),
  patchConversation: (id: string, body: { name?: string; muted?: boolean }) =>
    api<{ success: boolean }>(`/api/messages/conversations/${id}`, { method: 'PATCH', body }),
  deleteConversation: (id: string) =>
    api<{ success: boolean }>(`/api/messages/conversations/${id}`, { method: 'DELETE' }),
  members: (id: string) =>
    api<{ success: boolean; data: ConversationMember[] }>(`/api/messages/conversations/${id}/members`),
  addMembers: (id: string, userIds: string[]) =>
    api<{ success: boolean; data: { added: number } }>(`/api/messages/conversations/${id}/members`, { method: 'POST', body: { userIds } }),
  removeMember: (id: string, userId: string) =>
    api<{ success: boolean }>(`/api/messages/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
  setRole: (id: string, userId: string, role: 'admin' | 'member' | 'owner') =>
    api<{ success: boolean }>(`/api/messages/conversations/${id}/members/${userId}/role`, { method: 'PATCH', body: { role } }),
  leave: (id: string) =>
    api<{ success: boolean }>(`/api/messages/conversations/${id}/leave`, { method: 'POST' }),
  listMessages: (id: string, params?: { beforeSeq?: number; limit?: number }) =>
    api<{ success: boolean; data: { items: ChatMessage[]; has_more: boolean } }>(
      `/api/messages/conversations/${id}/messages`, { params }
    ),
  sendMessage: (id: string, body: string, fileIds?: string[]) =>
    api<{ success: boolean; data: ChatMessage }>(`/api/messages/conversations/${id}/messages`, { method: 'POST', body: { body, fileIds } }),
  editMessage: (messageId: string, body: string) =>
    api<{ success: boolean; data: ChatMessage }>(`/api/messages/messages/${messageId}`, { method: 'PATCH', body: { body } }),
  deleteMessage: (messageId: string) =>
    api<{ success: boolean }>(`/api/messages/messages/${messageId}`, { method: 'DELETE' }),
  markRead: (id: string) =>
    api<{ success: boolean; data: { unread: number } }>(`/api/messages/conversations/${id}/read`, { method: 'POST' }),
  unreadCount: () =>
    api<{ success: boolean; data: { count: number } }>('/api/messages/unread-count'),
  userSearch: (q: string, limit?: number) =>
    api<{ success: boolean; data: MessagingUser[] }>('/api/messages/users/search', { params: { q, limit } }),
  createAttachmentSession: (body: { original_filename: string; mime_type: string; size_bytes: number }) =>
    api<{ success: boolean; session_id: string; storage_key: string; upload_url: string }>('/api/messages/attachments/sessions', { method: 'POST', body }),
  confirmAttachment: (sessionId: string) =>
    api<{ success: boolean; data: { id: string; filename: string } }>('/api/messages/attachments/confirm', { method: 'POST', body: { sessionId } }),
  fileDownload: (fileId: string) =>
    api<{ success: boolean; data: { url: string; filename: string } }>(`/api/messages/files/${fileId}/download`),
  toggleReaction: (messageId: string, emoji: string) =>
    api<{ success: boolean; data: { reaction: 'added' | 'removed' } }>(`/api/messages/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } }),
};

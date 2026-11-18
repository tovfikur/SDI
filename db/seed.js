/**
 * Database seeder (Spec Phase 20 "Local" env: synthetic seed data).
 *
 * Idempotent: master reference data and demo rows use natural-key guards
 * (unique indexes / existence lookups / ON CONFLICT DO NOTHING), so the
 * seeder can be re-run safely against a database that already has data.
 * Demo employees use SDI-0101+ codes so they never collide with user/E2E rows.
 *
 * Default dev credentials (documented in docs/README.md):
 *   admin        / Admin@12345   (Super Admin)
 *   hr.admin     / Admin@12345   (HR Admin)
 *   pm.manager   / Admin@12345   (Project Manager)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', 'infra', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  return process.env.DATABASE_URL;
}

const hashPassword = (password) => {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
};

const PERMISSIONS = [
  ['hr.masters.view', 'View HR masters'],
  ['hr.masters.create', 'Create HR masters'],
  ['hr.masters.update', 'Update HR masters'],
  ['hr.masters.delete', 'Delete HR masters'],
  ['hr.employee.view', 'View employees'],
  ['hr.employee.create', 'Create employees'],
  ['hr.employee.update', 'Update employees'],
  ['hr.employee.delete', 'Delete employees'],
  ['hr.employee.transfer', 'Manage transfers'],
  ['hr.employee.performance', 'Manage performance records'],
  ['hr.attendance.view', 'View attendance'],
  ['hr.attendance.manage', 'Manage attendance events'],
  ['hr.attendance.approve', 'Approve pending attendance'],
  ['hr.attendance.field.self', 'Self field attendance check-in/out and tracking'],
  ['hr.attendance.field.view_all', 'View live field tracking and employee routes'],
  ['hr.attendance.field.report', 'View field tracking session reports'],
  ['geofence.view', 'View geofences and assignments'],
  ['geofence.manage', 'Create and edit geofences'],
  ['geofence.assign', 'Assign geofences to employees and scopes'],
  ['geofence.breach.view', 'View geofence breach history'],
  ['hr.leave.view', 'View leave'],
  ['hr.leave.manage', 'Manage leave applications'],
  ['hr.leave.approve', 'Approve leave'],
  ['hr.training.view', 'View training'],
  ['hr.training.manage', 'Manage training'],
  ['hr.files.upload', 'Upload and manage files'],
  ['pm.client.view', 'View clients'],
  ['pm.client.manage', 'Manage clients'],
  ['pm.project.view', 'View projects'],
  ['pm.project.manage', 'Manage projects'],
  ['pm.task.view', 'View tasks'],
  ['pm.task.manage', 'Manage tasks'],
  ['pm.meeting.view', 'View meetings'],
  ['pm.meeting.manage', 'Manage meetings'],
  ['pm.daily_task.view', 'View daily tasks'],
  ['pm.daily_task.manage', 'Manage daily tasks'],
  ['pm.daily_task.approve', 'Approve and reject work logs'],
  ['report.view', 'View and export reports'],
  ['audit.view', 'View activity log'],
  ['audit.delete', 'Delete activity log entries'],
  ['settings.manage', 'Manage settings, roles and users'],
  ['self.leave.apply', 'Submit own leave applications'],
  ['self.attendance.view', 'View own attendance'],
  ['self.profile.view', 'View own profile'],
  ['self.profile.update', 'Update own editable profile fields'],
  ['self.training.view', 'View own training assignments'],
  ['self.project.view', 'View projects you are part of'],
  ['self.task.create', 'Create and update own tasks in assigned projects'],
  ['self.worklog.manage', 'Manage own work logs'],
  ['self.loan.apply', 'Apply for a loan'],
  ['self.holiday.view', 'View holidays'],
  ['self.id_card.view', 'View own ID card'],
  ['self.performance.view', 'View own performance reviews'],
  ['hr.notices.read', 'Read notices'],
  ['hr.policies.read', 'Read policies'],
  ['payroll.view', 'View payroll runs and dashboard'],
  ['payroll.run', 'Create, calculate and manage payroll runs'],
  ['payroll.approve', 'Approve payroll runs'],
  ['payroll.pay', 'Mark payroll runs as paid'],
  ['payroll.report', 'View and export payroll reports'],
  ['salary_component.view', 'View salary components'],
  ['salary_component.manage', 'Manage salary components'],
  ['salary_structure.view', 'View salary structures'],
  ['salary_structure.manage', 'Manage salary structures'],
  ['employee_salary.view', 'View employee salary assignments'],
  ['employee_salary.manage', 'Manage employee salary assignments'],
  ['payslip.self', 'View own payslips'],
  ['payslip.view_all', 'View all payslips'],
];

const ROLE_PERMS = {
  super_admin: PERMISSIONS.map(([code]) => code),
  hr_admin: [
    'hr.masters.view', 'hr.masters.create', 'hr.masters.update', 'hr.masters.delete',
    'hr.employee.view', 'hr.employee.create', 'hr.employee.update', 'hr.employee.delete',
    'hr.employee.transfer', 'hr.employee.performance',
    'hr.attendance.view', 'hr.attendance.manage', 'hr.attendance.approve',
    'hr.attendance.field.self', 'hr.attendance.field.view_all', 'hr.attendance.field.report',
    'geofence.view', 'geofence.manage', 'geofence.assign', 'geofence.breach.view',
    'hr.leave.view', 'hr.leave.manage', 'hr.leave.approve',
    'hr.training.view', 'hr.training.manage',
    'hr.files.upload',
    'payroll.view', 'payroll.run', 'payroll.approve', 'payroll.pay', 'payroll.report',
    'salary_component.view', 'salary_component.manage',
    'salary_structure.view', 'salary_structure.manage',
    'employee_salary.view', 'employee_salary.manage',
    'payslip.self', 'payslip.view_all',
    'report.view', 'audit.view',
    'self.leave.apply', 'self.attendance.view', 'self.profile.view', 'self.profile.update',
    'hr.notices.read', 'hr.policies.read',
  ],
  hr_manager: [
    'hr.masters.view', 'hr.employee.view', 'hr.employee.performance',
    'hr.attendance.view', 'hr.attendance.approve',
    'hr.attendance.field.self', 'hr.attendance.field.view_all', 'hr.attendance.field.report',
    'geofence.view', 'geofence.breach.view',
    'hr.leave.view', 'hr.leave.approve', 'hr.training.view',
    'payroll.view', 'payroll.run', 'payroll.report',
    'salary_component.view', 'salary_structure.view', 'employee_salary.view',
    'payslip.self', 'payslip.view_all',
    'report.view', 'audit.view',
    'self.leave.apply', 'self.attendance.view', 'self.profile.view', 'self.profile.update',
    'hr.notices.read', 'hr.policies.read',
  ],
  project_manager: [
    'pm.client.view', 'pm.client.manage', 'pm.project.view', 'pm.project.manage',
    'pm.task.view', 'pm.task.manage', 'pm.meeting.view', 'pm.meeting.manage',
    'pm.daily_task.view', 'pm.daily_task.manage', 'pm.daily_task.approve', 'report.view', 'audit.view',
    'self.leave.apply', 'self.attendance.view', 'self.profile.view', 'self.profile.update',
    'hr.attendance.field.self', 'hr.attendance.field.view_all', 'hr.attendance.field.report',
    'geofence.view', 'geofence.breach.view',
  ],
  employee: [
    'self.leave.apply', 'self.attendance.view', 'self.profile.view', 'self.profile.update',
    'self.training.view',
    'self.project.view', 'self.task.create', 'self.worklog.manage',
    'self.loan.apply', 'self.holiday.view', 'self.id_card.view', 'self.performance.view',
    'payslip.self',
    'pm.task.view', 'pm.daily_task.view', 'pm.daily_task.manage',
    'hr.attendance.field.self',
    'hr.notices.read', 'hr.policies.read',
  ],
  viewer: [
    'hr.masters.view', 'hr.employee.view', 'hr.attendance.view', 'hr.leave.view',
    'hr.training.view', 'pm.client.view', 'pm.project.view', 'pm.task.view',
    'pm.meeting.view', 'pm.daily_task.view', 'report.view', 'audit.view',
    'hr.attendance.field.view_all', 'hr.attendance.field.report',
    'geofence.view', 'geofence.breach.view',
    'payroll.view', 'payroll.report',
    'salary_component.view', 'salary_structure.view', 'employee_salary.view',
    'payslip.self',
    'hr.notices.read', 'hr.policies.read',
  ],
};

// Deterministic PRNG so repeated seeds produce the same data.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const pool = new Pool({ connectionString: loadEnv() });
  const log = (msg) => console.log(msg);
  const rng = mulberry32(20260819);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  const randFloat = (min, max) => rng() * (max - min) + min;
  const exists = async (sql, params) => (await pool.query(sql, params)).rows.length > 0;

  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  };
  const localDate = (str) => {
    const [y, m, dd] = str.split('-').map(Number);
    return new Date(y, m - 1, dd);
  };
  const localIso = (y, m, dd, hh, mm) => new Date(y, m - 1, dd, hh, mm).toISOString();
  const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const isWeekend = (d) => d.getDay() === 5 || d.getDay() === 6; // Fri/Sat (BD weekend)

  // ---- Permissions ---------------------------------------------------------
  for (const [code, description] of PERMISSIONS) {
    await pool.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [code, description]
    );
  }
  const permRows = await pool.query('SELECT code, id FROM permissions');
  const permId = Object.fromEntries(permRows.rows.map((r) => [r.code, r.id]));
  log(`seeded ${PERMISSIONS.length} permissions`);

  // ---- Roles ---------------------------------------------------------------
  for (const [name, perms] of Object.entries(ROLE_PERMS)) {
    await pool.query(
      `INSERT INTO roles (name, description) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
      [name, `Built-in ${name} role (Spec Phase 7 permission matrix)`]
    );
    const { rows } = await pool.query('SELECT id FROM roles WHERE name = $1', [name]);
    const roleId = rows[0].id;
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const code of perms) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [roleId, permId[code]]
      );
    }
  }
  log(`seeded ${Object.keys(ROLE_PERMS).length} roles`);

  const roleId = async (name) => (await pool.query('SELECT id FROM roles WHERE name=$1', [name])).rows[0].id;

  // ---- Users ---------------------------------------------------------------
  const DEV_PASS = hashPassword('Admin@12345');
  const adminUser = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash, is_super_admin)
     VALUES ('admin', 'admin@sdi.local', 'System Administrator', $1, true)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [DEV_PASS]
  );
  await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash)
     VALUES ('hr.admin', 'hr@sdi.local', 'HR Administrator', $1)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [DEV_PASS]
  );
  await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash)
     VALUES ('pm.manager', 'pm@sdi.local', 'Project Manager', $1)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [DEV_PASS]
  );
  for (const [username, roleName] of [
    ['hr.admin', 'hr_admin'],
    ['pm.manager', 'project_manager'],
  ]) {
    const { rows } = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
    if (rows[0]) {
      await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        rows[0].id,
        await roleId(roleName),
      ]);
    }
  }
  // Demo employee user linked to SDI-0101 (self-service: own payslips only).
  const empUser = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash)
     VALUES ('emp.demo', 'emp@sdi.local', 'Arefin Chowdhury', $1)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [DEV_PASS]
  );
  if (empUser.rows[0]) {
    await pool.query(
      `UPDATE users SET employee_id = (SELECT id FROM employees WHERE employee_code='SDI-0101') WHERE id=$1`,
      [empUser.rows[0].id]
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [empUser.rows[0].id, await roleId('employee')]
    );
  }
  const adminId = adminUser.rows[0]?.id ?? (await pool.query(`SELECT id FROM users WHERE username='admin'`)).rows[0].id;
  log('seeded users (admin / hr.admin / pm.manager / emp.demo)');

  // ---- HR masters (idempotent) ----------------------------------------------
  const departments = ['Engineering', 'Human Resources', 'Sales & Marketing', 'Finance', 'Operations'];
  const deptId = {};
  for (const name of departments) {
    const { rows } = await pool.query(
      `INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      [name]
    );
    if (!rows[0]) {
      const r = await pool.query('SELECT id FROM departments WHERE lower(name)=lower($1)', [name]);
      deptId[name] = r.rows[0].id;
    } else {
      deptId[name] = rows[0].id;
    }
  }
  log(`seeded ${departments.length} departments`);

  const subDepts = [
    ['Software Development', 'Engineering'],
    ['QA', 'Engineering'],
    ['DevOps', 'Engineering'],
    ['Recruitment', 'Human Resources'],
    ['Payroll', 'Human Resources'],
    ['Account Payable', 'Finance'],
    ['Sales', 'Sales & Marketing'],
    ['Digital Marketing', 'Sales & Marketing'],
  ];
  for (const [name, dept] of subDepts) {
    await pool.query(
      `INSERT INTO sub_departments (department_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [deptId[dept], name]
    );
  }
  const subDeptRows = await pool.query('SELECT id, name, department_id FROM sub_departments');
  const subDeptId = {};
  for (const s of subDeptRows.rows) subDeptId[s.name] = s.id;
  log(`seeded ${subDepts.length} sub-departments`);

  const employeeTypes = ['Permanent', 'Contract', 'Intern'];
  const empTypeId = {};
  for (const name of employeeTypes) {
    const { rows } = await pool.query(
      `INSERT INTO employee_types (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      [name]
    );
    empTypeId[name] = rows[0]?.id ?? (await pool.query('SELECT id FROM employee_types WHERE lower(name)=lower($1)', [name])).rows[0].id;
  }

  const positions = [
    'Software Engineer', 'Senior Software Engineer', 'QA Engineer', 'DevOps Engineer',
    'HR Officer', 'HR Manager', 'Accountant', 'Marketing Executive', 'Project Manager',
    'Sales Executive', 'UI/UX Designer', 'Data Analyst', 'Finance Officer',
    'Business Analyst', 'Support Engineer', 'Operations Coordinator', 'Office Administrator',
    'System Administrator',
  ];
  const posId = {};
  for (const name of positions) {
    const { rows } = await pool.query(
      `INSERT INTO positions (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      [name]
    );
    posId[name] = rows[0]?.id ?? (await pool.query('SELECT id FROM positions WHERE lower(name)=lower($1)', [name])).rows[0].id;
  }
  log(`seeded ${employeeTypes.length} employee types, ${positions.length} positions`);

  const ruleRows = await pool.query(
    `INSERT INTO setup_rules (title, employee_type_id, daily_working_hour, office_start_time, office_end_time, grace_period_minutes, working_days, auto_calc_hours)
     VALUES ('Fixed 9-6 (Permanent)', $1, 8, '09:00', '18:00', 15, ARRAY['sun','mon','tue','wed','thu'], true)
     ON CONFLICT DO NOTHING RETURNING id`,
    [empTypeId['Permanent']]
  );
  const setupRuleId = ruleRows.rows[0]?.id ??
    (await pool.query(`SELECT id FROM setup_rules WHERE title='Fixed 9-6 (Permanent)'`)).rows[0].id;
  if (ruleRows.rows[0]?.id) {
    await pool.query(
      `UPDATE setup_rules SET working_days = ARRAY['sun','mon','tue','wed','thu'], auto_calc_hours = true WHERE id = $1`,
      [setupRuleId]
    );
  }

  const currentYear = new Date().getFullYear();
  const holidays = [
    ['New Year', `${currentYear}-01-01`],
    ['Independence Day', `${currentYear}-03-26`],
    ['Labour Day', `${currentYear}-05-01`],
    ['Victory Day', `${currentYear}-12-16`],
  ];
  for (const [title, d] of holidays) {
    await pool.query(`INSERT INTO holidays (title, holiday_date) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [title, d]);
  }
  log(`seeded ${holidays.length} holidays`);

  const leaveTypes = [
    ['Annual Leave', 'AL', 20, true, 'both'],
    ['Sick Leave', 'SL', 10, true, 'both'],
    ['Casual Leave', 'CL', 10, true, 'both'],
    ['Maternity Leave', 'ML', 112, true, 'female'],
    ['Paternity Leave', 'PL', 10, true, 'male'],
    ['Non-Paid Leave', 'NPL', 0, false, 'both'],
  ];
  const leaveTypeId = {};
  for (const [name, code, entitlement, paid, gender] of leaveTypes) {
    const { rows } = await pool.query(
      `INSERT INTO leave_types (name, code, annual_entitlement, is_paid, gender_eligibility)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING RETURNING id`,
      [name, code, entitlement, paid, gender]
    );
    leaveTypeId[code] = rows[0]?.id ?? (await pool.query('SELECT id FROM leave_types WHERE code=$1', [code])).rows[0].id;
  }
  log(`seeded ${leaveTypes.length} leave types`);

  // ==========================================================================
  // DEMO DATA (always runs; every insert is guarded so re-runs are safe)
  // ==========================================================================

  const today = new Date();
  const demoEmployees = [
    // code, name, gender, type, dept, sub, pos, join
    ['SDI-0101', 'Arefin Chowdhury', 'Male', 'Permanent', 'Sales & Marketing', 'Sales', 'Sales Executive', '2025-08-11'],
    ['SDI-0102', 'Sumaiya Karim', 'Female', 'Permanent', 'Sales & Marketing', 'Sales', 'Sales Executive', '2025-08-18'],
    ['SDI-0103', 'Rafiqul Islam', 'Male', 'Contract', 'Sales & Marketing', 'Digital Marketing', 'Marketing Executive', '2025-09-08'],
    ['SDI-0104', 'Nayeem Islam', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2025-09-15'],
    ['SDI-0105', 'Tanzila Rahman', 'Female', 'Permanent', 'Engineering', 'QA', 'QA Engineer', '2025-09-21'],
    ['SDI-0106', 'Shahidul Alam', 'Male', 'Permanent', 'Operations', null, 'Operations Coordinator', '2025-09-28'],
    ['SDI-0107', 'Israt Jahan', 'Female', 'Permanent', 'Human Resources', 'Recruitment', 'HR Officer', '2025-10-05'],
    ['SDI-0108', 'Omar Faruk', 'Male', 'Contract', 'Engineering', 'DevOps', 'DevOps Engineer', '2025-10-12'],
    ['SDI-0109', 'Sabrina Akter', 'Female', 'Permanent', 'Finance', 'Account Payable', 'Accountant', '2025-10-19'],
    ['SDI-0110', 'Imran Hossain', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Senior Software Engineer', '2025-11-02'],
    ['SDI-0111', 'Farhana Yasmin', 'Female', 'Contract', 'Sales & Marketing', 'Digital Marketing', 'Marketing Executive', '2025-11-09'],
    ['SDI-0112', 'Ashraf Ali', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2025-11-16'],
    ['SDI-0113', 'Rima Sultana', 'Female', 'Permanent', 'Human Resources', 'Payroll', 'HR Officer', '2025-11-23'],
    ['SDI-0114', 'Mehedi Hasan', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2025-12-01'],
    ['SDI-0115', 'Sharmin Chowdhury', 'Female', 'Permanent', 'Finance', null, 'Finance Officer', '2025-12-07'],
    ['SDI-0116', 'Jewel Rana', 'Male', 'Permanent', 'Engineering', 'QA', 'QA Engineer', '2025-12-14'],
    ['SDI-0117', 'Nasrin Akter', 'Female', 'Intern', 'Human Resources', 'Recruitment', 'HR Officer', '2025-12-21'],
    ['SDI-0118', 'Arif Hossain', 'Male', 'Permanent', 'Engineering', 'DevOps', 'DevOps Engineer', '2026-01-05'],
    ['SDI-0119', 'Shanta Das', 'Female', 'Contract', 'Sales & Marketing', 'Sales', 'Sales Executive', '2026-01-11'],
    ['SDI-0120', 'Kamal Uddin', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2026-01-18'],
    ['SDI-0121', 'Moushumi Khatun', 'Female', 'Permanent', 'Operations', null, 'Operations Coordinator', '2026-01-25'],
    ['SDI-0122', 'Tarek Aziz', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Business Analyst', '2026-02-01'],
    ['SDI-0123', 'Runa Laila', 'Female', 'Permanent', 'Finance', 'Account Payable', 'Accountant', '2026-02-08'],
    ['SDI-0124', 'Farid Mia', 'Male', 'Contract', 'Engineering', 'Software Development', 'Software Engineer', '2026-02-15'],
    ['SDI-0125', 'Sadia Rahman', 'Female', 'Permanent', 'Sales & Marketing', 'Digital Marketing', 'Marketing Executive', '2026-02-22'],
    ['SDI-0126', 'Rakib Hasan', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2026-03-02'],
    ['SDI-0127', 'Monira Parvin', 'Female', 'Permanent', 'Human Resources', 'Payroll', 'HR Officer', '2026-03-09'],
    ['SDI-0128', 'Sajjad Hossain', 'Male', 'Permanent', 'Engineering', 'QA', 'QA Engineer', '2026-03-16'],
    ['SDI-0129', 'Tanjia Ahmed', 'Female', 'Permanent', 'Sales & Marketing', 'Sales', 'Sales Executive', '2026-04-06'],
    ['SDI-0130', 'Golam Kibria', 'Male', 'Permanent', 'Engineering', 'DevOps', 'DevOps Engineer', '2026-04-13'],
    ['SDI-0131', 'Rubina Yesmin', 'Female', 'Contract', 'Operations', null, 'Office Administrator', '2026-04-20'],
    ['SDI-0132', 'Fahim Rahman', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2026-05-04'],
    ['SDI-0133', 'Shirin Sultana', 'Female', 'Permanent', 'Human Resources', 'Recruitment', 'HR Officer', '2026-05-11'],
    ['SDI-0134', 'Mamunur Rashid', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Senior Software Engineer', '2026-05-18'],
    ['SDI-0135', 'Nabila Islam', 'Female', 'Contract', 'Sales & Marketing', 'Sales', 'Sales Executive', '2026-06-01'],
    ['SDI-0136', 'Shafiul Islam', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2026-06-08'],
    ['SDI-0137', 'Sharmila Rani', 'Female', 'Intern', 'Finance', 'Account Payable', 'Accountant', '2026-06-15'],
    ['SDI-0138', 'Joynul Abedin', 'Male', 'Permanent', 'Engineering', 'QA', 'QA Engineer', '2026-07-06'],
    ['SDI-0139', 'Ferdousi Begum', 'Female', 'Permanent', 'Sales & Marketing', 'Digital Marketing', 'Marketing Executive', '2026-07-13'],
    ['SDI-0140', 'Asaduzzaman Khan', 'Male', 'Permanent', 'Engineering', 'Software Development', 'Software Engineer', '2026-07-20'],
    ['SDI-0141', 'Laboni Akter', 'Female', 'Permanent', 'Human Resources', 'Payroll', 'HR Officer', '2026-08-03'],
    ['SDI-0142', 'Mizanur Rahman', 'Male', 'Contract', 'Engineering', 'Software Development', 'Software Engineer', '2026-08-10'],
    ['SDI-0143', 'Protik Barua', 'Male', 'Permanent', 'Operations', null, 'Operations Coordinator', '2026-08-16'],
  ];
  const FIELD_EMPS = ['SDI-0101', 'SDI-0102', 'SDI-0103'];

  const empId = {};
  const empRows = await pool.query(
    `SELECT id, employee_code, department_id, sub_department_id, position_id, employee_type_id,
            setup_rule_id, joining_date, gender
       FROM employees WHERE deleted_at IS NULL ORDER BY employee_code`
  );
  for (const r of empRows.rows) empId[r.employee_code] = r.id;

  let newEmpCount = 0;
  for (const [code, name, gender, type, dept, sub, pos, join] of demoEmployees) {
    const { rows } = await pool.query(
      `INSERT INTO employees (
         employee_code, full_name, email, mobile, gender, contract_type, joining_date,
         department_id, sub_department_id, position_id, employee_type_id, setup_rule_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
       ON CONFLICT (employee_code) DO NOTHING RETURNING id`,
      [
        code, name, `${code.toLowerCase()}@sdi.local`, `0171${code.slice(-4)}0000`, gender,
        type, join,
        deptId[dept],
        sub ? subDeptId[sub] : null,
        posId[pos],
        empTypeId[type],
        setupRuleId,
      ]
    );
    if (rows[0]) {
      newEmpCount += 1;
      await pool.query(
        `INSERT INTO employee_banks (employee_id, bank_name, account_name, account_number, branch)
         VALUES ($1, 'DBBL', $2, '1234-5678-90', 'Gulshan')`,
        [rows[0].id, name]
      );
      await pool.query(
        `INSERT INTO employee_addresses (employee_id, type, address_line1, city, country)
         VALUES ($1, 'present', 'House 12, Road 5', 'Dhaka', 'Bangladesh')`,
        [rows[0].id]
      );
      empId[code] = rows[0].id;
    }
  }
  log(`demo employees: ${newEmpCount} new, ${Object.keys(empId).length} total`);

  // ---- Admin is also an employee (SDI-0100) --------------------------------
  await pool.query(
    `INSERT INTO employees (
       employee_code, full_name, email, gender, contract_type, joining_date,
       department_id, sub_department_id, position_id, employee_type_id, setup_rule_id, status
     ) VALUES (
       'SDI-0100', 'System Administrator', 'admin@sdi.local', 'Male', 'Permanent', '2024-01-01',
       $1, NULL, $2, $3, $4, 'active'
     )
     ON CONFLICT (employee_code) DO NOTHING`,
    [deptId['Engineering'], posId['System Administrator'], empTypeId['Permanent'], setupRuleId]
  );
  await pool.query(
    `UPDATE users SET employee_id = (SELECT id FROM employees WHERE employee_code='SDI-0100')
     WHERE username = 'admin'`
  );
  empId['SDI-0100'] = (await pool.query(
    `SELECT id FROM employees WHERE employee_code='SDI-0100'`
  )).rows[0].id;
  log('admin linked to employee SDI-0100 (System Administrator)');

  const demoEmpIds = Object.values(empId);

  // ---- Leave balances (all employees) --------------------------------------
  let balanceCount = 0;
  for (const eid of demoEmpIds) {
    for (const [code, total] of [['AL', 20], ['SL', 10], ['CL', 10], ['NPL', 0]]) {
      const taken = code === 'AL' ? randInt(2, 8) : code === 'SL' ? randInt(0, 3) : code === 'CL' ? randInt(0, 4) : 0;
      const { rowCount } = await pool.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, total, taken, due)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
        [eid, leaveTypeId[code], currentYear, total, taken, total - taken]
      );
      balanceCount += rowCount;
    }
  }
  log(`seeded ${balanceCount} leave balances`);

  // ---- Leave applications ---------------------------------------------------
  const leaveReasons = [
    'Family vacation', 'Medical appointment', 'Personal work', 'Village visit',
    'Wedding ceremony', 'Travel', 'Home repair', 'Religious holiday', 'Family emergency',
  ];
  let leaveAppCount = 0;
  for (let i = 0; i < 30; i++) {
    const eid = pick(demoEmpIds);
    const typeCode = pick(['AL', 'AL', 'SL', 'CL']);
    const status = rng() < 0.45 ? 'approved' : rng() < 0.8 ? 'pending' : 'rejected';
    const days = randInt(1, 4);
    let start;
    if (status === 'approved') start = addDays(today, -randInt(5, 45));
    else if (status === 'pending') start = rng() < 0.5 ? addDays(today, -randInt(3, 30)) : addDays(today, randInt(2, 12));
    else start = addDays(today, -randInt(10, 60));
    const end = addDays(start, days - 1);
    const reason = pick(leaveReasons);
    if (await exists(
      `SELECT id FROM leave_applications WHERE employee_id=$1 AND leave_type_id=$2
        AND start_date <= $4 AND end_date >= $3`,
      [eid, leaveTypeId[typeCode], dateStr(start), dateStr(end)]
    )) continue;
    await pool.query(
      `INSERT INTO leave_applications (employee_id, leave_type_id, start_date, end_date, requested_days,
                                       approved_days, reason, status, approved_by, approved_at, manager_comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               CASE WHEN $8='approved' THEN $9::uuid ELSE NULL END,
               CASE WHEN $8='approved' THEN $10::timestamptz ELSE NULL END,
               CASE WHEN $8='approved' THEN 'Approved by manager' ELSE NULL END)`,
      [eid, leaveTypeId[typeCode], dateStr(start), dateStr(end), days,
       status === 'approved' ? days : 0, reason, status, adminId, localIso(start.getFullYear(), start.getMonth() + 1, start.getDate(), 10, 0)]
    );
    leaveAppCount += 1;
  }
  log(`seeded ${leaveAppCount} leave applications`);

  const approvedLeaveDays = new Map(); // employee_id -> Set('YYYY-MM-DD')
  const { rows: approvedLeaves } = await pool.query(
    `SELECT employee_id, start_date, end_date FROM leave_applications WHERE status='approved'`
  );
  for (const a of approvedLeaves) {
    let d = localDate(dateStr(a.start_date));
    const end = localDate(dateStr(a.end_date));
    while (d <= end) {
      const key = `${a.employee_id}|${dateStr(d)}`;
      if (!approvedLeaveDays.has(key)) approvedLeaveDays.set(key, true);
      d = addDays(d, 1);
    }
  }

  // ---- Geofences + assignments ---------------------------------------------
  const geofenceSpecs = [
    ['Head Office', 'Main office campus in Banani', 23.8103, 90.4125, 300],
    ['Warehouse', 'Central warehouse in Tejgaon', 23.7658, 90.4252, 200],
    ['Dhaka Sales Zone', 'Sales coverage zone across Dhaka', 23.7903, 90.3983, 1500],
  ];
  const geoId = {};
  for (const [name, desc, lat, lng, radius] of geofenceSpecs) {
    const existing = await pool.query('SELECT id FROM geofences WHERE name=$1', [name]);
    if (existing.rows[0]) {
      geoId[name] = existing.rows[0].id;
      continue;
    }
    const { rows } = await pool.query(
      `INSERT INTO geofences (name, description, center_latitude, center_longitude, radius_meters, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, desc, lat, lng, radius, adminId]
    );
    geoId[name] = rows[0].id;
  }
  const geoAssign = async (geofence, column, scopeId) => {
    if (await exists(
      `SELECT id FROM geofence_assignments WHERE geofence_id=$1 AND ${column}=$2`,
      [geoId[geofence], scopeId]
    )) return;
    await pool.query(
      `INSERT INTO geofence_assignments (geofence_id, ${column}, restrict_check_in, flag_exit)
       VALUES ($1, $2, true, true)`,
      [geoId[geofence], scopeId]
    );
  };
  for (const code of FIELD_EMPS) await geoAssign('Head Office', 'employee_id', empId[code]);
  await geoAssign('Head Office', 'department_id', deptId['Engineering']);
  for (const code of ['SDI-0101', 'SDI-0102']) await geoAssign('Warehouse', 'employee_id', empId[code]);
  await geoAssign('Dhaka Sales Zone', 'department_id', deptId['Sales & Marketing']);
  log('seeded 3 geofences + assignments');

  // ---- Field tracking sessions (past 14 days + active today) ----------------
  const fieldSessionInfo = new Map(); // employee_id -> Map(dateStr -> {start, end})
  const geoCenters = [
    { name: 'Head Office', lat: 23.8103, lng: 90.4125 },
    { name: 'Warehouse', lat: 23.7658, lng: 90.4252 },
    { name: 'Dhaka Sales Zone', lat: 23.7903, lng: 90.3983 },
  ];
  let fieldSessionCount = 0;
  let fieldPointCount = 0;
  const insertPoints = async (sessionId, employeeId, points) => {
    for (const p of points) {
      await pool.query(
        `INSERT INTO field_location_points (session_id, employee_id, latitude, longitude, accuracy, speed, captured_at, battery_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, employeeId, p.lat, p.lng, p.acc, p.speed, p.at, p.battery]
      );
      fieldPointCount += 1;
    }
  };
  for (const code of FIELD_EMPS) {
    const eid = empId[code];
    if (!eid) continue;
    const info = new Map();
    fieldSessionInfo.set(eid, info);
    for (let i = 13; i >= 1; i--) {
      const day = addDays(today, -i);
      if (isWeekend(day)) continue;
      if (rng() < 0.12) continue;
      const center = pick(geoCenters);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), randInt(9, 9), randInt(5, 25));
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), randInt(17, 18), randInt(10, 55));
      const startLat = center.lat + randFloat(-0.001, 0.001);
      const startLng = center.lng + randFloat(-0.001, 0.001);
      const n = randInt(8, 13);
      const points = [];
      let lat = startLat, lng = startLng;
      for (let k = 0; k < n; k++) {
        lat = Math.min(center.lat + 0.008, Math.max(center.lat - 0.008, lat + randFloat(-0.003, 0.003)));
        lng = Math.min(center.lng + 0.008, Math.max(center.lng - 0.008, lng + randFloat(-0.003, 0.003)));
        const t = new Date(start.getTime() + ((end.getTime() - start.getTime()) * (k + 1)) / (n + 1));
        points.push({ lat, lng, acc: randInt(4, 18), speed: randInt(0, 25), at: t.toISOString(), battery: randInt(15, 100) });
      }
      if (await exists(
        `SELECT id FROM field_tracking_sessions WHERE employee_id=$1 AND started_at=$2`,
        [eid, start.toISOString()]
      )) continue;
      const { rows: sess } = await pool.query(
        `INSERT INTO field_tracking_sessions (employee_id, started_at, ended_at, start_latitude, start_longitude,
                                              end_latitude, end_longitude, status, device_id,
                                              geofence_id, current_geofence_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'device-phone',
                 $8, 'inside') RETURNING id`,
        [eid, start.toISOString(), end.toISOString(), startLat, startLng, points[n - 1].lat, points[n - 1].lng,
         geoId[center.name]]
      );
      if (!sess[0]) continue;
      await pool.query(
        `INSERT INTO attendance_events (employee_id, event_time, source) VALUES ($1, $2, 'device') ON CONFLICT DO NOTHING`,
        [eid, start.toISOString()]
      );
      await pool.query(
        `INSERT INTO attendance_events (employee_id, event_time, source) VALUES ($1, $2, 'device') ON CONFLICT DO NOTHING`,
        [eid, end.toISOString()]
      );
      await insertPoints(sess[0].id, eid, points);
      info.set(dateStr(day), { start, end });
      fieldSessionCount += 1;
    }
  }
  // Active sessions today (drive the live map + inside/outside analytics)
  const activeToday = [
    { code: 'SDI-0101', center: 'Head Office', latOff: 0.0002, lngOff: 0.0001, startMinAgo: 120, status: 'inside', points: 4 },
    { code: 'SDI-0102', center: 'Warehouse', latOff: 0.0035, lngOff: 0.0010, startMinAgo: 90, status: 'outside', points: 3 },
    { code: 'SDI-0103', center: 'Dhaka Sales Zone', latOff: 0.0003, lngOff: -0.0004, startMinAgo: 180, status: 'inside', points: 5 },
  ];
  for (const a of activeToday) {
    const eid = empId[a.code];
    if (!eid) continue;
    const center = geoCenters.find((g) => g.name === a.center);
    const start = new Date(Date.now() - a.startMinAgo * 60_000);
    if (await exists(
      `SELECT id FROM field_tracking_sessions WHERE employee_id=$1 AND status='active'`,
      [eid]
    )) continue;
    const startLat = center.lat + a.latOff;
    const startLng = center.lng + a.lngOff;
    const points = [];
    for (let k = 0; k < a.points; k++) {
      const t = new Date(start.getTime() + k * 30 * 60_000);
      points.push({
        lat: startLat + randFloat(-0.0015, 0.0015),
        lng: startLng + randFloat(-0.0015, 0.0015),
        acc: randInt(4, 14), speed: randInt(0, 12), at: t.toISOString(), battery: randInt(20, 90),
      });
    }
    const { rows: sess } = await pool.query(
      `INSERT INTO field_tracking_sessions (employee_id, started_at, start_latitude, start_longitude, status, device_id,
                                            geofence_id, current_geofence_status)
       VALUES ($1, $2, $3, $4, 'active', 'device-phone', $5, $6) RETURNING id`,
      [eid, start.toISOString(), startLat, startLng, geoId[a.center], a.status]
    );
    await pool.query(
      `INSERT INTO attendance_events (employee_id, event_time, source) VALUES ($1, $2, 'device') ON CONFLICT DO NOTHING`,
      [eid, start.toISOString()]
    );
    await insertPoints(sess[0].id, eid, points);
    const info = fieldSessionInfo.get(eid) ?? new Map();
    info.set(dateStr(today), { start, end: null });
    fieldSessionInfo.set(eid, info);
    fieldSessionCount += 1;
  }
  log(`seeded ${fieldSessionCount} field sessions, ${fieldPointCount} location points`);

  // ---- Attendance days + events (last ~70 workdays) --------------------------
  const ATT_DAYS = 70;
  const { rows: holidayRows } = await pool.query(
    `SELECT id, holiday_date FROM holidays WHERE holiday_date BETWEEN $1 AND $2`,
    [dateStr(addDays(today, -ATT_DAYS)), dateStr(today)]
  );
  const holidayIdByDate = new Map(holidayRows.map((h) => [dateStr(h.holiday_date), h.id]));

  const setupEmployees = empRows.rows.filter((r) => r.setup_rule_id);
  const dayValues = [];
  const dayEvents = []; // { key, time }
  for (const emp of setupEmployees) {
    const joinDate = emp.joining_date ? localDate(dateStr(emp.joining_date)) : null;
    const fieldInfo = fieldSessionInfo.get(emp.id);
    for (let i = ATT_DAYS; i >= 0; i--) {
      const day = addDays(today, -i);
      const ds = dateStr(day);
      if (isWeekend(day)) continue;
      if (joinDate && day < joinDate) continue;
      const key = `${emp.id}|${ds}`;
      const roll = rng();
      let status, firstIn = null, lastOut = null, workMin = null, lateMin = 0, holidayId = null;
      if (holidayIdByDate.has(ds)) {
        status = 'Holiday';
        holidayId = holidayIdByDate.get(ds);
      } else if (approvedLeaveDays.has(key)) {
        status = 'Leave';
      } else if (fieldInfo?.has(ds)) {
        const s = fieldInfo.get(ds);
        status = 'Present';
        firstIn = timeStr(s.start);
        if (s.end) lastOut = timeStr(s.end);
        workMin = s.end ? Math.round((s.end - s.start) / 60000) : null;
      } else if (roll < 0.78) {
        status = 'Present';
        firstIn = `08:5${randInt(5, 9)}:00`;
        lastOut = `1${randInt(7, 9)}:${randInt(45, 59)}:00`;
        workMin = 8 * 60 + randInt(0, 90);
      } else if (roll < 0.90) {
        status = 'Late';
        firstIn = `0${randInt(9, 10)}:${randInt(20, 40)}:00`;
        lastOut = `18:${randInt(0, 30)}:00`;
        const fi = firstIn.split(':').map(Number);
        lateMin = fi[0] * 60 + fi[1] - (9 * 60 + 15);
        workMin = Math.max(0, 8 * 60 - 30 - randInt(0, 60));
      } else {
        status = 'Absent';
      }
      dayValues.push([emp.id, ds, firstIn, lastOut, workMin, status, lateMin, holidayId, emp.setup_rule_id]);
      if ((status === 'Present' || status === 'Late') && !fieldInfo?.has(ds)) {
        const [hh, mm] = firstIn.split(':').map(Number);
        const [oh, om] = lastOut.split(':').map(Number);
        dayEvents.push({ key, time: localIso(day.getFullYear(), day.getMonth() + 1, day.getDate(), hh, mm) });
        dayEvents.push({ key, time: localIso(day.getFullYear(), day.getMonth() + 1, day.getDate(), oh, om) });
      }
    }
  }
  const CHUNK = 400;
  const insertedDays = new Set();
  for (let c = 0; c < dayValues.length; c += CHUNK) {
    const slice = dayValues.slice(c, c + CHUNK);
    const placeholders = slice
      .map((_, idx) => `($${idx * 9 + 1},$${idx * 9 + 2},$${idx * 9 + 3},$${idx * 9 + 4},$${idx * 9 + 5},$${idx * 9 + 6},$${idx * 9 + 7},$${idx * 9 + 8},$${idx * 9 + 9})`)
      .join(',');
    const { rows } = await pool.query(
      `INSERT INTO attendance_days (employee_id, work_date, first_in, last_out, total_work_minutes, status, late_minutes, holiday_id, setup_rule_id)
       VALUES ${placeholders}
       ON CONFLICT (employee_id, work_date) DO NOTHING
       RETURNING id, employee_id, work_date`,
      slice.flat()
    );
    for (const r of rows) insertedDays.add(`${r.employee_id}|${dateStr(r.work_date)}`);
  }
  const eventsToInsert = dayEvents.filter((e) => insertedDays.has(e.key));
  for (let c = 0; c < eventsToInsert.length; c += CHUNK) {
    const slice = eventsToInsert.slice(c, c + CHUNK);
    const placeholders = slice.map((_, idx) => `($${idx * 2 + 1},$${idx * 2 + 2},'device')`).join(',');
    await pool.query(
      `INSERT INTO attendance_events (employee_id, event_time, source) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      slice.flatMap((e) => [e.key.split('|')[0], e.time])
    );
  }
  log(`seeded ${dayValues.length} attendance days, ${eventsToInsert.length} attendance events`);

  // ---- Clients + projects + tasks -------------------------------------------
  const clientNames = ['Acme Corp', 'Globex Ltd', 'Initech'];
  const clientId = {};
  for (const name of clientNames) {
    const { rows } = await pool.query(
      `INSERT INTO clients (name, contact_person, email, phone) VALUES ($1, 'Contact', 'contact@example.com', '01900000000')
       ON CONFLICT DO NOTHING RETURNING id`,
      [name]
    );
    if (rows[0]) {
      clientId[name] = rows[0].id;
    } else {
      const r = await pool.query('SELECT id FROM clients WHERE lower(name)=lower($1)', [name]);
      clientId[name] = r.rows[0].id;
    }
  }
  log(`seeded ${clientNames.length} clients`);

  const newProjects = [
    { name: 'Customer Portal', client: 'Acme Corp', lead: 'SDI-0009', status: 'in_progress', startOffset: -90, duration: 120, summary: 'Self-service customer portal with order history and support tickets.' },
    { name: 'Inventory System', client: 'Globex Ltd', lead: 'SDI-0005', status: 'completed', startOffset: -170, duration: 100, summary: 'Warehouse inventory tracking and stock reconciliation.' },
    { name: 'Billing Automation', client: 'Initech', lead: 'SDI-0001', status: 'in_progress', startOffset: -45, duration: 90, summary: 'Automated invoice generation and payment reconciliation.' },
    { name: 'HR Analytics Module', client: 'Acme Corp', lead: 'SDI-0008', status: 'on_hold', startOffset: -70, duration: 60, summary: 'Dashboard and reporting module for HR metrics.' },
    { name: 'E-commerce Checkout', client: 'Globex Ltd', lead: 'SDI-0002', status: 'completed', startOffset: -220, duration: 90, summary: 'Fast and secure checkout flow for the retail storefront.' },
    { name: 'Data Migration', client: 'Initech', lead: 'SDI-0005', status: 'completed', startOffset: -130, duration: 75, summary: 'Migrate legacy records to the new core database.' },
    { name: 'API Gateway', client: 'Acme Corp', lead: 'SDI-0001', status: 'in_progress', startOffset: -25, duration: 60, summary: 'Central gateway with rate limiting and auth for microservices.' },
    { name: 'Warehouse App', client: 'Globex Ltd', lead: 'SDI-0009', status: 'open', startOffset: -5, duration: 90, summary: 'Mobile app for warehouse operators to scan and dispatch.' },
    { name: 'Marketing Dashboard', client: 'Initech', lead: 'SDI-0103', status: 'in_progress', startOffset: -35, duration: 45, summary: 'Campaign performance dashboard for the marketing team.' },
    { name: 'Payroll Integration', client: 'Acme Corp', lead: 'SDI-0006', status: 'cancelled', startOffset: -60, duration: 30, summary: 'Link payroll system with banking partner (cancelled).' },
    { name: 'Chatbot Assistant', client: 'Globex Ltd', lead: 'SDI-0110', status: 'on_hold', startOffset: -55, duration: 50, summary: 'Support chatbot answering common customer questions.' },
    { name: 'Security Audit', client: 'Initech', lead: 'SDI-0005', status: 'in_progress', startOffset: -20, duration: 40, summary: 'External security audit and hardening of production services.' },
  ];
  const taskTitles = [
    'Requirements analysis', 'System design', 'Database schema design', 'REST API development',
    'Frontend implementation', 'UI/UX design', 'Integration testing', 'Deployment automation',
    'Documentation', 'Code review', 'Bug fixing', 'Performance tuning', 'Security hardening', 'Client UAT support',
  ];
  const devPool = ['SDI-0001', 'SDI-0002', 'SDI-0003', 'SDI-0005', 'SDI-0110', 'SDI-0112', 'SDI-0114', 'SDI-0120', 'SDI-0126', 'SDI-0132', 'SDI-0136', 'SDI-0140', 'SDI-0142'];

  const projectId = {};
  const { rows: existingProjects } = await pool.query('SELECT id, name FROM projects WHERE deleted_at IS NULL');
  for (const p of existingProjects) projectId[p.name] = p.id;

  const statusRoll = (projectStatus) => {
    const r = rng();
    switch (projectStatus) {
      case 'completed':
        return r < 0.88 ? 'done' : 'review';
      case 'in_progress':
        return r < 0.22 ? 'done' : r < 0.62 ? 'in_progress' : r < 0.78 ? 'review' : r < 0.93 ? 'todo' : 'blocked';
      case 'on_hold':
        return r < 0.15 ? 'done' : r < 0.4 ? 'in_progress' : 'todo';
      case 'open':
        return r < 0.08 ? 'in_progress' : 'todo';
      case 'cancelled':
        return r < 0.5 ? 'cancelled' : r < 0.8 ? 'done' : 'todo';
      default:
        return 'todo';
    }
  };
  const progressFor = (status) => {
    if (status === 'done') return 100;
    if (status === 'review') return randInt(90, 99);
    if (status === 'in_progress') return randInt(25, 90);
    if (status === 'blocked') return randInt(20, 60);
    return 0;
  };

  const taskCountByStatus = { done: 0, in_progress: 0, review: 0, todo: 0, blocked: 0, cancelled: 0 };
  let newTaskCount = 0;
  const tasksByProject = new Map(); // projectId -> rows for progress calc
  for (const p of newProjects) {
    const start = addDays(today, p.startOffset);
    const end = addDays(start, p.duration);
    const count = p.status === 'completed' ? randInt(10, 13)
      : p.status === 'in_progress' ? randInt(9, 12)
      : p.status === 'on_hold' ? randInt(6, 8)
      : p.status === 'open' ? randInt(5, 6)
      : randInt(5, 6);
    let pid;
    if (!projectId[p.name]) {
      const { rows } = await pool.query(
        `INSERT INTO projects (name, client_id, project_lead_id, approximate_tasks, summary, start_date, duration_days, ending_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [p.name, clientId[p.client], empId[p.lead], count, p.summary, dateStr(start), p.duration, dateStr(end), p.status, adminId]
      );
      pid = rows[0].id;
      projectId[p.name] = pid;
    } else {
      pid = projectId[p.name];
    }
    const members = [p.lead, ...devPool.filter((c) => c !== p.lead).slice(0, randInt(2, 4))];
    for (const m of members) {
      if (!empId[m]) continue;
      await pool.query(
        `INSERT INTO project_members (project_id, employee_id, role) VALUES ($1, $2, 'developer') ON CONFLICT DO NOTHING`,
        [pid, empId[m]]
      );
    }
    const projTasks = [];
    for (let i = 0; i < count; i++) {
      const title = taskTitles[i % taskTitles.length];
      const status = statusRoll(p.status);
      const progress = progressFor(status);
      const assignee = members[i % members.length];
      const priority = pick(['low', 'medium', 'high']);
      const plannedStart = addDays(start, randInt(2, 20));
      const plannedEnd = addDays(plannedStart, randInt(10, 28));
      const maxEnd = addDays(end, 14);
      const plannedEndClamped = plannedEnd > maxEnd ? maxEnd : plannedEnd;
      let actual = null;
      if (status === 'done') {
        actual = addDays(plannedEndClamped, randInt(-4, 6));
        if (actual > today) actual = today;
      }
      const hours = randInt(8, 80);
      if (await exists(`SELECT id FROM tasks WHERE project_id=$1 AND title=$2`, [pid, title])) continue;
      await pool.query(
        `INSERT INTO tasks (project_id, title, description, assignee_id, priority, planned_start, planned_end,
                            actual_completion, status, progress_percent, estimated_hours, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [pid, `${title} — ${p.name}`, `${title} for ${p.name}.`, empId[assignee] ?? null, priority,
         dateStr(plannedStart), dateStr(plannedEndClamped), actual ? dateStr(actual) : null,
         status, progress, hours, adminId]
      );
      taskCountByStatus[status] += 1;
      newTaskCount += 1;
      projTasks.push({ status, progress_percent: progress, estimated_hours: hours });
    }
    tasksByProject.set(pid, projTasks);
  }
  log(`seeded ${newTaskCount} new tasks (${taskCountByStatus.done} done, ${taskCountByStatus.in_progress} in_progress, ${taskCountByStatus.review} review, ${taskCountByStatus.todo} todo, ${taskCountByStatus.blocked} blocked, ${taskCountByStatus.cancelled} cancelled)`);

  // Recompute project progress from tasks (mirrors calculateTaskProgress)
  const { rows: allTasks } = await pool.query(
    `SELECT project_id, status, progress_percent, estimated_hours FROM tasks WHERE deleted_at IS NULL`
  );
  const byProject = new Map();
  for (const t of allTasks) {
    if (!byProject.has(t.project_id)) byProject.set(t.project_id, []);
    byProject.get(t.project_id).push(t);
  }
  for (const [pid, tasks] of byProject) {
    let totalWeight = 0, earnedWeight = 0, completed = 0;
    for (const t of tasks) {
      if (t.status === 'cancelled') continue;
      const hours = Number(t.estimated_hours);
      const weight = Number.isFinite(hours) && hours > 0 ? hours : 1;
      const pct = Math.min(100, Math.max(0, Number(t.progress_percent) || 0));
      const contribution = t.status === 'done' ? 1 : pct / 100;
      totalWeight += weight;
      earnedWeight += weight * contribution;
      if (t.status === 'done') completed += 1;
    }
    const progress = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 10000) / 100 : 0;
    await pool.query(
      `UPDATE projects SET progress=$2, approximate_tasks=$3, updated_at=now() WHERE id=$1`,
      [pid, progress, tasks.length]
    );
  }
  log(`recomputed progress for ${byProject.size} projects from task state`);

  // ---- Meetings -------------------------------------------------------------
  const meetingPurposes = ['Sprint planning', 'Weekly status sync', 'Design review', 'Client demo', 'Retrospective', 'Kickoff meeting'];
  const meetingOutcomes = [
    'Decisions logged and action items assigned.',
    'Scope confirmed; timeline updated in the project plan.',
    'Feedback incorporated into the next iteration.',
    'Client approved the milestone; next sprint scheduled.',
  ];
  let meetingCount = 0;
  const { rows: allProjects } = await pool.query(
    'SELECT id, name FROM projects WHERE deleted_at IS NULL ORDER BY name'
  );
  for (const p of allProjects) {
    const n = rng() < 0.6 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      let held = addDays(today, -randInt(2, 88));
      while (isWeekend(held)) held = addDays(held, -1);
      const [hh, mm] = pick(['10:00', '11:30', '15:00', '16:30']).split(':').map(Number);
      const heldAt = localIso(held.getFullYear(), held.getMonth() + 1, held.getDate(), hh, mm);
      const place = pick(['Conference Room A', 'Conference Room B', 'Online (Google Meet)', 'Client Office']);
      const purpose = pick(meetingPurposes);
      const outcome = pick(meetingOutcomes);
      const attendeeLimit = randInt(3, 5);
      if (await exists(`SELECT id FROM meetings WHERE project_id=$1 AND held_at=$2`, [p.id, heldAt])) continue;
      const { rows } = await pool.query(
        `INSERT INTO meetings (project_id, place, held_at, purpose, outcomes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.id, place, heldAt, purpose, outcome, adminId]
      );
      const { rows: attendees } = await pool.query(
        `SELECT employee_id FROM project_members WHERE project_id=$1 LIMIT 6`,
        [p.id]
      );
      for (const a of attendees.slice(0, attendeeLimit)) {
        await pool.query(
          `INSERT INTO meeting_attendees (meeting_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [rows[0].id, a.employee_id]
        );
      }
      meetingCount += 1;
    }
  }
  log(`seeded ${meetingCount} meetings`);

  // ---- Daily tasks ----------------------------------------------------------
  const dailyDescs = [
    'Completed assigned sprint stories and updated the board.',
    'Pair programming on the payment module.',
    'Fixed production bug reported by the client.',
    'Prepared release notes and deployment checklist.',
    'Reviewed pull requests and provided feedback.',
    'Support calls with the client for UAT questions.',
    'Wrote unit tests for the new API endpoints.',
    'Updated documentation for the operations runbook.',
    'Data cleanup and validation for the migration batch.',
    'Attended sprint planning and refined backlog items.',
  ];
  let dailyTaskCount = 0;
  const dailyEmpPool = ['SDI-0001', 'SDI-0002', 'SDI-0003', 'SDI-0110', 'SDI-0114', 'SDI-0126'];
  for (let i = 2; i <= 13; i++) {
    const day = addDays(today, -i);
    if (isWeekend(day)) continue;
    for (const code of dailyEmpPool.slice(0, randInt(2, 3))) {
      const eid = empId[code];
      if (!eid) continue;
      const desc = pick(dailyDescs);
      const r = rng();
      const status = r < 0.15 ? 'draft' : r < 0.25 ? 'approved' : r < 0.32 ? 'rejected' : 'submitted';
      const hours = randInt(2, 8);
      if (await exists(
        `SELECT id FROM daily_tasks WHERE employee_id=$1 AND work_date=$2 AND work_description=$3`,
        [eid, dateStr(day), desc]
      )) continue;
      await pool.query(
        `INSERT INTO daily_tasks (employee_id, project_id, work_date, work_description, hours, status, approved_by, approved_at, rejected_by, rejected_at)
         VALUES ($1, NULL, $2, $3, $4, $5,
                 CASE WHEN $5='approved' THEN $6::uuid ELSE NULL END,
                 CASE WHEN $5='approved' THEN $7::timestamptz ELSE NULL END,
                 CASE WHEN $5='rejected' THEN $6::uuid ELSE NULL END,
                 CASE WHEN $5='rejected' THEN $7::timestamptz ELSE NULL END)`,
        [eid, dateStr(day), desc, hours, status, adminId, localIso(day.getFullYear(), day.getMonth() + 1, day.getDate(), 17, 30)]
      );
      dailyTaskCount += 1;
    }
  }
  log(`seeded ${dailyTaskCount} daily tasks`);

  // ---- Performance records ---------------------------------------------------
  const { rows: perfEmpRows } = await pool.query(
    `SELECT e.id, e.employee_code, e.joining_date, p.name AS position_name
       FROM employees e LEFT JOIN positions p ON p.id = e.position_id
      WHERE e.deleted_at IS NULL ORDER BY e.employee_code`
  );
  let perfCount = 0;
  for (const emp of perfEmpRows) {
    const r1 = rng();
    if (r1 < 0.2) continue; // leave ~20% of employees without reviews
    for (const ago of [randInt(30, 150), randInt(180, 300)]) {
      const perfDate = addDays(today, -ago);
      const evaluator = pick(['Asma Khatun', 'Rashidul Karim', 'Mahmud Hasan']);
      const score = randInt(55, 97);
      const note = pick(['Solid performance this period.', 'Good progress; needs more ownership.', 'Exceeds expectations on delivery.', 'Average output; coaching recommended.']);
      if (await exists(
        `SELECT id FROM employee_performances WHERE employee_id=$1 AND performance_date=$2`,
        [emp.id, dateStr(perfDate)]
      )) continue;
      await pool.query(
        `INSERT INTO employee_performances (employee_id, position_title, position_date, performance_date,
                                            evaluator_name, total_score, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [emp.id, emp.position_name ?? null, emp.joining_date ?? null, dateStr(perfDate),
         evaluator, score, note]
      );
      perfCount += 1;
    }
  }
  log(`seeded ${perfCount} performance records`);

  // ---- Training --------------------------------------------------------------
  let trn = await pool.query(`SELECT id FROM trainings WHERE title='NestJS Deep Dive'`);
  if (trn.rows.length === 0) {
    trn = await pool.query(
      `INSERT INTO trainings (title, description, trainer, venue, status) VALUES ('NestJS Deep Dive', 'Advanced NestJS training', 'External Trainer', 'Conference Room A', 'completed') RETURNING id`
    );
    for (const code of ['SDI-0001', 'SDI-0002', 'SDI-0003']) {
      await pool.query(
        `INSERT INTO training_assignments (training_id, employee_id, status, completion_date, score)
         VALUES ($1, $2, 'completed', '2025-08-01', 85) ON CONFLICT (training_id, employee_id) DO NOTHING`,
        [trn.rows[0].id, empId[code]]
      );
    }
    log('seeded training data');
  } else {
    log('training data already present');
  }

  // ---- Payroll ---------------------------------------------------------------
  // Components, structures and salary assignments are seeded idempotently;
  // payroll runs are created through the real domain calculator so the seeded
  // history matches production math (attendance/leave/loan integration).
  const { initDb: initPayrollDb } = require('@jsk/shared-kernel');
  const payroll = require('@jsk/domain-payroll');
  initPayrollDb({ connectionString: process.env.DATABASE_URL });

  const PAY_COMPONENTS = [
    ['Basic Salary', 'BASIC', 'earning', 'fixed', null, null, false, 10],
    ['House Rent', 'HOUSE', 'earning', 'percentage', null, null, false, 20],
    ['Medical Allowance', 'MEDICAL', 'earning', 'fixed', null, '3000.00', false, 30],
    ['Transport Allowance', 'TRANSPORT', 'earning', 'fixed', null, '2000.00', false, 40],
    ['Professional Allowance', 'PROF', 'earning', 'fixed', null, '1000.00', false, 50],
    ['Incentive / Commission', 'INCNTV', 'earning', 'fixed', null, null, false, 55],
    ['Tax Deduction', 'TAX', 'deduction', 'percentage', null, '3', true, 60],
    ['Provident Fund', 'PF', 'deduction', 'percentage', null, '10', false, 70],
  ];
  const payComponentId = {};
  for (const [name, code, type, calcType, refCode, amount, taxable, sort] of PAY_COMPONENTS) {
    const refId = refCode ? payComponentId[refCode] : null;
    const { rows } = await pool.query(
      `INSERT INTO salary_components (name, code, type, calculation_type, percentage_of_component, default_amount, taxable, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [name, code, type, calcType, refId, amount, taxable, sort]
    );
    payComponentId[code] = rows[0]?.id ?? (await pool.query('SELECT id FROM salary_components WHERE code=$1', [code])).rows[0].id;
  }
  log(`seeded ${PAY_COMPONENTS.length} salary components`);

  // Basic = % of gross; House Rent = % of Basic; Tax/PF = % of gross / % of Basic.
  const PAY_STRUCTURES = {
    'Permanent Structure': [
      ['BASIC', 'percentage', null, '50'], ['HOUSE', 'percentage', 'BASIC', '30'],
      ['MEDICAL', 'fixed', null, '3000.00'], ['TRANSPORT', 'fixed', null, '2000.00'],
      ['PROF', 'fixed', null, '1000.00'], ['TAX', 'percentage', null, '3'], ['PF', 'percentage', 'BASIC', '10'],
    ],
    'Management Structure': [
      ['BASIC', 'percentage', null, '50'], ['HOUSE', 'percentage', 'BASIC', '30'],
      ['MEDICAL', 'fixed', null, '5000.00'], ['TRANSPORT', 'fixed', null, '3000.00'],
      ['PROF', 'fixed', null, '2000.00'], ['TAX', 'percentage', null, '3'], ['PF', 'percentage', 'BASIC', '10'],
    ],
    'Contract Structure': [
      ['BASIC', 'percentage', null, '40'], ['HOUSE', 'percentage', 'BASIC', '25'],
      ['MEDICAL', 'fixed', null, '2000.00'], ['TRANSPORT', 'fixed', null, '1500.00'],
      ['TAX', 'percentage', null, '3'],
    ],
    'Sales Structure': [
      ['BASIC', 'percentage', null, '40'], ['HOUSE', 'percentage', 'BASIC', '25'],
      ['MEDICAL', 'fixed', null, '2500.00'], ['TRANSPORT', 'fixed', null, '2000.00'],
      ['TAX', 'percentage', null, '3'],
    ],
  };
  const payStructureId = {};
  for (const [name, comps] of Object.entries(PAY_STRUCTURES)) {
    const { rows } = await pool.query(
      `INSERT INTO salary_structures (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name, `Standard ${name.toLowerCase().replace(' structure', '')} bundle`]
    );
    payStructureId[name] = rows[0]?.id ?? (await pool.query('SELECT id FROM salary_structures WHERE name=$1', [name])).rows[0].id;
    const existingComps = await pool.query(
      `SELECT component_id FROM salary_structure_components WHERE structure_id=$1`,
      [payStructureId[name]]
    );
    if (existingComps.rows.length === 0) {
      for (const [code, calcType, refCode, amount] of comps) {
        await pool.query(
          `INSERT INTO salary_structure_components (structure_id, component_id, calculation_type, percentage_of_component, amount)
           VALUES ($1, $2, $3, $4, $5)`,
          [payStructureId[name], payComponentId[code], calcType, refCode ? payComponentId[refCode] : null, amount]
        );
      }
    }
  }
  log(`seeded ${Object.keys(PAY_STRUCTURES).length} salary structures`);

  // Salary assignment per demo employee (structure by type/department).
  const GROSS_BY_POS = {
    'Software Engineer': [45, 65], 'Senior Software Engineer': [85, 110],
    'QA Engineer': [40, 58], 'DevOps Engineer': [60, 85],
    'HR Officer': [30, 42], 'HR Manager': [70, 90],
    'Accountant': [35, 48], 'Marketing Executive': [30, 40],
    'Project Manager': [90, 120], 'Sales Executive': [28, 42],
    'UI/UX Designer': [55, 75], 'Data Analyst': [45, 60],
    'Finance Officer': [40, 55], 'Business Analyst': [50, 70],
    'Support Engineer': [35, 45], 'Operations Coordinator': [30, 40],
    'Office Administrator': [25, 32],
  };
  const positionIdToName = {};
  for (const [pname, pid] of Object.entries(posId)) positionIdToName[pid] = pname;
  const { rows: payEmpRows } = await pool.query(
    `SELECT e.id, e.employee_code, e.joining_date, e.employee_type_id, e.department_id, e.position_id,
            et.name AS type_name, d.name AS dept_name
       FROM employees e
       LEFT JOIN employee_types et ON et.id = e.employee_type_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.deleted_at IS NULL AND e.employee_code LIKE 'SDI-%' AND e.employee_code <> 'SDI-0001'
      ORDER BY e.employee_code`
  );
  let salaryAssignCount = 0;
  for (const emp of payEmpRows) {
    const posName = positionIdToName[emp.position_id] ?? 'Software Engineer';
    const [min, max] = GROSS_BY_POS[posName] ?? [40, 60];
    const gross = randInt(min, max) * 1000;
    let structureName = 'Permanent Structure';
    if (emp.type_name === 'Contract' || emp.type_name === 'Intern') structureName = 'Contract Structure';
    else if (emp.dept_name === 'Sales & Marketing') structureName = 'Sales Structure';
    else if (emp.dept_name === 'Finance' || ['Senior Software Engineer', 'Project Manager', 'HR Manager', 'UI/UX Designer', 'Data Analyst'].includes(posName)) {
      structureName = 'Management Structure';
    }
    if (await exists(
      `SELECT id FROM employee_salaries WHERE employee_id=$1 AND status='active'`,
      [emp.id]
    )) continue;
    await pool.query(
      `INSERT INTO employee_salaries (employee_id, salary_structure_id, gross_salary, currency, effective_from, status, created_by)
       VALUES ($1, $2, $3, 'BDT', $4, 'active', $5)`,
      [emp.id, payStructureId[structureName], `${gross}.00`, emp.joining_date ?? '2026-01-01', adminId]
    );
    salaryAssignCount += 1;
  }
  // A handful of promotions (salary history: old row closed, new row added).
  const SALARY_REVISIONS = [
    ['SDI-0110', '2026-06-01', 0.15], ['SDI-0104', '2026-06-01', 0.12], ['SDI-0107', '2026-07-01', 0.10],
    ['SDI-0109', '2026-07-01', 0.08], ['SDI-0114', '2026-07-01', 0.10], ['SDI-0120', '2026-06-01', 0.10],
  ];
  for (const [code, effFrom, raise] of SALARY_REVISIONS) {
    const emp = payEmpRows.find((r) => r.employee_code === code);
    if (!emp) continue;
    if (await exists(
      `SELECT id FROM employee_salaries WHERE employee_id=$1 AND effective_from=$2::date`,
      [emp.id, effFrom]
    )) continue;
    const current = await pool.query(
      `SELECT id, salary_structure_id, gross_salary FROM employee_salaries
        WHERE employee_id=$1 AND status='active' AND effective_from < $2::date
        ORDER BY effective_from DESC LIMIT 1`,
      [emp.id, effFrom]
    );
    if (!current.rows[0]) continue;
    await pool.query(
      `UPDATE employee_salaries SET effective_to=$2::date - 1, status='inactive', updated_at=now() WHERE id=$1`,
      [current.rows[0].id, effFrom]
    );
    await pool.query(
      `INSERT INTO employee_salaries (employee_id, salary_structure_id, gross_salary, currency, effective_from, status, created_by)
       VALUES ($1, $2, $3, 'BDT', $4, 'active', $5)`,
      [emp.id, current.rows[0].salary_structure_id,
       `${Math.round(Number(current.rows[0].gross_salary) * (1 + raise) / 100) * 100}.00`, effFrom, adminId]
    );
    salaryAssignCount += 1;
  }
  // Transport overrides for a few employees.
  for (const [code, amount] of [['SDI-0101', '3000.00'], ['SDI-0110', '4000.00'], ['SDI-0126', '2500.00']]) {
    const emp = payEmpRows.find((r) => r.employee_code === code);
    if (!emp) continue;
    const salaryRow = await pool.query(
      `SELECT id FROM employee_salaries WHERE employee_id=$1 AND status='active' ORDER BY effective_from DESC LIMIT 1`,
      [emp.id]
    );
    if (!salaryRow.rows[0]) continue;
    await pool.query(
      `INSERT INTO employee_salary_overrides (employee_salary_id, component_id, amount)
       VALUES ($1, $2, $3) ON CONFLICT (employee_salary_id, component_id) DO NOTHING`,
      [salaryRow.rows[0].id, payComponentId['TRANSPORT'], amount]
    );
  }
  log(`seeded ${salaryAssignCount} employee salary assignments`);

  // A few loans with installments (loan deductions flow into payroll runs).
  const LOANS = [
    ['SDI-0101', 200000, 5000], ['SDI-0104', 150000, 4000], ['SDI-0110', 100000, 3000],
  ];
  let loanCount = 0;
  for (const [code, amount, monthly] of LOANS) {
    const emp = payEmpRows.find((r) => r.employee_code === code);
    if (!emp) continue;
    if (await exists(`SELECT id FROM loans WHERE employee_id=$1 AND status='active'`, [emp.id])) continue;
    const startM = '2026-04';
    const endM = '2027-03';
    const { rows: loanRows } = await pool.query(
      `INSERT INTO loans (employee_id, amount, interest_rate, monthly_deduction, loan_date, start_month, end_month, status, notes)
       VALUES ($1, $2, 6, $3, '2026-04-05', $4, $5, 'active', 'Home loan (demo)') RETURNING id`,
      [emp.id, amount, monthly, startM, endM]
    );
    if (!loanRows[0]) continue;
    const dueDay = 5;
    for (let mi = 4; mi <= 12; mi++) {
      await pool.query(
        `INSERT INTO loan_installments (loan_id, installment_no, due_date, amount, principal_component, interest_component)
         VALUES ($1, $2, $3, $4, $4, 0) ON CONFLICT DO NOTHING`,
        [loanRows[0].id, mi - 3, `2026-${pad(mi)}-${pad(dueDay)}`, monthly]
      );
    }
    for (let mi = 1; mi <= 3; mi++) {
      await pool.query(
        `INSERT INTO loan_installments (loan_id, installment_no, due_date, amount, principal_component, interest_component)
         VALUES ($1, $2, $3, $4, $4, 0) ON CONFLICT DO NOTHING`,
        [loanRows[0].id, mi + 9, `2027-${pad(mi)}-${pad(dueDay)}`, monthly]
      );
    }
    loanCount += 1;
  }
  log(`seeded ${loanCount} loans with installments`);

  // Payroll runs: last 4 complete months (paid history) + current month (in progress).
  const runMonths = [];
  for (let k = 4; k >= 1; k--) {
    const d = new Date(today.getFullYear(), today.getMonth() - k, 1);
    runMonths.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`);
  }
  runMonths.push(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`);
  let runCount = 0;
  for (let i = 0; i < runMonths.length; i++) {
    const period = runMonths[i];
    const isCurrent = i === runMonths.length - 1;
    if (await exists(
      `SELECT id FROM payroll_runs WHERE period_month=$1::date AND status <> 'cancelled'`,
      [period]
    )) continue;
    let run = await payroll.createRun(period, adminId);
    // Small variation: bonus/commission adjustments before finalizing.
    if (period === runMonths[runMonths.length - 2]) {
      for (const code of ['SDI-0101', 'SDI-0102', 'SDI-0129', 'SDI-0135']) {
        const emp = payEmpRows.find((r) => r.employee_code === code);
        if (!emp) continue;
        await payroll.addAdjustment({
          payroll_run_id: run.id, employee_id: emp.id, type: 'earning',
          amount: '5000.00', salary_component_id: payComponentId['INCNTV'],
          reason: 'Festival bonus', added_by: adminId,
        });
      }
    } else if (period === runMonths[runMonths.length - 3]) {
      const emp = payEmpRows.find((r) => r.employee_code === 'SDI-0104');
      if (emp) {
        await payroll.addAdjustment({
          payroll_run_id: run.id, employee_id: emp.id, type: 'earning',
          amount: '8000.00', salary_component_id: payComponentId['INCNTV'],
          reason: 'Performance arrear', added_by: adminId,
        });
      }
    } else if (period === runMonths[runMonths.length - 4]) {
      for (const code of ['SDI-0102', 'SDI-0111']) {
        const emp = payEmpRows.find((r) => r.employee_code === code);
        if (!emp) continue;
        await payroll.addAdjustment({
          payroll_run_id: run.id, employee_id: emp.id, type: 'earning',
          amount: '3000.00', salary_component_id: payComponentId['INCNTV'],
          reason: 'Sales commission', added_by: adminId,
        });
      }
    }
    run = await payroll.calculateRun(run.id, adminId);
    if (!isCurrent) {
      run = await payroll.approveRun(run.id, adminId);
      const nextMonth = new Date(period.split('-')[0], Number(period.split('-')[1]), 1);
      const paymentDate = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01`;
      const method = runMonths.length - i === 4 ? 'cash' : runMonths.length - i === 3 ? 'cheque' : 'bank_transfer';
      await payroll.payRun(run.id, { payment_date: paymentDate, payment_method: method, payment_reference: `PAY-${period.slice(0, 7)}` }, adminId);
    }
    runCount += 1;
  }
  log(`seeded ${runCount} payroll runs (4 months paid history + current month in progress)`);

  await pool.end();
  log('seed complete');
}

main().catch((err) => {
  console.error('seed failed:', err.stack || err.message);
  process.exit(1);
});
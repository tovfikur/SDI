import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppLayout } from './components/AppLayout';
import { ErrorElement } from './components/ErrorBoundary';
import { RequirePermission } from './components/RequirePermission';
import { RequireEmployee } from './components/RequireEmployee';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { ActivityLogPage } from './pages/settings/ActivityLogPage';
import { MetaAuditPage } from './pages/settings/MetaAuditPage';
import { AppearancePage } from './pages/settings/AppearancePage';
import { GeofencingPage } from './pages/settings/GeofencingPage';
import { MobileAttendanceScreen } from './pages/hr/MobileAttendanceScreen';
import { FieldTrackingPage } from './pages/hr/FieldTrackingPage';
import { FieldLiveTab } from './pages/hr/FieldLiveTab';
import { FieldRouteHistoryTab } from './pages/hr/FieldRouteHistoryTab';
import { HrDashboardPage } from './pages/hr/HrDashboardPage';
import { DepartmentsPage } from './pages/hr/DepartmentsPage';
import { SubDepartmentsPage } from './pages/hr/SubDepartmentsPage';
import { BranchesPage } from './pages/hr/BranchesPage';
import { SetupRulesPage } from './pages/hr/SetupRulesPage';
import { EmployeesPage } from './pages/hr/EmployeesPage';
import { EmployeeListTab } from './pages/hr/EmployeeListTab';
import { PositionsTab } from './pages/hr/PositionsTab';
import { EmployeeTypesTab } from './pages/hr/EmployeeTypesTab';
import { EmployeeOnboardingWizard } from './pages/hr/wizard/EmployeeOnboardingWizard';
import { TransfersTab } from './pages/hr/TransfersTab';
import { InactiveTab } from './pages/hr/InactiveTab';
import { AttendancePage } from './pages/hr/AttendancePage';
import { AttendanceFormTab } from './pages/hr/AttendanceFormTab';
import { MonthlyAttendanceTab } from './pages/hr/MonthlyAttendanceTab';
import { CustomAttendanceTab } from './pages/hr/CustomAttendanceTab';
import { IndividualAttendanceTab } from './pages/hr/IndividualAttendanceTab';
import { MissingAttendanceTab } from './pages/hr/MissingAttendanceTab';
import { PendingAttendanceTab } from './pages/hr/PendingAttendanceTab';
import { AttendanceReportPage } from './pages/hr/AttendanceReportPage';
import { HolidaysPage } from './pages/hr/HolidaysPage';
import { LeavePage } from './pages/hr/LeavePage';
import { LeaveApplicationsTab } from './pages/hr/LeaveApplicationsTab';
import { LeaveTypesTab } from './pages/hr/LeaveTypesTab';
import { LeaveBalancesTab } from './pages/hr/LeaveBalancesTab';
import { ShortLeavesTab } from './pages/hr/ShortLeavesTab';
import { TrainingPage } from './pages/hr/TrainingPage';
import { TrainingProgramsTab } from './pages/hr/TrainingProgramsTab';
import { InternalCertificatesTab } from './pages/hr/InternalCertificatesTab';
import { ExternalCertificatesTab } from './pages/hr/ExternalCertificatesTab';
import { NoticesPage } from './pages/hr/NoticesPage';
import { IdCardsPage } from './pages/hr/IdCardsPage';
import { PoliciesPage } from './pages/hr/PoliciesPage';
import { LoansPage } from './pages/hr/LoansPage';
import { ResignationsPage } from './pages/hr/ResignationsPage';
import { ProjectDashboardPage } from './pages/projects/ProjectDashboardPage';
import { EmployeeTaskOverviewPage } from './pages/projects/EmployeeTaskOverviewPage';
import { ClientsPage } from './pages/projects/ClientsPage';
import { ProjectListPage } from './pages/projects/ProjectListPage';
import { ManageTasksPage } from './pages/projects/ManageTasksPage';
import { DailyTasksPage } from './pages/projects/DailyTasksPage';
import { MeetingsPage } from './pages/projects/MeetingsPage';
import { ProjectReportsPage } from './pages/projects/ProjectReportsPage';
import { PayrollDashboardPage } from './pages/payroll/PayrollDashboardPage';
import { EmployeeSalariesPage } from './pages/payroll/EmployeeSalariesPage';
import { PayrollRunPage } from './pages/payroll/PayrollRunPage';
import { PayslipsPage } from './pages/payroll/PayslipsPage';
import { PaymentsPage } from './pages/payroll/PaymentsPage';
import { PayrollReportsPage } from './pages/payroll/PayrollReportsPage';
import { SalaryComponentsPage } from './pages/settings/SalaryComponentsPage';
import { SalaryStructuresPage } from './pages/settings/SalaryStructuresPage';
import { PayrollRulesPage } from './pages/settings/PayrollRulesPage';
import { EmployeeDashboardPage } from './pages/self/EmployeeDashboardPage';
import { MyTodoPage } from './pages/self/MyTodoPage';
import { MessagesPage } from './pages/messages/MessagesPage';
import { MyProjectsPage } from './pages/self/MyProjectsPage';
import { MyProjectDetailPage } from './pages/self/MyProjectDetailPage';
import { MyTasksPage } from './pages/self/MyTasksPage';
import { MyWorklogPage } from './pages/self/MyWorklogPage';
import { MyAttendancePage } from './pages/self/MyAttendancePage';
import { MyLeavePage } from './pages/self/MyLeavePage';
import { MyLoansPage } from './pages/self/MyLoansPage';
import { MyProfilePage } from './pages/self/MyProfilePage';
import { MyPayslipsPage } from './pages/self/MyPayslipsPage';
import { MyOrganizationPage } from './pages/self/MyOrganizationPage';
import { MyIdCardPage } from './pages/self/MyIdCardPage';

/** Route-level RBAC: renders the element only when the user has one of the permissions. */
function Require(permissions: string[], element: ReactElement): ReactElement {
  return <RequirePermission permissions={permissions}>{element}</RequirePermission>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <ErrorElement />,
    children: [
      { index: true, element: <HomePage /> },
      // ---- Employee Self-Service (ESS) section ----
      {
        path: 'me',
        children: [
          { index: true, element: <Navigate to="/" replace /> },
          { path: 'dashboard', element: <EmployeeDashboardPage /> },
          { path: 'projects', element: <RequireEmployee><MyProjectsPage /></RequireEmployee> },
          { path: 'projects/:id', element: <RequireEmployee><MyProjectDetailPage /></RequireEmployee> },
          { path: 'tasks', element: <RequireEmployee><MyTasksPage /></RequireEmployee> },
          { path: 'todo', element: <RequireEmployee><MyTodoPage /></RequireEmployee> },
          { path: 'worklog', element: <RequireEmployee><MyWorklogPage /></RequireEmployee> },
          { path: 'attendance', element: <RequireEmployee><MyAttendancePage /></RequireEmployee> },
          { path: 'leave', element: <RequireEmployee><MyLeavePage /></RequireEmployee> },
          { path: 'loans', element: <RequireEmployee><MyLoansPage /></RequireEmployee> },
          { path: 'profile', element: <RequireEmployee><MyProfilePage /></RequireEmployee> },
          { path: 'payslips', element: <RequireEmployee><MyPayslipsPage /></RequireEmployee> },
          {
            path: 'organization',
            element: <RequireEmployee><MyOrganizationPage /></RequireEmployee>,
          },
          { path: 'id-card', element: <RequireEmployee><MyIdCardPage /></RequireEmployee> },
          { path: 'performance', element: <Navigate to="/me/projects" replace /> },
        ],
      },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'messages/:conversationId', element: <MessagesPage /> },
      // ---- Human Resource section ----
      {
        path: 'hr',
        children: [
          { index: true, element: <Navigate to="/hr/dashboard" replace /> },
          { path: 'dashboard', element: Require(['hr.masters.view'], <HrDashboardPage />) },
          { path: 'departments', element: Require(['hr.masters.view'], <DepartmentsPage />) },
          { path: 'branches', element: Require(['hr.masters.view'], <BranchesPage />) },
          {
            path: 'sub-departments',
            element: Require(['hr.masters.view'], <SubDepartmentsPage />),
          },
          { path: 'setup-rules', element: Require(['hr.masters.view'], <SetupRulesPage />) },
          {
            path: 'employees',
            element: Require(['hr.employee.view'], <EmployeesPage />),
            children: [
              { index: true, element: <EmployeeListTab /> },
              { path: 'positions', element: <PositionsTab /> },
              { path: 'types', element: <EmployeeTypesTab /> },
              { path: 'transfer-out', element: <TransfersTab transferType="out" /> },
              { path: 'transfer-in', element: <TransfersTab transferType="in" /> },
              { path: 'inactive', element: <InactiveTab /> },
            ],
          },
          {
            path: 'employees/create',
            element: Require(['hr.employee.create'], <EmployeeOnboardingWizard />),
          },
          {
            path: 'performance',
            element: <Navigate to="/hr/dashboard" replace />,
          },
          {
            path: 'attendance/mobile',
            element: (
              <RequireEmployee>
                <MobileAttendanceScreen />
              </RequireEmployee>
            ),
          },
          {
            path: 'attendance',
            element: Require(['hr.attendance.view'], <AttendancePage />),
            children: [
              { index: true, element: <Navigate to="/hr/attendance/form" replace /> },
              { path: 'form', element: <AttendanceFormTab /> },
              { path: 'monthly', element: <MonthlyAttendanceTab /> },
              { path: 'custom', element: <CustomAttendanceTab /> },
              { path: 'custom-record', element: <CustomAttendanceTab /> },
              { path: 'individual', element: <IndividualAttendanceTab /> },
              { path: 'individual-record', element: <IndividualAttendanceTab /> },
              { path: 'missing', element: <MissingAttendanceTab /> },
              { path: 'pending', element: <PendingAttendanceTab /> },
            ],
          },
          {
            path: 'attendance-report',
            element: Require(['report.view'], <AttendanceReportPage />),
          },
          { path: 'holidays', element: Require(['hr.masters.view'], <HolidaysPage />) },
          {
            path: 'field-tracking',
            element: Require(['hr.attendance.field.view_all'], <FieldTrackingPage />),
            children: [
              { index: true, element: <FieldLiveTab /> },
              { path: 'route-history', element: <FieldRouteHistoryTab /> },
            ],
          },
          {
            path: 'leave',
            element: Require(['hr.leave.view', 'self.leave.apply'], <LeavePage />),
            children: [
              { index: true, element: <Navigate to="/hr/leave/applications" replace /> },
              { path: 'applications', element: <LeaveApplicationsTab /> },
              { path: 'types', element: <LeaveTypesTab /> },
              { path: 'balances', element: <LeaveBalancesTab /> },
              { path: 'short-leaves', element: <ShortLeavesTab /> },
            ],
          },
          {
            path: 'training',
            element: Require(['hr.training.view', 'self.training.view'], <TrainingPage />),
            children: [
              { index: true, element: <Navigate to="/hr/training/programs" replace /> },
              { path: 'programs', element: <TrainingProgramsTab /> },
              { path: 'internal', element: <InternalCertificatesTab /> },
              { path: 'external', element: <ExternalCertificatesTab /> },
            ],
          },
          { path: 'notices', element: Require(['hr.notices.read'], <NoticesPage />) },
          { path: 'id-cards', element: Require(['hr.employee.view'], <IdCardsPage />) },
          { path: 'policies', element: Require(['hr.policies.read'], <PoliciesPage />) },
          { path: 'loans', element: Require(['hr.employee.view'], <LoansPage />) },
          { path: 'resignations', element: Require(['hr.employee.view'], <ResignationsPage />) },
        ],
      },
      // ---- Project Management section ----
      {
        path: 'projects',
        children: [
          { index: true, element: <Navigate to="/projects/dashboard" replace /> },
          { path: 'dashboard', element: Require(['pm.project.view'], <ProjectDashboardPage />) },
          {
            path: 'employee-tasks',
            element: Require(['pm.task.view'], <EmployeeTaskOverviewPage />),
          },
          { path: 'clients', element: Require(['pm.client.view'], <ClientsPage />) },
          { path: 'list', element: Require(['pm.project.view'], <ProjectListPage />) },
          { path: 'tasks', element: Require(['pm.task.view'], <ManageTasksPage />) },
          { path: 'daily-tasks', element: Require(['pm.daily_task.view'], <DailyTasksPage />) },
          { path: 'meetings', element: Require(['pm.meeting.view'], <MeetingsPage />) },
          { path: 'reports', element: Require(['report.view'], <ProjectReportsPage />) },
        ],
      },
      // ---- Payroll section ----
      {
        path: 'payroll',
        children: [
          { index: true, element: <Navigate to="/payroll/dashboard" replace /> },
          { path: 'dashboard', element: Require(['payroll.view'], <PayrollDashboardPage />) },
          {
            path: 'employee-salaries',
            element: Require(['employee_salary.view'], <EmployeeSalariesPage />),
          },
          { path: 'runs', element: Require(['payroll.view'], <PayrollRunPage />) },
          {
            path: 'payslips',
            element: Require(['payslip.self', 'payslip.view_all'], <PayslipsPage />),
          },
          { path: 'payments', element: Require(['payroll.view'], <PaymentsPage />) },
          { path: 'reports', element: Require(['payroll.report'], <PayrollReportsPage />) },
        ],
      },
      // ---- Settings (secondary navigation: Software Setup | Activity Log) ----
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/software-setup" replace /> },
          { path: 'software-setup', element: Require(['settings.manage'], <SettingsPage />) },
          { path: 'activity-log', element: Require(['audit.view'], <ActivityLogPage />) },
          { path: 'meta-audit', element: Require(['settings.manage'], <MetaAuditPage />) },
          { path: 'payroll-rules', element: Require(['payroll.view'], <PayrollRulesPage />) },
          {
            path: 'salary-components',
            element: Require(['salary_component.view'], <SalaryComponentsPage />),
          },
          {
            path: 'salary-structures',
            element: Require(['salary_structure.view'], <SalaryStructuresPage />),
          },
          { path: 'appearance', element: <AppearancePage /> },
          { path: 'geofencing', element: Require(['geofence.view'], <GeofencingPage />) },
        ],
      },
      // ---- Legacy top-level aliases (kept for old URLs) ----
      { path: 'attendance', element: <Navigate to="/hr/attendance" replace /> },
      { path: 'attendance/custom', element: <Navigate to="/hr/attendance/custom" replace /> },
      { path: 'attendance/custom-record', element: <Navigate to="/hr/attendance/custom" replace /> },
      { path: 'attendance/individual', element: <Navigate to="/hr/attendance/individual" replace /> },
      { path: 'attendance/individual-record', element: <Navigate to="/hr/attendance/individual" replace /> },
      { path: 'attendance/records', element: <Navigate to="/hr/attendance/monthly" replace /> },
      { path: 'custom-record', element: <Navigate to="/hr/attendance/custom" replace /> },
      { path: 'individual-record', element: <Navigate to="/hr/attendance/individual" replace /> },
      { path: 'leave', element: <Navigate to="/hr/leave" replace /> },
      { path: 'training', element: <Navigate to="/hr/training" replace /> },
      { path: 'meetings', element: <Navigate to="/projects/meetings" replace /> },
      { path: 'hr-master', element: <Navigate to="/hr/dashboard" replace /> },
      { path: 'audit', element: <Navigate to="/settings/activity-log" replace /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

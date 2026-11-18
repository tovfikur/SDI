# JSK Enterprise HRM & Project Management — Feature Specification

This document provides a comprehensive, enterprise-grade feature specification compiled directly from all reference project screenshots (`sceenshots/*.png`) and monorepo architecture contracts.

---

## Executive Overview & Architectural Baseline

| Metric / Dimension | Enterprise Specification Standard |
| :--- | :--- |
| **System Architecture** | Modular Monorepo (NestJS API Backend + Vite React SPA + Worker Service + Shared Kernel) |
| **Database Engine** | PostgreSQL with ACID Transaction Controls & Soft-Delete Retention |
| **UI Design Language** | Responsive Compact Square Cards (No Sideways Scroll) + Claymorphic 3D Depth + Native Mobile FAB Dial |
| **Geo-Location Services** | Geo-fenced Check-in Radius (meters) + Interactive Map Modals for Attendance & Sites |
| **Performance Standard** | Sub-100ms API response latency, sub-2s production bundle build, sub-minute batch recalculations |

---

## Complete Feature Matrix by Domain Module

### Module 1: HR Master & Employee Lifecycle Management

#### 1.1 9-Step Employee Onboarding Wizard
Transactional save across 9 sub-entities in a single ACID transaction:
1. **Personal Information:** Name, Father's Name, Mother's Name, Mobile, Alternate Mobile, Email, Date of Birth, Gender, Marital Status, Blood Group, Facebook ID, Tax Identification Number (TIN), National ID/Passport Number, NID Attachment, Nationality, Profile Photo Upload.
2. **Employee Details:** Code (`JSK-xxxx`), Department, Sub-Department, Position, Employee Type, Joining Date, Working Pattern rule assignment.
3. **Bank Details:** Bank Name, Branch, Account Number, Routing Number, Mobile Banking details.
4. **Address Information:** Present Address, Permanent Address, City, Division/State, Postal Code.
5. **Emergency Contacts:** Primary Contact Name, Relationship, Contact Number, Secondary Contact.
6. **Academic Qualifications:** Degree, Institution, Passing Year, Grade/CGPA, Certificate Attachment.
7. **Extra-Curricular Activities:** Skills, Certifications, Language Proficiencies, Hobbies.
8. **Job Experience History:** Company Name, Designation, Duration (Start/End Date), Key Responsibilities, Separation Reason.
9. **Family Member Information:** Dependent Name, Relation, Occupation, Contact Number.

#### 1.2 Master Setup Rules & Working Hours
- **Departments & Sub-Departments:** Hierarchical structure with active/inactive toggles.
- **Employee Setup Rules:** Title, Employee Type (Full-Time, Part-Time, Staff, In-Charge), Work Pattern (Fixed, Shift), Daily Working Hours, Office Start Time, Office End Time, Grace Period (e.g. 30 minutes), Active Status.

#### 1.3 Employee Performance Appraisal System (Sections A-F)
- **Section A (Assessment of Goals & Objectives):**
  - Criteria: Knowledge of Duties & Quality of Work, Timeliness of Delivery, Impact of Achievement, Overall Achievement of Goals, Going Beyond Call of Duty.
  - 5-Point Rating Scale: Poor (0), Need Improvement (3), Good (6), Very Good (9), Excellent (12) — Maximum 60 points.
- **Section B (Assessment of Other Performance Standards):**
  - Criteria: Interpersonal Skills & Teamwork, Attendance & Punctuality, Communication Skills, Contribution to Mission.
  - 5-Point Rating Scale: Poor (2), Need Improvement (4), Good (6), Very Good (9), Excellent (10) — Maximum 40 points.
- **Section C (Total Score & Classification):**
  - Combined Score (Score A + Score B).
  - Performance Classification: Exceeds Expectations (EE 80-100), Meets Expectations (AE 75-85), Unsatisfactory (UE 0-70).
  - Reviewer Recommendations & Signature fields.
- **Section D (Employee Comments):** Max 500-word employee feedback statement.
- **Section E (Development Plan):** Improvement areas, expected outcomes, responsible mentor, start date, end date.
- **Section F (Next Period Goals):** Agreed future goals and target completion periods.

#### 1.4 ID Card Badge Generation
- Employee selection directory with printable enterprise ID Card badge generation.

#### 1.5 Employee Lifecycle & Under-Evidenced Sub-Modules
- **Employee Transfers:** Transfer Out / Transfer In location logs.
- **Resignation & Notice Board:** Resignation processing, notice announcements.
- **Loan Management:** Loan disbursement, repayment schedules, and loan payment received gauge widgets.
- **HR Policies Catalog:** Policy documentation repository.

---

### Module 2: Attendance & Geo-Fencing System

#### 2.1 Raw Event Logging & Geo-Location Tracking
- Capture raw check-in/out timestamps with latitude, longitude, and device metadata.
- **Pending Geo Attendance Queue:** Review field work, client visits, and remote check-ins.
  - Fields: Employee, Date, Time, Type (IN/OUT), Reason Type (`field_work`, `client_visit`, `other`), Reason text.
  - **`📍 View Map` Modal:** Interactive map modal displaying exact check-in pin against allowed geo-fence radius.
  - Inline `✔ Approve` / `✖ Reject` and `Approve Selected` bulk actions.

#### 2.2 Attendance Recalculation Engine
- Pure-function day status derivation (`NoData`, `Present`, `Late`, `Absent`, `HolidayPresent`, `Missing`).
- Calculates Total Work Minutes and Late Minutes against employee setup rules and grace periods.

#### 2.3 Comprehensive Attendance Reports
1. **Late Attendance Report:** Filtered list of late arrivals with late minutes.
2. **Attendance Log:** Raw punch events list.
3. **Daily Present Report:** Real-time present workforce by date and department.
4. **Monthly Attendance Summary:** Aggregated present, late, and absent days.
5. **Monthly Attendance Sheet:** Complete monthly grid view.
6. **Employee Daily Worksheet:** Detailed daily work hours breakdown.

---

### Module 3: Leave Management System

#### 3.1 2-Step Approval Workflow & Entitlement Generator
- **Leave Application Queue:** Applicant details, leave type, start/end dates, total requested days, reason, and 2-step approval (Manager -> HR).
- **Idempotent Annual Leave Balance Generator:** Automatic annual leave balance matrix generation for active employees (`AL`: 20 days, `SL`: 10 days, `CL`: 10 days).
- **Employee Total Leave Matrix:** Live tracking of Total, Taken, and Due leave balances.
- **Employee Short Leaves:** Dedicated tracking for partial-day / short-duration leave requests.

---

### Module 4: Training Management

- Training program creation, venue allocation, trainer assignment, employee enrolments, completion tracking, and certificate uploads.

---

### Module 5: Project Management & Geo-Site Tracking

#### 5.1 Client Directory & Inline Client Creation (WF-009)
- Client directory with company name, email, phone, and address.
- **Inline Client Creation Modal:** Add a new client directly inside the Project Creation dialog without context switching.

#### 5.2 Project Creation & Automatic Date Calculation (BR-014)
- Fields: Project Name *, Client, Team Members (multi-select loaded from HRM module), Approximate Tasks, Scope Summary, Start Date *, Duration (in Days), Ending Date (auto-computed from Start Date + Duration), Status, Reward Points.
- **Geo-fenced Project Location:** Latitude, Longitude, Check-in allowed radius (meters), and `📍 Preview map` modal.

#### 5.3 Task Execution & Meeting Logs
- **Employee Task Overview:** Filter by Project, Employee, and Sprint. Counter tiles for To Do, In Progress, Done, Total.
- **Daily Tasks & Sprint Management:** Task assignment, priority, and progress tracking.
- **Meeting Logs:** Meeting schedule, agenda, minutes of meeting, and attachment uploads.

---

### Module 6: Enterprise Settings & Security Audit Log

#### 6.1 Application Master Settings
- Company Title, Support Email, Phone, Timezone (`Asia/Dhaka`), Address, Footer Text, Currency (`BDT`), Country, **Default Attendance Check-in Range (meters)**.
- Branding Image Assets: Header Logo (135x45), Sidebar Logo (150x45), Collapsed Logo (90x90), Login Background Image, Favicon.

#### 6.2 Security Audit & Soft-Delete Retention (C-01 / ADR-004)
- Immutable activity log recording for all state mutations.
- **Super Admin Soft-Delete Action:** Soft-delete retention preserving historical audit entries in `meta_audit_logs`.

# SDI Stabilization & Fix Plan

## 1. Current Priority

State clearly:

Priority is:

1. Make frontend compile
2. Make backend compile
3. Make all critical routes open
4. Fix current blocking backend/API errors
5. Only after stabilization continue feature/mobile work

Do NOT continue mobile/responsive feature development until stabilization is complete.

---

## 2. Current Known Critical Issues

Document every currently known issue:

### Frontend Compile / Runtime

* DashboardPage.tsx had malformed JSX / nested ternary issues.
* LoansPage.tsx had duplicate `statusTarget`.
* LoansPage.tsx currently uses `useEffect` without importing it.
* LoansPage.tsx has unused `navigate/useNavigate`.
* LoansPage.tsx may contain incomplete refactor leftovers.
* Frontend build must be run repeatedly until exit code 0.
* Raw Vite/Babel black error overlays must not remain.

### Employee

* New Employee creation returns `Internal server error`.
* Need to capture actual backend exception.
* Need to audit DTO/payload/foreign-key IDs.
* Need to verify date serialization.
* Need to verify unique Employee ID/email/mobile handling.
* Need to verify Department/Sub Department/Position/Employee Type/Setup Rule values are IDs rather than labels.

### Employee Performance

* `/hr/performance` shows `NetworkError when attempting to fetch resource`.
* Need to trace exact endpoint and API response.
* Need loading/empty/error states.
* Need actual performance CRUD working.

### Loans

* `/hr/loans` previously crashed on:
  `can't access property "employee_id", r is null`
* Loan page has had compile/refactor problems.
* Loan create/list/status must work.
* Employee relation null handling must be fixed properly.
* Loan form should later support automatic interest/installment/end-date/deduction-date calculation, but stabilization comes first.

### Resignations

* `/hr/resignations` crashes on:
  `can't access property "employee_id", r is null`
* Need API response contract fix.
* Need null employee relation handling.
* Need list/create/edit workflow smoke test.

### Leave

* Leave approval requires approval twice before becoming approved.
* Must make one modal Approve action enough.
* Verify first approval request.
* Verify backend approval is atomic.
* Verify leave balance updates exactly once.
* Reject should also work once.
* Leave Type creation returns `Internal server error`.
* Need to trace leave type payload/enum/date/numeric/unique constraints.

### Attendance

* Attendance Report > Monthly Detail returns `Internal server error`.
* `/hr/attendance/monthly` returns `Internal server error`.
* Need to trace selected month/date serialization.
* Need to handle missing employee/setup-rule/attendance relations safely.
* Recalculate All must be idempotent.
* No duplicate monthly summaries.
* Empty month should return valid empty state, not 500.

### Holidays

* Holiday dates display `Invalid Date`.
* Need to inspect raw API values.
* Standardize date-only contract to `YYYY-MM-DD`.
* Fix create/edit display and serialization.
* No timezone day shifting.

### Training

* New Training Program returns `Internal server error` when Schedule date/time is supplied.
* Need to normalize datetime before API submission.
* Verify enum values such as Planned/planned.
* Verify numeric fields.
* Create/Edit/Refresh must persist schedule correctly.

### Daily Tasks

* Daily Tasks was incomplete compared with reference.
* Need filters, description, approval status, bulk approval, exports and correct data source.
* This is NOT emergency priority unless it blocks build/runtime.

### Employee Task Overview

* Current view may show zero tasks even if tasks exist elsewhere.
* Need canonical task data source and filter consistency.
* Not emergency priority unless route crashes.

### Meetings

* Meeting List needs Purpose, Meeting Held, Place, Attachment, CRUD parity.
* Not emergency priority unless route crashes.

### Notices

* Current form too simplified compared with reference.
* Needs memo/type/subject/details/dates/attachment.
* Not emergency priority until stabilization is done.

### HR Policies

* Needs rich editor/sanitization/reference parity.
* Not emergency priority until stabilization is done.

### ID Card

* Current workflow should be Employee List -> selected employee -> preview/print.
* Must use SDI branding.
* Not emergency priority until stabilization is done.

### Project Reports

* Filter/report calculations are incomplete.
* Avg Task Progress formatting is incorrect.
* Project Progress may be incorrect.
* Not emergency priority unless route crashes.

### Mobile

* Mobile responsive work is incomplete.
* Bottom navigation needs improvement.
* All authorized desktop modules must be reachable on mobile.
* Mobile work is PAUSED until stabilization is complete.

### Employee Login + GPS Attendance

Major future requirement:

* each employee login
* self check-in/check-out
* location capture with latitude/longitude
* approximately 10-minute tracking between check-in and check-out
* admin map/history
* background/native mobile tracking architecture

This is a MAJOR FEATURE but MUST NOT be worked on during emergency stabilization.

---

## 3. Emergency Stabilization Checklist

Use checkboxes.

### Frontend Build

* [ ] Run frontend production build
* [ ] Fix first compiler error
* [ ] Re-run build
* [ ] Repeat until frontend build exit code = 0
* [ ] Remove duplicate declarations
* [ ] Fix malformed JSX
* [ ] Fix missing imports
* [ ] Remove unused imports/hooks where build fails
* [ ] Remove undefined functions
* [ ] Remove unrelated/dead copied code
* [ ] Verify no Vite/Babel black overlay

### Backend Build

* [ ] Run backend build/typecheck
* [ ] Fix blocking compile errors
* [ ] Confirm API starts successfully

### Core Route Smoke Test

* [ ] `/`
* [ ] `/hr/employees`
* [ ] `/hr/performance`
* [ ] `/hr/attendance`
* [ ] `/hr/attendance-report`
* [ ] `/hr/leave/applications`
* [ ] `/hr/leave/types`
* [ ] `/hr/training/programs`
* [ ] `/hr/holidays`
* [ ] `/hr/loans`
* [ ] `/hr/resignations`
* [ ] `/projects`
* [ ] `/projects/daily-tasks`
* [ ] `/projects/meetings`
* [ ] `/projects/employee-tasks`
* [ ] `/projects/reports`

For each route mark:

* loads
* refresh works
* no raw stack trace
* no compile overlay

---

## 4. Blocking Backend/API Fix Checklist

### Employee Create

* [ ] Reproduce 500
* [ ] Capture backend stack trace
* [ ] Inspect create payload
* [ ] Verify FK IDs
* [ ] Verify date formats
* [ ] Verify unique fields
* [ ] Fix controlled validation response
* [ ] Create employee successfully
* [ ] Refresh and confirm persistence

### Loans

* [ ] Fix page compile
* [ ] Fix list load
* [ ] Fix `employee_id` null root cause
* [ ] Proper empty state
* [ ] Create loan smoke test
* [ ] Status update smoke test

### Resignation

* [ ] Fix `employee_id` null root cause
* [ ] Proper empty state
* [ ] List loads
* [ ] Create resignation smoke test

### Leave Approval

* [ ] Reproduce double-approval
* [ ] Verify first request
* [ ] One atomic approve mutation
* [ ] Prevent duplicate submit
* [ ] Verify leave balance changes once
* [ ] Verify refresh persists approved state
* [ ] Verify reject works once

### Leave Type

* [ ] Reproduce create 500
* [ ] Fix enum/value mapping
* [ ] Fix numeric coercion
* [ ] Fix duplicate validation
* [ ] Create/edit successfully

### Attendance Monthly

* [ ] Reproduce Monthly Detail 500
* [ ] Reproduce Monthly Attendance 500
* [ ] Fix month/date parsing
* [ ] Fix null relation handling
* [ ] Valid empty state
* [ ] Recalculate All safe/idempotent
* [ ] No duplicate monthly rows

### Holidays

* [ ] Inspect raw dates
* [ ] Fix parser
* [ ] Fix serializer
* [ ] Remove all `Invalid Date`
* [ ] Create/edit/refresh test

### Training

* [ ] Reproduce schedule create 500
* [ ] Fix datetime serialization
* [ ] Fix enum mapping
* [ ] Fix numeric fields
* [ ] Create/edit/refresh test

### Employee Performance

* [ ] Trace NetworkError
* [ ] Verify frontend endpoint
* [ ] Verify backend route
* [ ] Verify auth/CORS/API origin
* [ ] Load data or valid empty state

---

## 5. Rules During Stabilization

Write these rules clearly:

* Do NOT work on new features.
* Do NOT continue mobile redesign.
* Do NOT continue GPS tracking.
* Do NOT perform architecture refactors.
* Do NOT use broad Python/regex rewriting on TSX/JSX.
* Do NOT modify multiple unrelated modules at once.
* Do NOT claim completion without build/test evidence.
* Do NOT hide backend errors without fixing root cause.
* Make smallest possible fix.
* After every frontend fix, run build again.
* After every backend fix, directly test endpoint.
* Preserve existing database data.
* Do not reset or wipe PostgreSQL.
* Keep SDI branding.
* Keep LAN access configuration.
* Keep PostgreSQL private.
* Leave frontend and backend running after testing.

---

## 6. Post-Stabilization Work

Only start this section AFTER:

Frontend build = PASS
Backend build = PASS
Critical routes = PASS

Then continue:

### Reference Parity

* [ ] Dashboard
* [ ] HR Dashboard
* [ ] Departments
* [ ] Sub Departments
* [ ] Setup Rules
* [ ] Employees
* [ ] Employee Performance
* [ ] Attendance
* [ ] Attendance Reports
* [ ] Holiday
* [ ] Leave
* [ ] Training
* [ ] Notices
* [ ] ID Card
* [ ] HR Policies
* [ ] Loan
* [ ] Resignation
* [ ] Project Dashboard
* [ ] Employee Task Overview
* [ ] Client List
* [ ] Project List
* [ ] Manage Task
* [ ] Daily Tasks
* [ ] Meeting List
* [ ] Project Reports
* [ ] Settings
* [ ] Activity Log

### Mobile

* [ ] Full-width mobile shell
* [ ] Bottom navigation
* [ ] More menu
* [ ] All desktop routes accessible
* [ ] Mobile cards
* [ ] Mobile filters
* [ ] Mobile forms
* [ ] Mobile action sheets
* [ ] Mobile map
* [ ] 320/360/390/412/430/768 QA

### Employee Self Attendance + GPS

* [ ] Employee login/account relation
* [ ] Check In
* [ ] Check Out
* [ ] Latitude/longitude
* [ ] 10-minute samples
* [ ] Admin map
* [ ] Route history
* [ ] Offline queue
* [ ] Geofence
* [ ] Native/background Android/iOS strategy

### Loan Automation

* [ ] Auto interest
* [ ] Total payable
* [ ] Monthly installment
* [ ] Deduction day
* [ ] First deduction
* [ ] Final deduction
* [ ] End month
* [ ] Installment schedule

---

## 7. Work Log

Create a table:

| Date/Time | Issue | Root Cause | Fix | Verification | Status |
| --------- | ----- | ---------- | --- | ------------ | ------ |

Every significant fix must be added here.

Do not write vague entries like "fixed bug."

Example:

| 2026-08-16 | LoansPage build | missing useEffect import | imported useEffect, removed unused navigate | frontend build passed | Done |

---

## 8. Current Build Status

Maintain:

Frontend build: PASS / FAIL
Backend build: PASS / FAIL
Frontend URL:
Backend URL:
LAN URL:
Last tested:

---

## 9. Remaining Blockers

Keep a short ordered list of current blockers.

The FIRST item must always be the next thing you work on.

Do not work on lower-priority items while blocker #1 remains.

---

After creating `STABILIZATION_AND_FIX_PLAN.md`:

1. Open/read it.
2. Update it with the actual current compiler error you are currently fixing.
3. Put all existing mobile TODO work on hold.
4. Start Emergency Stabilization from the first unchecked item.
5. Keep updating the MD file as you work.
6. Do not stop at creating the document.
7. Continue working from that file until frontend build passes.

Do not create another plan after this. Use this file as the master plan.
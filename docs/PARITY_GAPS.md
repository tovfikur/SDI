# Parity Gaps & Provenance Register

This document records all features, fields, and workflows that are **under-evidenced**, **Recommendation-level**, or **Assumption-based** relative to the original 15-minute screen recording, as required by Section 21 & 33 of the Architecture Specification.

## Provenance Labels
- `Observed`: Directly visible in the screen recording evidence.
- `Recommendation`: Industry-standard pattern added to complete the domain workflow cleanly.
- `Assumption`: Reasonable inference made where exact details were unevidenced.

---

## Registered Gaps & Implementation Status

| Feature / Screen | Spec Reference | Provenance | Implementation Details & Defaults |
|---|---|---|---|
| Loan Management | Spec §21 / FR-095 | Recommendation | Feature-flagged; basic CRUD schema (`loans`) |
| Resignation Workflow | Spec §21 / FR-096 | Recommendation | Feature-flagged; status workflow (`resignations`) |
| HR Policies & Notices | Spec §21 / FR-097 | Recommendation | Feature-flagged; document attachment metadata |
| ID Card Management | Spec §21 / FR-098 | Recommendation | Feature-flagged; employee ID card issue tracking |
| Bulk Import (Generic) | Spec §21 / FR-099 | Recommendation | Background job with per-row CSV validation results |
| Short Leave | Spec §21 / FR-075 | Recommendation | Hourly / half-day tracking separate from full-day leaves |
| Software Setup Screen | Spec §21 / FR-134 | Recommendation | System configuration key-value store |
| TOTP MFA | Spec §7 / AUTH-008 | Recommendation | Feature-flagged optional 2FA support |
| Audit Log Soft-Delete | Spec C-01 / ADR-004 | Recommendation | Application soft-hide (`is_hidden`) + secondary meta audit log |
| Payroll | Spec §19 (out of scope) | Assumption | Full payroll engine (structures, runs, payslips, loans integration, leave/attendance deductions) implemented as an Assumption-level feature. Payroll is explicitly out of scope per Spec §19 but was built to complete the HRM domain. Key assumptions: (1) gross_pay = sum of structure earning components (not equal to gross_salary); (2) basic_salary basis uses computed BASIC amount; (3) working_day_calculation defaults to calendar_days but supports scheduled_working_days; (4) loan/leave/attendance deductions wired but not evidenced. Payroll data: gross_salary (contract) vs gross_pay (computed) shown on payslips. |

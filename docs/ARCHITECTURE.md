# System Architecture Overview

Source of Truth: [`JSK_HRM_PM_Architecture_Specification.md`](../JSK_HRM_PM_Architecture_Specification.md)

## Architecture Style: Modular Monolith
- **Frontend SPA:** Vite + React + TypeScript + React Router (`apps/web`)
- **Backend API:** NestJS modular monolith (`apps/api`)
- **Background Worker:** NestJS application context with BullMQ queue host (`apps/worker`)
- **Shared Kernel:** Domain package contracts and cross-cutting DTOs (`packages/*`)
- **Database:** PostgreSQL with relational integrity, triggers, and migrations (`db/`)

## Module Boundaries
1. **HR Masters & Employee Management:** Departments, Setup Rules, Holidays, 9-Step Employee Wizard (`packages/domain-hr`)
2. **Attendance Management:** Raw events (append-only), derived day recalculation engine, device mappings (`packages/domain-attendance`)
3. **Leave Management:** Applications, 2-step approval workflow, annual entitlement balance matrix (`packages/domain-leave`)
4. **Training Management:** Master trainings, assignments, internal/external certificates (`packages/domain-training`)
5. **Project Management:** Projects, Clients (with inline creation modal), Tasks, Daily Tasks, Meetings with attachments (`packages/domain-projects`)
6. **Audit & Settings:** Activity Log, soft-delete retention, RBAC role management (`packages/domain-audit`)

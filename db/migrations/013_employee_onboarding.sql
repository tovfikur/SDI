-- Migration 013: Employee Onboarding Wizard — add missing persistent fields
-- Adds: photo, NID/passport, supervisor, probation, workplace, phone fields,
-- salary basics, working days, joining letter, bank routing, address details,
-- contact addresses, academic extras, experience salary/separation, family email.

BEGIN;

-- employees: new columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url         text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nid_passport      text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_id     uuid REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_months  integer;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS workplace         text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_phone        text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS whatsapp          text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS device_id         text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary      numeric(14,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS working_days      integer DEFAULT 26;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_letter_url text;

-- employee_banks: routing number + salary method
ALTER TABLE employee_banks ADD COLUMN IF NOT EXISTS salary_receiving_method text;
ALTER TABLE employee_banks ADD COLUMN IF NOT EXISTS routing_number          text;

-- employee_addresses: richer address fields
ALTER TABLE employee_addresses ADD COLUMN IF NOT EXISTS district  text;
ALTER TABLE employee_addresses ADD COLUMN IF NOT EXISTS thana     text;

-- employee_emergency_contacts: address column
ALTER TABLE employee_emergency_contacts ADD COLUMN IF NOT EXISTS address text;

-- employee_academic: board, result, attachment
ALTER TABLE employee_academic ADD COLUMN IF NOT EXISTS board      text;
ALTER TABLE employee_academic ADD COLUMN IF NOT EXISTS result     text;
ALTER TABLE employee_academic ADD COLUMN IF NOT EXISTS attachment_url text;

-- employee_extra_curriculars: attachment
ALTER TABLE employee_extra_curriculars ADD COLUMN IF NOT EXISTS attachment_url text;

-- employee_experiences: salary, separation_reason, attachment
ALTER TABLE employee_experiences ADD COLUMN IF NOT EXISTS salary            text;
ALTER TABLE employee_experiences ADD COLUMN IF NOT EXISTS separation_reason text;
ALTER TABLE employee_experiences ADD COLUMN IF NOT EXISTS attachment_url    text;

-- employee_family_members: email, attachment
ALTER TABLE employee_family_members ADD COLUMN IF NOT EXISTS email          text;
ALTER TABLE employee_family_members ADD COLUMN IF NOT EXISTS attachment_url text;

COMMIT;

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { hr } from '../../../api';
import type { Branch } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Icon, Icons } from '../../../components/Icon';
import { AppointmentLetterUpload, LetterFileView } from '../../../components/AppointmentLetterUpload';
import { EmployeePhotoUpload } from '../../../components/EmployeePhotoUpload';
import {
  type WizardData, defaultData, loadDraft, saveDraft, clearDraft,
  buildPayload, validatePersonal, validateEmployment, addressesEqual, hasAddressValue,
  type Department, type SubDepartment, type Position, type EmployeeType, type SetupRule,
  type BankInfo, type AddressInfo, type EmergencyContact, type AcademicInfo,
  type ExtraCurricularInfo, type ExperienceInfo, type FamilyMemberInfo,
  EMPTY_BANK, EMPTY_EMERGENCY, EMPTY_ACADEMIC, EMPTY_ACTIVITY, EMPTY_EXPERIENCE, EMPTY_FAMILY,
} from './wizard-helpers';

// ---------------------------------------------------------------------------
// Steps config
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'personal', label: 'Personal', icon: Icons.Users },
  { key: 'employment', label: 'Employment', icon: Icons.Briefcase },
  { key: 'bank', label: 'Bank & Salary', icon: Icons.CreditCard },
  { key: 'address', label: 'Address', icon: Icons.LocationDot },
  { key: 'emergency', label: 'Emergency', icon: Icons.UserTie },
  { key: 'education', label: 'Education', icon: Icons.GraduationCap },
  { key: 'activities', label: 'Activities', icon: Icons.Star },
  { key: 'experience', label: 'Experience', icon: Icons.Hourglass },
  { key: 'family', label: 'Family', icon: Icons.Users },
  { key: 'review', label: 'Review', icon: Icons.Success },
] as const;

type StepKey = typeof STEPS[number]['key'];

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

function Field({ label, children, error, required, half }: { label: string; children: ReactElement; error?: string; required?: boolean; half?: boolean }) {
  return (
    <div className={`form-group ${half ? 'form-group-half' : ''}`}>
      <label className="form-label">
        {label}
        {required && <span className="form-required-mark">*</span>}
      </label>
      {children}
      {error && <div className="form-error-text">{error}</div>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  return <input className="form-control-clay" type={type ?? 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />;
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <select className="form-control-clay" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder ?? 'Select...'}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function RepeatableSection<T>({ title, items, onAdd, onRemove, children }: { title: string; items: T[]; onAdd: () => void; onRemove: (i: number) => void; children: (item: T, index: number) => ReactElement }) {
  return (
    <div className="wizard-repeatable">
      <div className="wizard-repeatable-header">
        <h4>{title}</h4>
        <button type="button" className="btn-clay btn-clay-sm btn-clay-primary" onClick={onAdd}>
          <Icon icon={Icons.Plus} size="xs" /> Add
        </button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="wizard-repeatable-row">
          <div className="wizard-repeatable-row-header">
            <span className="wizard-repeatable-row-num">#{i + 1}</span>
            {items.length > 1 && (
              <button type="button" className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => onRemove(i)}>
                <Icon icon={Icons.Close} size="xs" /> Remove
              </button>
            )}
          </div>
          {children(item, i)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function StepPersonal({ data, set, errors }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void; errors: Record<string, string> }) {
  return (
    <div className="wizard-step-grid">
      <Field label="Employee ID" error={errors.employee_code}>
        <Input value={data.employee_code} onChange={(v) => set('employee_code', v)} placeholder="Auto-generated if blank" />
      </Field>
      <Field label="Full Name" error={errors.full_name} required>
        <Input value={data.full_name} onChange={(v) => set('full_name', v)} placeholder="e.g. Md. Rahman Khan" />
      </Field>
      <Field label="Employee Photo" error={errors.photo_file_id}>
        <div className="form-group-full">
          <EmployeePhotoUpload
            value={data.photo_file_id ? { file_id: data.photo_file_id, preview: '' } : null}
            onChange={(v) => set('photo_file_id', v?.file_id ?? '')}
          />
        </div>
      </Field>
      <Field label="Email" error={errors.email}>
        <Input value={data.email} onChange={(v) => set('email', v)} placeholder="name@company.com" type="email" />
      </Field>
      <Field label="Mobile" error={errors.mobile}>
        <Input value={data.mobile} onChange={(v) => set('mobile', v)} placeholder="+880 1XXXXXXXXX" />
      </Field>
      <Field label="Date of Birth" error={errors.date_of_birth}>
        <Input value={data.date_of_birth} onChange={(v) => set('date_of_birth', v)} type="date" />
      </Field>
      <Field label="Gender" error={errors.gender}>
        <Select value={data.gender} onChange={(v) => set('gender', v)} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
      </Field>
      <Field label="Marital Status" error={errors.marital_status}>
        <Select value={data.marital_status} onChange={(v) => set('marital_status', v)} options={[{ value: 'single', label: 'Single' }, { value: 'married', label: 'Married' }, { value: 'divorced', label: 'Divorced' }, { value: 'widowed', label: 'Widowed' }]} />
      </Field>
      <Field label="Blood Group" error={errors.blood_group}>
        <Select value={data.blood_group} onChange={(v) => set('blood_group', v)} options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => ({ value: g, label: g }))} />
      </Field>
      <Field label="NID / Passport" error={errors.nid_passport}>
        <Input value={data.nid_passport} onChange={(v) => set('nid_passport', v)} placeholder="National ID or passport number" />
      </Field>
    </div>
  );
}

function StepEmployment({ data, set, errors, depts, branches, subDepts, positions, types, rules, employees }: {
  data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void; errors: Record<string, string>;
  depts: Department[]; branches: Branch[]; subDepts: SubDepartment[]; positions: Position[]; types: EmployeeType[]; rules: SetupRule[]; employees: Array<{ id: string; full_name: string; employee_code: string }>;
}) {
  const filteredSubs = useMemo(() => data.department_id ? subDepts.filter((s) => s.department_id === data.department_id) : subDepts, [data.department_id, subDepts]);
  return (
    <div className="wizard-step-grid">
      <Field label="Branch" error={errors.branch_id}>
        <Select value={data.branch_id} onChange={(v) => set('branch_id', v)} options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select Branch..." />
      </Field>
      <Field label="Employee Type" error={errors.employee_type_id}>
        <Select value={data.employee_type_id} onChange={(v) => set('employee_type_id', v)} options={types.map((t) => ({ value: t.id, label: t.name }))} />
      </Field>
      <Field label="Department" error={errors.department_id}>
        <Select value={data.department_id} onChange={(v) => set('department_id', v)} options={depts.map((d) => ({ value: d.id, label: d.name }))} />
      </Field>
      <Field label="Sub Department" error={errors.sub_department_id}>
        <Select value={data.sub_department_id} onChange={(v) => set('sub_department_id', v)} options={filteredSubs.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      <Field label="Position / Designation" error={errors.position_id}>
        <Select value={data.position_id} onChange={(v) => set('position_id', v)} options={positions.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Supervisor" error={errors.supervisor_id}>
        <Select value={data.supervisor_id} onChange={(v) => set('supervisor_id', v)} options={employees.map((e) => ({ value: e.id, label: `${e.employee_code} — ${e.full_name}` }))} />
      </Field>
      <Field label="Setup Rule" error={errors.setup_rule_id}>
        <Select value={data.setup_rule_id} onChange={(v) => set('setup_rule_id', v)} options={rules.map((r) => ({ value: r.id, label: r.name }))} />
      </Field>
      <Field label="Joining Date" error={errors.joining_date} required>
        <Input value={data.joining_date} onChange={(v) => set('joining_date', v)} type="date" />
      </Field>
      <Field label="Contract End Date" error={errors.contract_end_date}>
        <Input value={data.contract_end_date} onChange={(v) => set('contract_end_date', v)} type="date" />
      </Field>
      <Field label="Contract Type">
        <Select value={data.contract_type} onChange={(v) => set('contract_type', v)} options={[{ value: 'permanent', label: 'Permanent' }, { value: 'contract', label: 'Contract' }, { value: 'probation', label: 'Probation' }, { value: 'part_time', label: 'Part Time' }, { value: 'intern', label: 'Intern' }]} />
      </Field>
      <Field label="Probation Months">
        <Input value={data.probation_months} onChange={(v) => set('probation_months', v)} type="number" placeholder="e.g. 6" />
      </Field>
      <Field label="Workplace">
        <Input value={data.workplace} onChange={(v) => set('workplace', v)} placeholder="e.g. Dhaka Head Office" />
      </Field>
      <Field label="Work Phone">
        <Input value={data.work_phone} onChange={(v) => set('work_phone', v)} placeholder="Office extension" />
      </Field>
      <Field label="WhatsApp">
        <Input value={data.whatsapp} onChange={(v) => set('whatsapp', v)} placeholder="+880..." />
      </Field>
      <Field label="Device ID">
        <Input value={data.device_id} onChange={(v) => set('device_id', v)} placeholder="Mobile device ID" />
      </Field>
      <Field label="Basic Salary (BDT)" error={errors.basic_salary}>
        <Input value={data.basic_salary} onChange={(v) => set('basic_salary', v)} type="number" placeholder="e.g. 35000" />
      </Field>
      <Field label="Working Days / Month">
        <Input value={data.working_days} onChange={(v) => set('working_days', v)} type="number" placeholder="26" />
      </Field>
      <Field label="Appointment Letter" error={errors.appointment_letter}>
        <div className="form-group-full">
          <AppointmentLetterUpload
            value={
              data.appointment_letter_file_id
                ? { file_id: data.appointment_letter_file_id, filename: data.appointment_letter_filename }
                : null
            }
            onChange={(v) => {
              set('appointment_letter_file_id', v?.file_id ?? '');
              set('appointment_letter_filename', v?.filename ?? '');
            }}
          />
        </div>
      </Field>
    </div>
  );
}

function StepBank({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const b = data.banks[0] ?? EMPTY_BANK;
  const update = (field: keyof BankInfo, val: string) => {
    const banks = [...data.banks];
    banks[0] = { ...(banks[0] ?? EMPTY_BANK), [field]: val };
    set('banks', banks);
  };
  return (
    <div className="wizard-step-grid">
      <Field label="Salary Receiving Method">
        <Select value={b.salary_receiving_method} onChange={(v) => update('salary_receiving_method', v)} options={[{ value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }]} />
      </Field>
      <Field label="Bank Name">
        <Input value={b.bank_name} onChange={(v) => update('bank_name', v)} placeholder="e.g. DBBL, BRAC, City" />
      </Field>
      <Field label="Account Name">
        <Input value={b.account_name} onChange={(v) => update('account_name', v)} placeholder="Account holder name" />
      </Field>
      <Field label="Account Number">
        <Input value={b.account_number} onChange={(v) => update('account_number', v)} placeholder="Bank account number" />
      </Field>
      <Field label="Branch">
        <Input value={b.branch} onChange={(v) => update('branch', v)} placeholder="Branch name" />
      </Field>
      <Field label="Routing Number">
        <Input value={b.routing_number} onChange={(v) => update('routing_number', v)} placeholder="Bank routing number" />
      </Field>
      <Field label="IBAN">
        <Input value={b.iban} onChange={(v) => update('iban', v)} placeholder="International Bank Account Number" />
      </Field>
    </div>
  );
}

function StepAddress({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const update = (idx: number, field: keyof AddressInfo, val: string) => {
    const addrs = [...data.addresses];
    addrs[idx] = { ...addrs[idx], [field]: val };
    if (data.same_address && idx === 0) {
      addrs[1] = { ...addrs[1], ...addrs[0], type: 'permanent' };
    }
    set('addresses', addrs);
  };
  const toggleSame = () => {
    const next = !data.same_address;
    if (next) {
      const addrs = [...data.addresses];
      addrs[1] = { ...addrs[0], type: 'permanent' };
      set('addresses', addrs);
    }
    set('same_address', next);
  };
  const renderAddr = (addr: AddressInfo, idx: number) => (
    <div className="wizard-step-grid" key={idx}>
      <Field label="Country">
        <Input value={addr.country} onChange={(v) => update(idx, 'country', v)} />
      </Field>
      <Field label="Division / State">
        <Input value={addr.state} onChange={(v) => update(idx, 'state', v)} placeholder="e.g. Dhaka" />
      </Field>
      <Field label="District / City">
        <Input value={addr.district} onChange={(v) => update(idx, 'district', v)} placeholder="e.g. Dhaka" />
      </Field>
      <Field label="Thana / Area">
        <Input value={addr.thana} onChange={(v) => update(idx, 'thana', v)} placeholder="e.g. Gulshan" />
      </Field>
      <Field label="ZIP / Postal Code">
        <Input value={addr.zip} onChange={(v) => update(idx, 'zip', v)} placeholder="e.g. 1212" />
      </Field>
      <Field label="Full Address" half={false}>
        <textarea className="form-control-clay" value={addr.address_line1} onChange={(e) => update(idx, 'address_line1', e.target.value)} rows={2} placeholder="Street, house, flat..." />
      </Field>
    </div>
  );
  return (
    <div>
      <div className="wizard-address-section">
        <h4>Present Address</h4>
        {data.addresses[0] && renderAddr(data.addresses[0], 0)}
      </div>
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
        <input type="checkbox" checked={data.same_address} onChange={toggleSame} />
        <span>Present Address &amp; Permanent Address Same</span>
      </label>
      {!data.same_address && (
        <div className="wizard-address-section">
          <h4>Permanent Address</h4>
          {data.addresses[1] && renderAddr(data.addresses[1], 1)}
        </div>
      )}
    </div>
  );
}

function StepEmergency({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const add = () => set('emergencyContacts', [...data.emergencyContacts, { ...EMPTY_EMERGENCY }]);
  const remove = (i: number) => set('emergencyContacts', data.emergencyContacts.filter((_, j) => j !== i));
  const update = (i: number, field: keyof EmergencyContact, val: string) => {
    const c = [...data.emergencyContacts];
    c[i] = { ...c[i], [field]: val };
    set('emergencyContacts', c);
  };
  return (
    <RepeatableSection title="Emergency Contacts" items={data.emergencyContacts} onAdd={add} onRemove={remove}>
      {(item, i) => (
        <div className="wizard-step-grid">
          <Field label="Full Name" required><Input value={item.name} onChange={(v) => update(i, 'name', v)} /></Field>
          <Field label="Relationship"><Input value={item.relationship} onChange={(v) => update(i, 'relationship', v)} placeholder="e.g. Father, Spouse" /></Field>
          <Field label="Phone"><Input value={item.phone} onChange={(v) => update(i, 'phone', v)} placeholder="+880..." /></Field>
          <Field label="Email"><Input value={item.email} onChange={(v) => update(i, 'email', v)} type="email" /></Field>
          <Field label="Address"><Input value={item.address} onChange={(v) => update(i, 'address', v)} placeholder="Full address" /></Field>
        </div>
      )}
    </RepeatableSection>
  );
}

function StepEducation({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const add = () => set('academics', [...data.academics, { ...EMPTY_ACADEMIC }]);
  const remove = (i: number) => set('academics', data.academics.filter((_, j) => j !== i));
  const update = (i: number, field: keyof AcademicInfo, val: string) => {
    const a = [...data.academics];
    a[i] = { ...a[i], [field]: val };
    set('academics', a);
  };
  return (
    <RepeatableSection title="Qualifications" items={data.academics} onAdd={add} onRemove={remove}>
      {(item, i) => (
        <div className="wizard-step-grid">
          <Field label="Degree / Exam"><Input value={item.degree} onChange={(v) => update(i, 'degree', v)} placeholder="e.g. B.Sc, HSC, MBA" /></Field>
          <Field label="Subject / Major"><Input value={item.field_of_study} onChange={(v) => update(i, 'field_of_study', v)} placeholder="e.g. Computer Science" /></Field>
          <Field label="Institution"><Input value={item.institution} onChange={(v) => update(i, 'institution', v)} /></Field>
          <Field label="Board / University"><Input value={item.board} onChange={(v) => update(i, 'board', v)} /></Field>
          <Field label="Result / CGPA"><Input value={item.result} onChange={(v) => update(i, 'result', v)} placeholder="e.g. 3.8/4.0, A+" /></Field>
          <Field label="Start Year"><Input value={item.start_year} onChange={(v) => update(i, 'start_year', v)} type="number" placeholder="2015" /></Field>
          <Field label="Passing Year"><Input value={item.end_year} onChange={(v) => update(i, 'end_year', v)} type="number" placeholder="2019" /></Field>
          <Field label="Grade"><Input value={item.grade} onChange={(v) => update(i, 'grade', v)} placeholder="e.g. First Class" /></Field>
        </div>
      )}
    </RepeatableSection>
  );
}

function StepActivities({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const add = () => set('extraCurriculars', [...data.extraCurriculars, { ...EMPTY_ACTIVITY }]);
  const remove = (i: number) => set('extraCurriculars', data.extraCurriculars.filter((_, j) => j !== i));
  const update = (i: number, field: keyof ExtraCurricularInfo, val: string) => {
    const a = [...data.extraCurriculars];
    a[i] = { ...a[i], [field]: val };
    set('extraCurriculars', a);
  };
  return (
    <RepeatableSection title="Activities & Certifications" items={data.extraCurriculars} onAdd={add} onRemove={remove}>
      {(item, i) => (
        <div className="wizard-step-grid">
          <Field label="Activity / Title"><Input value={item.activity} onChange={(v) => update(i, 'activity', v)} placeholder="e.g. AWS Certified Developer" /></Field>
          <Field label="Year"><Input value={item.year} onChange={(v) => update(i, 'year', v)} type="number" placeholder="2023" /></Field>
          <Field label="Description" half={false}><textarea className="form-control-clay" value={item.description} onChange={(e) => update(i, 'description', e.target.value)} rows={2} /></Field>
        </div>
      )}
    </RepeatableSection>
  );
}

function StepExperience({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const add = () => set('experiences', [...data.experiences, { ...EMPTY_EXPERIENCE }]);
  const remove = (i: number) => set('experiences', data.experiences.filter((_, j) => j !== i));
  const update = (i: number, field: keyof ExperienceInfo, val: string) => {
    const e = [...data.experiences];
    e[i] = { ...e[i], [field]: val };
    set('experiences', e);
  };
  return (
    <RepeatableSection title="Work Experience" items={data.experiences} onAdd={add} onRemove={remove}>
      {(item, i) => (
        <div className="wizard-step-grid">
          <Field label="Employer / Company"><Input value={item.company} onChange={(v) => update(i, 'company', v)} /></Field>
          <Field label="Designation"><Input value={item.designation} onChange={(v) => update(i, 'designation', v)} /></Field>
          <Field label="Start Date"><Input value={item.start_date} onChange={(v) => update(i, 'start_date', v)} type="date" /></Field>
          <Field label="End Date"><Input value={item.end_date} onChange={(v) => update(i, 'end_date', v)} type="date" /></Field>
          <Field label="Salary"><Input value={item.salary} onChange={(v) => update(i, 'salary', v)} placeholder="BDT" /></Field>
          <Field label="Separation Reason"><Input value={item.separation_reason} onChange={(v) => update(i, 'separation_reason', v)} /></Field>
          <Field label="Responsibilities" half={false}><textarea className="form-control-clay" value={item.responsibilities} onChange={(e) => update(i, 'responsibilities', e.target.value)} rows={2} /></Field>
        </div>
      )}
    </RepeatableSection>
  );
}

function StepFamily({ data, set }: { data: WizardData; set: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const add = () => set('familyMembers', [...data.familyMembers, { ...EMPTY_FAMILY }]);
  const remove = (i: number) => set('familyMembers', data.familyMembers.filter((_, j) => j !== i));
  const update = (i: number, field: keyof FamilyMemberInfo, val: string) => {
    const f = [...data.familyMembers];
    f[i] = { ...f[i], [field]: val };
    set('familyMembers', f);
  };
  return (
    <RepeatableSection title="Family Members" items={data.familyMembers} onAdd={add} onRemove={remove}>
      {(item, i) => (
        <div className="wizard-step-grid">
          <Field label="Full Name" required><Input value={item.name} onChange={(v) => update(i, 'name', v)} /></Field>
          <Field label="Relationship"><Input value={item.relationship} onChange={(v) => update(i, 'relationship', v)} placeholder="e.g. Spouse, Son, Daughter" /></Field>
          <Field label="Date of Birth"><Input value={item.date_of_birth} onChange={(v) => update(i, 'date_of_birth', v)} type="date" /></Field>
          <Field label="Occupation"><Input value={item.occupation} onChange={(v) => update(i, 'occupation', v)} /></Field>
          <Field label="Phone"><Input value={item.phone} onChange={(v) => update(i, 'phone', v)} /></Field>
          <Field label="Email"><Input value={item.email} onChange={(v) => update(i, 'email', v)} type="email" /></Field>
        </div>
      )}
    </RepeatableSection>
  );
}

function StepReview({ data, branches, onEdit }: { data: WizardData; branches: Branch[]; onEdit: (step: StepKey) => void }) {
  const fmt = (v: string | null | undefined) => v || '—';
  const bdt = (v: string) => v ? Number(v).toLocaleString(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }) : '—';
  const section = (title: string, step: StepKey, rows: Array<[string, string | ReactElement]>) => (
    <div className="wizard-review-section">
      <div className="wizard-review-section-header">
        <h4>{title}</h4>
        <button type="button" className="btn-clay btn-clay-sm btn-clay-secondary" onClick={() => onEdit(step)}>Edit</button>
      </div>
      <div className="wizard-review-grid">
        {rows.map(([label, val]) => (
          <div key={label} className="wizard-review-item">
            <span className="wizard-review-label">{label}</span>
            <span className="wizard-review-value">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="wizard-review">
      {section('Personal Information', 'personal', [
        ['Employee ID', data.employee_code || <span className="text-muted">Auto-generate</span>],
        ['Full Name', fmt(data.full_name)],
        ['Email', fmt(data.email)],
        ['Mobile', fmt(data.mobile)],
        ['DOB', fmt(data.date_of_birth)],
        ['Gender', fmt(data.gender)],
        ['Marital Status', fmt(data.marital_status)],
        ['Blood Group', fmt(data.blood_group)],
        ['NID / Passport', fmt(data.nid_passport)],
      ])}
      {section('Employment Details', 'employment', [
        ['Branch', fmt(branches.find((b) => b.id === data.branch_id)?.name)],
        ['Joining Date', fmt(data.joining_date)],
        ['Contract Type', fmt(data.contract_type)],
        ['Probation Months', fmt(data.probation_months)],
        ['Basic Salary', bdt(data.basic_salary)],
        ['Working Days', fmt(data.working_days)],
        ['Workplace', fmt(data.workplace)],
        [
          'Appointment Letter',
          data.appointment_letter_file_id ? (
            <LetterFileView fileId={data.appointment_letter_file_id} filename={data.appointment_letter_filename || 'Appointment Letter'} />
          ) : (
            <span className="text-muted">No letter uploaded</span>
          ),
        ],
      ])}
      {section('Bank & Salary', 'bank', [
        ['Receiving Method', fmt(data.banks[0]?.salary_receiving_method)],
        ['Bank', fmt(data.banks[0]?.bank_name)],
        ['Account #', fmt(data.banks[0]?.account_number)],
        ['Branch', fmt(data.banks[0]?.branch)],
        ['IBAN', fmt(data.banks[0]?.iban)],
      ])}
      {section('Present Address', 'address', [
        ['Country', fmt(data.addresses[0]?.country)],
        ['State', fmt(data.addresses[0]?.state)],
        ['District', fmt(data.addresses[0]?.district)],
        ['Thana', fmt(data.addresses[0]?.thana)],
        ['ZIP', fmt(data.addresses[0]?.zip)],
        ['Address', fmt(data.addresses[0]?.address_line1)],
      ])}
      {data.emergencyContacts.filter((c) => c.name).length > 0 && section('Emergency Contacts', 'emergency', data.emergencyContacts.filter((c) => c.name).map((c) => [c.name, `${c.relationship} — ${c.phone}`] as [string, string | ReactElement]))}
      {data.academics.filter((a) => a.degree || a.institution).length > 0 && section('Education', 'education', data.academics.filter((a) => a.degree || a.institution).map((a) => [`${a.degree} — ${a.institution}`, `${a.board || ''} ${a.result || ''}`.trim() || '—'] as [string, string | ReactElement]))}
      {data.experiences.filter((e) => e.company).length > 0 && section('Experience', 'experience', data.experiences.filter((e) => e.company).map((e) => [`${e.company} — ${e.designation}`, `${e.start_date || ''} → ${e.end_date || ''}`] as [string, string | ReactElement]))}
      {data.familyMembers.filter((f) => f.name).length > 0 && section('Family', 'family', data.familyMembers.filter((f) => f.name).map((f) => [f.name, f.relationship] as [string, string | ReactElement]))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard Component
// ---------------------------------------------------------------------------

export function EmployeeOnboardingWizard(): ReactElement {
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState<WizardData>(() => loadDraft() ?? defaultData());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [createdEmployee, setCreatedEmployee] = useState<Record<string, unknown> | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; email: string | null; temporary_password: string } | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(!!loadDraft());

  // When resuming an existing set of values (edit/draft), auto-check the box if
  // present and permanent addresses are identical so the permanent section hides.
  useEffect(() => {
    const present = data.addresses[0];
    const permanent = data.addresses[1];
    if (present && permanent && hasAddressValue(present) && addressesEqual(present, permanent)) {
      setData((prev) => (prev.same_address ? prev : { ...prev, same_address: true }));
    }
  }, []);

  // Master data
  const [depts, setDepts] = useState<Department[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subDepts, setSubDepts] = useState<SubDepartment[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [types, setTypes] = useState<EmployeeType[]>([]);
  const [rules, setRules] = useState<SetupRule[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; full_name: string; employee_code: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      hr.departments({ perPage: '200' }),
      hr.branches({ perPage: '100' }),
      hr.subDepartments({ perPage: '500' }),
      hr.positions({ perPage: '200' }),
      hr.employeeTypes({ perPage: '100' }),
      hr.setupRules({ perPage: '100' }),
      hr.employees({ perPage: '500' }),
    ]).then(([d, br, sd, p, t, r, em]) => {
      if (cancelled) return;
      setDepts((d.data as { items: Department[] }).items);
      setBranches((br.data as { items: Branch[] }).items ?? []);
      setSubDepts((sd.data as { items: SubDepartment[] }).items);
      setPositions((p.data as { items: Position[] }).items);
      setTypes((t.data as { items: EmployeeType[] }).items);
      setRules((r.data as { items: SetupRule[] }).items);
      setEmployees((em.data as { items: Array<{ id: string; full_name: string; employee_code: string }> }).items);
    }).catch(() => { /* master data load error - non-critical */ });
    return () => { cancelled = true; };
  }, []);

  // Auto-save draft
  useEffect(() => { saveDraft(data); }, [data]);

  const step = STEPS[stepIdx];
  const set = useCallback(<K extends keyof WizardData>(k: K, v: WizardData[K]) => {
    setData((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => { const next = { ...prev }; delete next[k]; return next; });
  }, []);

  const stepErrors = useMemo(() => {
    if (step.key === 'personal') return validatePersonal(data);
    if (step.key === 'employment') return validateEmployment(data);
    return {};
  }, [step.key, data]);

  const canNext = Object.keys(stepErrors).length === 0;

  const goNext = () => {
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goPrev = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  const goToStep = (target: StepKey | number) => {
    setErrors({});
    const idx = typeof target === 'number' ? target : STEPS.findIndex((s) => s.key === target);
    if (idx >= 0 && idx < STEPS.length) setStepIdx(idx);
  };

  const discardDraft = () => {
    clearDraft();
    setData(defaultData());
    setShowDraftBanner(false);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = buildPayload(data);
      const res = await hr.createEmployeeWizard(payload);
      setCreatedEmployee(res.data.employee);
      setCreatedCredentials(res.data.credentials);
      setCredentialCopied(false);
      clearDraft();
      setSubmitSuccess(true);
    } catch (err) {
      if (err && typeof err === 'object' && 'fieldErrors' in err) {
        setErrors((err as { fieldErrors: Record<string, string> }).fieldErrors);
        setStepIdx(0);
      }
      setSubmitError(err instanceof Error ? err.message : 'Failed to create employee');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitSuccess) {
    return (
      <div className="wizard-success-screen">
        <PageHeader title="Employee Onboarding" subtitle="New employee created successfully." />
        <div className="panel-clay wizard-success-card">
          <div className="wizard-success-icon">
            <Icon icon={Icons.Success} />
          </div>
          <h3>Employee Created</h3>
          <p className="wizard-success-detail">
            <strong>{data.full_name}</strong> has been added as{' '}
            <span className="badge-clay badge-clay-info">{(createdEmployee as { employee_code?: string })?.employee_code ?? data.employee_code}</span>
          </p>
          {createdCredentials && (
            <div
              className="panel-clay"
              style={{
                marginTop: '1.1rem',
                padding: '1rem 1.25rem',
                borderLeft: '4px solid var(--primary)',
                textAlign: 'left',
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: '0.6rem' }}>Login credentials (shown once)</div>
              <div className="form-group">
                <label className="form-label">Login ID / Email</label>
                <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {createdCredentials.email ?? createdCredentials.username}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Temporary Password</label>
                <div style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.04em' }}>
                  {createdCredentials.temporary_password}
                </div>
              </div>
              <div className="form-help-text">
                The employee must change this password on first login.
                {createdCredentials.email ? ' A welcome email was also sent.' : ''}
              </div>
              <div style={{ marginTop: '0.8rem' }}>
                <button
                  className="btn-clay btn-clay-sm btn-clay-secondary"
                  onClick={() => {
                    const loginId = createdCredentials.email ?? createdCredentials.username;
                    void navigator.clipboard
                      .writeText(
                        loginId
                          ? `Login email: ${loginId}\nTemporary password: ${createdCredentials.temporary_password}`
                          : createdCredentials.temporary_password
                      )
                      .catch(() => {});
                    setCredentialCopied(true);
                  }}
                >
                  {credentialCopied ? 'Copied!' : 'Copy Credentials'}
                </button>
              </div>
            </div>
          )}
          <div className="wizard-success-actions">
            <button className="btn-clay btn-clay-primary" onClick={() => navigate('/hr/employees')}>View Employees</button>
            <button className="btn-clay btn-clay-secondary" onClick={() => { setData(defaultData()); setSubmitSuccess(false); setStepIdx(0); }}>Add Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Employee Onboarding" subtitle="Complete the step-by-step wizard to add a new employee." />
      {showDraftBanner && (
        <div className="wizard-draft-banner panel-clay">
          <span>You have an unsaved draft from a previous session.</span>
          <div className="wizard-draft-banner-actions">
            <button className="btn-clay btn-clay-sm btn-clay-primary" onClick={() => setShowDraftBanner(false)}>Resume</button>
            <button className="btn-clay btn-clay-sm btn-clay-danger" onClick={discardDraft}>Discard</button>
          </div>
        </div>
      )}
      <div className="wizard-layout">
        <div className="wizard-stepper">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              className={`wizard-stepper-item ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'completed' : ''}`}
              onClick={() => goToStep(i)}
              type="button"
            >
              <span className="wizard-stepper-icon">
                {i < stepIdx ? <Icon icon={Icons.Success} size="xs" /> : <Icon icon={s.icon} size="xs" />}
              </span>
              <span className="wizard-stepper-label">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="wizard-content">
          <div className="panel-clay wizard-step-card">
            <div className="wizard-step-header">
              <Icon icon={step.icon} />
              <h3>{step.label}</h3>
            </div>
            {step.key === 'personal' && <StepPersonal data={data} set={set} errors={stepErrors} />}
            {step.key === 'employment' && <StepEmployment data={data} set={set} errors={stepErrors} depts={depts} branches={branches} subDepts={subDepts} positions={positions} types={types} rules={rules} employees={employees} />}
            {step.key === 'bank' && <StepBank data={data} set={set} />}
            {step.key === 'address' && <StepAddress data={data} set={set} />}
            {step.key === 'emergency' && <StepEmergency data={data} set={set} />}
            {step.key === 'education' && <StepEducation data={data} set={set} />}
            {step.key === 'activities' && <StepActivities data={data} set={set} />}
            {step.key === 'experience' && <StepExperience data={data} set={set} />}
            {step.key === 'family' && <StepFamily data={data} set={set} />}
            {step.key === 'review' && <StepReview data={data} branches={branches} onEdit={goToStep} />}
          </div>
          {submitError && <div className="alert-box alert-box-error" style={{ marginTop: 12 }}>{submitError}</div>}
          {Object.keys(errors).length > 0 && (
            <div className="alert-box alert-box-error" style={{ marginTop: 12 }}>
              Please fix the errors above before proceeding.
            </div>
          )}
          <div className="wizard-actions">
            {stepIdx > 0 && (
              <button type="button" className="btn-clay btn-clay-secondary" onClick={goPrev}>Previous</button>
            )}
            <div style={{ flex: 1 }} />
            {stepIdx < STEPS.length - 1 && (
              <button type="button" className="btn-clay btn-clay-primary" onClick={goNext} disabled={!canNext}>Save & Continue</button>
            )}
            {stepIdx === STEPS.length - 1 && (
              <button type="button" className="btn-clay btn-clay-success" onClick={() => void submit()} disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Employee'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
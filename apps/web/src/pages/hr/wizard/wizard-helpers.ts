// ---------------------------------------------------------------------------
// Extracted pure helpers for the Employee Onboarding Wizard
// ---------------------------------------------------------------------------

export const DRAFT_KEY = 'sdi_employee_onboarding_draft';

export interface Department { id: string; name: string; }
export interface SubDepartment { id: string; name: string; department_id: string; }
export interface Position { id: string; name: string; }
export interface EmployeeType { id: string; name: string; }
export interface SetupRule { id: string; name: string; }

export interface WizardData {
  employee_code: string; full_name: string; photo_file_id: string; email: string;
  mobile: string; date_of_birth: string; gender: string; marital_status: string;
  blood_group: string; nid_passport: string; contract_type: string;
  joining_date: string; contract_end_date: string; department_id: string;
  branch_id: string;
  sub_department_id: string; position_id: string; employee_type_id: string;
  setup_rule_id: string; supervisor_id: string; probation_months: string;
  workplace: string; work_phone: string; whatsapp: string; device_id: string;
  basic_salary: string; working_days: string; appointment_letter_file_id: string;
  appointment_letter_filename: string;
  salary_receiving_method: string; banks: Array<{ bank_name: string; account_name: string; account_number: string; branch: string; routing_number: string; iban: string; salary_receiving_method: string }>;
  addresses: Array<{ type: string; country: string; state: string; district: string; city: string; thana: string; zip: string; address_line1: string; address_line2: string }>;
  same_address: boolean;
  emergencyContacts: Array<{ name: string; relationship: string; phone: string; email: string; address: string }>;
  academics: Array<{ degree: string; field_of_study: string; institution: string; board: string; result: string; start_year: string; end_year: string; grade: string; attachment_url: string }>;
  extraCurriculars: Array<{ activity: string; description: string; year: string; attachment_url: string }>;
  experiences: Array<{ company: string; designation: string; start_date: string; end_date: string; salary: string; responsibilities: string; separation_reason: string; attachment_url: string }>;
  familyMembers: Array<{ name: string; relationship: string; date_of_birth: string; occupation: string; phone: string; email: string; attachment_url: string }>;
}

export function emptyBank() {
  return { bank_name: '', account_name: '', account_number: '', branch: '', routing_number: '', iban: '', salary_receiving_method: '' };
}

export function emptyAddress(type: string): WizardData['addresses'][0] {
  return { type, country: '', state: '', district: '', city: '', thana: '', zip: '', address_line1: '', address_line2: '' };
}

const ADDRESS_FIELDS = ['country', 'state', 'district', 'city', 'thana', 'zip', 'address_line1', 'address_line2'] as const;

export function addressesEqual(a: WizardData['addresses'][0], b: WizardData['addresses'][0]): boolean {
  return ADDRESS_FIELDS.every((f) => (a[f] ?? '') === (b[f] ?? ''));
}

export function hasAddressValue(a: WizardData['addresses'][0]): boolean {
  return ADDRESS_FIELDS.some((f) => (a[f] ?? '').trim() !== '');
}

export type BankInfo = WizardData['banks'][0];
export type AddressInfo = WizardData['addresses'][0];
export type EmergencyContact = WizardData['emergencyContacts'][0];
export type AcademicInfo = WizardData['academics'][0];
export type ExtraCurricularInfo = WizardData['extraCurriculars'][0];
export type ExperienceInfo = WizardData['experiences'][0];
export type FamilyMemberInfo = WizardData['familyMembers'][0];

export const EMPTY_BANK: BankInfo = { bank_name: '', account_name: '', account_number: '', branch: '', routing_number: '', iban: '', salary_receiving_method: '' };
export const EMPTY_EMERGENCY: EmergencyContact = { name: '', relationship: '', phone: '', email: '', address: '' };
export const EMPTY_ACADEMIC: AcademicInfo = { degree: '', field_of_study: '', institution: '', board: '', result: '', start_year: '', end_year: '', grade: '', attachment_url: '' };
export const EMPTY_ACTIVITY: ExtraCurricularInfo = { activity: '', description: '', year: '', attachment_url: '' };
export const EMPTY_EXPERIENCE: ExperienceInfo = { company: '', designation: '', start_date: '', end_date: '', salary: '', responsibilities: '', separation_reason: '', attachment_url: '' };
export const EMPTY_FAMILY: FamilyMemberInfo = { name: '', relationship: '', date_of_birth: '', occupation: '', phone: '', email: '', attachment_url: '' };

export function defaultData(): WizardData {
  return {
    employee_code: '', full_name: '', photo_file_id: '', email: '', mobile: '',
    date_of_birth: '', gender: '', marital_status: '', blood_group: '',
    nid_passport: '', contract_type: 'permanent', joining_date: '', contract_end_date: '',
    department_id: '', branch_id: '', sub_department_id: '', position_id: '', employee_type_id: '',
    setup_rule_id: '', supervisor_id: '', probation_months: '', workplace: '',
    work_phone: '', whatsapp: '', device_id: '', basic_salary: '', working_days: '26',
    appointment_letter_file_id: '', appointment_letter_filename: '', salary_receiving_method: '',
    banks: [emptyBank()],
    addresses: [emptyAddress('present'), emptyAddress('permanent')],
    same_address: false,
    emergencyContacts: [{ name: '', relationship: '', phone: '', email: '', address: '' }],
    academics: [{ degree: '', field_of_study: '', institution: '', board: '', result: '', start_year: '', end_year: '', grade: '', attachment_url: '' }],
    extraCurriculars: [{ activity: '', description: '', year: '', attachment_url: '' }],
    experiences: [{ company: '', designation: '', start_date: '', end_date: '', salary: '', responsibilities: '', separation_reason: '', attachment_url: '' }],
    familyMembers: [{ name: '', relationship: '', date_of_birth: '', occupation: '', phone: '', email: '', attachment_url: '' }],
  };
}

export function loadDraft(): WizardData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as WizardData;
  } catch { /* noop */ }
  return null;
}

export function saveDraft(d: WizardData): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* noop */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export function validatePersonal(data: WizardData): Record<string, string> {
  const e: Record<string, string> = {};
  if (!data.full_name.trim()) e.full_name = 'Full name is required.';
  return e;
}

export function validateEmployment(data: WizardData): Record<string, string> {
  const e: Record<string, string> = {};
  if (data.joining_date && data.contract_end_date && data.contract_end_date < data.joining_date) {
    e.contract_end_date = 'End date cannot be before joining date.';
  }
  return e;
}

export function buildPayload(data: WizardData) {
  return {
    employee: {
      employee_code: data.employee_code || undefined,
      full_name: data.full_name,
      email: data.email || undefined,
      mobile: data.mobile || undefined,
      date_of_birth: data.date_of_birth || undefined,
      gender: data.gender || undefined,
      marital_status: data.marital_status || undefined,
      blood_group: data.blood_group || undefined,
      contract_type: data.contract_type || undefined,
      joining_date: data.joining_date || undefined,
      contract_end_date: data.contract_end_date || undefined,
      department_id: data.department_id || undefined,
      branch_id: data.branch_id || undefined,
      sub_department_id: data.sub_department_id || undefined,
      position_id: data.position_id || undefined,
      employee_type_id: data.employee_type_id || undefined,
      setup_rule_id: data.setup_rule_id || undefined,
      photo_file_id: data.photo_file_id || undefined,
      nid_passport: data.nid_passport || undefined,
      supervisor_id: data.supervisor_id || undefined,
      probation_months: data.probation_months ? Number(data.probation_months) : undefined,
      workplace: data.workplace || undefined,
      work_phone: data.work_phone || undefined,
      whatsapp: data.whatsapp || undefined,
      device_id: data.device_id || undefined,
      basic_salary: data.basic_salary || undefined,
      working_days: data.working_days ? Number(data.working_days) : undefined,
      appointment_letter_file_id: data.appointment_letter_file_id || undefined,
    },
    banks: data.banks.filter((b) => b.bank_name || b.account_number).map((b) => ({
      bank_name: b.bank_name || undefined,
      account_name: b.account_name || undefined,
      account_number: b.account_number || undefined,
      branch: b.branch || undefined,
      routing_number: b.routing_number || undefined,
      iban: b.iban || undefined,
      salary_receiving_method: b.salary_receiving_method || undefined,
    })),
    addresses: (data.same_address
      ? [data.addresses[0], { ...data.addresses[0], type: 'permanent' }]
      : data.addresses
    ).filter((a) => a.address_line1 || a.city || a.district).map((a) => ({
      type: a.type,
      country: a.country || undefined,
      state: a.state || undefined,
      district: a.district || undefined,
      city: a.city || undefined,
      thana: a.thana || undefined,
      zip: a.zip || undefined,
      address_line1: a.address_line1 || undefined,
      address_line2: a.address_line2 || undefined,
    })),
    emergencyContacts: data.emergencyContacts.filter((c) => c.name).map((c) => ({
      name: c.name, relationship: c.relationship || undefined, phone: c.phone || undefined,
      email: c.email || undefined, address: c.address || undefined,
    })),
    academics: data.academics.filter((a) => a.degree || a.institution).map((a) => ({
      degree: a.degree || undefined, field_of_study: a.field_of_study || undefined,
      institution: a.institution || undefined, board: a.board || undefined,
      result: a.result || undefined, start_year: a.start_year ? Number(a.start_year) : undefined,
      end_year: a.end_year ? Number(a.end_year) : undefined, grade: a.grade || undefined,
      attachment_url: a.attachment_url || undefined,
    })),
    extraCurriculars: data.extraCurriculars.filter((a) => a.activity).map((a) => ({
      activity: a.activity, description: a.description || undefined,
      year: a.year ? Number(a.year) : undefined, attachment_url: a.attachment_url || undefined,
    })),
    experiences: data.experiences.filter((e) => e.company).map((e) => ({
      company: e.company, designation: e.designation || undefined,
      start_date: e.start_date || undefined, end_date: e.end_date || undefined,
      salary: e.salary || undefined, responsibilities: e.responsibilities || undefined,
      separation_reason: e.separation_reason || undefined, attachment_url: e.attachment_url || undefined,
    })),
    familyMembers: data.familyMembers.filter((f) => f.name).map((f) => ({
      name: f.name, relationship: f.relationship || undefined,
      date_of_birth: f.date_of_birth || undefined, occupation: f.occupation || undefined,
      phone: f.phone || undefined, email: f.email || undefined, attachment_url: f.attachment_url || undefined,
    })),
  };
}

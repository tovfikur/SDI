import { useCallback, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { hr } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon, Icons } from '../../components/Icon';
import type { IconDefinition } from '../../components/Icon';
import { useToast } from '../../components/Toast';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function InfoField({ label, value, icon }: { label: string; value: string | number | null | undefined; icon?: IconDefinition }): ReactElement {
  return (
    <div className="form-group" style={{ minWidth: 0, marginBottom: 12 }}>
      <label>
        {icon && <Icon icon={icon} size="xs" />}
        {label}
      </label>
      <div style={{ fontWeight: 600 }}>{value ?? '—'}</div>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  actions,
  children,
}: {
  title: string;
  icon: IconDefinition;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="card-title">
          <Icon icon={icon} size="sm" />
          {title}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'date' | 'tel';
}): ReactElement {
  return (
    <div className="form-group" style={{ minWidth: 0 }}>
      <label>{label}</label>
      <input
        className="form-control-clay"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const str = (v: unknown): string => (v == null ? '' : String(v));

export function MyProfilePage(): ReactElement {
  const { toast } = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [empForm, setEmpForm] = useState<Record<string, string>>({});
  const [bankForm, setBankForm] = useState<Record<string, string>>({});
  const [addrForm, setAddrForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.me();
      setData(res.data);
      const banks = (res.data.banks as Array<Record<string, unknown>>) ?? [];
      const addresses = (res.data.addresses as Array<Record<string, unknown>>) ?? [];
      const bank = banks[0] ?? {};
      const addr = addresses[0] ?? {};
      setEmpForm({
        mobile: str(res.data.mobile),
        work_phone: str(res.data.work_phone),
        whatsapp: str(res.data.whatsapp),
        marital_status: str(res.data.marital_status),
        blood_group: str(res.data.blood_group),
        nid_passport: str(res.data.nid_passport),
      });
      setBankForm({
        bank_name: str(bank.bank_name),
        account_name: str(bank.account_name),
        account_number: str(bank.account_number),
        branch: str(bank.branch),
        routing_number: str(bank.routing_number),
        iban: str(bank.iban),
      });
      setAddrForm({
        address_line1: str(addr.address_line1),
        address_line2: str(addr.address_line2),
        city: str(addr.city),
        state: str(addr.state),
        zip: str(addr.zip),
        country: str(addr.country),
        district: str(addr.district),
        thana: str(addr.thana),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (): void => {
    setEditing(true);
  };

  const cancelEdit = (): void => {
    setEditing(false);
    void load();
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await hr.updateMyProfile({
        employee: empForm,
        bank: bankForm,
        address: addrForm,
      });
      toast('Profile updated successfully.', 'success');
      setEditing(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="data-table-state">Loading profile…</div>;
  if (error) {
    const noProfile = /profile/i.test(error) && !/failed to load/i.test(error);
    if (noProfile) {
      return (
        <div>
          <PageHeader title="My Profile" subtitle="Your personal, employment and contact information." />
          <div className="card" style={{ maxWidth: 420, margin: '3rem auto' }}>
            <div className="card-body" style={{ padding: '2.2rem 1.6rem' }}>
              <div className="empty-state" style={{ padding: 0 }}>
                <div className="empty-state-icon">
                  <Icon icon={Icons.UserTie} size="xl" />
                </div>
                <div className="empty-state-title">No employee profile linked</div>
                <div className="empty-state-hint" style={{ textAlign: 'center' }}>
                  Your account is not connected to an employee record yet. Please contact HR to link your profile.
                </div>
                <Link to="/" className="btn btn-outline" style={{ marginTop: 12 }}>
                  Go to Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <div className="data-table-state data-table-error">{error}</div>;
  }
  if (!data) return <div className="empty-state">No profile found.</div>;

  const banks = (data.banks as Array<Record<string, unknown>>) ?? [];
  const addresses = (data.addresses as Array<Record<string, unknown>>) ?? [];
  const emergencyContacts = (data.emergencyContacts as Array<Record<string, unknown>>) ?? [];
  const bank = banks[0] ?? {};
  const addr = addresses[0] ?? {};
  const fullName = String(data.full_name ?? 'My Profile');
  const dept = String(data.department_name ?? data.department ?? '');
  const position = String(data.position_name ?? data.position ?? '');
  const employeeCode = String(data.employee_code ?? '');

  return (
    <div>
      <PageHeader
        title="My Profile"
        subtitle="Your personal, employment and contact information."
        actions={
          !editing ? (
            <>
              <button type="button" className="btn-clay btn-clay-primary" onClick={startEdit}>
                <Icon icon={Icons.Edit} size="sm" /> Edit Profile
              </button>
              <Link
                to="/me/id-card"
                className="btn-clay btn-clay-secondary"
                style={{ marginLeft: 8 }}
              >
                <Icon icon={Icons.IdCard} size="sm" /> View ID Card
              </Link>
            </>
          ) : (
            <>
              <button type="button" className="btn-clay btn-clay-secondary" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-clay btn-clay-primary" onClick={save} disabled={saving} style={{ marginLeft: 8 }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          )
        }
      />

      {/* Hero card */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          background: 'linear-gradient(135deg, var(--primary) 0%, #1d4ed8 100%)',
          color: '#fff',
          border: 'none',
        }}
      >
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.22)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {initialsOf(fullName) || '👤'}
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.2 }}>{fullName}</div>
            <div style={{ opacity: 0.9, marginTop: 4, fontSize: '0.88rem' }}>
              {employeeCode && <span style={{ marginRight: 10 }}>{employeeCode}</span>}
              {dept}
              {dept && position ? ' · ' : ''}
              {position}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <StatusBadge value={String(data.status ?? 'active')} />
              {String(data.contract_type ?? '') && (
                <span
                  className="badge-soft"
                  style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                >
                  {String(data.contract_type)}
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: 16,
              flex: '1 1 300px',
              background: 'rgba(255,255,255,0.1)',
              padding: '12px 16px',
              borderRadius: 10,
            }}
          >
            {[
              { label: 'Joined', value: String(data.joining_date ?? '—') },
              { label: 'Contract End', value: String(data.contract_end_date ?? '—') },
              { label: 'Supervisor', value: String(data.supervisor_name ?? data.supervisor_id ?? '—') },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', opacity: 0.8, letterSpacing: 0.4 }}>{s.label}</div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent)' }}>
          <div className="card-header">
            <div className="card-title">
              <Icon icon={Icons.Edit} size="sm" />
              Editing Profile
            </div>
            <span className="badge-clay badge-clay-info">Changes apply immediately</span>
          </div>
          <div className="card-body">
            <div className="row">
              <div className="col">
                <EditField label="Mobile" value={empForm.mobile} onChange={(v) => setEmpForm({ ...empForm, mobile: v })} type="tel" placeholder="01XXXXXXXXX" />
              </div>
              <div className="col">
                <EditField label="Work Phone" value={empForm.work_phone} onChange={(v) => setEmpForm({ ...empForm, work_phone: v })} type="tel" />
              </div>
              <div className="col">
                <EditField label="WhatsApp" value={empForm.whatsapp} onChange={(v) => setEmpForm({ ...empForm, whatsapp: v })} type="tel" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="col">
                <div className="form-group">
                  <label>Marital Status</label>
                  <select className="form-control-clay" value={empForm.marital_status} onChange={(e) => setEmpForm({ ...empForm, marital_status: e.target.value })}>
                    <option value="">—</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                    <option value="widowed">Widowed</option>
                  </select>
                </div>
              </div>
              <div className="col">
                <EditField label="Blood Group" value={empForm.blood_group} onChange={(v) => setEmpForm({ ...empForm, blood_group: v })} placeholder="e.g. O+" />
              </div>
              <div className="col">
                <EditField label="NID / Passport" value={empForm.nid_passport} onChange={(v) => setEmpForm({ ...empForm, nid_passport: v })} />
              </div>
            </div>
            <hr style={{ margin: '18px 0', opacity: 0.15 }} />
            <div className="row">
              <div className="col">
                <EditField label="Bank Name" value={bankForm.bank_name} onChange={(v) => setBankForm({ ...bankForm, bank_name: v })} />
              </div>
              <div className="col">
                <EditField label="Account Name" value={bankForm.account_name} onChange={(v) => setBankForm({ ...bankForm, account_name: v })} />
              </div>
              <div className="col">
                <EditField label="Account Number" value={bankForm.account_number} onChange={(v) => setBankForm({ ...bankForm, account_number: v })} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="col">
                <EditField label="Branch" value={bankForm.branch} onChange={(v) => setBankForm({ ...bankForm, branch: v })} />
              </div>
              <div className="col">
                <EditField label="Routing Number" value={bankForm.routing_number} onChange={(v) => setBankForm({ ...bankForm, routing_number: v })} />
              </div>
              <div className="col">
                <EditField label="IBAN" value={bankForm.iban} onChange={(v) => setBankForm({ ...bankForm, iban: v })} />
              </div>
            </div>
            <hr style={{ margin: '18px 0', opacity: 0.15 }} />
            <div className="row">
              <div className="col">
                <EditField label="Address Line 1" value={addrForm.address_line1} onChange={(v) => setAddrForm({ ...addrForm, address_line1: v })} />
              </div>
              <div className="col">
                <EditField label="Address Line 2" value={addrForm.address_line2} onChange={(v) => setAddrForm({ ...addrForm, address_line2: v })} />
              </div>
              <div className="col">
                <EditField label="City" value={addrForm.city} onChange={(v) => setAddrForm({ ...addrForm, city: v })} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="col">
                <EditField label="District" value={addrForm.district} onChange={(v) => setAddrForm({ ...addrForm, district: v })} />
              </div>
              <div className="col">
                <EditField label="Thana" value={addrForm.thana} onChange={(v) => setAddrForm({ ...addrForm, thana: v })} />
              </div>
              <div className="col">
                <EditField label="State" value={addrForm.state} onChange={(v) => setAddrForm({ ...addrForm, state: v })} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="col">
                <EditField label="Postal / ZIP" value={addrForm.zip} onChange={(v) => setAddrForm({ ...addrForm, zip: v })} />
              </div>
              <div className="col">
                <EditField label="Country" value={addrForm.country} onChange={(v) => setAddrForm({ ...addrForm, country: v })} />
              </div>
            </div>
          </div>
        </div>
      )}

      <SectionCard title="Employment" icon={Icons.Briefcase}>
        <div className="row">
          <div className="col">
            <InfoField label="Department" value={dept || null} icon={Icons.Building} />
          </div>
          <div className="col">
            <InfoField label="Sub Department" value={String(data.sub_department_name ?? data.sub_department ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Position" value={position || null} icon={Icons.UserTie} />
          </div>
          <div className="col">
            <InfoField label="Employee Type" value={String(data.employee_type_name ?? data.employee_type ?? null)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="col">
            <InfoField label="Joining Date" value={String(data.joining_date ?? null)} icon={Icons.CalendarDays} />
          </div>
          <div className="col">
            <InfoField label="Contract Type" value={String(data.contract_type ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Contract End" value={String(data.contract_end_date ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Workplace" value={String(data.workplace ?? null)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Personal & Contact" icon={Icons.UserTie}>
        <div className="row">
          <div className="col">
            <InfoField label="Email" value={String(data.email ?? null)} icon={Icons.Globe} />
          </div>
          <div className="col">
            <InfoField label="Mobile" value={String(data.mobile ?? null)} icon={Icons.UserClock} />
          </div>
          <div className="col">
            <InfoField label="Date of Birth" value={String(data.date_of_birth ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Gender" value={String(data.gender ?? null)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="col">
            <InfoField label="Marital Status" value={String(data.marital_status ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Blood Group" value={String(data.blood_group ?? null)} />
          </div>
          <div className="col">
            <InfoField label="NID / Passport" value={String(data.nid_passport ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Work Phone" value={String(data.work_phone ?? null)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Bank Details" icon={Icons.SackDollar}>
        <div className="row">
          <div className="col">
            <InfoField label="Bank" value={String(bank.bank_name ?? bank.bank ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Account Name" value={String(bank.account_name ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Account Number" value={String(bank.account_number ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Branch" value={String(bank.branch ?? null)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="col">
            <InfoField label="Routing Number" value={String(bank.routing_number ?? null)} />
          </div>
          <div className="col">
            <InfoField label="IBAN" value={String(bank.iban ?? null)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Address" icon={Icons.MapLocationDot}>
        <div className="row">
          <div className="col">
            <InfoField label="Type" value={String(addr.type ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Address" value={String(addr.address_line1 ?? null)} />
          </div>
          <div className="col">
            <InfoField label="City" value={String(addr.city ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Country" value={String(addr.country ?? null)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="col">
            <InfoField label="District" value={String(addr.district ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Thana" value={String(addr.thana ?? null)} />
          </div>
          <div className="col">
            <InfoField label="State" value={String(addr.state ?? null)} />
          </div>
          <div className="col">
            <InfoField label="Postal / ZIP" value={String(addr.zip ?? null)} />
          </div>
        </div>
      </SectionCard>

      {emergencyContacts.length > 0 && (
        <SectionCard title="Emergency Contacts" icon={Icons.UserClock}>
          {emergencyContacts.map((c, i) => (
            <div key={i} className="row" style={{ marginBottom: 8 }}>
              <div className="col">
                <InfoField label="Name" value={String(c.name ?? c.full_name ?? null)} />
              </div>
              <div className="col">
                <InfoField label="Relationship" value={String(c.relationship ?? null)} />
              </div>
              <div className="col">
                <InfoField label="Phone" value={String(c.phone ?? c.phone_number ?? null)} />
              </div>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { hr } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { useCurrentUser } from '../../auth-context';
import { Icon, Icons } from '../../components/Icon';

interface IdCard {
  id: string;
  card_number: string;
  issued_date: string | null;
  expiry_date: string | null;
  employee_id: string;
  full_name?: string;
  employee_code?: string;
  department_name?: string;
  position_name?: string;
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export function MyIdCardPage(): ReactElement {
  const user = useCurrentUser();
  const [cards, setCards] = useState<IdCard[]>([]);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cardRes, meRes] = await Promise.allSettled([hr.idCards({}), hr.me()]);
      if (cardRes.status === 'fulfilled') setCards(cardRes.value.data as IdCard[]);
      if (meRes.status === 'fulfilled') setProfile(meRes.value.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ID card');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="data-table-state">Loading ID card…</div>;
  if (error) return <div className="data-table-state data-table-error">{error}</div>;

  const card = cards[0] ?? null;
  const fullName = String(profile?.full_name ?? card?.full_name ?? user?.fullName ?? '');
  const code = String(profile?.employee_code ?? card?.employee_code ?? '');
  const dept = String(profile?.department_name ?? card?.department_name ?? '');
  const position = String(profile?.position_name ?? card?.position_name ?? '');

  return (
    <div>
      <PageHeader title="My ID Card" subtitle="Your company ID details" />
      {!card ? (
        <div className="empty-state">No ID card has been issued for you yet.</div>
      ) : (
        <div style={{ maxWidth: 460, margin: '0 auto' }}>
          <div className="id-card-preview">
            <div className="id-card-preview-header">
              <div className="id-card-preview-org">SDI</div>
              <div className="id-card-preview-org-sub">STAFF IDENTITY CARD</div>
            </div>
            <div style={{ display: 'flex', gap: 16, padding: '18px 20px 14px', alignItems: 'center' }}>
              <div className="id-card-preview-avatar">
                {profile?.photo_url ? (
                  <img src={String(profile.photo_url)} alt={fullName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                ) : (
                  initialsOf(fullName) || '👤'
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }}>{fullName}</div>
                <div className="id-card-preview-label">Employee ID</div>
                <div className="id-card-preview-value">{code}</div>
              </div>
            </div>
            <div style={{ padding: '0 20px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div className="id-card-preview-label">Department</div>
                <div className="id-card-preview-value">{dept || '—'}</div>
              </div>
              <div>
                <div className="id-card-preview-label">Position</div>
                <div className="id-card-preview-value">{position || '—'}</div>
              </div>
            </div>
            <div className="id-card-preview-footer">
              <div>
                <div className="id-card-preview-label">Card No.</div>
                <div style={{ fontWeight: 800, letterSpacing: 1 }}>{card.card_number}</div>
              </div>
              <div>
                <div className="id-card-preview-label">Issued</div>
                <div>{card.issued_date ?? '—'}</div>
              </div>
              <div>
                <div className="id-card-preview-label">Expires</div>
                <div>{card.expiry_date ?? '—'}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => window.print()}>
              <Icon icon={Icons.Print} size="sm" /> Print ID Card
            </button>
            <a
              href={`/me/profile`}
              className="btn btn-outline"
            >
              <Icon icon={Icons.UserTie} size="sm" /> Update Profile
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
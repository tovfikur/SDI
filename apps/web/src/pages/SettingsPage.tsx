import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { API_BASE, files, hr, security } from '../api';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

interface Settings {
  id: string;
  company_title: string | null;
  support_email: string | null;
  support_phone: string | null;
  timezone: string | null;
  address: string | null;
  footer_text: string | null;
  currency: string | null;
  country: string | null;
  default_checkin_range: number | null;
  login_bg_url: string | null;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
const MAX_BYTES = 5 * 1024 * 1024;

const BG_PUBLIC_PATH = '/api/branding/background?file=';

function resolveBgUrl(stored: string | null | undefined): string | null {
  if (typeof stored !== 'string' || stored.trim() === '') return null;
  const s = stored.trim();
  if (s.includes(BG_PUBLIC_PATH)) return s;
  return /^https?:\/\//i.test(s) ? s : (s.startsWith('/') ? s : null);
}

function getMimeType(file: File): string {
  if (file.type && ACCEPTED_TYPES.has(file.type.toLowerCase())) {
    return file.type.toLowerCase();
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function SettingsPage(): ReactElement {
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [clearValue, setClearValue] = useState('');
  const [loginBgUrl, setLoginBgUrl] = useState<string>('');
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgError, setBgError] = useState('');
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await hr.settings();

      const statusRes = await security.deletePasswordStatus();
      setMustChangePassword(statusRes.data?.configured ?? false);
      const data = res.data as unknown as Settings;
      setForm({
        company_title: data.company_title ?? '',
        support_email: data.support_email ?? '',
        support_phone: data.support_phone ?? '',
        timezone: data.timezone ?? '',
        address: data.address ?? '',
        footer_text: data.footer_text ?? '',
        currency: data.currency ?? '',
        country: data.country ?? '',
        default_checkin_range: data.default_checkin_range != null ? String(data.default_checkin_range) : '',
      });
      const rawBg = data.login_bg_url ?? '';
      setLoginBgUrl(rawBg);
      const bgUrl = resolveBgUrl(rawBg);
      setBgPreview(
        bgUrl
          ? /^https?:\/\//i.test(bgUrl)
            ? bgUrl
            : `${API_BASE}${bgUrl}`
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSubmitting(true);
    setSaved(false);
    setError('');
    try {
      await hr.updateSettings({
        company_title: form.company_title || undefined,
        support_email: form.support_email || undefined,
        support_phone: form.support_phone || undefined,
        timezone: form.timezone || undefined,
        address: form.address || undefined,
        footer_text: form.footer_text || undefined,
        currency: form.currency || undefined,
        country: form.country || undefined,
        default_checkin_range: form.default_checkin_range ? Number(form.default_checkin_range) : undefined,
        login_bg_url: loginBgUrl.trim(),
      });
      setSaved(true);
      await load();
      toast('Settings saved successfully.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
      toast(e instanceof Error ? e.message : 'Failed to save settings', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadBg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ACCEPTED_EXT.test(file.name)) {
      setBgError('Only JPG, PNG or WebP images are allowed.');
      return;
    }
    const mime = getMimeType(file);
    if (file.size > MAX_BYTES) {
      setBgError('Image must be 5 MB or smaller.');
      return;
    }
    setBgError('');
    setBgUploading(true);
    try {
      const sess = await files.createUploadSession({
        module: 'settings',
        entity_type: 'login_bg',
        original_filename: file.name,
        mime_type: mime,
        size_bytes: file.size,
      });

      let uploadTarget = sess.upload_url;
      try {
        const parsed = new URL(sess.upload_url, window.location.origin);
        uploadTarget = parsed.pathname + parsed.search;
      } catch {
        // keep sess.upload_url
      }

      await new Promise<void>((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadTarget);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', mime);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            res();
            return;
          }
          let detail = '';
          const match = /<Message>([\s\S]*?)<\/Message>/i.exec(xhr.responseText ?? '');
          if (match?.[1]) detail = match[1].trim();
          rej(
            new Error(
              detail
                ? `Storage rejected the upload (HTTP ${xhr.status}): ${detail}`
                : `Upload failed (HTTP ${xhr.status}). Please retry.`
            )
          );
        };
        xhr.onerror = () => rej(new Error('Upload failed — check your connection and try again.'));
        xhr.send(file);
      });

      const confirmed = await files.confirmUpload(sess.session_id);
      const newBgPath = `${BG_PUBLIC_PATH}${confirmed.data.id}`;
      setLoginBgUrl(newBgPath);
      setBgPreview(`${API_BASE}${newBgPath}`);
      setSaved(false);

      // Auto-save the new background immediately so it takes effect right away
      await hr.updateSettings({ login_bg_url: newBgPath });
      toast('Login background uploaded and applied successfully!', 'success');
    } catch (err) {
      setBgError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBgUploading(false);
    }
  };

  const removeBg = async () => {
    setLoginBgUrl('');
    setBgPreview(null);
    setBgError('');
    setSaved(false);
    try {
      await hr.updateSettings({ login_bg_url: '' });
      toast('Login background removed.', 'info');
    } catch (err) {
      setBgError(err instanceof Error ? err.message : 'Failed to remove background');
    }
  };

  const resetAll = async () => {
    if (clearValue !== 'RESET') {
      setError('Type RESET to confirm wiping company settings.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await hr.updateSettings({
        company_title: '',
        support_email: '',
        support_phone: '',
        timezone: '',
        address: '',
        footer_text: '',
        currency: '',
        country: '',
        default_checkin_range: 0,
      });
      setSaved(true);
      await load();
      toast('Company settings reset.', 'info');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset settings');
      toast(e instanceof Error ? e.message : 'Failed to reset settings', 'error');
    } finally {
      setSubmitting(false);
      setModalOpen(false);
      setClearValue('');
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  return (
    <div>
      <div className="panel-clay" style={{ maxWidth: 900 }}>
        <div className="software-setup-header">
          <div>
            <h3 className="software-setup-title">Company Profile</h3>
            <p className="software-setup-subtitle">Company information and application preferences.</p>
          </div>
          <div className="data-table-actions">
            <button className="btn-clay btn-clay-secondary" onClick={() => setModalOpen(true)}>
              Reset
            </button>
            <button className="btn-clay btn-clay-primary" onClick={save} disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {loading && <div className="data-table-state">Loading settings...</div>}
        {error && <div className="data-table-state data-table-error">{error}</div>}
        {saved && <div className="form-help-text" style={{ color: 'var(--clay-success)', marginBottom: '0.5rem' }}>Settings saved.</div>}

        {!loading && !error && (
          <>
            <h3 className="form-section-title">Company</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Company Title</label>
                <input className="form-control-clay" value={form.company_title ?? ''} onChange={set('company_title')} placeholder="SDI" />
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <input className="form-control-clay" value={form.country ?? ''} onChange={set('country')} placeholder="Bangladesh" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-control-clay" value={form.currency ?? ''} onChange={set('currency')}>
                  <option value="">—</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="BDT">BDT — Bangladeshi Taka</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                  <option value="INR">INR — Indian Rupee</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <input className="form-control-clay" value={form.timezone ?? ''} onChange={set('timezone')} placeholder="Asia/Dhaka" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Support Email</label>
                <input type="email" className="form-control-clay" value={form.support_email ?? ''} onChange={set('support_email')} />
              </div>
              <div className="form-group">
                <label className="form-label">Support Phone</label>
                <input className="form-control-clay" value={form.support_phone ?? ''} onChange={set('support_phone')} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea className="form-control-clay" rows={2} value={form.address ?? ''} onChange={set('address')} />
            </div>

            <h3 className="form-section-title">Attendance</h3>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Default Check-in Range (minutes)</label>
                <input type="number" min={0} className="form-control-clay" value={form.default_checkin_range ?? ''} onChange={set('default_checkin_range')} />
              </div>
            </div>

            <h3 className="form-section-title">Appearance</h3>
            <div className="form-group">
              <label className="form-label">Footer Text</label>
              <input className="form-control-clay" value={form.footer_text ?? ''} onChange={set('footer_text')} placeholder="Powered by SDI" />
            </div>
            <div className="form-group">
              <label className="form-label">Login Background Image</label>
              {bgPreview ? (
                <div style={{ marginBottom: '0.75rem', position: 'relative', display: 'inline-block', width: '100%', maxWidth: 480 }}>
                  <img
                    src={bgPreview}
                    alt="Login background preview"
                    onError={() => setBgError('Could not load image from URL. Please check the URL or upload a new image.')}
                    style={{
                      width: '100%',
                      maxWidth: 480,
                      maxHeight: 180,
                      objectFit: 'cover',
                      borderRadius: '10px',
                      border: '1px solid var(--border-subtle)',
                      display: 'block',
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    width: '100%',
                    maxWidth: 480,
                    height: 110,
                    borderRadius: '10px',
                    border: '1px dashed var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-dim)',
                    fontSize: '0.85rem',
                    marginBottom: '0.75rem',
                    background: 'var(--surface-muted)',
                  }}
                >
                  No login background set
                </div>
              )}
              <div className="data-table-actions" style={{ justifyContent: 'flex-start', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-clay btn-clay-sm btn-clay-secondary"
                  disabled={bgUploading}
                  onClick={() => bgInputRef.current?.click()}
                >
                  {bgUploading ? 'Uploading...' : 'Upload Image'}
                </button>
                {loginBgUrl && (
                  <button type="button" className="btn-clay btn-clay-sm btn-clay-danger" onClick={() => void removeBg()}>
                    Remove
                  </button>
                )}
                <input
                  ref={bgInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  style={{ display: 'none' }}
                  onChange={(e) => void uploadBg(e)}
                />
              </div>
              <div className="form-group" style={{ maxWidth: 480, marginBottom: '0.5rem' }}>
                <label className="form-label" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Image URL / API Path
                </label>
                <input
                  type="text"
                  className="form-control-clay"
                  value={loginBgUrl}
                  placeholder="https://... or /api/branding/background?file=..."
                  onChange={(e) => {
                    const val = e.target.value;
                    setLoginBgUrl(val);
                    setBgPreview(val.trim() ? (/^https?:\/\//i.test(val) ? val.trim() : `${API_BASE}${val.trim()}`) : null);
                    setBgError('');
                    setSaved(false);
                  }}
                />
              </div>
              {bgError && <div className="form-error-text" style={{ marginTop: '0.25rem' }}>{bgError}</div>}
              <div className="form-help-text" style={{ marginTop: '0.5rem' }}>
                Recommended 1920×1080. JPG, PNG or WebP up to 5 MB, or enter a direct image URL. The image appears as the full-screen background on the login page.
              </div>
            </div>
                <h3 className="form-section-title">Security</h3>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Delete Password</label>
          <input
            className="form-control-clay"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="Enter delete password"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <button
            className="btn-clay btn-clay-primary"
            onClick={() => {
              security.setDeletePassword(deletePassword);
              setMustChangePassword(true);
            }}
            disabled={submitting}
          >
            {submitting ? 'Setting...' : 'Set Delete Password'}
          </button>
          {mustChangePassword && <span className="form-help-text" style={{color: 'var(--clay-success)'}}>
            Password set. You will be required to enter it for admin deletes.
          </span>}
        </div>
      </div></>
        )}
      </div>

      <Modal title="Reset Settings" open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={resetAll} submitting={submitting} submitLabel="Reset" danger>
        <p>
          This will clear all company profile fields. Type <strong>RESET</strong> to confirm.
        </p>
        <input className="form-control-clay" value={clearValue} onChange={(e) => setClearValue(e.target.value)} placeholder="RESET" />
      </Modal>
    </div>
  );
}
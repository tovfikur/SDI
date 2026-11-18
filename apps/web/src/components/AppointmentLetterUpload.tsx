import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { files } from '../api';
import { Icon, Icons } from './Icon';

export interface LetterFile {
  file_id: string;
  filename: string;
}

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ACCEPTED_EXT = /\.(pdf|doc|docx)$/i;
const MAX_BYTES = 10 * 1024 * 1024;

function typeError(name: string): string {
  return `${name} is not a supported file type. Only PDF, DOC or DOCX files are allowed.`;
}

function sizeError(): string {
  return 'File exceeds the 10MB limit.';
}

/** Uploads a single file through the session+confirm pipeline with progress. */
function uploadFile(
  file: File,
  onProgress: (pct: number) => void
): Promise<{ file_id: string; filename: string }> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const sess = await files.createUploadSession({
          module: 'hr',
          entity_type: 'employee_appointment_letter',
          original_filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        });

        await new Promise<void>((res, rej) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', sess.upload_url);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? res() : rej(new Error(`Upload failed (${xhr.status})`)));
          xhr.onerror = () => rej(new Error('Upload failed — check your connection and try again.'));
          xhr.send(file);
        });

        const confirmed = await files.confirmUpload(sess.session_id);
        resolve({ file_id: confirmed.data.id, filename: confirmed.data.original_filename });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Upload failed'));
      }
    })();
  });
}

/** Read-only view/download action for an already-confirmed file reference. */
export function LetterFileView({
  fileId,
  filename,
}: {
  fileId: string;
  filename?: string | null;
}): ReactElement {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await files.fileDownload(fileId);
      window.open(res.data.url, '_blank');
    } catch {
      window.alert('Unable to open the file. Please try again.');
    } finally {
      setOpening(false);
    }
  };
  return (
    <button type="button" className="file-uploader-open" onClick={() => void open()} disabled={opening}>
      <Icon icon={Icons.FileLines} size="sm" />
      <span>{filename || 'Appointment Letter'}</span>
    </button>
  );
}

/**
 * Premium appointment-letter uploader backed by the file-session infra.
 * Validates PDF/DOC/DOCX up to 10MB, streams with progress, then persists
 * the confirmed file id via onChange.
 */
export function AppointmentLetterUpload({
  value,
  onChange,
  error,
  disabled = false,
}: {
  value: LetterFile | null;
  onChange: (v: LetterFile | null) => void;
  error?: string;
  disabled?: boolean;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');

  const pick = () => {
    if (disabled) return;
    setUploadError('');
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_EXT.test(file.name)) {
      setUploadError(typeError(file.name));
      return;
    }
    if (file.type && ACCEPTED_TYPES.size > 0 && !ACCEPTED_TYPES.has(file.type)) {
      setUploadError(typeError(file.name));
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError(sizeError());
      return;
    }

    setProgress(0);
    setUploadError('');
    try {
      const result = await uploadFile(file, setProgress);
      onChange(result);
      setProgress(null);
    } catch (err) {
      setProgress(null);
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  };

  const shownError = error || uploadError;

  return (
    <div className={`file-uploader${shownError ? ' file-uploader-invalid' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        className="file-uploader-input"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(e) => void handleChange(e)}
        disabled={disabled}
      />

      {value ? (
        <div className="file-uploader-chip">
          <span className="file-uploader-chip-icon">
            <Icon icon={Icons.FileLines} />
          </span>
          <span className="file-uploader-chip-main">
            <span className="file-uploader-chip-name" title={value.filename}>
              {value.filename}
            </span>
            <span className="file-uploader-chip-hint">Appointment Letter · PDF/DOC/DOCX · max 10MB</span>
          </span>
          <span className="file-uploader-chip-actions">
            <LetterFileView fileId={value.file_id} filename={value.filename} />
            <button type="button" className="btn-clay btn-clay-sm btn-clay-secondary" onClick={pick} disabled={disabled}>
              <Icon icon={Icons.Refresh} size="xs" /> Replace
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              title="Remove"
              onClick={() => onChange(null)}
              disabled={disabled}
            >
              <Icon icon={Icons.Trash} />
            </button>
          </span>
        </div>
      ) : (
        <button type="button" className="file-uploader-drop" onClick={pick} disabled={disabled || progress !== null}>
          {progress !== null ? (
            <span className="file-uploader-progress">
              <span className="file-uploader-progress-track">
                <span className="file-uploader-progress-fill" style={{ width: `${progress}%` }} />
              </span>
              <span className="file-uploader-progress-label">Uploading… {progress}%</span>
            </span>
          ) : (
            <>
              <Icon icon={Icons.Upload} size="lg" />
              <span>
                <strong>Upload Appointment Letter</strong>
                <small>PDF, DOC or DOCX · max 10MB</small>
              </span>
            </>
          )}
        </button>
      )}

      {shownError && <div className="form-error-text">{shownError}</div>}
    </div>
  );
}
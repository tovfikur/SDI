import type { ReactElement } from 'react';
import { Icon, Icons } from '../../components/Icon';
import type { IconDefinition } from '../../components/Icon';
import { useTheme } from '../../theme-context';
import type { ThemePreference } from '../../theme-context';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
  icon: IconDefinition;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Bright and crisp',
    icon: Icons.Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Easy on the eyes',
    icon: Icons.Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follows your device',
    icon: Icons.Desktop,
  },
];

export function AppearancePage(): ReactElement {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div>
      <div className="software-setup-header">
        <div>
          <div className="software-setup-title">Appearance</div>
          <div className="software-setup-subtitle">
            Choose how SDI looks on this device.
          </div>
        </div>
      </div>

      <div className="panel-clay" style={{ maxWidth: 620 }}>
        <div className="glass-panel-title" style={{ marginBottom: '0.35rem' }}>
          Theme
        </div>
        <div className="glass-panel-subtitle" style={{ marginBottom: '1rem' }}>
          Pick a theme or let SDI follow your device&apos;s preferred color scheme.
        </div>

        <div className="theme-options">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`theme-option${active ? ' active' : ''}`}
                onClick={() => setTheme(opt.value)}
                aria-pressed={active}
              >
                <span className="theme-option-icon">
                  <Icon icon={opt.icon} />
                </span>
                <span className="theme-option-label">{opt.label}</span>
                <span className="theme-option-desc">{opt.description}</span>
                <span className="theme-option-check">
                  {active && <Icon icon={Icons.Check} size="xs" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="theme-resolved-hint">
          Currently displaying:{' '}
          <span className="badge-clay badge-clay-info">
            {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
          </span>
          {theme === 'system' && <span style={{ marginLeft: '0.5rem' }}>(System)</span>}
        </div>
      </div>
    </div>
  );
}
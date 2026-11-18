import type { CSSProperties } from 'react';

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** App-default project accent (the blue used before customization existed). */
export const DEFAULT_PROJECT_ACCENT = '#2563eb';

export interface ProjectColorPreset {
  name: string;
  card: string;
  text: string;
}

/** Palette offered in Create/Edit Project ("Project Color"). */
export const PROJECT_COLOR_PRESETS: ProjectColorPreset[] = [
  { name: 'Blue', card: '#1e3a8a', text: '#eff6ff' },
  { name: 'Green', card: '#166534', text: '#f0fdf4' },
  { name: 'Red', card: '#b91c1c', text: '#fef2f2' },
  { name: 'Orange', card: '#c2410c', text: '#fff7ed' },
  { name: 'Purple', card: '#6d28d9', text: '#f5f3ff' },
  { name: 'Teal', card: '#0f766e', text: '#f0fdfa' },
  { name: 'Slate', card: '#334155', text: '#f8fafc' },
];

export function isValidHex(v: unknown): boolean {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

/**
 * Per-project custom card colors. Returns undefined unless at least one value
 * is valid hex, so projects without customization keep default CSS styling.
 */
export function projectCardStyle(
  cardColor?: string | null,
  textColor?: string | null
): CSSProperties | undefined {
  const bg = typeof cardColor === 'string' ? cardColor.trim() : '';
  const fg = typeof textColor === 'string' ? textColor.trim() : '';
  const hasBg = HEX_RE.test(bg);
  const hasFg = HEX_RE.test(fg);
  if (!hasBg && !hasFg) return undefined;
  return {
    ...(hasBg ? { background: bg } : {}),
    ...(hasFg
      ? { color: fg, '--text-dim': fg, '--text-main': fg } as CSSProperties
      : {}),
  };
}

/** Saved project color, falling back to the app-default blue. */
export function projectAccent(cardColor?: string | null): string {
  const v = typeof cardColor === 'string' ? cardColor.trim() : '';
  return HEX_RE.test(v) ? v : DEFAULT_PROJECT_ACCENT;
}

const hasBg = (cardColor?: string | null): boolean =>
  typeof cardColor === 'string' && HEX_RE.test(cardColor.trim());

/**
 * Progress bar fill inside a project card. On a custom-colored card the fill
 * follows the card's text color; otherwise it uses the project accent
 * (saved color, or app-default blue).
 */
export function projectProgressStyle(
  cardColor?: string | null,
  textColor?: string | null,
  pct?: number | null
): CSSProperties {
  const width = `${Math.max(0, Math.min(100, Number(pct ?? 0)))}%`;
  if (hasBg(cardColor)) {
    const fg = typeof textColor === 'string' ? textColor.trim() : '';
    return { width, background: HEX_RE.test(fg) ? fg : 'rgba(255,255,255,0.92)' };
  }
  return { width, background: projectAccent(cardColor) };
}

/**
 * Percentage badge inside a project card: solid project accent on default
 * cards, translucent chip matching the card text on custom-colored cards.
 */
export function projectBadgeStyle(
  cardColor?: string | null,
  textColor?: string | null
): CSSProperties {
  if (hasBg(cardColor)) {
    const fg = typeof textColor === 'string' ? textColor.trim() : '';
    return {
      background: 'rgba(255,255,255,0.18)',
      color: HEX_RE.test(fg) ? fg : '#ffffff',
      borderColor: 'transparent',
    };
  }
  return {
    background: projectAccent(cardColor),
    color: '#ffffff',
    borderColor: 'transparent',
  };
}

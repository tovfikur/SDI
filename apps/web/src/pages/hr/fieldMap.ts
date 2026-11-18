/**
 * Shared Leaflet bits for field-tracking maps: custom CSS pins (no external
 * marker images needed) and a default view for the org area (Dhaka).
 */

import L from 'leaflet';

export const DEFAULT_MAP_CENTER: [number, number] = [23.8103, 90.4125];
export const DEFAULT_MAP_ZOOM = 12;

export function coloredPin(color: string, label?: string): L.DivIcon {
  return L.divIcon({
    className: 'field-map-pin',
    html: `<div class="field-map-pin-dot" style="background:${color}">${label ?? ''}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

export function isValidCoordinate(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function formatSeen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)} min ago`;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatClock(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

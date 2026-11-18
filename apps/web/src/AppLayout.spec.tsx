import { render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { router } from './router';

describe('AppLayout (SPA shell)', () => {
  it('renders the SDI login branding when unauthenticated', async () => {
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Self Development Initiatives')).toBeTruthy();
    expect(screen.getAllByText('SDI').length).toBeGreaterThan(0);
    expect(await screen.findByText('Username')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });
});
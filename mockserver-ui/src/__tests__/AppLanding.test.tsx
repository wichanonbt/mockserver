import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useDashboardStore } from '../store';

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connect: vi.fn(),
    start: vi.fn(),
    sendFilter: vi.fn(),
    clearServer: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../hooks/useDebugMismatch', () => ({ useDebugMismatch: () => ({ debugMismatch: null }) }));
vi.mock('../hooks/useGenerateStub', () => ({ useGenerateStub: () => ({ generateStub: null }) }));
vi.mock('../components/AppBar', () => ({ default: () => <header data-testid="app-bar" />, NAV_TAB_DESCRIPTIONS: {} }));
vi.mock('../components/MockManagementView', () => ({
  default: () => <div data-testid="manage-view" />,
}));
vi.mock('../components/OnboardingPanel', () => ({ default: () => <div data-testid="onboarding" /> }));

import App from '../App';

describe('dashboard landing', () => {
  beforeEach(() => {
    useDashboardStore.setState({ connectionStatus: 'connected', view: 'get-started', error: null });
  });
  afterEach(() => {
    globalThis.location.hash = '';
  });

  it('shows the mock catalog at /mockserver/dashboard with no hash', async () => {
    globalThis.location.hash = '';
    render(<App />);
    expect(await screen.findByTestId('manage-view')).toBeInTheDocument();
    expect(screen.queryByTestId('app-bar')).not.toBeInTheDocument();
  });

  it('shows the operator console when the hash names a view', async () => {
    globalThis.location.hash = '#/dashboard';
    render(<App />);
    expect(await screen.findByTestId('app-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-view')).not.toBeInTheDocument();
  });

  it('shows the operator console at #/manage', async () => {
    globalThis.location.hash = '#/manage';
    render(<App />);
    expect(await screen.findByTestId('app-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-view')).not.toBeInTheDocument();
  });
});

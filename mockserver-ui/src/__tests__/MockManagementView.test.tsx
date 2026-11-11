import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import MockManagementView from '../components/MockManagementView';
import { buildTheme } from '../theme';
import { useDashboardStore } from '../store';
import type { JsonListItem } from '../types';

const params = { host: '127.0.0.1', port: '1080', secure: false };

function expectation(id: string, value: Record<string, unknown>): JsonListItem {
  return { key: id, value: { id, ...value } };
}

function renderView() {
  return render(
    <ThemeProvider theme={buildTheme('light')}>
      <MockManagementView connectionParams={params} />
    </ThemeProvider>,
  );
}

describe('MockManagementView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    localStorage.removeItem('mockserver-manage-groups');
    useDashboardStore.setState({
      activeExpectations: [
        expectation('found', {
          priority: 5,
          httpRequest: {
            method: 'GET',
            path: '/users/{id}',
            pathParameters: { id: ['12345'] },
          },
          httpResponse: {
            statusCode: 200,
            body: { status: 'success' },
            delay: { timeUnit: 'MILLISECONDS', value: 50 },
          },
        }),
        expectation('miss', {
          priority: 0,
          httpRequest: { method: 'GET', path: '/users/{id}' },
          httpResponse: { statusCode: 404, body: { error: 'Not Found' } },
        }),
        expectation('charge', {
          httpRequest: { method: 'PUT', path: '/charge' },
          httpForward: { host: 'payments.internal', port: 443, scheme: 'HTTPS' },
        }),
      ],
      connectionStatus: 'connected',
      notification: null,
    });
  });

  it('shows groups on the central dashboard and opens a scenario', async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.getByRole('heading', { name: 'Central Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Operator dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Users/ })).toBeInTheDocument();
    expect(screen.getByText('1 Mock Active')).toBeInTheDocument();
    expect(screen.getByText('All Real API')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Users/ }));

    expect(screen.getByLabelText('Path')).toHaveValue('/users/{id}');
    expect(screen.getByRole('button', { name: /^OK · id/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Response body')).toHaveValue('{\n  "status": "success"\n}');

    await user.click(screen.getByRole('button', { name: 'Unmatched fallback' }));
    expect(screen.getByLabelText('Fallback body')).toHaveValue('{\n  "error": "Not Found"\n}');
  });

  it('sends a live request from Try It after opening a mock', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith('/mockserver/status')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ ports: [1080] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"status":"success"}',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /Users/ }));
    await user.click(screen.getByRole('button', { name: 'Try It' }));

    expect(screen.getByTestId('live-response-widget')).toBeInTheDocument();
    expect(screen.getByLabelText('Live request path')).toHaveValue('/users/12345');

    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getByTestId('try-it-result')).toBeInTheDocument());

    const liveCall = fetchMock.mock.calls.find(([url]) => !String(url).endsWith('/mockserver/status'));
    expect(liveCall).toBeDefined();
    expect(String(liveCall?.[0])).toBe('http://127.0.0.1:1080/users/12345');
    const result = screen.getByTestId('try-it-result');
    expect(result).toHaveTextContent('200 OK');
    expect(result).toHaveTextContent('{"status":"success"}');
  });

  it('keeps the saved truncated scenario after switching away and back', async () => {
    const fullBody = '{"status":"success","payload":"' + 'x'.repeat(200) + '"}';
    useDashboardStore.setState({
      activeExpectations: [
        {
          key: 'big',
          value: {
            id: 'big',
            httpRequest: { method: 'GET', path: '/big' },
            httpResponse: { statusCode: 200, body: '{"cut":true}' },
          },
          truncatedExpectation: { expectationId: 'big', part: 'expectation', originalLength: fullBody.length, shownLength: 12 },
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/mockserver/retrieve')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{
            id: 'big',
            httpRequest: { method: 'GET', path: '/big' },
            httpResponse: { statusCode: 200, body: fullBody },
          }],
        } as unknown as Response;
      }
      if (href.endsWith('/mockserver/expectation')) {
        return { ok: true, status: 201, json: async () => ([]), text: async () => '' } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
    }));

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /Big/ }));
    await waitFor(() => expect(screen.getByLabelText('Response body')).toHaveValue(fullBody));

    const edited = fullBody.replace('"success"', '"saved"');
    fireEvent.change(screen.getByLabelText('Response body'), { target: { value: edited } });
    await user.click(screen.getByRole('button', { name: 'Save Mock' }));
    await waitFor(() => expect(useDashboardStore.getState().notification?.message).toBe('Mock saved'));

    await user.click(screen.getByRole('button', { name: 'Unmatched fallback' }));
    await user.click(screen.getByRole('button', { name: /OK 200 OK/ }));
    expect(JSON.parse((screen.getByLabelText('Response body') as HTMLTextAreaElement).value)).toEqual(JSON.parse(edited));
  });

  it('does not save the deleted scenario over a remaining one', async () => {
    useDashboardStore.setState((state) => ({
      activeExpectations: [
        ...state.activeExpectations,
        expectation('created', {
          priority: 4,
          httpRequest: { method: 'GET', path: '/users/{id}' },
          httpResponse: { statusCode: 201, body: { status: 'created' } },
        }),
      ],
    }));
    let saved: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('/mockserver/clear')) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
      }
      if (href.endsWith('/mockserver/expectation')) {
        saved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return { ok: true, status: 201, json: async () => ([]), text: async () => '' } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: /Users/ }));
    expect(screen.getByLabelText('Response body')).toHaveValue('{\n  "status": "success"\n}');

    await user.click(screen.getByRole('button', { name: 'Delete OK · id' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/mockserver/clear'))).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete scenario' })).not.toBeInTheDocument());

    act(() => {
      useDashboardStore.setState((state) => ({
        activeExpectations: state.activeExpectations.filter((item) => item.key !== 'found'),
      }));
    });
    await waitFor(() => expect(screen.getByLabelText('Response body')).toHaveValue('{\n  "status": "created"\n}'));

    await user.click(screen.getByRole('button', { name: 'Save Mock' }));
    await waitFor(() => expect(useDashboardStore.getState().notification?.message).toBe('Mock saved'));

    expect(saved).toBeDefined();
    expect(saved?.id).toBe('created');
    expect((saved?.httpResponse as Record<string, unknown> | undefined)?.body).toEqual({ status: 'created' });
  });
});

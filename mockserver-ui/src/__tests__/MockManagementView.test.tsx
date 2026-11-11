import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getAllByRole('button', { name: 'New Group' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Open group Users' })).toBeInTheDocument();
    expect(screen.getByText('1 Mock Active')).toBeInTheDocument();
    expect(screen.getByText('All Real API')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open group Users' }));

    expect(screen.queryByRole('button', { name: 'New Group' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Open group Users' }));
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
    expect(screen.getByRole('dialog', { name: 'Try It' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Try It' }));
    expect(screen.queryByTestId('live-response-widget')).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Open group Big' }));
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
    await user.click(screen.getByRole('button', { name: 'Open group Users' }));
    expect(screen.getByLabelText('Response body')).toHaveValue('{\n  "status": "success"\n}');

    await user.click(screen.getByRole('button', { name: 'Delete OK · id' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/mockserver/clear'))).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete scenario' })).not.toBeInTheDocument());
    expect(useDashboardStore.getState().activeExpectations.some((item) => item.key === 'found')).toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Response body')).toHaveValue('{\n  "status": "created"\n}'));

    await user.click(screen.getByRole('button', { name: 'Save Mock' }));
    await waitFor(() => expect(useDashboardStore.getState().notification?.message).toBe('Mock saved'));

    expect(saved).toBeDefined();
    expect(saved?.id).toBe('created');
    expect((saved?.httpResponse as Record<string, unknown> | undefined)?.body).toEqual({ status: 'created' });
  });

  it('opens a new mock without showing Try It until the button is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.endsWith('/mockserver/expectation')) {
          return { ok: true, status: 201, json: async () => ([]), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'New API Mock' }));
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/created' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(useDashboardStore.getState().notification?.message).toBe('Mock created'));

    act(() => {
      useDashboardStore.setState((state) => ({
        activeExpectations: [
          ...state.activeExpectations,
          expectation('new-mock', {
            httpRequest: { method: 'GET', path: '/created' },
            httpResponse: { statusCode: 200, body: {} },
          }),
        ],
      }));
    });

    await waitFor(() => expect(screen.getByLabelText('Path')).toHaveValue('/created'));
    expect(screen.queryByTestId('live-response-widget')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Try It' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try It' }));
    expect(screen.getByTestId('live-response-widget')).toBeInTheDocument();
  });

  it('returns to the catalog after deleting the last scenario of an endpoint', async () => {
    useDashboardStore.setState({
      activeExpectations: [
        expectation('solo', {
          httpRequest: { method: 'GET', path: '/solo' },
          httpResponse: { statusCode: 200, body: { ok: true } },
        }),
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href.includes('/mockserver/clear')) {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Open group Solo' }));
    await user.click(screen.getByRole('button', { name: 'Delete OK' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Central Dashboard' })).toBeInTheDocument());
    expect(useDashboardStore.getState().activeExpectations).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /GET \/solo/ })).not.toBeInTheDocument();
    expect(useDashboardStore.getState().notification?.message).toBe('Scenario deleted');
  });

  it('registers a grouped mock with x-mockserver-group so the same path can live in two groups', async () => {
    let saved: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith('/mockserver/expectation')) {
          saved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          return { ok: true, status: 201, json: async () => ([]), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderView();
    await user.click(within(screen.getByTestId('manage-home')).getByRole('button', { name: 'New Group' }));
    await user.type(screen.getByLabelText('Group name'), 'Payments');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New group' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New API Mock' }));
    await user.click(screen.getByLabelText('Group'));
    await user.click(await screen.findByRole('option', { name: 'Payments' }));
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/hello' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(saved).toBeDefined());
    expect(saved?.httpRequest).toMatchObject({
      method: 'GET',
      path: '/hello',
      headers: { 'x-mockserver-group': ['Payments'] },
    });
  });

  it('deletes a group and every mock in it', async () => {
    useDashboardStore.setState({
      activeExpectations: [
        expectation('pay', {
          httpRequest: {
            method: 'GET',
            path: '/hello',
            headers: { 'x-mockserver-group': ['Payments'] },
          },
          httpResponse: { statusCode: 200, body: {} },
        }),
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/mockserver/clear')) {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderView();
    expect(screen.getByRole('button', { name: 'Open group Payments' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete group Payments' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(useDashboardStore.getState().activeExpectations).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Open group Payments' })).not.toBeInTheDocument();
    expect(useDashboardStore.getState().notification?.message).toBe('Group Payments deleted');
  });

  it('warns when a catch-all scenario shadows the proxy fallback', async () => {
    useDashboardStore.setState({
      activeExpectations: [
        expectation('ok', {
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'] },
          },
          httpResponse: { statusCode: 200, body: {} },
        }),
        expectation('fwd', {
          priority: -10,
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'] },
          },
          httpForward: { host: 'google.com', port: 443, scheme: 'HTTPS' },
        }),
      ],
    });

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Open group Lab 1' }));
    await user.click(screen.getByRole('button', { name: 'Unmatched fallback' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'OK matches every GET /health in this group, so this fallback never runs',
    );
  });

  it('warns when an equal-priority fallback matches before a header rule', async () => {
    useDashboardStore.setState({
      activeExpectations: [
        expectation('fwd', {
          priority: 1,
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'] },
          },
          httpForward: { host: 'google.com', port: 443, scheme: 'HTTPS' },
        }),
        expectation('hit', {
          priority: 1,
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'], a: ['.*1.*'] },
          },
          httpResponse: { statusCode: 200, body: {} },
        }),
      ],
    });

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Open group Lab 1' }));
    expect(screen.getByRole('status')).toHaveTextContent('unmatched fallback has the same or higher priority');

    await user.click(screen.getByRole('button', { name: 'Unmatched fallback' }));
    expect(screen.getByRole('status')).toHaveTextContent('same or higher priority as a scenario');
  });

  it('pins an equal-priority fallback below the scenario on save so the header rule keeps matching', async () => {
    useDashboardStore.setState({
      activeExpectations: [
        expectation('fwd', {
          priority: 1,
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'] },
          },
          httpForward: { host: 'google.com', port: 443, scheme: 'HTTPS' },
        }),
        expectation('hit', {
          priority: 1,
          httpRequest: {
            method: 'GET',
            path: '/health',
            headers: { 'x-mockserver-group': ['Lab 1'], a: ['1'] },
          },
          httpResponse: { statusCode: 200, body: {} },
        }),
      ],
    });
    const saved: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith('/mockserver/expectation')) {
          saved.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
          return { ok: true, status: 201, json: async () => ([]), text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ ports: [1080] }), text: async () => '' } as unknown as Response;
      }),
    );

    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Open group Lab 1' }));
    await user.click(screen.getByRole('button', { name: 'Save Mock' }));
    await waitFor(() => expect(saved.length).toBeGreaterThanOrEqual(2));
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hit', priority: 1 }),
      expect.objectContaining({ id: 'fwd', priority: -10, httpForward: expect.objectContaining({ host: 'google.com' }) }),
    ]));
  });
});

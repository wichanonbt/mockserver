import { describe, expect, it } from 'vitest';
import type { JsonListItem } from '../types';
import {
  applyFallbackDraft,
  applyScenarioDraft,
  buildCatalog,
  classifyMatcher,
  nextScenarioPriority,
  draftFromScenario,
  encodeMatcher,
  forwardFromUrl,
  groupIdForPath,
  GROUP_HEADER,
  ensureGroupHeader,
  newResponseExpectation,
  retargetExpectation,
} from './mockCatalog';

function item(key: string, value: Record<string, unknown>): JsonListItem {
  return { key, value };
}

describe('mockCatalog', () => {
  it('groups by the first real path segment, skipping api and version prefixes', () => {
    expect(groupIdForPath('/api/v1/users/{id}')).toBe('users');
    expect(groupIdForPath('/charge')).toBe('charge');
    const groups = buildCatalog([
      item('a', {
        id: 'a',
        httpRequest: { method: 'GET', path: '/api/v1/users/{id}', pathParameters: { id: ['12345'] } },
        httpResponse: { statusCode: 200, body: { id: '12345' } },
      }),
      item('b', {
        id: 'b',
        priority: -10,
        httpRequest: { method: 'PUT', path: '/charge' },
        httpForward: { host: 'payments.internal', port: 443, scheme: 'HTTPS' },
      }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['charge', 'users']);
    const users = groups.find((g) => g.id === 'users');
    expect(users?.endpoints[0]).toMatchObject({ method: 'GET', path: '/api/v1/users/{id}', active: true });
    expect(users?.endpoints[0]?.scenarios[0]?.rules[0]).toMatchObject({ kind: 'pathParam', key: 'id', op: 'equals', value: '12345' });
    expect(groups.find((g) => g.id === 'charge')?.endpoints[0]?.fallback).toMatchObject({
      mode: 'proxy',
      upstream: 'https://payments.internal',
    });
    expect(groups.find((g) => g.id === 'charge')?.endpoints[0]?.scenarios).toEqual([]);
  });

  it('treats a lower-priority unconditional response as the fallback', () => {
    const groups = buildCatalog([
      item('hit', {
        id: 'hit',
        priority: 5,
        httpRequest: { method: 'GET', path: '/users/{id}', pathParameters: { id: ['1'] } },
        httpResponse: { statusCode: 200, body: '{}' },
      }),
      item('miss', {
        id: 'miss',
        priority: 0,
        httpRequest: { method: 'GET', path: '/users/{id}' },
        httpResponse: { statusCode: 404, body: '{"error":"Not Found"}' },
      }),
    ]);
    const endpoint = groups[0]?.endpoints[0];
    expect(endpoint?.scenarios.map((s) => s.id)).toEqual(['hit']);
    expect(endpoint?.fallback).toMatchObject({ mode: 'mock', statusCode: 404, id: 'miss' });
  });

  it('gives a new scenario a higher priority than an equal-priority catch-all forward', () => {
    const groups = buildCatalog([
      item('fwd', {
        id: 'fwd',
        priority: 1,
        httpRequest: { method: 'GET', path: '/health', headers: { [GROUP_HEADER]: ['Lab 1'] } },
        httpForward: { host: 'google.com', port: 443, scheme: 'HTTPS' },
      }),
      item('hit', {
        id: 'hit',
        priority: 1,
        httpRequest: {
          method: 'GET',
          path: '/health',
          headers: { [GROUP_HEADER]: ['Lab 1'], a: ['.*1.*'] },
        },
        httpResponse: { statusCode: 200, body: {} },
      }),
    ]);
    const endpoint = groups[0]?.endpoints[0];
    expect(endpoint?.fallback).toMatchObject({ id: 'fwd', mode: 'proxy', priority: 1 });
    expect(endpoint?.scenarios.map((s) => s.id)).toEqual(['hit']);
    expect(nextScenarioPriority(endpoint!)).toBe(2);
  });

  it('forces a previously equal-priority forward down to unmatched priority on save', () => {
    const saved = applyFallbackDraft(
      { id: 'fwd', priority: 1, httpRequest: { method: 'GET', path: '/health' } },
      { mode: 'proxy', upstream: 'https://google.com', statusCode: 404, body: '' },
      'GET',
      '/health',
    );
    expect(saved).toMatchObject({ id: 'fwd', priority: -10 });
  });

  it('leaves an OpenAPI-only expectation out of the catalog', () => {
    expect(buildCatalog([item('spec', { specUrlOrPayload: 'https://example.com/openapi.json' })])).toEqual([]);
  });

  it('round-trips an equals path parameter and a seconds delay', () => {
    expect(classifyMatcher(encodeMatcher('contains', 'abc'))).toEqual({ op: 'contains', value: 'abc' });
    expect(classifyMatcher('12345')).toEqual({ op: 'equals', value: '12345' });
    const groups = buildCatalog([
      item('d', {
        id: 'd',
        priority: 2,
        httpRequest: { method: 'GET', path: '/users/{id}', cookies: { session: 'abc' } },
        httpResponse: {
          statusCode: 200,
          body: '{"ok":true}',
          delay: { timeUnit: 'SECONDS', value: 1 },
        },
        times: { remainingTimes: 0, unlimited: false },
      }),
    ]);
    const scenario = groups[0]?.endpoints[0]?.scenarios[0];
    expect(scenario).toMatchObject({ delayMs: 1000, active: false, statusCode: 200 });
    const saved = applyScenarioDraft(
      scenario!.raw,
      { ...draftFromScenario(scenario!), statusCode: 201, delayMs: 50, active: true },
      'GET',
      '/users/{id}',
    );
    expect(saved).toMatchObject({
      id: 'd',
      priority: 2,
      httpRequest: { method: 'GET', path: '/users/{id}', cookies: { session: 'abc' } },
      httpResponse: { statusCode: 201, delay: { timeUnit: 'MILLISECONDS', value: 50 } },
      times: { remainingTimes: 0, unlimited: false },
    });
    expect(saved).not.toHaveProperty('httpError');
  });

  it('builds a proxy fallback and a new response expectation', () => {
    expect(forwardFromUrl('https://api-sit.internal.com/api/v1/users')).toEqual({
      host: 'api-sit.internal.com',
      port: 443,
      scheme: 'HTTPS',
    });
    const saved = applyFallbackDraft(undefined, {
      mode: 'proxy',
      upstream: 'https://api-sit.internal.com/users',
      statusCode: 404,
      body: '',
    }, 'GET', '/users/{id}');
    expect(saved).toMatchObject({
      priority: -10,
      httpForward: { host: 'api-sit.internal.com', port: 443, scheme: 'HTTPS' },
    });
    expect(newResponseExpectation('POST', '/users')).toMatchObject({
      httpRequest: { method: 'POST', path: '/users' },
      httpResponse: { statusCode: 200 },
    });
    expect(newResponseExpectation('GET', '/hello', 0, 'Payments')).toMatchObject({
      httpRequest: {
        method: 'GET',
        path: '/hello',
        headers: { [GROUP_HEADER]: ['Payments'] },
      },
    });
  });

  it('keeps the same path in separate groups when x-mockserver-group differs', () => {
    const groups = buildCatalog([
      item('pay', {
        id: 'pay',
        httpRequest: { method: 'GET', path: '/hello', headers: { [GROUP_HEADER]: ['Payments'] } },
        httpResponse: { statusCode: 200, body: { from: 'payments' } },
      }),
      item('ord', {
        id: 'ord',
        httpRequest: { method: 'GET', path: '/hello', headers: { [GROUP_HEADER]: ['Orders'] } },
        httpResponse: { statusCode: 201, body: { from: 'orders' } },
      }),
    ]);
    expect(groups.map((g) => g.name).sort()).toEqual(['Orders', 'Payments']);
    expect(groups.find((g) => g.id === 'payments')?.endpoints[0]?.path).toBe('/hello');
    expect(groups.find((g) => g.id === 'orders')?.endpoints[0]?.scenarios[0]?.statusCode).toBe(201);
    expect(groups.find((g) => g.id === 'payments')?.endpoints[0]?.id).not.toBe(
      groups.find((g) => g.id === 'orders')?.endpoints[0]?.id,
    );
  });

  it('pins a group header rule without duplicating it', () => {
    const once = ensureGroupHeader([], 'Payments');
    expect(once).toEqual([expect.objectContaining({ kind: 'header', key: GROUP_HEADER, op: 'equals', value: 'Payments' })]);
    expect(ensureGroupHeader(once, 'Payments')).toHaveLength(1);
    expect(ensureGroupHeader(once, undefined)).toEqual([]);
  });

  it('marks a conditional forward as advanced-only and leaves it unchanged on save', () => {
    const raw = {
      id: 'fwd',
      httpRequest: { method: 'GET', path: '/users/{id}', headers: { 'X-Tenant': ['acme'] } },
      httpForward: { host: 'users.internal', port: 443, scheme: 'HTTPS' },
    };
    const scenario = buildCatalog([item('fwd', raw)])[0]?.endpoints[0]?.scenarios[0];
    expect(scenario?.advancedOnly).toBe(true);
    expect(applyScenarioDraft(raw, draftFromScenario(scenario!), 'GET', '/users/{id}')).toEqual(raw);
  });

  it('keeps unmodelled httpResponse fields when saving a scenario', () => {
    const raw = {
      id: 'cookie',
      httpRequest: { method: 'GET', path: '/session' },
      httpResponse: {
        statusCode: 200,
        reasonPhrase: 'OK',
        cookies: { session: 'abc' },
        body: '{"ok":true}',
      },
    };
    const scenario = buildCatalog([item('cookie', raw)])[0]?.endpoints[0]?.scenarios[0];
    const saved = applyScenarioDraft(
      raw,
      { ...draftFromScenario(scenario!), statusCode: 201 },
      'GET',
      '/session',
    );
    expect(saved['httpResponse']).toMatchObject({
      statusCode: 201,
      reasonPhrase: 'OK',
      cookies: { session: 'abc' },
    });
  });

  it('retargets method and path without rewriting the action', () => {
    const raw = {
      id: 't',
      httpRequest: { method: 'GET', path: '/old' },
      httpResponseTemplate: { templateType: 'MUSTACHE', template: '{{ x }}' },
    };
    expect(retargetExpectation(raw, 'POST', '/new')).toMatchObject({
      httpRequest: { method: 'POST', path: '/new' },
      httpResponseTemplate: { template: '{{ x }}' },
    });
    expect(buildCatalog([item('t', raw)])[0]?.endpoints[0]?.scenarios[0]?.advancedOnly).toBe(true);
  });
});

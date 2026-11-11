import { afterEach, describe, expect, it } from 'vitest';
import { operatorDashboardHref, operatorDashboardRequested, mockCatalogHref } from './dashboardRoute';

describe('dashboardRoute', () => {
  afterEach(() => {
    globalThis.location.hash = '';
  });

  it('treats an empty hash as the mock catalog', () => {
    globalThis.location.hash = '';
    expect(operatorDashboardRequested()).toBe(false);
  });

  it('treats a ViewMode hash as the operator console', () => {
    globalThis.location.hash = '#/traffic';
    expect(operatorDashboardRequested()).toBe(true);
  });

  it('treats #/manage as the operator console', () => {
    globalThis.location.hash = '#/manage';
    expect(operatorDashboardRequested()).toBe(true);
  });

  it('ignores an unknown hash', () => {
    globalThis.location.hash = '#/not-a-view';
    expect(operatorDashboardRequested()).toBe(false);
  });

  it('builds catalog and operator hrefs under the SPA base', () => {
    expect(mockCatalogHref()).toMatch(/\/$/);
    expect(operatorDashboardHref()).toMatch(/manage$/);
  });
});

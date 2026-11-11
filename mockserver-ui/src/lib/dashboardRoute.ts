import { coerceView } from '../store';

/** Path segment under `/mockserver/dashboard/` for the AppBar operator console. */
export const OPERATOR_DASHBOARD_SEGMENT = 'manage';

function dashboardBase(): string {
  const base = import.meta.env.BASE_URL || '/mockserver/dashboard/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** Landing URL for the grouped mock catalog (no view hash). */
export function mockCatalogHref(): string {
  return dashboardBase();
}

/** URL of the previous dashboard (AppBar + 21 views). */
export function operatorDashboardHref(): string {
  return `${dashboardBase()}${OPERATOR_DASHBOARD_SEGMENT}`;
}

/**
 * True when the URL asks for the AppBar operator console rather than the catalog.
 * `/mockserver/dashboard/manage`, `#/manage`, and any `#/<ViewMode>` deep link
 * (so existing bookmarks such as `#/traffic` keep working).
 */
export function operatorDashboardRequested(): boolean {
  try {
    const path = globalThis.location?.pathname ?? '';
    if (/\/mockserver\/dashboard\/manage\/?$/.test(path)) return true;
    const hash = (globalThis.location?.hash ?? '').replace(/^#\/?/, '');
    if (!hash) return false;
    if (hash === OPERATOR_DASHBOARD_SEGMENT) return true;
    return coerceView(hash) != null;
  } catch {
    return false;
  }
}

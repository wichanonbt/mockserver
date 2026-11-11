/**
 * Groups active HTTP expectations the way the Manage view shows them:
 * a service (`x-mockserver-group` header, else the first path segment), an
 * endpoint (method + path inside that group), then scenarios and one
 * lower-priority fallback for requests none of those scenarios match.
 */
import type { JsonListItem } from '../types';

export type MatchKind = 'pathParam' | 'header' | 'query' | 'body';
export type MatchOp = 'equals' | 'regex' | 'contains';
export type ScenarioAction = 'response' | 'forward' | 'error' | 'other';

export interface MatchRule {
  id: string;
  kind: MatchKind;
  key: string;
  op: MatchOp;
  value: string;
  /** Original wire value when a string op/value pair cannot represent it. */
  wire?: unknown;
}

export interface HeaderRow {
  name: string;
  value: string;
}

export interface ScenarioModel {
  id: string;
  itemKey: string;
  title: string;
  action: ScenarioAction;
  statusCode: number;
  headers: HeaderRow[];
  body: string;
  delayMs: number;
  dropConnection: boolean;
  priority: number;
  active: boolean;
  rules: MatchRule[];
  /** Template, callback, or other action this editor must not rewrite. */
  advancedOnly: boolean;
  truncated: boolean;
  raw: Record<string, unknown>;
}

export interface FallbackModel {
  id?: string;
  itemKey?: string;
  mode: 'proxy' | 'mock';
  upstream: string;
  statusCode: number;
  body: string;
  truncated: boolean;
  /** Match priority of the stored fallback expectation. Higher wins; unmatched fallbacks are -10. */
  priority?: number;
  raw?: Record<string, unknown>;
}

export interface EndpointModel {
  id: string;
  method: string;
  path: string;
  /** Set when every expectation on the endpoint shares a non-string path matcher. */
  pathWire?: unknown;
  active: boolean;
  scenarios: ScenarioModel[];
  fallback?: FallbackModel;
}

export interface GroupModel {
  id: string;
  name: string;
  endpoints: EndpointModel[];
}

export interface NamedGroup {
  id: string;
  name: string;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved',
  302: 'Found',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusText(code: number): string {
  return STATUS_TEXT[code] ?? '';
}

const GROUPS_KEY = 'mockserver-manage-groups';

export function loadNamedGroups(): NamedGroup[] {
  try {
    const raw = globalThis.localStorage?.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is NamedGroup =>
      !!g && typeof g === 'object' && typeof (g as NamedGroup).id === 'string' && typeof (g as NamedGroup).name === 'string');
  } catch {
    return [];
  }
}

export function saveNamedGroups(groups: NamedGroup[]): void {
  try {
    globalThis.localStorage?.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Preference only — a full or blocked store must not block editing mocks.
  }
}

export function slugGroupId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'group';
}

/** Request header that selects which catalog group a mock belongs to. */
export const GROUP_HEADER = 'x-mockserver-group';

export function isGroupHeaderRule(rule: MatchRule): boolean {
  return rule.kind === 'header' && rule.key.toLowerCase() === GROUP_HEADER;
}

export function groupHeaderValue(rules: MatchRule[]): string | undefined {
  const value = rules.find(isGroupHeaderRule)?.value.trim();
  return value || undefined;
}

/** Keep exactly one `x-mockserver-group` equals rule when a group name is set. */
export function ensureGroupHeader(rules: MatchRule[], groupName: string | undefined): MatchRule[] {
  const without = rules.filter((item) => !isGroupHeaderRule(item));
  if (!groupName?.trim()) return without;
  return [rule('header', GROUP_HEADER, 'equals', groupName.trim()), ...without];
}

export function groupIdForPath(path: string): string {
  const parts = path.split('/').filter(Boolean).map((p) => p.replace(/[{}]/g, ''));
  while (parts.length > 1 && /^(v\d+|api)$/i.test(parts[0] ?? '')) parts.shift();
  return (parts[0] || 'root').toLowerCase();
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function pathText(path: unknown): string {
  if (typeof path === 'string') return path;
  if (isRecord(path)) {
    if (typeof path['value'] === 'string') return path['value'];
    if (typeof path['regex'] === 'string') return path['regex'];
  }
  return '';
}

function methodText(method: unknown): string {
  if (typeof method === 'string' && method.trim()) return method.trim().toUpperCase();
  if (isRecord(method) && typeof method['value'] === 'string' && method['value'].trim()) {
    return method['value'].trim().toUpperCase();
  }
  return 'GET';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMeta(s: string): boolean {
  return /[.*+?^${}()|[\]\\]/.test(s);
}

function unescapeRegex(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

export function encodeMatcher(op: MatchOp, value: string): string {
  if (op === 'regex') return value;
  if (op === 'contains') return `.*${escapeRegex(value)}.*`;
  if (hasMeta(value)) return `^${escapeRegex(value)}$`;
  return value;
}

export function classifyMatcher(raw: string): { op: MatchOp; value: string } {
  if (raw.startsWith('.*') && raw.endsWith('.*') && raw.length >= 4) {
    const inner = raw.slice(2, -2);
    const unescaped = unescapeRegex(inner);
    if (escapeRegex(unescaped) === inner) return { op: 'contains', value: unescaped };
  }
  if (!hasMeta(raw)) return { op: 'equals', value: raw };
  const anchored = /^\^([\s\S]*)\$$/.exec(raw);
  if (anchored) {
    const unescaped = unescapeRegex(anchored[1] ?? '');
    if (escapeRegex(unescaped) === anchored[1]) return { op: 'equals', value: unescaped };
  }
  return { op: 'regex', value: raw };
}

let ruleSeq = 0;
function nextRuleId(): string {
  ruleSeq += 1;
  return `rule-${ruleSeq}`;
}

function rule(kind: MatchKind, key: string, op: MatchOp, value: string, wire?: unknown): MatchRule {
  return { id: nextRuleId(), kind, key, op, value, wire };
}

function matcherText(value: unknown): { op: MatchOp; value: string; wire?: unknown } {
  if (typeof value === 'string') return { ...classifyMatcher(value) };
  if (value == null) return { op: 'equals', value: '' };
  return { op: 'regex', value: JSON.stringify(value), wire: value };
}

function readMultiMap(input: unknown, kind: MatchKind): MatchRule[] {
  const out: MatchRule[] = [];
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!isRecord(entry) || typeof entry['name'] !== 'string') continue;
      const values = Array.isArray(entry['values']) ? entry['values'] : [];
      for (const value of values) {
        const m = matcherText(value);
        out.push(rule(kind, entry['name'], m.op, m.value, m.wire));
      }
    }
    return out;
  }
  if (!isRecord(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      const m = matcherText(item);
      out.push(rule(kind, key, m.op, m.value, m.wire));
    }
  }
  return out;
}

function tryObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readBody(body: unknown): MatchRule[] {
  if (body == null) return [];
  if (typeof body === 'string') {
    const obj = tryObject(body);
    if (obj && Object.values(obj).every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
      return Object.entries(obj).map(([key, value]) => rule('body', key, 'equals', String(value)));
    }
    return [rule('body', '$', 'regex', body)];
  }
  if (!isRecord(body)) return [rule('body', '$', 'regex', JSON.stringify(body), body)];
  const type = typeof body['type'] === 'string' ? body['type'] : '';
  if (type === 'JSON_PATH' && typeof body['jsonPath'] === 'string') {
    return [rule('body', body['jsonPath'], 'regex', body['jsonPath'])];
  }
  if ((type === 'REGEX' || typeof body['regex'] === 'string') && typeof body['regex'] === 'string') {
    const m = classifyMatcher(body['regex']);
    return [rule('body', 'body', m.op, m.value)];
  }
  if (type === 'STRING' && typeof body['string'] === 'string') {
    return [rule('body', '$', 'regex', body['string'])];
  }
  const json = typeof body['json'] === 'string' ? tryObject(body['json']) ?? body['json'] : body['json'];
  if (isRecord(json) && Object.values(json).every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
    return Object.entries(json).map(([key, value]) => rule('body', key, 'equals', String(value)));
  }
  if (!type && Object.values(body).every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
    return Object.entries(body).map(([key, value]) => rule('body', key, 'equals', String(value)));
  }
  return [rule('body', '$', 'regex', JSON.stringify(body), body)];
}

function readRules(req: Record<string, unknown>): MatchRule[] {
  return [
    ...readMultiMap(req['pathParameters'], 'pathParam'),
    ...readMultiMap(req['headers'], 'header'),
    ...readMultiMap(req['queryStringParameters'], 'query'),
    ...readBody(req['body']),
  ];
}

function delayMsOf(container: unknown): number {
  if (!isRecord(container) || !isRecord(container['delay'])) return 0;
  const delay = container['delay'];
  const value = typeof delay['value'] === 'number' ? delay['value'] : Number(delay['value']);
  if (!Number.isFinite(value)) return 0;
  const unit = typeof delay['timeUnit'] === 'string' ? delay['timeUnit'] : 'MILLISECONDS';
  switch (unit) {
    case 'SECONDS': return value * 1000;
    case 'MINUTES': return value * 60_000;
    case 'HOURS': return value * 3_600_000;
    case 'MICROSECONDS': return value / 1000;
    case 'NANOSECONDS': return value / 1_000_000;
    default: return value;
  }
}

function isActiveTimes(times: unknown): boolean {
  if (!isRecord(times)) return true;
  if (times['unlimited'] === true) return true;
  if (typeof times['remainingTimes'] === 'number') return times['remainingTimes'] > 0;
  return true;
}

function readHeaders(headers: unknown): HeaderRow[] {
  if (Array.isArray(headers)) {
    const rows: HeaderRow[] = [];
    for (const entry of headers) {
      if (!isRecord(entry) || typeof entry['name'] !== 'string') continue;
      const values = Array.isArray(entry['values']) ? entry['values'] : [];
      for (const value of values) rows.push({ name: entry['name'], value: String(value) });
    }
    return rows;
  }
  if (!isRecord(headers)) return [];
  const rows: HeaderRow[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) rows.push({ name, value: String(item) });
  }
  return rows;
}

function bodyToText(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function actionOf(exp: Record<string, unknown>): ScenarioAction {
  if ('httpResponse' in exp) return 'response';
  if ('httpError' in exp) return 'error';
  if ('httpForward' in exp) return 'forward';
  return 'other';
}

function forwardToUrl(fwd: unknown): string {
  if (!isRecord(fwd)) return '';
  const scheme = String(fwd['scheme'] ?? 'HTTP').toUpperCase() === 'HTTPS' ? 'https' : 'http';
  const host = typeof fwd['host'] === 'string' ? fwd['host'] : '';
  if (!host) return '';
  const port = typeof fwd['port'] === 'number' ? fwd['port'] : Number(fwd['port']);
  const defaultPort = scheme === 'https' ? 443 : 80;
  const portPart = Number.isFinite(port) && port !== defaultPort ? `:${port}` : '';
  return `${scheme}://${host}${portPart}`;
}

function scenarioTitle(action: ScenarioAction, statusCode: number, rules: MatchRule[], drop: boolean): string {
  if (action === 'error' && drop) return 'Connection drop';
  if (action === 'forward') return 'Forward to upstream';
  if (action === 'other') return 'Custom action';
  const phrase = statusText(statusCode) || `HTTP ${statusCode}`;
  const first = rules.find((item) => !isGroupHeaderRule(item));
  return first ? `${phrase} · ${first.key}` : phrase;
}

interface ParsedExpectation {
  id: string;
  itemKey: string;
  method: string;
  path: string;
  pathWire?: unknown;
  priority: number;
  extra: boolean;
  action: ScenarioAction;
  scenario: ScenarioModel;
  forwardUrl: string;
}

function parseItem(item: JsonListItem): ParsedExpectation | undefined {
  const raw = item.value;
  if (!isRecord(raw) || !isRecord(raw['httpRequest'])) return undefined;
  const req = raw['httpRequest'];
  const path = pathText(req['path']);
  if (!path) return undefined;
  const response = isRecord(raw['httpResponse']) ? raw['httpResponse'] : undefined;
  const error = isRecord(raw['httpError']) ? raw['httpError'] : undefined;
  const action = actionOf(raw);
  const rules = readRules(req);
  const statusCode = action === 'response' && typeof response?.['statusCode'] === 'number'
    ? response['statusCode']
    : 200;
  const drop = error?.['dropConnection'] === true;
  const id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : item.key;
  const scenario: ScenarioModel = {
    id,
    itemKey: item.key,
    title: scenarioTitle(action, statusCode, rules, drop),
    action,
    statusCode,
    headers: readHeaders(response?.['headers']),
    body: bodyToText(response?.['body']),
    delayMs: delayMsOf(response ?? error),
    dropConnection: drop,
    priority: typeof raw['priority'] === 'number' ? raw['priority'] : 0,
    active: isActiveTimes(raw['times']),
    rules,
    advancedOnly: action === 'other' || action === 'forward' || (action === 'error' && !drop),
    truncated: !!item.truncatedExpectation,
    raw,
  };
  return {
    id,
    itemKey: item.key,
    method: methodText(req['method']),
    path,
    pathWire: typeof req['path'] === 'string' ? undefined : req['path'],
    priority: scenario.priority,
    extra: rules.some((item) => !isGroupHeaderRule(item)),
    action,
    scenario,
    forwardUrl: action === 'forward' ? forwardToUrl(raw['httpForward']) : '',
  };
}

function lowest(items: ParsedExpectation[]): ParsedExpectation | undefined {
  return items.reduce<ParsedExpectation | undefined>((best, item) => {
    if (!best || item.priority < best.priority) return item;
    return best;
  }, undefined);
}

/**
 * A plain forward, or a response with no extra matchers whose priority is below
 * every conditional scenario, is the unmatched fallback. Specific scenarios stay
 * in the list so a catch-all does not hide them.
 */
function pickFallback(items: ParsedExpectation[]): ParsedExpectation | undefined {
  const forward = lowest(items.filter((item) => item.action === 'forward' && !item.extra));
  if (forward) return forward;
  const conditional = items.filter((item) => item.extra);
  if (conditional.length === 0) return undefined;
  const maxPriority = Math.max(...conditional.map((item) => item.priority));
  return lowest(items.filter((item) => !item.extra && item.action === 'response' && item.priority < maxPriority));
}

function toFallback(item: ParsedExpectation): FallbackModel {
  return {
    id: item.id,
    itemKey: item.itemKey,
    mode: item.action === 'forward' ? 'proxy' : 'mock',
    upstream: item.forwardUrl,
    statusCode: item.action === 'response' ? item.scenario.statusCode : 404,
    body: item.action === 'response' ? item.scenario.body : '{\n  "error": "Not Found"\n}',
    truncated: item.scenario.truncated,
    priority: item.priority,
    raw: item.scenario.raw,
  };
}

/** Next scenario priority: one above every existing scenario and the unmatched fallback. */
export function nextScenarioPriority(endpoint: Pick<EndpointModel, 'scenarios' | 'fallback'>): number {
  return Math.max(
    0,
    ...endpoint.scenarios.map((item) => item.priority),
    endpoint.fallback?.priority ?? Number.NEGATIVE_INFINITY,
  ) + 1;
}

export function scenarioFromValue(value: Record<string, unknown>, key = 'loaded'): ScenarioModel | undefined {
  return parseItem({ key, value })?.scenario;
}

function groupRef(rules: MatchRule[], path: string, names: NamedGroup[]): { id: string; name: string } {
  const headerName = groupHeaderValue(rules);
  if (headerName) {
    const id = slugGroupId(headerName);
    const named = names.find((item) => item.id === id || item.name === headerName);
    return { id, name: named?.name ?? headerName };
  }
  const id = groupIdForPath(path);
  const named = names.find((item) => item.id === id);
  return { id, name: named?.name ?? titleCase(id) };
}

export function buildCatalog(items: JsonListItem[], names: NamedGroup[] = []): GroupModel[] {
  const byEndpoint = new Map<string, ParsedExpectation[]>();
  const groupOf = new Map<string, { id: string; name: string }>();
  for (const item of items) {
    const parsed = parseItem(item);
    if (!parsed) continue;
    const group = groupRef(parsed.scenario.rules, parsed.path, names);
    const id = endpointId(parsed.method, parsed.path, group.id);
    const list = byEndpoint.get(id) ?? [];
    list.push(parsed);
    byEndpoint.set(id, list);
    groupOf.set(id, group);
  }

  const groups = new Map<string, GroupModel>();
  const nameById = new Map(names.map((g) => [g.id, g.name]));
  for (const named of names) {
    groups.set(named.id, { id: named.id, name: named.name, endpoints: [] });
  }

  for (const [id, parsed] of byEndpoint) {
    const first = parsed[0];
    if (!first) continue;
    const ref = groupOf.get(id) ?? groupRef(first.scenario.rules, first.path, names);
    const group = groups.get(ref.id) ?? {
      id: ref.id,
      name: nameById.get(ref.id) ?? ref.name,
      endpoints: [],
    };
    const fallbackParsed = pickFallback(parsed);
    const scenarios = parsed
      .filter((item) => item !== fallbackParsed)
      .map((item) => item.scenario)
      .sort((a, b) => b.priority - a.priority);
    const pathWires = parsed.map((item) => item.pathWire);
    const pathWire = pathWires.every((w) => JSON.stringify(w) === JSON.stringify(pathWires[0])) ? pathWires[0] : undefined;
    group.endpoints.push({
      id,
      method: first.method,
      path: first.path,
      pathWire,
      active: scenarios.some((s) => s.active && (s.action === 'response' || s.action === 'error')),
      scenarios,
      fallback: fallbackParsed ? toFallback(fallbackParsed) : undefined,
    });
    groups.set(ref.id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      endpoints: [...group.endpoints].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findEndpoint(groups: GroupModel[], endpointId: string): { group: GroupModel; endpoint: EndpointModel } | undefined {
  for (const group of groups) {
    const endpoint = group.endpoints.find((item) => item.id === endpointId);
    if (endpoint) return { group, endpoint };
  }
  return undefined;
}

function writeMatcher(item: MatchRule): unknown {
  if (item.wire !== undefined && item.op === 'regex' && JSON.stringify(item.wire) === item.value) return item.wire;
  return encodeMatcher(item.op, item.value);
}

function writeMultiMap(rules: MatchRule[], kind: MatchKind): Record<string, unknown[]> | undefined {
  const relevant = rules.filter((r) => r.kind === kind && r.key.trim());
  if (relevant.length === 0) return undefined;
  const out: Record<string, unknown[]> = {};
  for (const item of relevant) {
    const list = out[item.key] ?? [];
    list.push(writeMatcher(item));
    out[item.key] = list;
  }
  return out;
}

function coerceScalar(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function writeBody(rules: MatchRule[]): unknown {
  const bodyRules = rules.filter((r) => r.kind === 'body' && (r.key.trim() || r.value.trim()));
  if (bodyRules.length === 0) return undefined;
  const only = bodyRules.length === 1 ? bodyRules[0] : undefined;
  if (only?.wire !== undefined && only.op === 'regex' && JSON.stringify(only.wire) === only.value) return only.wire;
  if (bodyRules.every((r) => r.op === 'equals')) {
    const json: Record<string, unknown> = {};
    for (const item of bodyRules) json[item.key] = coerceScalar(item.value);
    return { type: 'JSON', json: JSON.stringify(json), matchType: 'ONLY_MATCHING_FIELDS' };
  }
  const first = bodyRules[0];
  if (!first) return undefined;
  if (first.op === 'regex' && (first.key.startsWith('$') || first.key.includes('.'))) {
    return { type: 'JSON_PATH', jsonPath: first.key === '$' ? first.value : first.key };
  }
  return { type: 'REGEX', regex: encodeMatcher(first.op, first.value) };
}

function writeHeaders(rows: HeaderRow[]): Record<string, string[]> | undefined {
  const filled = rows.filter((row) => row.name.trim());
  if (filled.length === 0) return undefined;
  const out: Record<string, string[]> = {};
  for (const row of filled) {
    const list = out[row.name] ?? [];
    list.push(row.value);
    out[row.name] = list;
  }
  return out;
}

function delayOf(ms: number): Record<string, unknown> | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return { timeUnit: 'MILLISECONDS', value: Math.round(ms) };
}

function responseBody(text: string, previous: unknown): unknown {
  if (bodyToText(previous) === text) return previous;
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export function blankRule(kind: MatchKind = 'pathParam'): MatchRule {
  return rule(kind, '', 'equals', '');
}

export interface ScenarioDraft {
  statusCode: number;
  headers: HeaderRow[];
  body: string;
  delayMs: number;
  dropConnection: boolean;
  priority: number;
  active: boolean;
  rules: MatchRule[];
}

export function draftFromScenario(scenario: ScenarioModel): ScenarioDraft {
  return {
    statusCode: scenario.statusCode || 200,
    headers: scenario.headers.map((row) => ({ ...row })),
    body: scenario.body,
    delayMs: scenario.delayMs,
    dropConnection: scenario.dropConnection,
    priority: scenario.priority,
    active: scenario.active,
    rules: scenario.rules.map((item) => ({ ...item })),
  };
}

/** Patch a stored expectation with the scenario form. Leaves template/callback actions untouched. */
export function applyScenarioDraft(
  raw: Record<string, unknown>,
  draft: ScenarioDraft,
  method: string,
  path: string,
  pathWire?: unknown,
): Record<string, unknown> {
  const action = actionOf(raw);
  if (action !== 'response' && !(action === 'error' && draft.dropConnection)) return raw;
  const next = structuredClone(raw);
  const req = isRecord(next['httpRequest']) ? { ...next['httpRequest'] } : {};
  req['method'] = method;
  req['path'] = pathWire !== undefined && pathText(pathWire) === path ? pathWire : path;
  const pathParameters = writeMultiMap(draft.rules, 'pathParam');
  const headers = writeMultiMap(draft.rules, 'header');
  const query = writeMultiMap(draft.rules, 'query');
  const body = writeBody(draft.rules);
  if (pathParameters) req['pathParameters'] = pathParameters; else delete req['pathParameters'];
  if (headers) req['headers'] = headers; else delete req['headers'];
  if (query) req['queryStringParameters'] = query; else delete req['queryStringParameters'];
  if (body !== undefined) req['body'] = body; else delete req['body'];
  next['httpRequest'] = req;
  delete next['httpForward'];
  delete next['httpError'];
  delete next['httpResponse'];
  const delay = delayOf(draft.delayMs);
  if (draft.dropConnection) {
    next['httpError'] = { dropConnection: true, ...(delay ? { delay } : {}) };
  } else {
    const previousResponse = isRecord(raw['httpResponse']) ? { ...raw['httpResponse'] } : {};
    const previousBody = previousResponse['body'];
    const response: Record<string, unknown> = { ...previousResponse, statusCode: draft.statusCode };
    const responseHeaders = writeHeaders(draft.headers);
    if (responseHeaders) response['headers'] = responseHeaders;
    else delete response['headers'];
    if (draft.body !== '' || previousBody !== undefined) response['body'] = responseBody(draft.body, previousBody);
    else delete response['body'];
    if (delay) response['delay'] = delay;
    else delete response['delay'];
    next['httpResponse'] = response;
  }
  next['priority'] = draft.priority;
  return next;
}

export interface FallbackDraft {
  mode: 'proxy' | 'mock';
  upstream: string;
  statusCode: number;
  body: string;
}

export function draftFromFallback(fallback: FallbackModel | undefined): FallbackDraft {
  return {
    mode: fallback?.mode ?? 'proxy',
    upstream: fallback?.upstream ?? '',
    statusCode: fallback?.statusCode ?? 404,
    body: fallback?.body ?? '{\n  "error": "Not Found"\n}',
  };
}

export function forwardFromUrl(url: string): Record<string, unknown> {
  const parsed = new URL(url);
  const scheme = parsed.protocol === 'https:' ? 'HTTPS' : 'HTTP';
  const port = parsed.port ? Number(parsed.port) : scheme === 'HTTPS' ? 443 : 80;
  return { host: parsed.hostname, port, scheme };
}

export function applyFallbackDraft(
  raw: Record<string, unknown> | undefined,
  draft: FallbackDraft,
  method: string,
  path: string,
  groupName?: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = raw ? structuredClone(raw) : {};
  const req = isRecord(next['httpRequest']) ? { ...next['httpRequest'] } : {};
  req['method'] = method;
  req['path'] = path;
  delete req['pathParameters'];
  delete req['queryStringParameters'];
  delete req['body'];
  if (groupName?.trim()) req['headers'] = { [GROUP_HEADER]: [groupName.trim()] };
  else delete req['headers'];
  next['httpRequest'] = req;
  delete next['httpResponse'];
  delete next['httpError'];
  delete next['httpForward'];
  delete next['httpResponseTemplate'];
  delete next['httpForwardTemplate'];
  const priority = typeof next['priority'] === 'number' && next['priority'] < 0 ? next['priority'] : -10;
  next['priority'] = priority;
  next['times'] = { unlimited: true };
  if (draft.mode === 'proxy') {
    next['httpForward'] = forwardFromUrl(draft.upstream);
  } else {
    const previous = isRecord(raw?.['httpResponse']) ? { ...raw['httpResponse'] } : {};
    next['httpResponse'] = {
      ...previous,
      statusCode: draft.statusCode,
      headers: previous['headers'] ?? { 'Content-Type': ['application/json'] },
      body: responseBody(draft.body, previous['body']),
    };
  }
  return next;
}

export function newResponseExpectation(method: string, path: string, priority = 0, groupName?: string): Record<string, unknown> {
  const httpRequest: Record<string, unknown> = { method, path };
  if (groupName?.trim()) httpRequest['headers'] = { [GROUP_HEADER]: [groupName.trim()] };
  return {
    priority,
    httpRequest,
    httpResponse: {
      statusCode: 200,
      headers: { 'Content-Type': ['application/json'] },
      body: '{\n  \n}',
    },
    times: { unlimited: true },
  };
}

/** Change only the request method and path, leaving the action and matchers as they are. */
export function retargetExpectation(
  raw: Record<string, unknown>,
  method: string,
  path: string,
  pathWire?: unknown,
): Record<string, unknown> {
  const next = structuredClone(raw);
  const req = isRecord(next['httpRequest']) ? { ...next['httpRequest'] } : {};
  req['method'] = method;
  req['path'] = pathWire !== undefined && pathText(pathWire) === path ? pathWire : path;
  next['httpRequest'] = req;
  return next;
}

export function endpointId(method: string, path: string, groupId = ''): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const core = `${method.trim().toUpperCase()} ${normalised}`;
  return groupId ? `${groupId} ${core}` : core;
}

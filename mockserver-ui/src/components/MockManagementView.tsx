import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { ThemeProvider } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import HomeIcon from '@mui/icons-material/Home';
import PeopleIcon from '@mui/icons-material/People';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import type { ConnectionParams } from '../hooks/useConnectionParams';
import LiveResponseWidget from './LiveResponseWidget';
import { fetchAuditEntries, type AuditEntry } from '../lib/audit';
import { humanizeError } from '../lib/errorMessage';
import { deleteExpectation, fetchExpectation } from '../lib/expectations';
import { registerExpectation } from '../lib/generateStub';
import {
  applyFallbackDraft,
  applyScenarioDraft,
  blankRule,
  buildCatalog,
  draftFromFallback,
  draftFromScenario,
  endpointId,
  ensureGroupHeader,
  findEndpoint,
  groupHeaderValue,
  groupIdForPath,
  isGroupHeaderRule,
  loadNamedGroups,
  newResponseExpectation,
  nextScenarioPriority,
  retargetExpectation,
  saveNamedGroups,
  scenarioFromValue,
  slugGroupId,
  statusText,
  type EndpointModel,
  type FallbackDraft,
  type GroupModel,
  type MatchKind,
  type MatchRule,
  type NamedGroup,
  type ScenarioDraft,
  type ScenarioModel,
} from '../lib/mockCatalog';
import { buildTheme, monospaceFontFamily } from '../theme';
import { useDashboardStore } from '../store';
import ConfirmDialog from './ConfirmDialog';

const SIDEBAR = '#0f172a';
const SIDEBAR_EDGE = '#1e293b';
const BRAND = '#0284c7';
const BRAND_SOFT = '#f0f9ff';
const INK = '#1e293b';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const PAGE = '#f8fafc';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const RULE_KINDS: { value: MatchKind; label: string }[] = [
  { value: 'pathParam', label: 'Path Param' },
  { value: 'header', label: 'Header' },
  { value: 'query', label: 'Query Param' },
  { value: 'body', label: 'Body (JSONPath)' },
];

function methodTone(method: string, onDark: boolean): { color: string; background: string } {
  const tones: Record<string, [string, string, string, string]> = {
    GET: ['#60a5fa', 'rgba(59,130,246,0.2)', '#1d4ed8', '#dbeafe'],
    POST: ['#4ade80', 'rgba(34,197,94,0.2)', '#15803d', '#dcfce7'],
    PUT: ['#fb923c', 'rgba(249,115,22,0.2)', '#c2410c', '#ffedd5'],
    PATCH: ['#c084fc', 'rgba(168,85,247,0.2)', '#7e22ce', '#f3e8ff'],
    DELETE: ['#f87171', 'rgba(239,68,68,0.2)', '#b91c1c', '#fee2e2'],
  };
  const tone = tones[method] ?? ['#cbd5e1', 'rgba(148,163,184,0.2)', '#334155', '#e2e8f0'];
  return onDark
    ? { color: tone[0], background: tone[1] }
    : { color: tone[2], background: tone[3] };
}

function groupIcon(id: string) {
  if (/user|account|people/.test(id)) return <PeopleIcon fontSize="small" />;
  if (/pay|charge|card|billing/.test(id)) return <CreditCardIcon fontSize="small" />;
  return <FolderIcon fontSize="small" />;
}

function normalisePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

interface MockManagementViewProps {
  connectionParams: ConnectionParams;
}

export default function MockManagementView({ connectionParams }: MockManagementViewProps) {
  const expectations = useDashboardStore((s) => s.activeExpectations);
  const connectionStatus = useDashboardStore((s) => s.connectionStatus);
  const setNotification = useDashboardStore((s) => s.setNotification);
  const editExpectation = useDashboardStore((s) => s.editExpectation);
  const [named, setNamed] = useState<NamedGroup[]>(() => loadNamedGroups());
  const wholes = useRef(new Map<string, Record<string, unknown>>());
  const [loadedWholeId, setLoadedWholeId] = useState<string | null>(null);
  const [loadedFallbackId, setLoadedFallbackId] = useState<string | null>(null);
  const [screen, setScreen] = useState<'home' | 'endpoint'>('home');
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [groupExpanded, setGroupExpanded] = useState(true);
  const [endpointKey, setEndpointKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<'scenario' | 'fallback'>('scenario');
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);
  const [fallback, setFallback] = useState<FallbackDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [apiDialog, setApiDialog] = useState(false);
  const [apiMethod, setApiMethod] = useState<(typeof METHODS)[number]>('GET');
  const [apiPath, setApiPath] = useState('');
  const [apiGroup, setApiGroup] = useState('');
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScenarioModel | null>(null);
  const [pendingGroupDelete, setPendingGroupDelete] = useState<GroupModel | null>(null);
  const [tryItOpen, setTryItOpen] = useState(false);

  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const groups = useMemo(() => buildCatalog(expectations, named), [expectations, named]);
  const located = endpointKey ? findEndpoint(groups, endpointKey) : undefined;
  const endpoint = located?.endpoint;
  const scenario = endpoint?.scenarios.find((item) => item.id === scenarioId) ?? endpoint?.scenarios[0];

  const scenarioIdKey = scenario?.id;
  const scenarioTruncated = scenario?.truncated === true;
  const scenarioItemKey = scenario?.itemKey;
  const scenarioAdvanced = scenario?.advancedOnly === true;
  const fallbackId = endpoint?.fallback?.id;
  const fallbackTruncated = endpoint?.fallback?.truncated === true;
  const fallbackUpstream = endpoint?.fallback?.upstream ?? '';

  function scenarioDraftOf(item: ScenarioModel): ScenarioDraft | null {
    if (item.advancedOnly) return null;
    const raw = wholes.current.get(item.id);
    if (raw) {
      const model = scenarioFromValue(raw, item.itemKey);
      if (model) return draftFromScenario(model);
    }
    return item.truncated ? null : draftFromScenario(item);
  }

  function fallbackDraftOf(current: EndpointModel): FallbackDraft {
    const existing = current.fallback;
    if (existing?.id) {
      const raw = wholes.current.get(existing.id);
      if (raw) {
        const model = scenarioFromValue(raw, existing.id);
        if (model) {
          return {
            mode: model.action === 'forward' ? 'proxy' : 'mock',
            upstream: model.action === 'forward' ? (existing.upstream ?? '') : '',
            statusCode: model.statusCode || 404,
            body: model.body,
          };
        }
      }
    }
    return draftFromFallback(existing);
  }

  useEffect(() => {
    if (editor !== 'scenario' || !scenarioIdKey || scenarioAdvanced || !scenarioTruncated) return;
    if (wholes.current.has(scenarioIdKey)) return;
    let cancelled = false;
    fetchExpectation(connectionParams, scenarioIdKey)
      .then((raw) => {
        if (cancelled) return;
        wholes.current.set(scenarioIdKey, raw);
        setLoadedWholeId(scenarioIdKey);
        const model = scenarioFromValue(raw, scenarioItemKey);
        if (model) setDraft(draftFromScenario(model));
      })
      .catch((error) => {
        if (!cancelled) {
          setNotification({ message: humanizeError(error).message || 'The mock could not be loaded', severity: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionParams, editor, scenarioIdKey, scenarioTruncated, scenarioAdvanced, scenarioItemKey, setNotification]);

  useEffect(() => {
    if (editor !== 'fallback' || !fallbackId || !fallbackTruncated) return;
    if (wholes.current.has(fallbackId)) return;
    let cancelled = false;
    fetchExpectation(connectionParams, fallbackId)
      .then((raw) => {
        if (cancelled) return;
        wholes.current.set(fallbackId, raw);
        setLoadedFallbackId(fallbackId);
        const model = scenarioFromValue(raw, fallbackId);
        if (!model) return;
        setFallback({
          mode: model.action === 'forward' ? 'proxy' : 'mock',
          upstream: model.action === 'forward' ? fallbackUpstream : '',
          statusCode: model.statusCode || 404,
          body: model.body,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setNotification({ message: humanizeError(error).message || 'The fallback could not be loaded', severity: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionParams, editor, fallbackId, fallbackTruncated, fallbackUpstream, setNotification]);

  function remember(next: NamedGroup[]) {
    setNamed(next);
    saveNamedGroups(next);
  }

  function fail(error: unknown, fallbackMessage: string) {
    setNotification({ message: humanizeError(error).message || fallbackMessage, severity: 'error' });
  }

  function showHome() {
    setScreen('home');
    setOpenGroupId(null);
    setTryItOpen(false);
  }

  function showEndpoint(next: EndpointModel, groupId: string) {
    const first = next.scenarios[0];
    setScreen('endpoint');
    setOpenGroupId(groupId);
    setGroupExpanded(true);
    setEndpointKey(next.id);
    setMethod(next.method);
    setPath(next.path);
    if (first && !first.advancedOnly) {
      setEditor('scenario');
      setScenarioId(first.id);
      setDraft(scenarioDraftOf(first));
      setLoadedWholeId(wholes.current.has(first.id) || !first.truncated ? first.id : null);
    } else if (first) {
      setEditor('scenario');
      setScenarioId(first.id);
      setDraft(null);
    } else {
      setEditor('fallback');
      setScenarioId(null);
      setFallback(fallbackDraftOf(next));
      const id = next.fallback?.id;
      setLoadedFallbackId(id && (wholes.current.has(id) || !next.fallback?.truncated) ? id : null);
    }
  }

  function selectScenario(next: ScenarioModel) {
    setEditor('scenario');
    setScenarioId(next.id);
    setDraft(scenarioDraftOf(next));
    setLoadedWholeId(wholes.current.has(next.id) || !next.truncated ? next.id : null);
  }

  function selectFallback(current: EndpointModel) {
    setEditor('fallback');
    setFallback(fallbackDraftOf(current));
    const id = current.fallback?.id;
    setLoadedFallbackId(id && (wholes.current.has(id) || !current.fallback?.truncated) ? id : null);
  }

  function discard() {
    if (!endpoint) return;
    setMethod(endpoint.method);
    setPath(endpoint.path);
    if (editor === 'fallback') {
      setFallback(fallbackDraftOf(endpoint));
      const id = endpoint.fallback?.id;
      setLoadedFallbackId(id && (wholes.current.has(id) || !endpoint.fallback?.truncated) ? id : null);
    } else if (scenario && !scenario.advancedOnly) {
      setDraft(scenarioDraftOf(scenario));
      setLoadedWholeId(wholes.current.has(scenario.id) || !scenario.truncated ? scenario.id : null);
    }
  }

  async function wholeScenario(item: ScenarioModel): Promise<Record<string, unknown>> {
    const cached = wholes.current.get(item.id);
    if (cached) return cached;
    if (item.truncated) {
      const raw = await fetchExpectation(connectionParams, item.id);
      wholes.current.set(item.id, raw);
      return raw;
    }
    return item.raw;
  }

  function rememberWhole(id: string | undefined, raw: Record<string, unknown>) {
    if (id) wholes.current.set(id, raw);
  }

  async function alignPath(current: EndpointModel) {
    const nextPath = normalisePath(path);
    if (current.method === method && current.path === nextPath) return;
    const writes: Promise<number>[] = [];
    for (const item of current.scenarios) {
      const raw = retargetExpectation(await wholeScenario(item), method, nextPath, current.pathWire);
      rememberWhole(item.id, raw);
      writes.push(registerExpectation(connectionParams, raw));
    }
    if (current.fallback?.raw) {
      const source = current.fallback.truncated && current.fallback.id
        ? wholes.current.get(current.fallback.id) ?? await fetchExpectation(connectionParams, current.fallback.id)
        : current.fallback.raw;
      const raw = retargetExpectation(source, method, nextPath);
      rememberWhole(current.fallback.id, raw);
      writes.push(registerExpectation(connectionParams, raw));
    }
    await Promise.all(writes);
    setEndpointKey(endpointId(method, nextPath, openGroupId ?? ''));
  }

  async function save() {
    if (!endpoint || busy) return;
    setBusy(true);
    try {
      const nextPath = normalisePath(path);
      if (editor === 'fallback') {
        const current = fallback ?? draftFromFallback(endpoint.fallback);
        if (current.mode === 'proxy' && !current.upstream.trim()) {
          setNotification({ message: 'Enter the upstream URL to forward unmatched requests', severity: 'warning' });
          return;
        }
        const raw = endpoint.fallback?.id
          ? wholes.current.get(endpoint.fallback.id) ?? (
            endpoint.fallback.truncated
              ? await fetchExpectation(connectionParams, endpoint.fallback.id)
              : endpoint.fallback.raw
          )
          : endpoint.fallback?.raw;
        const written = applyFallbackDraft(raw, current, method, nextPath, groupedName());
        rememberWhole(endpoint.fallback?.id, written);
        if (endpoint.fallback?.id) setLoadedFallbackId(endpoint.fallback.id);
        await registerExpectation(connectionParams, written);
        await alignPath({ ...endpoint, fallback: undefined, scenarios: endpoint.scenarios.filter((item) => item.id !== endpoint.fallback?.id) });
      } else if (scenario && draft && scenario.id === scenarioId && !scenario.advancedOnly) {
        const written = applyScenarioDraft(
          await wholeScenario(scenario),
          { ...draft, rules: ensureGroupHeader(draft.rules, groupedName()) },
          method,
          nextPath,
          endpoint.pathWire,
        );
        rememberWhole(scenario.id, written);
        setLoadedWholeId(scenario.id);
        await registerExpectation(connectionParams, written);
        const writtenPriority = typeof written['priority'] === 'number' ? written['priority'] : 0;
        const existingFallback = endpoint.fallback;
        const fallbackPriority = existingFallback?.priority ?? 0;
        if (existingFallback && writtenPriority <= fallbackPriority) {
          const fallbackRaw = existingFallback.id
            ? wholes.current.get(existingFallback.id) ?? (
              existingFallback.truncated
                ? await fetchExpectation(connectionParams, existingFallback.id)
                : existingFallback.raw
            )
            : existingFallback.raw;
          const pinned = applyFallbackDraft(
            fallbackRaw,
            draftFromFallback(existingFallback),
            method,
            nextPath,
            groupedName(),
          );
          rememberWhole(existingFallback.id, pinned);
          await registerExpectation(connectionParams, pinned);
        }
        await alignPath({ ...endpoint, scenarios: endpoint.scenarios.filter((item) => item.id !== scenario.id) });
      } else {
        return;
      }
      setPath(nextPath);
      setNotification({ message: 'Mock saved', severity: 'success' });
    } catch (error) {
      fail(error, 'The mock could not be saved');
    } finally {
      setBusy(false);
    }
  }

  function toggleEndpoint() {
    setNotification({
      message: 'Delete the scenarios to stop serving this mock; the fallback then handles every request.',
      severity: 'info',
    });
  }

  function groupedName(): string | undefined {
    const fromRules = endpoint
      ? groupHeaderValue(endpoint.scenarios.flatMap((item) => item.rules))
      : undefined;
    if (fromRules) return fromRules;
    return named.find((item) => item.id === openGroupId)?.name;
  }

  async function addScenario() {
    if (!endpoint || busy) return;
    const priority = nextScenarioPriority(endpoint);
    setBusy(true);
    try {
      await registerExpectation(connectionParams, newResponseExpectation(method, normalisePath(path), priority, groupedName()));
    } catch (error) {
      fail(error, 'The scenario could not be added');
    } finally {
      setBusy(false);
    }
  }

  async function removeScenario(target: ScenarioModel) {
    const removedId = target.id;
    const removedKey = target.itemKey;
    const remaining = endpoint?.scenarios.filter((item) => item.id !== removedId) ?? [];
    const leftoverFallback = endpoint?.fallback && endpoint.fallback.id !== removedId ? endpoint : undefined;
    setBusy(true);
    try {
      await deleteExpectation(connectionParams, removedId);
      wholes.current.delete(removedId);
      useDashboardStore.setState((state) => ({
        activeExpectations: state.activeExpectations.filter((item) => {
          if (item.key === removedKey || item.key === removedId) return false;
          return item.value['id'] !== removedId;
        }),
      }));
      if (remaining[0]) {
        if (scenarioId === removedId || scenario?.id === removedId) {
          selectScenario(remaining[0]);
        }
      } else if (leftoverFallback) {
        setScenarioId(null);
        setDraft(null);
        selectFallback(leftoverFallback);
      } else {
        showHome();
      }
      setPendingDelete(null);
      setNotification({ message: 'Scenario deleted', severity: 'success' });
    } catch (error) {
      fail(error, 'The scenario could not be deleted');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    const name = groupName.trim();
    if (!name) return;
    const id = slugGroupId(name);
    if (!named.some((group) => group.id === id) && !groups.some((group) => group.id === id && group.name === name)) {
      remember([...named.filter((group) => group.id !== id), { id, name }]);
    }
    setGroupDialog(false);
    setGroupName('');
    setOpenGroupId(id);
    setScreen('home');
  }

  async function removeGroup(group: GroupModel) {
    const targets = group.endpoints.flatMap((item) => {
      const rows = item.scenarios.map((scenario) => ({ id: scenario.id, key: scenario.itemKey }));
      if (item.fallback?.id) rows.push({ id: item.fallback.id, key: item.fallback.itemKey ?? item.fallback.id });
      return rows;
    });
    setBusy(true);
    try {
      await Promise.all(targets.map((item) => deleteExpectation(connectionParams, item.id)));
      const gone = new Set(targets.flatMap((item) => [item.id, item.key]));
      useDashboardStore.setState((state) => ({
        activeExpectations: state.activeExpectations.filter((item) => {
          if (gone.has(item.key)) return false;
          const id = item.value['id'];
          return typeof id !== 'string' || !gone.has(id);
        }),
      }));
      remember(named.filter((item) => item.id !== group.id));
      setPendingGroupDelete(null);
      showHome();
      setNotification({ message: `Group ${group.name} deleted`, severity: 'success' });
    } catch (error) {
      fail(error, 'The group could not be deleted');
    } finally {
      setBusy(false);
    }
  }

  async function createApi() {
    const group = groups.find((item) => item.id === apiGroup);
    const nextPath = normalisePath(apiPath || '/resource');
    const groupName = group && apiGroup ? group.name : undefined;
    setBusy(true);
    try {
      await registerExpectation(connectionParams, newResponseExpectation(apiMethod, nextPath, 0, groupName));
      setApiDialog(false);
      setApiPath('');
      setPendingOpen(endpointId(apiMethod, nextPath, apiGroup || groupIdForPath(nextPath)));
      setNotification({ message: 'Mock created', severity: 'success' });
    } catch (error) {
      fail(error, 'The mock could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function openAudit() {
    setAuditOpen(true);
    setAuditError(null);
    try {
      setAuditEntries(await fetchAuditEntries(connectionParams, { limit: 30 }));
    } catch (error) {
      setAuditEntries([]);
      setAuditError(humanizeError(error).message);
    }
  }

  async function openAdvanced(item: ScenarioModel) {
    try {
      const raw = await wholeScenario(item);
      editExpectation(raw);
    } catch (error) {
      fail(error, 'The expectation could not be opened');
    }
  }

  const openGroup = groups.find((group) => group.id === openGroupId);
  const pending = pendingOpen ? findEndpoint(groups, pendingOpen) : undefined;
  if (pending) {
    const first = pending.endpoint.scenarios[0];
    setPendingOpen(null);
    setScreen('endpoint');
    setOpenGroupId(pending.group.id);
    setGroupExpanded(true);
    setEndpointKey(pending.endpoint.id);
    setMethod(pending.endpoint.method);
    setPath(pending.endpoint.path);
    setEditor(first ? 'scenario' : 'fallback');
    setScenarioId(first?.id ?? null);
    setDraft(first && !first.advancedOnly && !first.truncated ? draftFromScenario(first) : null);
    if (!first) setFallback(draftFromFallback(pending.endpoint.fallback));
    setLoadedWholeId(first && !first.truncated ? first.id : null);
  }
  const connected = connectionStatus === 'connected';

  return (
    <ThemeProvider theme={buildTheme('light')}>
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', bgcolor: PAGE, color: INK }} data-testid="manage-view">
      <Box component="aside" sx={{ width: 288, flexShrink: 0, bgcolor: SIDEBAR, color: '#cbd5e1', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${SIDEBAR_EDGE}` }}>
        <Box sx={{ height: 64, display: 'flex', alignItems: 'center', px: 2, borderBottom: `1px solid ${SIDEBAR_EDGE}`, bgcolor: '#020617', fontWeight: 600, color: '#fff', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: BRAND }} />
          MockServer
        </Box>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, borderBottom: `1px solid ${SIDEBAR_EDGE}` }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setApiGroup(openGroupId ?? ''); setApiDialog(true); }} sx={{ bgcolor: BRAND, textTransform: 'none', '&:hover': { bgcolor: '#0369a1' } }}>
            New API Mock
          </Button>
          {screen === 'home' && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setGroupDialog(true)} sx={{ bgcolor: '#1e293b', textTransform: 'none', '&:hover': { bgcolor: '#334155' } }}>
              New Group
            </Button>
          )}
        </Box>
        <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${SIDEBAR_EDGE}`, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            fullWidth
            startIcon={<HomeIcon />}
            onClick={showHome}
            aria-current={screen === 'home' ? 'page' : undefined}
            sx={{ justifyContent: 'flex-start', textTransform: 'none', color: screen === 'home' ? '#fff' : '#cbd5e1', bgcolor: screen === 'home' ? '#1e293b' : 'transparent' }}
          >
            Central Dashboard
          </Button>
        </Box>
        {screen === 'endpoint' && openGroup && (
          <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
            <Button
              fullWidth
              onClick={() => setGroupExpanded((open) => !open)}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}
            >
              {groupExpanded ? '▾' : '▸'} {openGroup.name}
            </Button>
            {groupExpanded && openGroup.endpoints.map((item) => (
              <EndpointRow
                key={item.id}
                endpoint={item}
                selected={item.id === endpointKey}
                disabled={busy}
                onOpen={() => showEndpoint(item, openGroup.id)}
                onToggle={() => toggleEndpoint()}
              />
            ))}
            {openGroup.endpoints.length === 0 && (
              <Box sx={{ px: 1, py: 1, fontSize: 13, color: '#94a3b8' }}>No endpoints in this group yet.</Box>
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
        <Box sx={{ height: 64, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ fontSize: 14, color: MUTED }}>Server</Box>
            <Box sx={{ px: 1.5, py: 0.75, border: `1px solid ${LINE}`, borderRadius: 1, bgcolor: PAGE, fontWeight: 600, fontSize: 14 }}>
              {connectionParams.host}:{connectionParams.port}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: 999, fontSize: 12, fontWeight: 700, color: connected ? '#047857' : '#b45309', bgcolor: connected ? '#d1fae5' : '#fef3c7', border: `1px solid ${connected ? '#a7f3d0' : '#fde68a'}` }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: connected ? '#10b981' : '#f59e0b' }} />
              {connected ? 'Mock Active' : 'Reconnecting'}
            </Box>
          </Box>
          <IconButton aria-label="Audit logs" onClick={() => { void openAudit(); }} sx={{ color: MUTED }}>
            <HistoryIcon />
          </IconButton>
        </Box>

        {screen === 'home' ? (
          <Home
            groups={groups}
            onOpen={(group) => {
              const first = group.endpoints[0];
              if (first) showEndpoint(first, group.id);
              else {
                setOpenGroupId(group.id);
                setScreen('endpoint');
                setEndpointKey(null);
              }
            }}
            onCreateGroup={() => setGroupDialog(true)}
            onDeleteGroup={setPendingGroupDelete}
          />
        ) : endpoint ? (
          <EndpointEditor
            endpoint={endpoint}
            method={method}
            path={path}
            editor={editor}
            scenario={scenario}
            draft={draft}
            fallback={fallback ?? draftFromFallback(endpoint.fallback)}
            groupName={groupedName()}
            busy={busy}
            saveBlocked={(editor === 'scenario' && ((scenarioTruncated && loadedWholeId !== scenarioIdKey) || (!!scenarioId && scenario?.id !== scenarioId)))
              || (editor === 'fallback' && fallbackTruncated && loadedFallbackId !== fallbackId)}
            connectionParams={connectionParams}
            tryItOpen={tryItOpen}
            onOpenTryIt={() => setTryItOpen(true)}
            onCloseTryIt={() => setTryItOpen(false)}
            onMethod={setMethod}
            onPath={setPath}
            onDraft={setDraft}
            onFallback={setFallback}
            onSelectScenario={selectScenario}
            onSelectFallback={() => selectFallback(endpoint)}
            onAdd={() => { void addScenario(); }}
            onDelete={setPendingDelete}
            onDiscard={discard}
            onSave={() => { void save(); }}
            onAdvanced={(item) => { void openAdvanced(item); }}
          />
        ) : (
          <Box sx={{ p: 4, color: MUTED }}>This group has no endpoints yet. Create an API mock to add one.</Box>
        )}
      </Box>

      <Drawer anchor="right" open={auditOpen} onClose={() => setAuditOpen(false)}>
        <Box sx={{ width: 320, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }} role="dialog" aria-label="Audit logs">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ fontWeight: 700 }}>Audit logs</Box>
            <IconButton aria-label="Close audit logs" onClick={() => setAuditOpen(false)} size="small"><CloseIcon fontSize="small" /></IconButton>
          </Box>
          {auditError && <Box sx={{ fontSize: 13, color: '#b45309' }}>{auditError}</Box>}
          {auditEntries?.length === 0 && !auditError && <Box sx={{ fontSize: 13, color: MUTED }}>No audit entries. The trail is off until control-plane audit is enabled.</Box>}
          {auditEntries?.map((entry, index) => (
            <Box key={`${entry.epochTimeMs}-${index}`} sx={{ border: `1px solid ${LINE}`, borderRadius: 1, p: 1.25 }}>
              <Box sx={{ fontSize: 12, color: MUTED }}>{new Date(entry.epochTimeMs).toLocaleString()}</Box>
              <Box sx={{ fontSize: 14, fontWeight: 600 }}>{entry.operation}</Box>
              <Box sx={{ fontSize: 13 }}>{entry.summary}</Box>
            </Box>
          ))}
          <Button onClick={() => useDashboardStore.getState().setView('audit')} sx={{ textTransform: 'none' }}>Open full audit</Button>
        </Box>
      </Drawer>

      <Dialog open={groupDialog} onClose={() => setGroupDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle>New group</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="Group name" fullWidth value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="User Service" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { void createGroup(); }}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={apiDialog} onClose={() => setApiDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle>New API mock</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            select
            label="Group"
            value={apiGroup}
            onChange={(event) => setApiGroup(event.target.value)}
            helperText="A grouped mock only matches requests that send x-mockserver-group with this group name."
          >
            <MenuItem value="">No group</MenuItem>
            {groups.map((group) => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
          </TextField>
          <TextField select label="Method" value={apiMethod} onChange={(event) => setApiMethod(event.target.value as (typeof METHODS)[number])}>
            {METHODS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
          </TextField>
          <TextField label="Path" value={apiPath} onChange={(event) => setApiPath(event.target.value)} placeholder="/resource" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApiDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={() => { void createApi(); }}>Create</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete scenario"
        message="This removes the expectation from the server. Recorded traffic is left as it is."
        confirmLabel="Delete"
        onConfirm={() => { if (pendingDelete) void removeScenario(pendingDelete); }}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingGroupDelete !== null}
        title="Delete group"
        message={pendingGroupDelete
          ? `This removes ${pendingGroupDelete.name} and every mock in it from the server. Recorded traffic is left as it is.`
          : ''}
        confirmLabel="Delete"
        onConfirm={() => { if (pendingGroupDelete) void removeGroup(pendingGroupDelete); }}
        onClose={() => setPendingGroupDelete(null)}
      />
    </Box>
    </ThemeProvider>
  );
}

function EndpointRow({
  endpoint,
  selected,
  disabled,
  onOpen,
  onToggle,
}: {
  endpoint: EndpointModel;
  selected: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggle: (active: boolean) => void;
}) {
  const tone = methodTone(endpoint.method, true);
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1,
        py: 1,
        mb: 0.5,
        borderRadius: 1,
        border: `1px solid ${selected ? '#334155' : 'transparent'}`,
        bgcolor: selected ? '#1e293b' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: 10, fontWeight: 800, px: 0.75, py: 0.25, borderRadius: 0.5, color: tone.color, bgcolor: tone.background }}>{endpoint.method}</Box>
        <Box sx={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{endpoint.path}</Box>
      </Box>
      <Switch
        size="small"
        checked={endpoint.active}
        disabled={disabled}
        slotProps={{ input: { 'aria-label': `Mock ${endpoint.method} ${endpoint.path}` } }}
        onClick={(event) => event.stopPropagation()}
        onChange={(_event, checked) => onToggle(checked)}
      />
    </Box>
  );
}

function Home({
  groups,
  onOpen,
  onCreateGroup,
  onDeleteGroup,
}: {
  groups: GroupModel[];
  onOpen: (group: GroupModel) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (group: GroupModel) => void;
}) {
  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 4, bgcolor: PAGE }} data-testid="manage-home">
      <Box sx={{ maxWidth: 1024, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Box component="h2" sx={{ m: 0, fontSize: 24, fontWeight: 700 }}>Central Dashboard</Box>
            <Box sx={{ mt: 0.5, fontSize: 14, color: MUTED }}>Manage API groups and which endpoints are serving a mock.</Box>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateGroup} sx={{ bgcolor: BRAND, textTransform: 'none' }}>New Group</Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 3 }}>
          {groups.map((group) => {
            const activeCount = group.endpoints.filter((item) => item.active).length;
            return (
              <Box
                key={group.id}
                sx={{ textAlign: 'left', bgcolor: '#fff', border: `1px solid ${LINE}`, borderRadius: 3, p: 2.5, color: 'inherit', '&:hover': { borderColor: '#60a5fa', boxShadow: '0 4px 12px rgba(15,23,42,0.08)' } }}
              >
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}>
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Open group ${group.name}`}
                    onClick={() => onOpen(group)}
                    sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flex: 1, minWidth: 0, bgcolor: 'transparent', border: 0, p: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                  >
                    <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: BRAND_SOFT, color: BRAND }}>{groupIcon(group.id)}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ fontWeight: 700 }}>{group.name}</Box>
                      <Box sx={{ fontSize: 12, color: MUTED }}>{group.endpoints.length} endpoint{group.endpoints.length === 1 ? '' : 's'}</Box>
                    </Box>
                  </Box>
                  <IconButton
                    aria-label={`Delete group ${group.name}`}
                    size="small"
                    onClick={() => onDeleteGroup(group)}
                    sx={{ color: MUTED }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, cursor: 'pointer' }} onClick={() => onOpen(group)}>
                  {group.endpoints.slice(0, 4).map((item) => {
                    const tone = methodTone(item.method, false);
                    return (
                      <Box key={item.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 14, borderTop: `1px solid #f1f5f9`, pt: 1 }}>
                        <Box sx={{ display: 'flex', gap: 1, minWidth: 0 }}>
                          <Box sx={{ fontSize: 10, fontWeight: 800, px: 0.75, borderRadius: 0.5, color: tone.color, bgcolor: tone.background }}>{item.method}</Box>
                          <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path}</Box>
                        </Box>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.active ? '#10b981' : '#cbd5e1', flexShrink: 0 }} title={item.active ? 'Mock active' : 'Not mocking'} />
                      </Box>
                    );
                  })}
                </Box>
                <Box onClick={() => onOpen(group)} sx={{ mt: 2, pt: 2, borderTop: `1px solid #f1f5f9`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <Box sx={{ fontSize: 11, fontWeight: 700, px: 1, py: 0.5, borderRadius: 1, color: activeCount ? '#047857' : MUTED, bgcolor: activeCount ? '#ecfdf5' : '#f1f5f9', border: `1px solid ${activeCount ? '#a7f3d0' : LINE}` }}>
                    {group.endpoints.length === 0 ? 'Empty' : activeCount ? `${activeCount} Mock Active` : 'All Real API'}
                  </Box>
                  <Box sx={{ fontSize: 12, fontWeight: 700, color: BRAND }}>Manage →</Box>
                </Box>
              </Box>
            );
          })}
          <Box
            component="button"
            type="button"
            onClick={onCreateGroup}
            sx={{ minHeight: 220, border: `2px dashed #cbd5e1`, borderRadius: 3, bgcolor: 'transparent', color: MUTED, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, '&:hover': { borderColor: BRAND, color: BRAND, bgcolor: BRAND_SOFT } }}
          >
            <AddIcon />
            <Box sx={{ fontWeight: 700, fontSize: 14 }}>Create New Group</Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}


function tryItJson(
  method: string,
  path: string,
  editor: 'scenario' | 'fallback',
  endpoint: EndpointModel,
  scenario: ScenarioModel | undefined,
  draft: ScenarioDraft | null,
  fallback: FallbackDraft,
  groupName?: string,
): string {
  if (editor === 'fallback') {
    if (fallback.mode === 'proxy' && !fallback.upstream.trim()) {
      return JSON.stringify({ httpRequest: { method, path } });
    }
    try {
      return JSON.stringify(applyFallbackDraft(endpoint.fallback?.raw, fallback, method, path, groupName));
    } catch {
      return JSON.stringify({ httpRequest: { method, path } });
    }
  }
  if (scenario?.advancedOnly) {
    return JSON.stringify(scenario.raw);
  }
  if (draft) {
    const raw = scenario?.raw ?? {};
    const seed = 'httpResponse' in raw || 'httpError' in raw || 'httpForward' in raw
      ? raw
      : { ...raw, httpResponse: { statusCode: 200 } };
    const withGroup = { ...draft, rules: ensureGroupHeader(draft.rules, groupName) };
    return JSON.stringify(applyScenarioDraft(seed, withGroup, method, path, endpoint.pathWire));
  }
  return JSON.stringify({ httpRequest: { method, path } });
}

function EndpointEditor({
  endpoint,
  method,
  path,
  editor,
  scenario,
  draft,
  fallback,
  groupName,
  busy,
  saveBlocked,
  onMethod,
  onPath,
  onDraft,
  onFallback,
  onSelectScenario,
  onSelectFallback,
  onAdd,
  onDelete,
  onDiscard,
  onSave,
  onAdvanced,
  connectionParams,
  tryItOpen,
  onOpenTryIt,
  onCloseTryIt,
}: {
  endpoint: EndpointModel;
  method: string;
  path: string;
  editor: 'scenario' | 'fallback';
  scenario?: ScenarioModel;
  draft: ScenarioDraft | null;
  fallback: FallbackDraft;
  groupName?: string;
  busy: boolean;
  saveBlocked?: boolean;
  connectionParams: ConnectionParams;
  tryItOpen: boolean;
  onOpenTryIt: () => void;
  onCloseTryIt: () => void;
  onMethod: (method: string) => void;
  onPath: (path: string) => void;
  onDraft: (draft: ScenarioDraft) => void;
  onFallback: (draft: FallbackDraft) => void;
  onSelectScenario: (scenario: ScenarioModel) => void;
  onSelectFallback: () => void;
  onAdd: () => void;
  onDelete: (scenario: ScenarioModel) => void;
  onDiscard: () => void;
  onSave: () => void;
  onAdvanced: (scenario: ScenarioModel) => void;
}) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-testid="manage-endpoint">
      <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${LINE}`, bgcolor: PAGE, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 1.5, flex: '1 1 280px', minWidth: 0 }}>
          <TextField select size="small" value={method} onChange={(event) => onMethod(event.target.value)} sx={{ width: 110 }} slotProps={{ htmlInput: { 'aria-label': 'Method' } }}>
            {METHODS.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
          </TextField>
          <TextField size="small" fullWidth value={path} onChange={(event) => onPath(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Path', style: { fontFamily: monospaceFontFamily } } }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onDiscard} sx={{ textTransform: 'none' }}>Discard</Button>
          <Button
            startIcon={<SendOutlinedIcon />}
            onClick={onOpenTryIt}
            sx={{ textTransform: 'none' }}
          >
            Try It
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} disabled={busy || saveBlocked || scenario?.advancedOnly === true && editor === 'scenario'} onClick={onSave} sx={{ bgcolor: BRAND, textTransform: 'none' }}>Save Mock</Button>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Box sx={{ width: 256, borderRight: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <Box sx={{ p: 1.5, borderBottom: `1px solid #f1f5f9`, bgcolor: PAGE, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ fontWeight: 600, fontSize: 14 }}>Scenarios ({endpoint.scenarios.length})</Box>
            <Button size="small" startIcon={<AddIcon />} onClick={onAdd} disabled={busy} sx={{ textTransform: 'none' }}>Add</Button>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
            {endpoint.scenarios.map((item) => {
              const selected = editor === 'scenario' && item.id === scenario?.id;
              const tone = item.statusCode >= 400 ? { color: '#c2410c', background: '#ffedd5' } : { color: '#15803d', background: '#dcfce7' };
              return (
                <Box key={item.id} sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onSelectScenario(item)}
                    sx={{ flex: 1, textAlign: 'left', p: 1.5, borderRadius: 1, border: `1px solid ${selected ? '#bae6fd' : LINE}`, bgcolor: selected ? BRAND_SOFT : '#fff', cursor: 'pointer', color: 'inherit' }}
                  >
                    <Box sx={{ fontSize: 14, fontWeight: selected ? 700 : 500 }}>{item.title}</Box>
                    <Box sx={{ display: 'flex', gap: 1, mt: 0.75, alignItems: 'center' }}>
                      {item.action === 'response' && <Box sx={{ fontSize: 10, fontWeight: 800, px: 0.75, borderRadius: 0.5, color: tone.color, bgcolor: tone.background }}>{item.statusCode} {statusText(item.statusCode)}</Box>}
                      {item.delayMs > 0 && <Box sx={{ fontSize: 10, color: MUTED }}>{item.delayMs}ms</Box>}
                      {!item.active && <Box sx={{ fontSize: 10, color: MUTED }}>Off</Box>}
                    </Box>
                  </Box>
                  <IconButton aria-label={`Delete ${item.title}`} size="small" onClick={() => onDelete(item)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Box>
              );
            })}
            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${LINE}` }}>
              <Box sx={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', color: MUTED, mb: 1 }}>UNMATCHED (FALLBACK)</Box>
              <Box
                component="button"
                type="button"
                onClick={onSelectFallback}
                aria-label="Unmatched fallback"
                sx={{ width: '100%', textAlign: 'left', p: 1.5, borderRadius: 1, cursor: 'pointer', color: 'inherit', border: editor === 'fallback' ? `1px solid ${BRAND}` : `1px dashed #cbd5e1`, bgcolor: editor === 'fallback' ? BRAND_SOFT : '#fff' }}
              >
                <Box sx={{ fontSize: 14, fontWeight: 600 }}>{endpoint.fallback?.mode === 'mock' ? 'Return Default Error' : endpoint.fallback ? 'Forward to Real API' : 'Not configured'}</Box>
                <Box sx={{ fontSize: 10, color: MUTED, mt: 0.5 }}>{endpoint.fallback?.mode === 'proxy' ? (endpoint.fallback.upstream || 'Set an upstream URL') : endpoint.fallback ? 'Mock response' : 'Choose a proxy or a default error'}</Box>
              </Box>
            </Box>
          </Box>
        </Box>
        <Box sx={{ flex: 1, overflow: 'auto', p: 3, bgcolor: PAGE }}>
          {editor === 'scenario' && scenario?.advancedOnly && (
            <Box sx={{ bgcolor: '#fff', border: `1px solid ${LINE}`, borderRadius: 2, p: 2 }}>
              <Box sx={{ fontWeight: 700, mb: 1 }}>Custom action</Box>
              <Box sx={{ fontSize: 14, color: MUTED, mb: 2 }}>This expectation uses a template or callback. Open it in the full Mocks editor so that action is kept.</Box>
              <Button variant="contained" onClick={() => onAdvanced(scenario)} sx={{ textTransform: 'none', bgcolor: BRAND }}>Open in Mocks</Button>
            </Box>
          )}
          {editor === 'scenario' && scenario && draft && !scenario.advancedOnly && (
            <ScenarioForm
              draft={draft}
              onChange={onDraft}
              fallbackTakesFirst={
                endpoint.fallback?.priority != null && scenario.priority <= endpoint.fallback.priority
              }
            />
          )}
          {editor === 'fallback' && (
            <FallbackForm
              draft={fallback}
              onChange={onFallback}
              method={method}
              path={path}
              catchAllTitle={catchAllScenarioTitle(endpoint)}
              fallbackTakesFirst={
                endpoint.fallback?.priority != null
                && endpoint.scenarios.some((item) => item.active && item.priority <= endpoint.fallback!.priority!)
              }
            />
          )}
        </Box>
      </Box>
      <Drawer
        anchor="right"
        open={tryItOpen}
        onClose={onCloseTryIt}
        slotProps={{
          backdrop: { sx: { backgroundColor: 'rgba(15, 23, 42, 0.55)' } },
          paper: {
            sx: {
              width: { xs: '100%', sm: 880 },
              maxWidth: '96vw',
              bgcolor: '#ffffff',
              color: '#1e293b',
              boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.18)',
            },
          },
        }}
      >
        <Box
          sx={{ width: '100%', height: '100%', overflow: 'hidden', p: 0, boxSizing: 'border-box' }}
          role="dialog"
          aria-label="Try It"
        >
          {tryItOpen && (
            <LiveResponseWidget
              key={`${endpoint.id}:${editor}:${scenario?.id ?? 'fallback'}`}
              expectationJson={tryItJson(method, path, editor, endpoint, scenario, draft, fallback, groupName)}
              connectionParams={connectionParams}
              onClose={onCloseTryIt}
            />
          )}
        </Box>
      </Drawer>
    </Box>
  );
}

function cardSx() {
  return { bgcolor: '#fff', border: `1px solid ${LINE}`, borderRadius: 2, mb: 3 } as const;
}

function ScenarioForm({
  draft,
  onChange,
  fallbackTakesFirst,
}: {
  draft: ScenarioDraft;
  onChange: (draft: ScenarioDraft) => void;
  fallbackTakesFirst?: boolean;
}) {
  function patch(partial: Partial<ScenarioDraft>) {
    onChange({ ...draft, ...partial });
  }
  function patchRule(id: string, partial: Partial<MatchRule>) {
    patch({ rules: draft.rules.map((rule) => rule.id === id ? { ...rule, ...partial } : rule) });
  }
  return (
    <Box>
      <Box sx={cardSx()}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${LINE}`, bgcolor: PAGE, display: 'flex', justifyContent: 'space-between' }}>
          <Box sx={{ fontWeight: 600 }}>Request matching conditions</Box>
          <Button size="small" onClick={() => patch({ rules: [...draft.rules, blankRule()] })} sx={{ textTransform: 'none' }}>+ Add Rule</Button>
        </Box>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ fontSize: 12, color: MUTED }}>Execute this scenario when the request matches these rules. A value without regex characters is an exact match. The x-mockserver-group header is added for grouped mocks so the same path can live in more than one group.</Box>
          {fallbackTakesFirst ? (
            <Box role="status" sx={{ bgcolor: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 1, p: 1.5, fontSize: 13 }}>
              The unmatched fallback has the same or higher priority and does not need these extra rules, so it matches first and this scenario never runs. Open Unmatched fallback and Save Mock to give the fallback unmatched priority.
            </Box>
          ) : null}
          {draft.rules.length === 0 && <Box sx={{ fontSize: 13, color: MUTED }}>No extra rules. This scenario matches every request to the method and path.</Box>}
          {draft.rules.map((rule) => {
            const groupHeader = isGroupHeaderRule(rule);
            return (
            <Box key={rule.id} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField select size="small" value={rule.kind} disabled={groupHeader} onChange={(event) => patchRule(rule.id, { kind: event.target.value as MatchKind })} aria-label="Rule kind" sx={{ width: 160 }}>
                {RULE_KINDS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </TextField>
              <TextField size="small" value={rule.key} disabled={groupHeader} onChange={(event) => patchRule(rule.id, { key: event.target.value })} aria-label="Rule key" placeholder="Key" sx={{ width: 160 }} />
              <TextField select size="small" value={rule.op} disabled={groupHeader} onChange={(event) => patchRule(rule.id, { op: event.target.value as MatchRule['op'] })} aria-label="Rule operator" sx={{ width: 130 }}>
                <MenuItem value="equals">Equals</MenuItem>
                <MenuItem value="regex">Regex</MenuItem>
                <MenuItem value="contains">Contains</MenuItem>
              </TextField>
              <TextField size="small" value={rule.value} disabled={groupHeader} onChange={(event) => patchRule(rule.id, { value: event.target.value })} aria-label="Rule value" placeholder="Value" sx={{ flex: 1, minWidth: 120 }} />
              <IconButton aria-label="Remove rule" disabled={groupHeader} onClick={() => patch({ rules: draft.rules.filter((item) => item.id !== rule.id) })}><DeleteOutlineIcon /></IconButton>
            </Box>
            );
          })}
        </Box>
      </Box>
      <Box sx={cardSx()}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${LINE}`, bgcolor: PAGE, fontWeight: 600 }}>Mock response data</Box>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '160px 1fr' }, gap: 2 }}>
          <Box>
            <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED, mb: 0.5 }}>HTTP STATUS</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField size="small" type="number" value={draft.statusCode} onChange={(event) => patch({ statusCode: Number(event.target.value) })} aria-label="HTTP status" sx={{ width: 90 }} />
              <Box sx={{ fontSize: 14, color: MUTED }}>{statusText(draft.statusCode)}</Box>
            </Box>
          </Box>
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED }}>RESPONSE HEADERS</Box>
              <Button size="small" onClick={() => patch({ headers: [...draft.headers, { name: '', value: '' }] })} sx={{ textTransform: 'none' }}>+ Add</Button>
            </Box>
            {draft.headers.map((header, index) => (
              <Box key={`${header.name}-${index}`} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField size="small" value={header.name} onChange={(event) => patch({ headers: draft.headers.map((row, i) => i === index ? { ...row, name: event.target.value } : row) })} aria-label="Header name" />
                <TextField size="small" fullWidth value={header.value} onChange={(event) => patch({ headers: draft.headers.map((row, i) => i === index ? { ...row, value: event.target.value } : row) })} aria-label="Header value" />
                <IconButton aria-label="Remove header" onClick={() => patch({ headers: draft.headers.filter((_, i) => i !== index) })}><CloseIcon fontSize="small" /></IconButton>
              </Box>
            ))}
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED, mb: 0.5 }}>RESPONSE BODY</Box>
            <Box component="textarea" aria-label="Response body" value={draft.body} spellCheck={false} onChange={(event) => patch({ body: event.target.value })} sx={{ width: '100%', minHeight: 180, boxSizing: 'border-box', p: 2, borderRadius: 1, border: '1px solid #334155', bgcolor: '#0f172a', color: '#4ade80', fontFamily: monospaceFontFamily, fontSize: 13 }} />
          </Box>
        </Box>
      </Box>
      <Box sx={cardSx()}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${LINE}`, bgcolor: PAGE, fontWeight: 600 }}>Network and timeout simulation</Box>
        <Box sx={{ p: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED, mb: 1 }}>SIMULATE LATENCY (DELAY)</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box component="input" type="range" min={0} max={5000} value={Math.min(draft.delayMs, 5000)} aria-label="Delay" onChange={(event) => patch({ delayMs: Number(event.target.value) })} sx={{ flex: 1 }} />
              <TextField size="small" type="number" value={draft.delayMs} onChange={(event) => patch({ delayMs: Number(event.target.value) })} aria-label="Delay milliseconds" sx={{ width: 100 }} />
            </Box>
          </Box>
          <Box>
            <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED, mb: 1 }}>CONNECTION TIMEOUT</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Switch checked={draft.dropConnection} onChange={(_event, checked) => patch({ dropConnection: checked })} slotProps={{ input: { 'aria-label': 'Force connection drop' } }} />
              <Box sx={{ fontSize: 14 }}>Force connection drop</Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function catchAllScenarioTitle(endpoint: EndpointModel): string | undefined {
  return endpoint.scenarios.find((item) => item.active && !item.rules.some((rule) => !isGroupHeaderRule(rule)))?.title;
}

function FallbackForm({
  draft,
  onChange,
  method,
  path,
  catchAllTitle,
  fallbackTakesFirst,
}: {
  draft: FallbackDraft;
  onChange: (draft: FallbackDraft) => void;
  method: string;
  path: string;
  catchAllTitle?: string;
  fallbackTakesFirst?: boolean;
}) {
  return (
    <Box sx={cardSx()}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${LINE}`, bgcolor: PAGE }}>
        <Box sx={{ fontWeight: 600 }}>API fallback behaviour</Box>
        <Box sx={{ fontSize: 12, color: MUTED, mt: 0.5 }}>What to do when a request matches this method and path but none of the scenarios.</Box>
      </Box>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 3 }}>
        <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
          <input type="radio" name="fallback-mode" checked={draft.mode === 'proxy'} onChange={() => onChange({ ...draft, mode: 'proxy' })} />
          Forward to real API
        </Box>
        <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
          <input type="radio" name="fallback-mode" checked={draft.mode === 'mock'} onChange={() => onChange({ ...draft, mode: 'mock' })} />
          Return default error
        </Box>
      </Box>
      {draft.mode === 'proxy' ? (
        <Box sx={{ p: 2 }}>
          {catchAllTitle ? (
            <Box role="status" sx={{ bgcolor: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 1, p: 1.5, fontSize: 13, mb: 2 }}>
              {catchAllTitle} matches every {method} {path} in this group, so this fallback never runs. Add matching conditions to that scenario, or delete it, then Try It again.
            </Box>
          ) : fallbackTakesFirst ? (
            <Box role="status" sx={{ bgcolor: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', borderRadius: 1, p: 1.5, fontSize: 13, mb: 2 }}>
              This fallback is the same or higher priority as a scenario, so it matches first even when those extra rules would hit. Save Mock to set unmatched priority, then Try It again.
            </Box>
          ) : (
            <Box sx={{ bgcolor: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 1, p: 1.5, fontSize: 13, mb: 2 }}>
              Unmatched requests keep this method and path and are forwarded to the host below (for example GET /health to https://google.com becomes GET https://google.com/health).
            </Box>
          )}
          <Box sx={{ fontSize: 12, fontWeight: 700, color: MUTED, mb: 0.5 }}>TARGET UPSTREAM URL</Box>
          <TextField fullWidth size="small" value={draft.upstream} onChange={(event) => onChange({ ...draft, upstream: event.target.value })} placeholder="https://api.internal.example/service" aria-label="Upstream URL" />
        </Box>
      ) : (
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <TextField size="small" type="number" value={draft.statusCode} onChange={(event) => onChange({ ...draft, statusCode: Number(event.target.value) })} aria-label="Fallback status" sx={{ width: 90 }} />
            <Box sx={{ color: MUTED }}>{statusText(draft.statusCode)}</Box>
          </Box>
          <Box component="textarea" aria-label="Fallback body" value={draft.body} spellCheck={false} onChange={(event) => onChange({ ...draft, body: event.target.value })} sx={{ width: '100%', minHeight: 140, boxSizing: 'border-box', p: 2, borderRadius: 1, border: '1px solid #334155', bgcolor: '#0f172a', color: '#fdba74', fontFamily: monospaceFontFamily, fontSize: 13 }} />
        </Box>
      )}
    </Box>
  );
}

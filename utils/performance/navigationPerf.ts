export type AccountType = 'individual' | 'business';

interface VisitMetric {
  route: string;
  accountType: AccountType;
  startedAt: number;
  routeMountedAt?: number;
  firstPaintAt?: number;
  firstDataAt?: number;
  routeRenderCount: number;
  routeMountCount: number;
  routeUnmountCount: number;
  apiCount: number;
  snapshotCount: number;
  capabilityCount: number;
  bridgeCallCount: number;
  cacheHits: number;
  cacheMisses: number;
}

interface PerfState {
  active?: VisitMetric;
  history: VisitMetric[];
}

declare global {
  interface Window {
    __bpNavPerfState?: PerfState;
  }
}

function state(): PerfState {
  if (typeof window === 'undefined') return { history: [] };
  if (!window.__bpNavPerfState) window.__bpNavPerfState = { history: [] };
  return window.__bpNavPerfState;
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function finalizeActive() {
  const s = state();
  if (s.active) {
    s.history.push({ ...s.active });
    if (s.history.length > 300) s.history.splice(0, s.history.length - 300);
  }
  s.active = undefined;
}

export function navPerfStartRoute(route: string, accountType: AccountType): void {
  const s = state();
  if (s.active?.route === route && s.active?.accountType === accountType) return;
  finalizeActive();
  s.active = {
    route,
    accountType,
    startedAt: now(),
    routeRenderCount: 0,
    routeMountCount: 0,
    routeUnmountCount: 0,
    apiCount: 0,
    snapshotCount: 0,
    capabilityCount: 0,
    bridgeCallCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
}

export function navPerfMarkFirstPaint(route: string): void {
  const s = state();
  if (!s.active || s.active.route !== route) return;
  if (s.active.firstPaintAt == null) s.active.firstPaintAt = now();
}

export function navPerfMarkRouteMounted(route: string): void {
  const s = state();
  if (!s.active || s.active.route !== route) return;
  s.active.routeMountCount += 1;
  if (s.active.routeMountedAt == null) s.active.routeMountedAt = now();
}

export function navPerfMarkRouteUnmounted(route: string): void {
  const s = state();
  if (!s.active || s.active.route !== route) return;
  s.active.routeUnmountCount += 1;
}

export function navPerfMarkRouteRender(route: string): void {
  const s = state();
  if (!s.active || s.active.route !== route) return;
  s.active.routeRenderCount += 1;
}

export function navPerfTrackApi(endpoint: string, phase: 'start' | 'end', ok?: boolean): void {
  if (phase !== 'end') return;
  const s = state();
  const a = s.active;
  if (!a) return;
  a.apiCount += 1;
  if (endpoint.includes('capab')) a.capabilityCount += 1;
  if (endpoint.startsWith('bridge-') || endpoint.includes('external-account')) a.bridgeCallCount += 1;
  if (a.firstDataAt == null && ok !== false) a.firstDataAt = now();
}

export function navPerfTrackSnapshot(ok: boolean): void {
  const s = state();
  const a = s.active;
  if (!a) return;
  a.snapshotCount += 1;
  if (a.firstDataAt == null && ok) a.firstDataAt = now();
}

export function navPerfTrackCache(route: string, hit: boolean): void {
  const s = state();
  const a = s.active;
  if (!a || a.route !== route) return;
  if (hit) a.cacheHits += 1;
  else a.cacheMisses += 1;
}

function summarize(rows: VisitMetric[]) {
  const grouped = new Map<string, VisitMetric[]>();
  rows.forEach((r) => {
    const k = `${r.accountType}:${r.route}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(r);
  });
  return Array.from(grouped.entries()).map(([k, arr]) => {
    const [accountType, route] = k.split(':');
    const avg = (vals: number[]) => vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const mount = arr.map((r) => (r.routeMountedAt ?? r.startedAt) - r.startedAt);
    const paint = arr.map((r) => (r.firstPaintAt ?? r.startedAt) - r.startedAt);
    const data = arr.map((r) => (r.firstDataAt ?? r.startedAt) - r.startedAt);
    return {
      accountType,
      route,
      visits: arr.length,
      avgRouteMountMs: Number(avg(mount).toFixed(2)),
      avgFirstPaintMs: Number(avg(paint).toFixed(2)),
      avgTimeToDataMs: Number(avg(data).toFixed(2)),
      avgApiCount: Number(avg(arr.map((r) => r.apiCount)).toFixed(2)),
      avgSnapshotCount: Number(avg(arr.map((r) => r.snapshotCount)).toFixed(2)),
      avgCapabilityCount: Number(avg(arr.map((r) => r.capabilityCount)).toFixed(2)),
      avgBridgeCallCount: Number(avg(arr.map((r) => r.bridgeCallCount)).toFixed(2)),
      avgRouteRenderCount: Number(avg(arr.map((r) => r.routeRenderCount)).toFixed(2)),
      avgRouteMountCount: Number(avg(arr.map((r) => r.routeMountCount)).toFixed(2)),
      avgRouteUnmountCount: Number(avg(arr.map((r) => r.routeUnmountCount)).toFixed(2)),
      avgCacheHits: Number(avg(arr.map((r) => r.cacheHits)).toFixed(2)),
      avgCacheMisses: Number(avg(arr.map((r) => r.cacheMisses)).toFixed(2)),
    };
  });
}

export function navPerfGetReport() {
  const s = state();
  const rows = [...s.history, ...(s.active ? [{ ...s.active }] : [])];
  return {
    generatedAt: new Date().toISOString(),
    rows,
    summary: summarize(rows),
  };
}

export function navPerfReset() {
  const s = state();
  s.history = [];
  s.active = undefined;
}

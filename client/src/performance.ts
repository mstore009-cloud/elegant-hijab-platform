export const appBootStartedAt = typeof performance !== "undefined" ? performance.now() : 0;

type PerformanceMetric = {
  name: "first_open" | "route_navigation";
  durationMs: number;
  path: string;
  timestamp: string;
};

export function recordPerformanceMetric(name: PerformanceMetric["name"], durationMs: number, path: string) {
  if (typeof window === "undefined") return;
  const metric: PerformanceMetric = {
    name,
    durationMs: Math.round(durationMs),
    path,
    timestamp: new Date().toISOString(),
  };
  const store = (window as Window & { __platformPerformance?: PerformanceMetric[] }).__platformPerformance ?? [];
  store.push(metric);
  (window as Window & { __platformPerformance?: PerformanceMetric[] }).__platformPerformance = store.slice(-30);
  window.dispatchEvent(new CustomEvent("platform:performance", { detail: metric }));
  if (import.meta.env.DEV) console.debug("[Performance]", metric);
}

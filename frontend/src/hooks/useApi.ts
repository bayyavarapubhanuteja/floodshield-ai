/* Data hook: fetches `path` and refetches whenever the event clock advances a 5-min step
   (`live`), the city changes, or `deps` change. Keeps previous data while reloading. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";

export function useApi<T = any>(path: string | null, opts: { live?: boolean; deps?: any[] } = {}) {
  const { tick, city } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const live = opts.live !== false;

  const load = useCallback(async () => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const sep = path.includes("?") ? "&" : "?";
      const full = path.includes("city=") ? path : `${path}${sep}city=${city}`;
      const d = await api.get<T>(full, { signal: c.signal });
      setData(d);
      setError(null);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || "Failed to load");
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
  }, [path, city]);

  useEffect(() => { load(); }, [load, live ? tick : 0, ...(opts.deps || [])]); // eslint-disable-line
  useEffect(() => () => ctrl.current?.abort(), []);
  return { data, error, loading, reload: load, setData };
}

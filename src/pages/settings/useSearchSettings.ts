import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type SearchSettings = {
  max_concurrency: number;
  memory_soft_limit_mb: number;
  per_source_timeout_ms: number;
  reclaim_batch: number;
};

const DEFAULTS: SearchSettings = {
  max_concurrency: 8,
  memory_soft_limit_mb: 400,
  per_source_timeout_ms: 2000,
  reclaim_batch: 2,
};

export function useSearchSettings() {
  const [settings, setSettings] = useState<SearchSettings>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The backend doesn't currently expose a getter for settings; we
  // start with defaults and update on save. (A getter can be added
  // later if needed.)
  useEffect(() => {
    setError(null);
  }, [settings]);

  const save = useCallback(async (next: SearchSettings) => {
    setSaving(true);
    setError(null);
    try {
      await invoke('update_search_settings', { settings: next });
      setSettings(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, save, error, saving };
}

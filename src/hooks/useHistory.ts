import { useCallback, useEffect, useState } from 'react';
import type { MeetingMeta } from '../logic/types';
import { HistoryIndex } from '../logic/HistoryIndex';
import { fsAdapter } from '../adapters/FsAdapter';

export function useHistory() {
  const [list, setList] = useState<MeetingMeta[]>([]);
  const [crashed, setCrashed] = useState<MeetingMeta[]>([]);

  const refresh = useCallback(async () => {
    const h = new HistoryIndex(fsAdapter);
    setList(await h.list());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = new HistoryIndex(fsAdapter);
        setList(await h.list());
        setCrashed(await h.crashRecoveryScan());
      } catch {
        // On first launch before any meeting directories exist, the Rust call
        // may succeed with empty list. If it errors (e.g. in non-Tauri env
        // during vitest), swallow to keep the UI usable.
      }
    })();
  }, []);

  return { list, crashed, refresh };
}

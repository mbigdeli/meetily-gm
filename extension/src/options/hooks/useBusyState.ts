import { useCallback, useState } from "react";

export function useBusyState() {
  const [busyButtons, setBusyButtons] = useState<Record<string, boolean>>({});

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyButtons((prev) => ({ ...prev, [id]: busy }));
  }, []);

  const isBusy = useCallback(
    (id: string) => busyButtons[id] ?? false,
    [busyButtons],
  );

  const runBusy = useCallback(
    async (id: string, action: () => Promise<void>) => {
      if (busyButtons[id]) return;
      setBusy(id, true);
      try {
        await action();
      } finally {
        setBusy(id, false);
      }
    },
    [busyButtons, setBusy],
  );

  return { busyButtons, isBusy, runBusy };
}

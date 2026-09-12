import { useCallback, useMemo, useState } from "react";

/** Checkbox selection over a list of ids; ids that leave the list drop out. */
export function useSelection(ids: string[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => {
    const live = new Set(ids);
    return new Set([...picked].filter((id) => live.has(id)));
  }, [picked, ids]);
  const toggle = useCallback((id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    }), []);
  const clear = useCallback(() => setPicked(new Set()), []);
  const all = ids.length > 0 && selected.size === ids.length;
  const toggleAll = useCallback(
    () => setPicked(all ? new Set() : new Set(ids)),
    [all, ids],
  );
  return {
    selected,
    has: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    clear,
    all,
    count: selected.size,
  };
}

export type Selection = ReturnType<typeof useSelection>;

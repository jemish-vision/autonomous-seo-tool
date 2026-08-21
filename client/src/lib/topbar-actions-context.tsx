import { createContext, useContext, useState, type ReactNode } from "react";

interface TopbarActionsValue {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}

const TopbarActionsContext = createContext<TopbarActionsValue | null>(null);

/** Lets a route-level client component register right-slot buttons (Export, + New crawl, ...). */
export function TopbarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <TopbarActionsContext.Provider value={{ actions, setActions }}>{children}</TopbarActionsContext.Provider>
  );
}

export function useTopbarActions(): TopbarActionsValue {
  const ctx = useContext(TopbarActionsContext);
  if (!ctx) throw new Error("useTopbarActions must be used within TopbarActionsProvider");
  return ctx;
}

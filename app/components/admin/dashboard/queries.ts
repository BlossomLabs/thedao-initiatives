import { useQuery } from "@tanstack/react-query";
import { sessionKey, useSession } from "~/context/session";
import { api } from "~/lib/api";
import type { AdminInitiativePage, AdminListRow, AdminStatus, AdminTodo } from "~/lib/api-types";

/** Under ["admin"], so the initiative page's refresh (it invalidates ["admin"]) reaches them. */
export const todoKey = ["admin", "todo"] as const;
export const listKey = ["admin", "list"] as const;
export const statusKey = ["admin", "status"] as const;

/** The dashboard's first paint: what waits for an admin (KV only on the server). */
export function useAdminTodo() {
  const { session } = useSession();
  return useQuery({
    queryKey: [...todoKey, sessionKey(session)],
    queryFn: ({ signal }) => api<AdminTodo>("/api/admin/todo", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
}

/** The full table, fetched only once it is opened. */
export function useAdminList(enabled: boolean) {
  const { session } = useSession();
  return useQuery({
    queryKey: [...listKey, sessionKey(session)],
    queryFn: ({ signal }) => api<{ rows: AdminListRow[] }>("/api/admin/initiatives", { signal }),
    enabled: Boolean(session?.isAdmin) && enabled,
  });
}

export function useAdminStatus(enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: [...statusKey, sessionKey(session)],
    queryFn: ({ signal }) => api<AdminStatus>("/api/admin/status", { signal }),
    enabled: Boolean(session?.isAdmin) && enabled,
  });
}

/**
 * One initiative's admin page, fetched when its row opens. The key is the one
 * the initiative page uses, so opening the page after the row shows it at once.
 */
export function useAdminPage(slug: string, enabled: boolean) {
  const { session } = useSession();
  return useQuery({
    queryKey: ["admin", "initiative", slug, sessionKey(session)],
    queryFn: ({ signal }) => api<AdminInitiativePage>(`/api/admin/initiatives/${slug}`, { signal }),
    enabled: Boolean(session?.isAdmin) && enabled,
  });
}

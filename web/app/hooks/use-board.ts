import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/api";
import type { Board } from "~/lib/api-types";

export const boardKey = ["board"] as const;

export const BOARD_POLL_MS = 30_000;

export function useBoard() {
  return useQuery({
    queryKey: boardKey,
    queryFn: () => api<Board>("/api/board"),
    refetchInterval: BOARD_POLL_MS,
  });
}

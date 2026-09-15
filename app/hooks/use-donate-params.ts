import { useQuery } from "@tanstack/react-query";
import { API_URL } from "~/lib/api";
import type { DonateParams } from "~/lib/api-types";

/** Accepted tokens + USD rates; a 503 is a valid "disabled" answer. */
export function useDonateParams(enabled = true) {
  return useQuery({
    queryKey: ["donate-params"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DonateParams> => {
      const res = await fetch(API_URL + "/api/donate/params");
      const data = await res.json();
      return data as DonateParams;
    },
  });
}

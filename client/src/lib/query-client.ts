import { QueryClient } from "@tanstack/react-query";

/**
 * One QueryClient for the app. Sensible defaults for a dashboard: data is fresh for 30s, retries
 * once, and we don't refetch on every window focus (the crawl data changes on a human timescale).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

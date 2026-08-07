import { useEffect, useRef, useState } from "react";

import type { MessengerChat } from "./types.js";

export type ChatSearchState = Readonly<{
  query: string;
  results: readonly MessengerChat[];
  state: "idle" | "searching" | "ready" | "failed";
}>;

export const SEARCH_DEBOUNCE_MS = 350;
export const SEARCH_MIN_LENGTH = 2;

/**
 * Runs a global search a short pause after typing stops. Every keystroke would
 * otherwise reach MAX itself, so the query is debounced and any request left
 * over from an earlier keystroke is abandoned before its result can overwrite a
 * newer one.
 */
export function useChatSearch(
  query: string,
  search?: (
    query: string,
    signal: AbortSignal
  ) => Promise<readonly MessengerChat[]>
): ChatSearchState {
  const [result, setResult] = useState<ChatSearchState>({
    query: "",
    results: [],
    state: "idle"
  });
  const searchRef = useRef(search);
  searchRef.current = search;
  const trimmed = query.trim();

  useEffect(() => {
    const run = searchRef.current;
    if (run === undefined || trimmed.length < SEARCH_MIN_LENGTH) {
      setResult({ query: trimmed, results: [], state: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult((previous) => ({
        query: trimmed,
        results: previous.query === trimmed ? previous.results : [],
        state: "searching"
      }));
      run(trimmed, controller.signal).then(
        (results) => {
          if (!controller.signal.aborted) {
            setResult({ query: trimmed, results, state: "ready" });
          }
        },
        () => {
          if (!controller.signal.aborted) {
            setResult({ query: trimmed, results: [], state: "failed" });
          }
        }
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return result;
}

import {
  useEffect,
  useState
} from "react";

export const WIDE_PANE_QUERY = "(min-width: 820px)";

export function useResponsivePane(): boolean {
  const [wide, setWide] = useState(() =>
    window.matchMedia(WIDE_PANE_QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(WIDE_PANE_QUERY);
    const update = (event: MediaQueryListEvent) => {
      setWide(event.matches);
    };
    setWide(media.matches);
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return wide;
}

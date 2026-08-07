/** The badge MAX draws beside an official account or channel. */
export function VerifiedBadge() {
  return (
    <svg
      className="verified-badge"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Подтверждённый аккаунт"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 1.6l2.5 2.1 3.2-.4 1 3.1 2.9 1.5-1.2 3 1.2 3-2.9 1.5-1 3.1-3.2-.4L12 22.4l-2.5-2.1-3.2.4-1-3.1L2.4 16l1.2-3-1.2-3 2.9-1.5 1-3.1 3.2.4L12 1.6z"
      />
      <path
        fill="var(--surface)"
        d="M10.8 15.4l-3-3 1.3-1.3 1.7 1.7 4.1-4.1 1.3 1.3-5.4 5.4z"
      />
    </svg>
  );
}

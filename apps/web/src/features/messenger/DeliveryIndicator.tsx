import type { DeliveryStatus } from "./types.js";

type DeliveryIndicatorProps = Readonly<{
  status: DeliveryStatus;
  preview?: boolean;
}>;

const DELIVERY_VIEW: Readonly<Record<
  DeliveryStatus,
  readonly [glyph: string, label: string]
>> = {
  pending: ["◷", "Отправляется"],
  sent: ["✓", "Отправлено"],
  delivered: ["✓", "Доставлено"],
  read: ["✓✓", "Прочитано"],
  failed: ["!", "Не отправлено"]
};

export function DeliveryIndicator({
  status,
  preview = false
}: DeliveryIndicatorProps) {
  const [glyph, label] = DELIVERY_VIEW[status];
  const ariaLabel = preview
    ? `Последнее сообщение ${label.toLocaleLowerCase("ru-RU")}`
    : label;
  return (
    <span
      className={`delivery-indicator delivery-indicator--${status}`}
      aria-label={ariaLabel}
    >
      {glyph}
    </span>
  );
}

export type PrivateNotification = Readonly<{
  senderName: string;
  kind: "text" | "image" | "video" | "voice" | "file";
  messageBody?: string;
  mediaUrl?: string;
}>;

const kindLabels: Readonly<Record<PrivateNotification["kind"], string>> = {
  text: "Сообщение",
  image: "Фото",
  video: "Видео",
  voice: "Голосовое",
  file: "Файл"
};

export function formatPrivateNotification(
  notification: PrivateNotification
): string {
  const senderName = notification.senderName.slice(0, 256);
  return `Новое сообщение от ${senderName} · ${kindLabels[notification.kind]}`;
}

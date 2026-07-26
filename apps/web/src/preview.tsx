import { createRoot } from "react-dom/client";

import { MessengerShell } from "./features/messenger/MessengerShell.js";
import type {
  MessengerChat,
  MessengerMessage
} from "./features/messenger/types.js";
import "./styles/tokens.css";
import "./styles/global.css";

const previewChats: readonly MessengerChat[] = [
  {
    id: "alex",
    title: "Алексей",
    preview: "Привет! Ты видел фото?",
    timestamp: "2026-07-26T13:42:00.000Z",
    formattedTime: "13:42",
    unreadCount: 2,
    muted: false,
    kind: "direct"
  },
  {
    id: "friends",
    title: "Друзья",
    preview: "Лена: Встречаемся в семь?",
    timestamp: "2026-07-26T13:10:00.000Z",
    formattedTime: "13:10",
    unreadCount: 5,
    muted: false,
    kind: "group"
  },
  {
    id: "mother",
    title: "Мама",
    preview: "Хорошо ❤️",
    timestamp: "2026-07-25T20:30:00.000Z",
    formattedTime: "вчера",
    unreadCount: 0,
    muted: false,
    kind: "direct",
    deliveryStatus: "read"
  },
  {
    id: "saved",
    title: "Избранное",
    preview: "Сохраните что-нибудь",
    timestamp: "2026-07-25T18:12:00.000Z",
    formattedTime: "вчера",
    unreadCount: 0,
    muted: false,
    kind: "direct",
    deliveryStatus: "read"
  }
];

const previewMessages: readonly MessengerMessage[] = [
  {
    id: "one",
    text: "Привет! Ты видел фото?",
    direction: "incoming",
    sentAt: "13:40"
  },
  {
    id: "two",
    text: "Да, сейчас отвечу",
    direction: "outgoing",
    sentAt: "13:42",
    status: "read"
  }
];

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Preview root is missing");
}

createRoot(root).render(
  <MessengerShell
    chats={previewChats}
    messages={previewMessages}
    initialChatId="alex"
    initialPane="conversation"
    onSelectChat={() => {}}
    onSend={() => {}}
  />
);

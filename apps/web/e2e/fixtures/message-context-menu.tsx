import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MessengerShell } from "../../src/features/messenger/MessengerShell.js";
import type {
  MessengerChat,
  MessengerMessage
} from "../../src/features/messenger/types.js";
import "../../src/styles/tokens.css";
import "../../src/styles/global.css";

const chat: MessengerChat = {
  id: "menu-chat",
  title: "Собеседник",
  preview: "Последнее сообщение",
  timestamp: "2026-11-09T06:00:00.000Z",
  unreadCount: 0,
  muted: false,
  kind: "direct"
};

function message(index: number): MessengerMessage {
  return {
    id: `message-${String(index)}`,
    text: `Сообщение ${String(index)}`,
    direction: "incoming",
    sentAt: "2026-11-09T06:00:00.000Z"
  };
}

function MessageMenuFixture() {
  const [messages, setMessages] = useState<readonly MessengerMessage[]>(
    () => Array.from({ length: 40 }, (_, index) => message(index))
  );

  useEffect(() => {
    function receiveMessage() {
      setMessages((previous) => [...previous, message(previous.length)]);
    }
    function refreshHistory() {
      setMessages((previous) => previous.map((item) => ({ ...item })));
    }
    window.addEventListener("test:incoming-message", receiveMessage);
    window.addEventListener("test:refresh-history", refreshHistory);
    return () => {
      window.removeEventListener("test:incoming-message", receiveMessage);
      window.removeEventListener("test:refresh-history", refreshHistory);
    };
  }, []);

  return (
    <MessengerShell
      chats={[chat]}
      messages={messages}
      initialChatId={chat.id}
      initialPane="conversation"
      onSelectChat={() => {}}
      onSend={() => {}}
      onReactMessage={() => {}}
    />
  );
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Message menu fixture root is missing");
}
createRoot(root).render(<MessageMenuFixture />);

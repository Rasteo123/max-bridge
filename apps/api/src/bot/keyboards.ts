import type { OutboundBotButton } from "./contracts.js";

export function miniAppButton(miniAppUrl: string): OutboundBotButton {
  return {
    text: "Открыть MAX",
    webAppUrl: miniAppUrl
  };
}

export function approvalButtons(
  requestHandle: string
): readonly OutboundBotButton[] {
  return [
    {
      text: "Разрешить",
      callbackData: `approval:allow:${requestHandle}`
    },
    {
      text: "Отклонить",
      callbackData: `approval:reject:${requestHandle}`
    }
  ];
}

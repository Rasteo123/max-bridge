import type {
  BotActor,
  BotControllerDependencies
} from "../contracts.js";
import { approvalButtons, miniAppButton } from "../keyboards.js";

const usableStates = new Set([
  "approved_unbound",
  "authenticating",
  "active",
  "reauth_required"
]);

export async function handleStart(
  actor: BotActor,
  dependencies: BotControllerDependencies
): Promise<void> {
  const request = await dependencies.gateway.requestAccess(actor);
  if (request.state === "pending") {
    await dependencies.transport.send({
      chatId: actor.telegramId,
      text: "Заявка отправлена. Дождитесь одобрения администратора."
    });
    if (request.created && request.requestHandle !== undefined) {
      const displayName = [
        actor.firstName,
        actor.lastName
      ].filter((value) => value !== undefined).join(" ");
      await dependencies.transport.send({
        chatId: dependencies.adminTelegramId,
        text: [
          "Новая заявка в MAX-мост",
          `Пользователь: ${displayName}`,
          `Telegram ID: ${actor.telegramId}`
        ].join("\n"),
        buttons: approvalButtons(request.requestHandle)
      });
    }
    return;
  }

  if (usableStates.has(request.state)) {
    await dependencies.transport.send({
      chatId: actor.telegramId,
      text: request.state === "reauth_required"
        ? "Нужно повторно войти в MAX."
        : "Доступ разрешён.",
      buttons: [miniAppButton(dependencies.miniAppUrl)]
    });
    return;
  }

  await dependencies.transport.send({
    chatId: actor.telegramId,
    text: "Доступ к сервису отключён администратором."
  });
}

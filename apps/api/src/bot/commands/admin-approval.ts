import type { BotControllerDependencies } from "../contracts.js";
import { miniAppButton } from "../keyboards.js";

export type ApprovalDecisionInput = Readonly<{
  actorTelegramId: string;
  requestHandle: string;
  decision: "allow" | "reject";
}>;

export async function handleApprovalDecision(
  input: ApprovalDecisionInput,
  dependencies: BotControllerDependencies
): Promise<void> {
  if (input.actorTelegramId !== dependencies.adminTelegramId) {
    await dependencies.transport.answerCallback(
      input.actorTelegramId,
      "Недостаточно прав"
    );
    return;
  }
  if (!/^[A-Za-z0-9_-]{22}$/u.test(input.requestHandle)) {
    await dependencies.transport.answerCallback(
      input.actorTelegramId,
      "Некорректная заявка"
    );
    return;
  }

  const result = await dependencies.gateway.decide(
    input.requestHandle,
    input.decision
  );
  if (result === null) {
    await dependencies.transport.answerCallback(
      input.actorTelegramId,
      "Заявка уже обработана"
    );
    return;
  }

  if (input.decision === "allow") {
    await dependencies.transport.send({
      chatId: result.telegramId,
      text: "Администратор одобрил доступ.",
      buttons: [miniAppButton(dependencies.miniAppUrl)]
    });
    await dependencies.transport.answerCallback(
      input.actorTelegramId,
      "Доступ разрешён"
    );
    return;
  }

  await dependencies.transport.send({
    chatId: result.telegramId,
    text: "Администратор отклонил заявку."
  });
  await dependencies.transport.answerCallback(
    input.actorTelegramId,
    "Заявка отклонена"
  );
}

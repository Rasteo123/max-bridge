import {
  Markup,
  Telegraf,
  type Telegram
} from "telegraf";

import {
  handleApprovalDecision
} from "./commands/admin-approval.js";
import { handleStart } from "./commands/start.js";
import type {
  BotActor,
  BotControllerDependencies,
  BotTransport,
  FriendAccessGateway,
  OutboundBotButton,
  OutboundBotMessage
} from "./contracts.js";

export {
  handleApprovalDecision,
  handleStart
};
export type {
  BotActor,
  BotControllerDependencies,
  BotTransport,
  FriendAccessGateway,
  OutboundBotMessage
};

export type TelegramBotOptions = Readonly<{
  token: string;
  adminTelegramId: string;
  miniAppUrl: string;
  gateway: FriendAccessGateway;
}>;

export function createTelegramBot(options: TelegramBotOptions): Telegraf {
  const bot = new Telegraf(options.token);

  bot.start(async (context) => {
    const actor = actorFromContext(context.from);
    if (actor === null) {
      return;
    }
    await handleStart(actor, {
      ...options,
      transport: new TelegrafTransport(bot.telegram)
    });
  });

  bot.action(
    /^approval:(allow|reject):([A-Za-z0-9_-]{22})$/u,
    async (context) => {
      const decision = context.match[1];
      const requestHandle = context.match[2];
      if (
        (decision !== "allow" && decision !== "reject")
        || requestHandle === undefined
      ) {
        return;
      }
      await handleApprovalDecision({
        actorTelegramId: String(context.from.id),
        decision,
        requestHandle
      }, {
        ...options,
        transport: new TelegrafTransport(
          bot.telegram,
          context.callbackQuery.id
        )
      });
    }
  );

  return bot;
}

class TelegrafTransport implements BotTransport {
  constructor(
    private readonly telegram: Telegram,
    private readonly callbackQueryId?: string
  ) {}

  async send(message: OutboundBotMessage): Promise<void> {
    const buttons = message.buttons?.map(toTelegrafButton);
    await this.telegram.sendMessage(
      message.chatId,
      message.text,
      buttons === undefined
        ? {}
        : Markup.inlineKeyboard([buttons])
    );
  }

  async answerCallback(
    _actorTelegramId: string,
    text: string
  ): Promise<void> {
    if (this.callbackQueryId !== undefined) {
      await this.telegram.answerCbQuery(this.callbackQueryId, text);
    }
  }
}

function toTelegrafButton(button: OutboundBotButton) {
  return "callbackData" in button
    ? Markup.button.callback(button.text, button.callbackData)
    : Markup.button.webApp(button.text, button.webAppUrl);
}

function actorFromContext(
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  } | undefined
): BotActor | null {
  if (from === undefined) {
    return null;
  }
  return {
    telegramId: String(from.id),
    firstName: from.first_name,
    ...(from.last_name === undefined ? {} : { lastName: from.last_name }),
    ...(from.username === undefined ? {} : { username: from.username })
  };
}

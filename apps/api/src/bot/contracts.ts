import type { UserState } from "@maxbridge/core";

export type BotActor = Readonly<{
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
}>;

export type OutboundBotButton =
  | Readonly<{
      text: string;
      callbackData: string;
    }>
  | Readonly<{
      text: string;
      webAppUrl: string;
    }>;

export type OutboundBotMessage = Readonly<{
  chatId: string;
  text: string;
  buttons?: readonly OutboundBotButton[];
}>;

export interface BotTransport {
  send(message: OutboundBotMessage): Promise<void>;
  answerCallback(actorTelegramId: string, text: string): Promise<void>;
}

export type AccessRequestResult = Readonly<{
  state: UserState;
  created: boolean;
  requestHandle?: string;
}>;

export type AccessDecisionResult = Readonly<{
  telegramId: string;
  state: UserState;
}>;

export interface FriendAccessGateway {
  requestAccess(actor: BotActor): Promise<AccessRequestResult>;
  decide(
    requestHandle: string,
    decision: "allow" | "reject"
  ): Promise<AccessDecisionResult | null>;
}

export type BotControllerDependencies = Readonly<{
  adminTelegramId: string;
  miniAppUrl: string;
  gateway: FriendAccessGateway;
  transport: BotTransport;
}>;

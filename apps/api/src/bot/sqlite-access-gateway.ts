import type {
  AccessDecisionResult,
  AccessRequestResult,
  BotActor,
  FriendAccessGateway
} from "./contracts.js";
import type { ApprovalRepository } from "../db/approval-repository.js";
import type { UsersRepository } from "../db/users-repository.js";

export class SqliteFriendAccessGateway implements FriendAccessGateway {
  constructor(
    private readonly users: UsersRepository,
    private readonly approvals: ApprovalRepository
  ) {}

  async requestAccess(actor: BotActor): Promise<AccessRequestResult> {
    const user = await this.users.createPending({
      telegramId: actor.telegramId,
      firstName: actor.firstName,
      ...(actor.lastName === undefined ? {} : { lastName: actor.lastName }),
      ...(actor.username === undefined ? {} : { username: actor.username })
    });
    if (user.state !== "pending") {
      return {
        state: user.state,
        created: false
      };
    }
    const requestHandle = this.approvals.createForUser(user.lookupId);
    return {
      state: user.state,
      created: requestHandle !== null,
      ...(requestHandle === null ? {} : { requestHandle })
    };
  }

  async decide(
    requestHandle: string,
    decision: "allow" | "reject"
  ): Promise<AccessDecisionResult | null> {
    const result = this.approvals.decide(requestHandle, decision);
    if (result === null) {
      return null;
    }
    const identity = await this.users.findIdentityByLookup(result.userLookup);
    if (identity === null) {
      throw new Error("Approved user identity is unavailable");
    }
    return {
      telegramId: identity.telegramId,
      state: result.state
    };
  }
}

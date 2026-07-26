import type { AuthUserGateway } from "./auth-routes.js";
import type { SessionPrincipal } from "./session-store.js";
import type { UsersRepository } from "../db/users-repository.js";

export class RepositoryAuthUserGateway implements AuthUserGateway {
  constructor(private readonly users: UsersRepository) {}

  findPrincipal(telegramId: string): SessionPrincipal | null {
    const user = this.users.findUser(telegramId);
    return user === null
      ? null
      : {
          userLookup: user.lookupId,
          userState: user.state
        };
  }
}

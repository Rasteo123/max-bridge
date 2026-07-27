export type SocketFactory = (
  url: string
) => WebSocket;

export type AuthenticatedSocketOptions = Readonly<{
  initData: () => string;
  authenticate: (initData: string) => Promise<void>;
  isAuthenticationRejected?(error: unknown): boolean;
  createSocket?: SocketFactory;
  path?: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onMessage?(value: unknown): void;
  onStatus?(status: "connected" | "reconnecting" | "disconnected"): void;
  onAuthenticationExpired?(): void;
}>;

export class AuthenticatedSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private started = false;
  private stopped = false;
  private paused = false;
  private lifecycleVersion = 0;
  private resumePromise: Promise<boolean> | null = null;

  constructor(private readonly options: AuthenticatedSocketOptions) {}

  start(): void {
    if (this.stopped || this.started) {
      return;
    }
    this.started = true;
    this.paused = false;
    this.options.onStatus?.("reconnecting");
    this.connect();
  }

  pause(): void {
    if (this.stopped) {
      return;
    }
    if (this.paused) {
      if (this.resumePromise !== null) {
        this.lifecycleVersion += 1;
      }
      return;
    }
    this.started = true;
    this.paused = true;
    this.lifecycleVersion += 1;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1_000, "client_pause");
    this.options.onStatus?.("disconnected");
  }

  resume(): Promise<boolean> {
    if (
      this.stopped ||
      !this.started ||
      !this.paused ||
      this.resumePromise !== null
    ) {
      return Promise.resolve(false);
    }
    const lifecycleVersion = this.lifecycleVersion;
    const operation = this.reauthenticateForResume(lifecycleVersion);
    this.resumePromise = operation;
    void operation.finally(() => {
      if (this.resumePromise === operation) {
        this.resumePromise = null;
      }
    });
    return operation;
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.paused = false;
    this.lifecycleVersion += 1;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1_000, "client_stop");
    this.options.onStatus?.("disconnected");
  }

  private connect(): void {
    if (this.stopped || this.paused || !this.started) {
      return;
    }
    const location = window.location;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const path = this.options.path ?? "/api/ws";
    const createSocket = this.options.createSocket ??
      ((url: string) => new WebSocket(url));
    const socket = createSocket(
      `${protocol}//${location.host}${path}`
    );
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (
        this.socket !== socket ||
        this.stopped ||
        this.paused
      ) {
        return;
      }
      this.reconnectAttempts = 0;
      this.options.onStatus?.("connected");
    });
    socket.addEventListener("message", (event) => {
      if (
        this.socket !== socket ||
        this.stopped ||
        this.paused
      ) {
        return;
      }
      if (typeof event.data !== "string") {
        return;
      }
      try {
        this.options.onMessage?.(JSON.parse(event.data) as unknown);
      } catch {
        // Invalid live frames are ignored and never enter the UI store.
      }
    });
    socket.addEventListener("close", (event) => {
      if (
        this.socket !== socket ||
        this.stopped ||
        this.paused
      ) {
        return;
      }
      this.socket = null;
      if (event.code === 4_401 || event.code === 1_008) {
        this.options.onStatus?.("reconnecting");
        void this.reauthenticateAndReconnect();
        return;
      }
      this.options.onStatus?.("reconnecting");
      this.scheduleReconnect();
    });
  }

  private async reauthenticateAndReconnect(): Promise<void> {
    const lifecycleVersion = this.lifecycleVersion;
    try {
      const initData = this.options.initData();
      if (initData.length === 0) {
        this.expireAuthentication();
        return;
      }
      await this.options.authenticate(initData);
      if (!this.isCurrentRunningLifecycle(lifecycleVersion)) {
        return;
      }
      this.scheduleReconnect();
    } catch (error: unknown) {
      if (!this.isCurrentRunningLifecycle(lifecycleVersion)) {
        return;
      }
      if (this.options.isAuthenticationRejected?.(error) === true) {
        this.expireAuthentication();
        return;
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (
      this.stopped ||
      this.paused ||
      !this.started ||
      this.reconnectTimer !== null
    ) {
      return;
    }
    const baseDelay = this.options.reconnectDelayMs ?? 1_000;
    const maxDelay = this.options.maxReconnectDelayMs ?? 30_000;
    const delay = Math.min(
      maxDelay,
      baseDelay * 2 ** Math.min(this.reconnectAttempts, 8)
    );
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts >= 5) {
      this.options.onStatus?.("disconnected");
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private expireAuthentication(): void {
    this.stopped = true;
    this.started = false;
    this.paused = false;
    this.lifecycleVersion += 1;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1_000, "authentication_expired");
    this.options.onStatus?.("disconnected");
    this.options.onAuthenticationExpired?.();
  }

  private async reauthenticateForResume(
    lifecycleVersion: number
  ): Promise<boolean> {
    try {
      const initData = this.options.initData();
      if (initData.length === 0) {
        this.expireAuthentication();
        return false;
      }
      await this.options.authenticate(initData);
      if (
        this.stopped ||
        !this.started ||
        !this.paused ||
        this.lifecycleVersion !== lifecycleVersion
      ) {
        return false;
      }
      this.paused = false;
      this.reconnectAttempts = 0;
      this.options.onStatus?.("reconnecting");
      this.connect();
      return true;
    } catch (error: unknown) {
      if (
        this.stopped ||
        this.lifecycleVersion !== lifecycleVersion
      ) {
        return false;
      }
      if (this.options.isAuthenticationRejected?.(error) === true) {
        this.expireAuthentication();
        return false;
      }
      this.options.onStatus?.("disconnected");
      return false;
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private isCurrentRunningLifecycle(version: number): boolean {
    return !this.stopped &&
      this.started &&
      !this.paused &&
      this.lifecycleVersion === version;
  }
}

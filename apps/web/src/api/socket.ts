export type SocketFactory = (
  url: string
) => WebSocket;

export type AuthenticatedSocketOptions = Readonly<{
  initData: () => string;
  authenticate: (initData: string) => Promise<void>;
  createSocket?: SocketFactory;
  path?: string;
  reconnectDelayMs?: number;
  onMessage?(value: unknown): void;
  onStatus?(status: "connected" | "reconnecting" | "disconnected"): void;
}>;

export class AuthenticatedSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly options: AuthenticatedSocketOptions) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.options.onStatus?.("reconnecting");
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(1_000, "client_stop");
    this.socket = null;
    this.options.onStatus?.("disconnected");
  }

  private connect(): void {
    if (this.stopped) {
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
      this.options.onStatus?.("connected");
    });
    socket.addEventListener("message", (event) => {
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
      if (this.stopped) {
        return;
      }
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
    try {
      const initData = this.options.initData();
      if (initData.length === 0) {
        return;
      }
      await this.options.authenticate(initData);
      this.scheduleReconnect();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.reconnectDelayMs ?? 1_000);
  }
}

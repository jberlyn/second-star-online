/**
 * The client's connection. Sends intents, delivers server messages, and after an unexpected drop
 * reconnects with the resume token for up to the server's grace period, so a blip does not log you
 * out.
 */
import type { ClientMsg, ServerMsg } from "@secondstaronline/shared";

export interface Connection {
  send(msg: ClientMsg): void;
  close(): void;
  /** Replaced by the app: called for every server message. */
  onMessage: (msg: ServerMsg) => void;
  /**
   * Called when the connection is gone for good (logout, kick, resume refused). `relogin` marks a
   * refused resume: the player meant to stay, so the app reopens Load Character, not the title.
   */
  onGone: (text: string | null, relogin?: boolean) => void;
  /** The token from the last `welcome`, used to resume. */
  token: string | null;
}

export const RESUME_DELAY_MS = 1000;
export const RESUME_ATTEMPTS = 25;

/** Server close codes after which reconnecting would be wrong (logout, kick, flooding). */
// 4007 (fell behind) is deliberately absent: the client resumes and gets a fresh snapshot.
const FINAL_CODES = new Set([4001, 4002, 4003, 4004, 4005, 4006]);

export function wsUrl(loc: Location = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

export function connect(url: string = wsUrl()): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let ws = new WebSocket(url);
    let queue: ClientMsg[] = [];
    let closedByUs = false;
    let attempts = 0;
    let resolved = false;
    /** A resume was sent on this socket and has not been answered yet. */
    let resuming = false;
    /** `onGone` has run: the closes that follow are ours to ignore. */
    let ended = false;
    const end = (text: string | null, relogin = false) => {
      if (ended) {
        return;
      }
      ended = true;
      conn.onGone(text, relogin);
    };

    const conn: Connection = {
      token: null,
      onMessage: () => {},
      onGone: () => {},
      send(msg) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        } else {
          queue.push(msg);
        }
      },
      close() {
        closedByUs = true;
        ws.close();
      },
    };

    const wire = (sock: WebSocket) => {
      sock.addEventListener("open", () => {
        attempts = 0;
        if (!resolved) {
          resolved = true;
          resolve(conn);
        } else if (conn.token) {
          resuming = true;
          sock.send(JSON.stringify({ t: "resume", token: conn.token }));
        }
        for (const m of queue) {
          sock.send(JSON.stringify(m));
        }
        queue = [];
      });
      sock.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data)) as ServerMsg;
        if (msg.t === "welcome") {
          resuming = false;
          conn.token = msg.token;
        }
        if (msg.t === "denied" && resuming) {
          // A refused resume (the grace ran out, or a ban since the drop) ends the session: this
          // socket was never in game, so the app must go back to the title, not stay on a dead
          // game screen whose Log out the server ignores. It reopens Load Character to log in again.
          resuming = false;
          conn.token = null;
          closedByUs = true;
          sock.close();
          end(msg.text, true);
          return;
        }
        conn.onMessage(msg);
      });
      sock.addEventListener("close", (e) => {
        if (!resolved) {
          reject(new Error("could not connect"));
          return;
        }
        if (ended) {
          return;
        }
        if (closedByUs || FINAL_CODES.has(e.code) || !conn.token) {
          end(null);
          return;
        }
        if (attempts >= RESUME_ATTEMPTS) {
          end("Disconnected!"); // 1.6's text for a lost connection
          return;
        }
        attempts += 1;
        setTimeout(() => {
          ws = new WebSocket(url);
          wire(ws);
        }, RESUME_DELAY_MS);
      });
    };
    wire(ws);
  });
}

/**
 * Connects, retrying every `RESUME_DELAY_MS` while the server is unreachable (a restart takes it
 * away for a moment), so a fresh start after a lost session never strands the client without a
 * connection. Resolves null once `stopped()` turns true.
 */
export async function connectRetrying(
  stopped: () => boolean,
  url: string = wsUrl(),
): Promise<Connection | null> {
  for (;;) {
    try {
      return await connect(url);
    } catch {
      if (stopped()) {
        return null;
      }
      await new Promise((r) => setTimeout(r, RESUME_DELAY_MS));
    }
  }
}

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
  /** Called when the connection is gone for good (logout, kick, resume refused). */
  onGone: (text: string | null) => void;
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
          conn.token = msg.token;
        }
        if (msg.t === "denied" && conn.token && msg.text) {
          // A refused resume ends the session.
          conn.token = null;
        }
        conn.onMessage(msg);
      });
      sock.addEventListener("close", (e) => {
        if (!resolved) {
          reject(new Error("could not connect"));
          return;
        }
        if (closedByUs || FINAL_CODES.has(e.code) || !conn.token) {
          conn.onGone(null);
          return;
        }
        if (attempts >= RESUME_ATTEMPTS) {
          conn.onGone("Disconnected!"); // 1.6's text for a lost connection
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

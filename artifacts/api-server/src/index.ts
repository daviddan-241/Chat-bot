import http from "http";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/api/terminal/socket.io",
});

interface TerminalSession {
  proc: ChildProcessWithoutNullStreams;
  clients: Set<string>;
  killTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, TerminalSession>();
const IDLE_MS = 10 * 60 * 1000;

function spawnShell(): ChildProcessWithoutNullStreams {
  const shell = process.env["SHELL"] || "bash";
  return spawn(shell, [], {
    cwd: process.env["HOME"] || "/home/runner",
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

function scheduleKill(sessionId: string) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  if (sess.killTimer) clearTimeout(sess.killTimer);
  sess.killTimer = setTimeout(() => {
    try { sess.proc.kill(); } catch (_) {}
    sessions.delete(sessionId);
    logger.info({ sessionId }, "Terminal session expired");
  }, IDLE_MS);
}

io.on("connection", (socket) => {
  const sessionId = (socket.handshake.query["sessionId"] as string) ||
    `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  let sess = sessions.get(sessionId);
  if (!sess) {
    const proc = spawnShell();
    sess = { proc, clients: new Set(), killTimer: null };
    sessions.set(sessionId, sess);

    proc.stdout.on("data", (data: Buffer) => {
      io.to(sessionId).emit("output", data.toString());
    });
    proc.stderr.on("data", (data: Buffer) => {
      io.to(sessionId).emit("output", data.toString());
    });
    proc.on("close", (exitCode) => {
      io.to(sessionId).emit("exit", { exitCode });
      sessions.delete(sessionId);
      logger.info({ sessionId, exitCode }, "Terminal process exited");
    });
    proc.on("error", (err) => {
      io.to(sessionId).emit("output", `\r\nShell error: ${err.message}\r\n`);
      sessions.delete(sessionId);
    });

    logger.info({ sessionId }, "Terminal session created");
  } else {
    if (sess.killTimer) clearTimeout(sess.killTimer);
  }

  sess.clients.add(socket.id);
  socket.join(sessionId);
  socket.emit("session_ready", { sessionId });

  socket.on("input", (data: string) => {
    try {
      sessions.get(sessionId)?.proc.stdin.write(data);
    } catch (_) {}
  });

  socket.on("resize", (_dims: { cols: number; rows: number }) => {
  });

  socket.on("disconnect", () => {
    const s = sessions.get(sessionId);
    if (s) {
      s.clients.delete(socket.id);
      if (s.clients.size === 0) scheduleKill(sessionId);
    }
  });
});

server.listen(port, () => { logger.info({ port }, "Server listening"); });

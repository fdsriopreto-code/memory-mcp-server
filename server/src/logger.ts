import { broadcast } from "./ws.js";

export type LogLevel = "log" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

const RING_SIZE = 500;
const buffer: LogEntry[] = [];

function push(level: LogLevel, args: unknown[]) {
  const msg = args
    .map(a => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  const entry: LogEntry = { ts: Date.now(), level, msg };
  buffer.push(entry);
  if (buffer.length > RING_SIZE) buffer.shift();
  try { broadcast("server_log", entry); } catch { /* ws not ready yet */ }
}

export function getLogBuffer(): LogEntry[] {
  return [...buffer];
}

export function patchConsole(): void {
  const orig = {
    log:   console.log.bind(console),
    info:  console.info.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log   = (...a: unknown[]) => { orig.log(...a);   push("log",   a); };
  console.info  = (...a: unknown[]) => { orig.info(...a);  push("info",  a); };
  console.warn  = (...a: unknown[]) => { orig.warn(...a);  push("warn",  a); };
  console.error = (...a: unknown[]) => { orig.error(...a); push("error", a); };
}

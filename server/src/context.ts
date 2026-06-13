import { AsyncLocalStorage } from "node:async_hooks";

interface RequestCtx {
  sessionId: string | null;
}

export const requestCtx = new AsyncLocalStorage<RequestCtx>();

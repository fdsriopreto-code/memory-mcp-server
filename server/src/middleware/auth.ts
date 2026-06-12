import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// MCP API key auth (para Claude Code)
export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!key || key !== env.MCP_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// JWT auth (para o painel frontend)
export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Token ausente" }); return; }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    (req as Request & { admin: unknown }).admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

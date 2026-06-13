import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const authRoutes = Router();

authRoutes.post("/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email e password obrigatórios" });
    return;
  }

  if (email.trim().toLowerCase() !== env.ADMIN_EMAIL.toLowerCase() || password !== env.ADMIN_PASSWORD) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const token = jwt.sign({ email }, env.JWT_SECRET, { expiresIn: "30d" });
  res.json({ token });
});

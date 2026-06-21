import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type RawNode = {
  id: string; title: string; type: string; importance: number;
  accessCount: number; isPinned: boolean; content: string;
};
type RawEdge = { fromId: string; toId: string; relation: string };

type Node = RawNode & { x: number; y: number; vx: number; vy: number; radius: number; pinned: boolean };
type Project = { id: string; name: string; slug: string; color: string };

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  DECISION:     "#6366f1",
  CONTEXT:      "#3b82f6",
  PATTERN:      "#10b981",
  NOTE:         "#f59e0b",
  BUG_FIX:      "#ef4444",
  ARCHITECTURE: "#8b5cf6",
  BRAIN:        "#ec4899",
};
const RELATION_COLORS: Record<string, string> = {
  EXTENDS:    "#6366f1",
  SUPERSEDES: "#a855f7",
  CONTRADICTS:"#ef4444",
  DEPENDS_ON: "#3b82f6",
  EXAMPLE_OF: "#10b981",
  RELATED:    "#64748b",
};

const REPULSION   = 3200;
const SPRING_K    = 0.028;
const SPRING_REST = 140;
const CENTER_K    = 0.0012;
const DAMPING     = 0.80;
const DT          = 0.65;

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function lerpColor(a: string, b: string, t: number) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bv = Math.round(ca.b + (cb.b - ca.b) * t);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bv.toString(16).padStart(2,"0")}`;
}

function heatColor(base: string, heat: number): string {
  if (heat < 0.3) return base;
  if (heat < 0.65) return lerpColor(base, "#f97316", (heat - 0.3) / 0.35);
  return lerpColor("#f97316", "#ef4444", (heat - 0.65) / 0.35);
}

function nodeRadius(n: RawNode) { return 6 + n.importance * 2.5; }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function BrainGraphPage() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef<number>(0);
  const nodesRef    = useRef<Node[]>([]);
  const edgesRef    = useRef<RawEdge[]>([]);
  const viewRef     = useRef({ scale: 1, ox: 0, oy: 0 });
  const mouseRef    = useRef({ down: false, nodeId: null as string | null, px: 0, py: 0, ox: 0, oy: 0 });
  const hovRef      = useRef<Node | null>(null);
  const selRef      = useRef<Node | null>(null);
  const startTime   = useRef(performance.now());
  const stableRef   = useRef(0); // tick count when stable

  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length > 0) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  // ── Load graph data ─────────────────────────────────────────────────────────
  const loadGraph = useCallback(() => {
    if (!project) return;
    setLoading(true);
    api.get<{ nodes: RawNode[]; edges: RawEdge[] }>(`/api/projects/${project}/brain-graph`)
      .then(({ nodes: rawNodes, edges }) => {
        const canvas = canvasRef.current;
        const W = canvas ? canvas.offsetWidth  : 1200;
        const H = canvas ? canvas.offsetHeight : 700;
        const cx = W / 2, cy = H / 2;

        const nodes: Node[] = rawNodes.map((n, i) => {
          const angle  = (i / rawNodes.length) * Math.PI * 2;
          const spread = Math.min(200 + rawNodes.length * 8, 350);
          return {
            ...n,
            radius: nodeRadius(n),
            x: cx + Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
            y: cy + Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            pinned: false,
          };
        });

        nodesRef.current = nodes;
        edgesRef.current = edges;
        hovRef.current   = null;
        selRef.current   = null;
        stableRef.current = 0;
        setSelected(null);
        setNodeCount(nodes.length);
        setEdgeCount(edges.length);

        // Reset view
        viewRef.current = { scale: 1, ox: 0, oy: 0 };
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // ── Physics tick ────────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    const cx = W / 2, cy = H / 2;

    // Compute total kinetic energy to detect stability
    let ke = 0;

    for (const n of nodes) {
      if (n.pinned) continue;

      // Center pull
      n.vx += (cx - n.x) * CENTER_K * DT;
      n.vy += (cy - n.y) * CENTER_K * DT;

      // Repulsion (node vs node)
      for (const m of nodes) {
        if (m === n) continue;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const dist2 = Math.max(dx * dx + dy * dy, 1);
        const dist  = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        n.vx += (dx / dist) * force * DT;
        n.vy += (dy / dist) * force * DT;
      }
    }

    // Springs (edges)
    for (const e of edges) {
      const from = nodes.find(n => n.id === e.fromId);
      const to   = nodes.find(n => n.id === e.toId);
      if (!from || !to) continue;
      const dx   = to.x - from.x;
      const dy   = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f    = (dist - SPRING_REST) * SPRING_K * DT;
      if (!from.pinned) { from.vx += (dx / dist) * f; from.vy += (dy / dist) * f; }
      if (!to.pinned)   { to.vx   -= (dx / dist) * f; to.vy   -= (dy / dist) * f; }
    }

    // Integrate
    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx *= DAMPING; n.vy *= DAMPING;
      n.x  += n.vx * DT; n.y  += n.vy * DT;
      ke    += n.vx * n.vx + n.vy * n.vy;

      // Soft walls
      const mg = n.radius + 24;
      if (n.x < mg)     n.vx += (mg - n.x) * 0.12;
      if (n.x > W - mg) n.vx -= (n.x - (W - mg)) * 0.12;
      if (n.y < mg)     n.vy += (mg - n.y) * 0.12;
      if (n.y > H - mg) n.vy -= (n.y - (H - mg)) * 0.12;
    }

    if (ke < 0.02 * nodes.length) stableRef.current++;
    else stableRef.current = 0;
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  const render = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr  = window.devicePixelRatio || 1;
    const W    = canvas.width  / dpr;
    const H    = canvas.height / dpr;
    const nodes  = nodesRef.current;
    const edges  = edgesRef.current;
    const { scale, ox, oy } = viewRef.current;
    const hov    = hovRef.current;
    const sel    = selRef.current;
    const t      = timestamp - startTime.current;
    const maxAcc = Math.max(...nodes.map(n => n.accessCount), 1);

    // Background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, Math.max(canvas.width, canvas.height) / 1.5);
    bg.addColorStop(0,   "#07091a");
    bg.addColorStop(0.5, "#040610");
    bg.addColorStop(1,   "#020408");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // World transform
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // ── Draw edges ─────────────────────────────────────────────────────────
    for (const e of edges) {
      const from = nodes.find(n => n.id === e.fromId);
      const to   = nodes.find(n => n.id === e.toId);
      if (!from || !to) continue;

      const color   = RELATION_COLORS[e.relation] ?? "#64748b";
      const isHot   = sel && (sel.id === from.id || sel.id === to.id);
      const heatF   = from.accessCount / maxAcc;
      const heatT   = to.accessCount / maxAcc;
      const avgHeat = (heatF + heatT) / 2;

      // Curve control point (slight bend)
      const mx = (from.x + to.x) / 2 + (to.y - from.y) * 0.18;
      const my = (from.y + to.y) / 2 - (to.x - from.x) * 0.18;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(mx, my, to.x, to.y);

      const alpha = isHot ? "cc" : avgHeat > 0.3 ? "88" : "33";
      ctx.strokeStyle = `${color}${alpha}`;
      ctx.lineWidth = isHot ? 1.8 : avgHeat > 0.3 ? 1.2 : 0.7;
      ctx.stroke();

      // Arrow tip
      const angle = Math.atan2(to.y - my, to.x - mx);
      const ar = to.radius + 3;
      ctx.beginPath();
      ctx.moveTo(to.x - ar * Math.cos(angle), to.y - ar * Math.sin(angle));
      ctx.lineTo(
        to.x - ar * Math.cos(angle) - 7 * Math.cos(angle - 0.45),
        to.y - ar * Math.sin(angle) - 7 * Math.sin(angle - 0.45),
      );
      ctx.lineTo(
        to.x - ar * Math.cos(angle) - 7 * Math.cos(angle + 0.45),
        to.y - ar * Math.sin(angle) - 7 * Math.sin(angle + 0.45),
      );
      ctx.closePath();
      ctx.fillStyle = `${color}${alpha}`;
      ctx.fill();
    }

    // ── Synapse particles ───────────────────────────────────────────────────
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const from = nodes.find(n => n.id === e.fromId);
      const to   = nodes.find(n => n.id === e.toId);
      if (!from || !to) continue;
      const heatF = from.accessCount / maxAcc;
      const heatT = to.accessCount / maxAcc;
      if (heatF < 0.15 && heatT < 0.15) continue;

      const phase = ((t / 1800) + ei * 0.37) % 1;
      const mx    = (from.x + to.x) / 2 + (to.y - from.y) * 0.18;
      const my    = (from.y + to.y) / 2 - (to.x - from.x) * 0.18;
      const p     = phase;
      const px    = (1-p)*(1-p)*from.x + 2*(1-p)*p*mx + p*p*to.x;
      const py    = (1-p)*(1-p)*from.y + 2*(1-p)*p*my + p*p*to.y;
      const particleColor = RELATION_COLORS[e.relation] ?? "#94a3b8";

      ctx.save();
      ctx.shadowBlur  = 10;
      ctx.shadowColor = particleColor;
      ctx.fillStyle   = particleColor;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Draw nodes ──────────────────────────────────────────────────────────
    for (const n of nodes) {
      const heat      = n.accessCount / maxAcc;
      const baseColor = TYPE_COLORS[n.type] ?? "#64748b";
      const glowClr   = heatColor(baseColor, heat);
      const glowR     = n.radius * (2.2 + heat * 5);
      const pulse     = (sel?.id === n.id) ? (1 + 0.14 * Math.sin(t / 280)) : 1;
      const isHov     = hov?.id === n.id;
      const isSel     = sel?.id === n.id;

      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.scale(pulse, pulse);

      // Outer glow corona
      const grd = ctx.createRadialGradient(0, 0, n.radius * 0.5, 0, 0, glowR);
      const alpha1 = Math.round((heat > 0.4 ? 0.65 : 0.3) * 255).toString(16).padStart(2, "0");
      grd.addColorStop(0,   `${glowClr}${alpha1}`);
      grd.addColorStop(0.4, `${glowClr}28`);
      grd.addColorStop(1,   `${glowClr}00`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Second inner glow for hot nodes (extra pop)
      if (heat > 0.5) {
        const grd2 = ctx.createRadialGradient(0, 0, 0, 0, 0, n.radius * 2);
        grd2.addColorStop(0, `${glowClr}88`);
        grd2.addColorStop(1, `${glowClr}00`);
        ctx.fillStyle = grd2;
        ctx.beginPath();
        ctx.arc(0, 0, n.radius * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node body
      ctx.shadowBlur  = isHov || isSel ? 28 : heat > 0.4 ? 18 : 10;
      ctx.shadowColor = glowClr;
      ctx.fillStyle   = baseColor;
      ctx.beginPath();
      ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner highlight (glass sphere effect)
      const hi = ctx.createRadialGradient(-n.radius * 0.28, -n.radius * 0.28, 0, 0, 0, n.radius);
      hi.addColorStop(0, "rgba(255,255,255,0.4)");
      hi.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
      ctx.fill();

      // Pin ring
      if (n.isPinned) {
        ctx.strokeStyle = "#f59e0b88";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, n.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Selected ring
      if (isSel) {
        ctx.strokeStyle = `${glowClr}aa`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, n.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      // Label
      if (scale > 0.65 || isHov) {
        const lbl  = n.title.length > 22 ? n.title.slice(0, 21) + "…" : n.title;
        const fs   = Math.max(10, Math.min(13, 12 / scale));
        ctx.font      = `${isHov || isSel ? 600 : 400} ${fs}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${isHov || isSel ? 0.95 : 0.6})`;
        ctx.textBaseline = "middle";
        ctx.fillText(lbl, n.x + n.radius + 7, n.y);
      }
    }

    ctx.restore(); // end world transform

    // ── Tooltip (screen space) ──────────────────────────────────────────────
    if (hov && !sel) {
      const sx = hov.x * scale + ox;
      const sy = hov.y * scale + oy;
      const tc = TYPE_COLORS[hov.type] ?? "#6b7280";
      const heat = hov.accessCount / maxAcc;
      const hc   = heatColor(tc, heat);
      const TW = 220, TH = 88;
      let tx = sx + 18, ty = sy - TH / 2;
      if (tx + TW > W - 8) tx = sx - TW - 18;
      if (ty < 8) ty = 8;
      if (ty + TH > H - 8) ty = H - TH - 8;

      ctx.fillStyle   = "rgba(4,6,18,0.95)";
      ctx.strokeStyle = `${hc}55`;
      ctx.lineWidth   = 1;
      roundRect(ctx, tx, ty, TW, TH, 10);
      ctx.fill();
      ctx.stroke();

      ctx.font      = "600 12px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "top";
      ctx.fillText(hov.title.slice(0, 28), tx + 12, ty + 13);

      ctx.font      = "11px Inter, system-ui";
      ctx.fillStyle = hc;
      ctx.fillText(hov.type.replace(/_/g, " "), tx + 12, ty + 31);

      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillText(`Importância: ${hov.importance}/5  ·  ${hov.accessCount} acessos`, tx + 12, ty + 49);

      if (hov.isPinned) {
        ctx.fillStyle = "#f59e0b";
        ctx.fillText("📌 Pinada", tx + 12, ty + 67);
      }
    }

    // ── Legend (fixed bottom-left) ──────────────────────────────────────────
    const legendX = 16, legendY = H - 16 - (Object.keys(TYPE_COLORS).length * 20 + 24);
    ctx.fillStyle   = "rgba(4,6,18,0.8)";
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth   = 1;
    roundRect(ctx, legendX, legendY, 150, Object.keys(TYPE_COLORS).length * 20 + 24, 10);
    ctx.fill(); ctx.stroke();

    ctx.font      = "600 10px Inter, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.textBaseline = "top";
    ctx.fillText("TIPOS DE MEMÓRIA", legendX + 12, legendY + 10);

    Object.entries(TYPE_COLORS).forEach(([type, color], i) => {
      const ly = legendY + 28 + i * 20;
      ctx.shadowBlur  = 6;
      ctx.shadowColor = color;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(legendX + 18, ly + 5, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font      = "11px Inter, system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(type.replace(/_/g, " "), legendX + 30, ly);
    });

    // Heat legend
    const hx = W - 16 - 130, hy = H - 16 - 80;
    ctx.fillStyle   = "rgba(4,6,18,0.8)";
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, hx, hy, 130, 80, 10);
    ctx.fill(); ctx.stroke();

    ctx.font      = "600 10px Inter, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("ATIVIDADE (CALOR)", hx + 10, hy + 10);

    const grd = ctx.createLinearGradient(hx + 10, 0, hx + 120, 0);
    grd.addColorStop(0,   "#3b82f6");
    grd.addColorStop(0.4, "#8b5cf6");
    grd.addColorStop(0.65,"#f97316");
    grd.addColorStop(1,   "#ef4444");
    ctx.fillStyle   = grd;
    ctx.strokeStyle = "transparent";
    ctx.beginPath();
    ctx.roundRect(hx + 10, hy + 28, 110, 12, 4);
    ctx.fill();

    ctx.font = "10px Inter, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("frio",  hx + 10,  hy + 52);
    ctx.textAlign = "right";
    ctx.fillText("quente", hx + 120, hy + 52);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText("Baseado em nº de acessos", hx + 10, hy + 66);

    // ── Mini stats bar (top center) ─────────────────────────────────────────
    const statsText = `${nodeCount} memórias · ${edgeCount} links · zoom ${Math.round(scale * 100)}%`;
    ctx.font      = "11px Inter, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.textAlign = "center";
    ctx.fillText(statsText, W / 2, 18);
    ctx.textAlign = "left";
  }, [nodeCount, edgeCount]);

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (ts: number) => {
      // Slow down physics after stable
      if (stableRef.current < 300) tick();
      render(ts);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [tick, render]);

  // ── Resize canvas ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const { offsetWidth: W, offsetHeight: H } = canvas;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Mouse events ─────────────────────────────────────────────────────────────
  const screenToWorld = (sx: number, sy: number) => {
    const { scale, ox, oy } = viewRef.current;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (sx - rect.left - ox) / scale, y: (sy - rect.top - oy) / scale };
  };

  const hitTest = (wx: number, wy: number): Node | null => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy < (n.radius + 6) ** 2) return n;
    }
    return null;
  };

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const drag = mouseRef.current;

    if (drag.down) {
      if (drag.nodeId) {
        const n = nodesRef.current.find(n => n.id === drag.nodeId);
        if (n) { n.x = x; n.y = y; n.vx = 0; n.vy = 0; stableRef.current = 0; }
      } else {
        const canvas = canvasRef.current!;
        const rect   = canvas.getBoundingClientRect();
        viewRef.current.ox = drag.ox + (e.clientX - rect.left - drag.px);
        viewRef.current.oy = drag.oy + (e.clientY - rect.top  - drag.py);
      }
    } else {
      hovRef.current = hitTest(x, y);
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const n = hitTest(x, y);
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    mouseRef.current = {
      down: true,
      nodeId: n?.id ?? null,
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      ox: viewRef.current.ox,
      oy: viewRef.current.oy,
    };
    if (n) { n.pinned = true; stableRef.current = 0; }
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const drag = mouseRef.current;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const moved  = Math.abs(e.clientX - rect.left - drag.px) + Math.abs(e.clientY - rect.top - drag.py);

    if (drag.nodeId) {
      const n = nodesRef.current.find(n => n.id === drag.nodeId);
      if (n) {
        n.pinned = false;
        if (moved < 4) {
          // Click: select / deselect
          const isSame = selRef.current?.id === n.id;
          selRef.current = isSame ? null : n;
          setSelected(isSame ? null : n);
        }
      }
    } else if (moved < 4) {
      selRef.current = null;
      setSelected(null);
    }
    mouseRef.current.down = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const canvas  = canvasRef.current!;
    const rect    = canvas.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    const { scale, ox, oy } = viewRef.current;
    const newScale = Math.max(0.18, Math.min(4, scale * factor));
    viewRef.current = {
      scale: newScale,
      ox: mx - (mx - ox) * (newScale / scale),
      oy: my - (my - oy) * (newScale / scale),
    };
  }, []);

  const onMouseLeave = useCallback(() => {
    hovRef.current = null;
    mouseRef.current.down = false;
    const nodeId = mouseRef.current.nodeId;
    if (nodeId) {
      const n = nodesRef.current.find(n => n.id === nodeId);
      if (n) n.pinned = false;
    }
  }, []);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nodesRef.current.length) return;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    const nodes = nodesRef.current;
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 30;
    const minY = Math.min(...ys) - 30, maxY = Math.max(...ys) + 30;
    const scale = Math.min(0.95 * W / (maxX - minX), 0.95 * H / (maxY - minY), 2);
    viewRef.current = {
      scale,
      ox: (W - (maxX + minX) * scale) / 2,
      oy: (H - (maxY + minY) * scale) / 2,
    };
  }, []);

  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Controls bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] shrink-0"
        style={{ background: "rgba(4,6,18,0.8)", backdropFilter: "blur(12px)" }}>

        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
            <svg fill="none" viewBox="0 0 14 14" className="w-3.5 h-3.5 text-white">
              <path d="M7 2c-1 0-2 .5-2.5 1.3-.4-.2-.9-.2-1.4 0C2.4 4 2 4.8 2 5.6c0 .7.3 1.4.7 1.8.2 1 .8 1.8 1.6 2.2L4.9 12h4.2l.6-2.4c.8-.4 1.4-1.2 1.6-2.2.4-.4.7-1.1.7-1.8 0-.8-.4-1.6-1.1-2.3-.5-.2-1-.2-1.4 0C9 2.5 8 2 7 2z"
                stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">Brain Graph</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ color: "rgba(255,255,255,0.3)", borderColor: "rgba(255,255,255,0.08)" }}>
            {loading ? "Carregando…" : `${nodeCount} nós · ${edgeCount} sinapses`}
          </span>
        </div>

        <div className="flex-1" />

        <select value={project} onChange={e => setProject(e.target.value)}
          className="text-sm rounded-xl px-3 py-1.5 border outline-none"
          style={{ background: "#0d1117", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>

        <button onClick={fitView}
          className="px-3 py-1.5 rounded-xl text-xs border transition-all flex items-center gap-1.5"
          style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.2)", color: "rgba(165,180,252,0.8)" }}>
          <svg fill="none" viewBox="0 0 16 16" className="w-3.5 h-3.5"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Encaixar
        </button>

        <button onClick={loadGraph}
          className="px-3 py-1.5 rounded-xl text-xs border transition-all"
          style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)", color: "rgba(110,231,183,0.8)" }}>
          ↻ Reload
        </button>

        <div className="text-[10px] border rounded-lg px-2.5 py-1.5"
          style={{ color: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.06)" }}>
          Drag = mover · Scroll = zoom · Click = detalhes
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="flex-1 cursor-crosshair"
          style={{ display: "block", userSelect: "none" }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
        />

        {/* Side detail panel */}
        {selected && (
          <div className="w-72 border-l border-white/[0.06] flex flex-col overflow-y-auto shrink-0"
            style={{ background: "linear-gradient(180deg,#08091a,#050610)", backdropFilter: "blur(20px)" }}>
            <div className="p-5 border-b border-white/[0.05]">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2"
                    style={{ background: `${TYPE_COLORS[selected.type] ?? "#6b7280"}22`, color: TYPE_COLORS[selected.type] ?? "#9ca3af" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[selected.type] ?? "#9ca3af" }} />
                    {selected.type.replace(/_/g, " ")}
                  </span>
                  <p className="text-sm font-semibold text-white leading-tight">{selected.title}</p>
                </div>
                <button onClick={() => { selRef.current = null; setSelected(null); }}
                  className="text-white/30 hover:text-white/70 transition-colors shrink-0 mt-0.5 text-lg leading-none">×</button>
              </div>

              <div className="flex items-center gap-4 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                <span>
                  {"★".repeat(selected.importance)}{"☆".repeat(5 - selected.importance)}
                </span>
                <span>{selected.accessCount} acessos</span>
                {selected.isPinned && <span style={{ color: "#f59e0b" }}>📌 Pinada</span>}
              </div>
            </div>

            <div className="p-5 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3"
                style={{ color: "rgba(255,255,255,0.25)" }}>Conteúdo</p>
              <p className="text-[12px] leading-relaxed whitespace-pre-line"
                style={{ color: "rgba(255,255,255,0.6)" }}>
                {selected.content}
              </p>
            </div>

            <div className="p-5 border-t border-white/[0.05]">
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                ID: {selected.id.slice(-12)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

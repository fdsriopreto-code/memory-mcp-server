import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";

type AtlasNode = {
  id: string; title: string; type: string; importance: number;
  tags: string[]; isPinned: boolean; x: number; y: number;
};

type AtlasData = {
  nodes: AtlasNode[];
  total: number;
  project: { name: string; color: string };
  message?: string;
};

type Project = { id: string; name: string; slug: string; color: string };

const TYPE_COLORS: Record<string, string> = {
  DECISION:     "#6366f1",
  CONTEXT:      "#3b82f6",
  PATTERN:      "#10b981",
  NOTE:         "#f59e0b",
  BUG_FIX:      "#ef4444",
  ARCHITECTURE: "#8b5cf6",
  BRAIN:        "#ec4899",
};

export default function MemoryAtlasPage() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject]   = useState("");
  const [atlas, setAtlas]       = useState<AtlasData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<AtlasNode | null>(null);
  const [search, setSearch]     = useState("");

  // Pan/zoom state
  const panRef   = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    api.get<AtlasData>(`/api/projects/${project}/atlas`)
      .then(data => { setAtlas(data); setSelected(null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !atlas?.nodes.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;

    function draw() {
      if (!ctx || !atlas) return;
      ctx.clearRect(0, 0, W, H);

      // Dark background
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      const pan   = panRef.current;
      const scale = scaleRef.current;
      const cx = W / 2 + pan.x;
      const cy = H / 2 + pan.y;
      const radius = Math.min(W, H) * 0.42 * scale;

      const filtered = search
        ? atlas.nodes.filter(n =>
            n.title.toLowerCase().includes(search.toLowerCase()) ||
            n.type.toLowerCase().includes(search.toLowerCase()) ||
            n.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
          )
        : atlas.nodes;

      // Draw faint grid
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 1;
      for (let g = -3; g <= 3; g++) {
        const gx = cx + g * radius / 3;
        const gy = cy + g * radius / 3;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // Draw nodes
      filtered.forEach(node => {
        const nx = cx + node.x * radius;
        const ny = cy + node.y * radius;
        const r  = 4 + node.importance * 2.5;
        const color = TYPE_COLORS[node.type] ?? "#64748b";
        const isSelected = selected?.id === node.id;
        const isSearchMatch = search && (node.title.toLowerCase().includes(search.toLowerCase()) || node.tags.some(t => t.toLowerCase().includes(search.toLowerCase())));

        // Glow for selected or search match
        if (isSelected || isSearchMatch) {
          ctx.beginPath();
          ctx.arc(nx, ny, r + 8, 0, Math.PI * 2);
          const grd = ctx.createRadialGradient(nx, ny, r, nx, ny, r + 10);
          grd.addColorStop(0, color + "50");
          grd.addColorStop(1, color + "00");
          ctx.fillStyle = grd;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#fff" : (search && !isSearchMatch ? color + "30" : color + "cc");
        ctx.fill();

        // Pin indicator
        if (node.isPinned) {
          ctx.beginPath();
          ctx.arc(nx, ny, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Label for important/selected nodes
        if (node.importance >= 4 || isSelected || isSearchMatch) {
          ctx.font = isSelected ? "bold 11px Inter, sans-serif" : "10px Inter, sans-serif";
          ctx.fillStyle = isSelected ? "#fff" : "rgba(255,255,255,0.7)";
          ctx.textAlign = "center";
          const label = node.title.slice(0, 22) + (node.title.length > 22 ? "…" : "");
          ctx.fillText(label, nx, ny - r - 4);
        }
      });

      // Legend
      let lx = 16, ly = H - 16;
      Object.entries(TYPE_COLORS).forEach(([type, color]) => {
        ctx.beginPath(); ctx.arc(lx + 5, ly - 5, 5, 0, Math.PI * 2);
        ctx.fillStyle = color + "cc"; ctx.fill();
        ctx.font = "9px Inter, sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.textAlign = "left";
        ctx.fillText(type, lx + 14, ly);
        lx += ctx.measureText(type).width + 26;
      });
    }

    draw();
    canvasRef.current!.dataset.draw = "ready";

    // Store draw fn for re-renders
    (canvasRef.current as any).__draw = draw;
  }, [atlas, selected, search]);

  // Re-render on pan/zoom
  const redraw = () => { (canvasRef.current as any)?.__draw?.(); };

  // Mouse events
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging.current) return;
    panRef.current.x += e.clientX - lastMouse.current.x;
    panRef.current.y += e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    redraw();
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    dragging.current = false;
    // Click detection (small movement = click)
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) handleClick(e);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!atlas?.nodes.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = canvasRef.current.width;
    const H = canvasRef.current.height;
    const pan = panRef.current;
    const scale = scaleRef.current;
    const cx = W / 2 + pan.x;
    const cy = H / 2 + pan.y;
    const radius = Math.min(W, H) * 0.42 * scale;

    let closest: AtlasNode | null = null;
    let minDist = 20;
    atlas.nodes.forEach(node => {
      const nx = cx + node.x * radius;
      const ny = cy + node.y * radius;
      const dist = Math.sqrt((mx - nx) ** 2 + (my - ny) ** 2);
      if (dist < minDist) { minDist = dist; closest = node; }
    });
    setSelected(closest);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    scaleRef.current = Math.max(0.3, Math.min(4, scaleRef.current * (e.deltaY < 0 ? 1.1 : 0.9)));
    redraw();
  }

  const typeDistrib = atlas?.nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1; return acc;
  }, {} as Record<string, number>) ?? {};

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Memory Atlas</h1>
          <p className="text-sm text-white/40 mt-0.5">Mapa semântico 2D — memórias próximas são semanticamente similares</p>
        </div>
        <div className="flex items-center gap-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filtrar por título, tipo, tag..."
            className="px-3 py-1.5 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50 w-52" />
          <select value={project} onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <button onClick={load} className="px-3 py-1.5 text-sm rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white/80 transition-colors">
            &#8634;
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 rounded-2xl overflow-hidden relative" style={{ background: "#0a0a0f" }}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-white/30">Calculando posições semânticas…</div>
          ) : atlas?.message ? (
            <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">{atlas.message}</div>
          ) : (
            <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing"
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onWheel={onWheel} />
          )}
          {/* Controls hint */}
          <div className="absolute bottom-3 left-3 text-[10px] text-white/20">
            scroll = zoom · drag = pan · click = detalhe
          </div>
          {atlas && !loading && (
            <div className="absolute top-3 left-3 text-[10px] text-white/30">
              {atlas.total} memórias mapeadas
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {selected ? (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[selected.type] ?? "#64748b" }} />
                <span className="text-xs font-semibold text-white/50">{selected.type}</span>
                <span className="ml-auto text-xs text-white/30">imp:{selected.importance}/5</span>
              </div>
              <h3 className="text-sm font-semibold text-white leading-tight mb-2">{selected.title}</h3>
              {selected.isPinned && <span className="text-[10px] text-amber-400">&#128204; Pinada</span>}
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selected.tags.map(t => (
                    <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/5 text-white/30">{t}</span>
                  ))}
                </div>
              )}
              <button onClick={() => setSelected(null)}
                className="mt-3 text-xs text-white/30 hover:text-white/60 transition-colors">
                &#x2715; fechar
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-xs text-white/40">Clique em um nó para ver detalhes</p>
            </div>
          )}

          {/* Type distribution */}
          {atlas && (
            <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">Distribuição</p>
              {Object.entries(typeDistrib).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[type] ?? "#64748b" }} />
                  <span className="text-xs text-white/40 flex-1">{type}</span>
                  <span className="text-xs font-semibold" style={{ color: TYPE_COLORS[type] ?? "#64748b" }}>{count}</span>
                  <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${count / atlas.total * 100}%`, background: TYPE_COLORS[type] ?? "#64748b" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

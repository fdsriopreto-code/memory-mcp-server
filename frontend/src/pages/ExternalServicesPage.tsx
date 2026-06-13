import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../services/api";

interface ExternalService {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string;
  adminEmail: string;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = { name: "", displayName: "", apiUrl: "", adminEmail: "", adminPassword: "" };

export default function ExternalServicesPage() {
  const [services, setServices] = useState<ExternalService[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [editing,  setEditing]  = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const data = await api.get<ExternalService[]>("/api/external-services");
      setServices(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function startAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(svc: ExternalService) {
    setEditing(svc.id);
    setForm({ name: svc.name, displayName: svc.displayName, apiUrl: svc.apiUrl, adminEmail: svc.adminEmail, adminPassword: "" });
    setShowForm(true);
  }

  function cancelForm() { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.displayName || !form.apiUrl || !form.adminEmail) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    if (!editing && !form.adminPassword) {
      toast.error("Senha é obrigatória ao criar"); return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await api.patch<ExternalService>(`/api/external-services/${editing}`, form);
        setServices(prev => prev.map(s => s.id === editing ? updated : s));
        toast.success("Serviço atualizado");
      } else {
        const created = await api.post<ExternalService>("/api/external-services", form);
        setServices(prev => [...prev, created]);
        toast.success("Serviço adicionado");
      }
      cancelForm();
    } catch { toast.error("Erro ao salvar"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remover serviço "${name}"?`)) return;
    await api.delete(`/api/external-services/${id}`);
    setServices(prev => prev.filter(s => s.id !== id));
    toast.success("Removido");
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(`/api/external-services/${id}/test`, {});
      if (r.ok) toast.success("Conexão OK — login bem-sucedido");
      else toast.error(`Falha: ${r.error}`);
    } catch { toast.error("Erro ao testar conexão"); }
    finally { setTesting(null); }
  }

  async function handleToggle(svc: ExternalService) {
    const updated = await api.patch<ExternalService>(`/api/external-services/${svc.id}`, { isActive: !svc.isActive });
    setServices(prev => prev.map(s => s.id === svc.id ? updated : s));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Serviços Externos</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Serviços conectados ao MCP — o Claude pode buscar logs deles
          </p>
        </div>
        <button onClick={startAdd}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          + Adicionar serviço
        </button>
      </div>

      {/* Info box */}
      <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-xl px-4 py-3 text-xs text-indigo-300 space-y-1">
        <p className="font-semibold text-indigo-200">Como funciona</p>
        <p>O Claude usa o tool <code className="bg-indigo-900/50 px-1 rounded">get_server_logs(service="nome")</code> para buscar logs em tempo real de qualquer serviço cadastrado aqui.</p>
        <p>A senha de admin é armazenada criptografada (AES-256-GCM). O token JWT fica em cache por 11h.</p>
        <p>O serviço externo precisa ter o endpoint <code className="bg-indigo-900/50 px-1 rounded">POST /api/platform-admin/login</code> e <code className="bg-indigo-900/50 px-1 rounded">GET /api/platform-admin/server-logs</code>.</p>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white mb-4">
            {editing ? "Editar serviço" : "Novo serviço"}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Nome (slug) *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                placeholder="ilemanager"
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
              <p className="text-[10px] text-gray-600 mt-1">Identificador usado pelo Claude. Ex: ilemanager</p>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Nome de exibição *</label>
              <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="ILE Manager API"
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">URL base da API *</label>
              <input value={form.apiUrl} onChange={e => setForm(f => ({ ...f, apiUrl: e.target.value.replace(/\/$/, "") }))}
                placeholder="https://back-ilemanager.seudominio.com"
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Email do admin *</label>
              <input type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                placeholder="admin@email.com"
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">
                Senha do admin {editing ? "(deixe vazio para não alterar)" : "*"}
              </label>
              <input type="password" value={form.adminPassword} onChange={e => setForm(f => ({ ...f, adminPassword: e.target.value }))}
                placeholder={editing ? "••••••••" : "Senha do platform admin"}
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"/>
            </div>

            <div className="sm:col-span-2 flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Adicionar"}
              </button>
              <button type="button" onClick={cancelForm}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Services list */}
      {loading ? (
        <div className="text-center py-16 text-gray-600 text-sm">Carregando...</div>
      ) : services.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-sm">Nenhum serviço configurado.</p>
          <p className="text-gray-700 text-xs mt-1">Adicione um para que o Claude possa buscar logs remotamente.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map(svc => (
            <div key={svc.id}
              className={`bg-gray-900 border rounded-2xl p-4 transition-opacity ${svc.isActive ? "border-gray-800" : "border-gray-800/50 opacity-60"}`}>
              <div className="flex items-start gap-4">
                {/* Status dot */}
                <div className="mt-1 shrink-0">
                  <span className={`inline-flex w-2 h-2 rounded-full ${svc.isActive ? "bg-emerald-500" : "bg-gray-600"}`}/>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{svc.displayName}</span>
                    <code className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-indigo-400 font-mono">
                      {svc.name}
                    </code>
                    {!svc.isActive && (
                      <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">desativado</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{svc.apiUrl}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{svc.adminEmail}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  <button onClick={() => handleTest(svc.id)} disabled={testing === svc.id || !svc.isActive}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-emerald-400 hover:border-emerald-500/40 disabled:opacity-40 transition-colors">
                    {testing === svc.id ? "Testando..." : "Testar"}
                  </button>
                  <button onClick={() => handleToggle(svc)}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">
                    {svc.isActive ? "Desativar" : "Ativar"}
                  </button>
                  <button onClick={() => startEdit(svc)}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">
                    Editar
                  </button>
                  <button onClick={() => handleDelete(svc.id, svc.displayName)}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-colors">
                    Remover
                  </button>
                </div>
              </div>

              {/* Tool usage hint */}
              <div className="mt-3 pt-3 border-t border-gray-800/60">
                <p className="text-[10px] text-gray-600 font-mono">
                  get_server_logs(service="{svc.name}", level="error", limit=50)
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

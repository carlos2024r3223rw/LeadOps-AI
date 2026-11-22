import { createContext, useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Bot, Check, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, Database, FileText, Inbox, LayoutDashboard, LockKeyhole, LogIn, LogOut, Menu,
  MoreHorizontal, Play, RefreshCw, Search, Send, Settings, ShieldCheck, Sparkles,
  TriangleAlert, UserRound, UsersRound, X, XCircle,
} from "lucide-react";
import { api, clearApiAccess, useAdminToken, useDemoSession, type GmailStatus, type SystemHealth } from "./api";
import { supabase } from "./supabase";
import type { Lead, LeadStatus } from "./types";

type View = "inbox" | "summary" | "form" | "executions" | "team" | "settings";
type AccessMode = "loading" | "guest" | "demo" | "admin";
type Language = "es" | "en";

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: "es", setLanguage: () => undefined });
const useLanguage = () => useContext(LanguageContext);
const bilingual = (language: Language, spanish: string, english: string) => language === "en" ? english : spanish;

const statusLabelsEs: Record<LeadStatus, string> = {
  new: "Nuevo", processing: "Procesando", needs_review: "Por revisar", approved: "Aprobado",
  sending: "Enviando", sent: "Enviado", failed: "Falló", discarded: "Descartado",
};
const statusLabelsEn: Record<LeadStatus, string> = {
  new: "New", processing: "Processing", needs_review: "Needs review", approved: "Approved",
  sending: "Sending", sent: "Sent", failed: "Failed", discarded: "Discarded",
};

const serviceLabels = { wordpress: "WordPress", woocommerce: "WooCommerce", shopify: "Shopify", other: "Otro" };
const missingLabels: Record<string, string> = { company: "Empresa", project_scope: "Alcance detallado", catalog_size: "Tamaño del catálogo", target_markets: "Mercados objetivo" };

function relativeDate(date: string, language: Language = "es") {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 2) return bilingual(language, "Ahora", "Now");
  if (minutes < 60) return bilingual(language, `Hace ${minutes} min`, `${minutes} min ago`);
  if (minutes < 1440) return bilingual(language, `Hace ${Math.round(minutes / 60)} h`, `${Math.round(minutes / 60)} h ago`);
  return bilingual(language, `Hace ${Math.round(minutes / 1440)} d`, `${Math.round(minutes / 1440)} d ago`);
}

function StatusPill({ status }: { status: LeadStatus }) {
  const { language } = useLanguage();
  const icon = status === "sent" ? <Check size={12} /> : status === "failed" ? <X size={12} /> : status === "processing" ? <RefreshCw size={12} /> : null;
  return <span className={`status status-${status}`}>{icon}{(language === "en" ? statusLabelsEn : statusLabelsEs)[status]}</span>;
}

function Logo() {
  return <div className="brand"><span className="brand-mark">L</span><span>LeadOps <b>AI</b></span></div>;
}

function Sidebar({ view, onView, open, onClose, mode, userEmail, onLogout, reviewCount }: { view: View; onView: (view: View) => void; open: boolean; onClose: () => void; mode: "demo" | "admin"; userEmail?: string; onLogout: () => void; reviewCount: number }) {
  const { language } = useLanguage();
  const go = (next: View) => { onView(next); onClose(); };
  return <>
    <div className={`sidebar-scrim ${open ? "visible" : ""}`} onClick={onClose} />
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-top"><Logo /><button className="icon-button mobile-only" onClick={onClose} aria-label="Cerrar menú"><X size={20} /></button></div>
      <nav className="nav-list" aria-label="Navegación principal">
        <button className={view === "inbox" ? "active" : ""} onClick={() => go("inbox")}><Inbox size={18} />{bilingual(language, "Bandeja", "Inbox")}<span className="nav-count">{reviewCount}</span></button>
        <button className={view === "summary" ? "active" : ""} onClick={() => go("summary")}><LayoutDashboard size={18} />{bilingual(language, "Resumen", "Overview")}</button>
        <button onClick={() => go("form")} className={view === "form" ? "active" : ""}><FileText size={18} />{bilingual(language, "Formulario público", "Public form")}</button>
        <button className={view === "executions" ? "active" : ""} onClick={() => go("executions")}><Activity size={18} />{bilingual(language, "Ejecuciones", "Executions")}</button>
      </nav>
      <p className="nav-label">{bilingual(language, "Administración", "Administration")}</p>
      <nav className="nav-list"><button className={view === "team" ? "active" : ""} onClick={() => go("team")}><UsersRound size={18} />{bilingual(language, "Equipo", "Team")}</button><button className={view === "settings" ? "active" : ""} onClick={() => go("settings")}><Settings size={18} />{bilingual(language, "Configuración", "Settings")}</button></nav>
      <div className="sidebar-spacer" />
      <div className="demo-card"><span><span className="live-dot" /> {mode === "demo" ? bilingual(language, "Demo aislada", "Isolated demo") : bilingual(language, "Espacio privado", "Private workspace")}</span><p>{mode === "demo" ? bilingual(language, "Datos ficticios y correos simulados. Esta sesión se elimina automáticamente.", "Fictitious data and simulated emails. This session expires automatically.") : bilingual(language, "Leads persistentes protegidos con Supabase Auth.", "Persistent leads protected with Supabase Auth.")}</p></div>
      <button className="user-card" onClick={onLogout}><div className="avatar">{mode === "demo" ? "DV" : "CM"}</div><div><strong>{mode === "demo" ? bilingual(language, "Visitante demo", "Demo visitor") : (userEmail || bilingual(language, "Administrador", "Administrator"))}</strong><span>{mode === "demo" ? bilingual(language, "Sesión temporal", "Temporary session") : bilingual(language, "Administrador", "Administrator")}</span></div><LogOut size={16} /></button>
    </aside>
  </>;
}

function Header({ onMenu, onNew, mode }: { onMenu: () => void; onNew: () => void; mode: "demo" | "admin" }) {
  const { language } = useLanguage();
  return <header className="topbar">
    <button className="icon-button mobile-only" onClick={onMenu} aria-label="Abrir menú"><Menu size={21} /></button>
    <div className="search"><Search size={17} /><input aria-label={bilingual(language, "Buscar", "Search")} placeholder={bilingual(language, "Buscar leads, empresas o correos…", "Search leads, companies or emails…")}/><kbd>⌘ K</kbd></div>
    <div className="topbar-actions"><span className="api-health"><span className="live-dot" /> {mode === "demo" ? bilingual(language, "Demo aislada", "Isolated demo") : bilingual(language, "Sistema operativo", "System online")}</span><button className="button primary compact" onClick={onNew}>+ {bilingual(language, "Nuevo lead", "New lead")}</button></div>
  </header>;
}

function EmptyDetail() {
  const { language } = useLanguage();
  return <div className="empty-detail"><div><Bot size={28} /></div><h3>{bilingual(language, "Selecciona un lead", "Select a lead")}</h3><p>{bilingual(language, "Abre una solicitud para revisar el análisis, editar el borrador y aprobar el envío.", "Open an inquiry to review the analysis, edit the draft, and approve delivery.")}</p></div>;
}

function LeadDetail({ lead, onClose, onUpdated, mode }: { lead: Lead; onClose: () => void; onUpdated: (lead: Lead) => void; mode: "demo" | "admin" }) {
  const { language } = useLanguage();
  const [subject, setSubject] = useState(lead.draft?.subject ?? "");
  const [body, setBody] = useState(lead.draft?.body ?? "");
  const [tab, setTab] = useState<"review" | "activity">("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setSubject(lead.draft?.subject ?? ""); setBody(lead.draft?.body ?? ""); setTab("review"); }, [lead.id, lead.draft?.version]);

  async function action(name: string, run: () => Promise<{ data: Lead }>) {
    setBusy(name); setError("");
    try { const result = await run(); onUpdated(result.data); } catch (err) { setError(err instanceof Error ? err.message : "Ocurrió un error"); } finally { setBusy(null); }
  }

  const lastExecution = lead.executions.at(-1);
  const deliveryFailure = lead.status === "failed" && Boolean(lead.draft && lead.approvedAt);
  return <section className="detail-panel">
    <div className="detail-head">
      <button className="icon-button detail-back" onClick={onClose} aria-label="Cerrar detalle"><ArrowLeft size={20} /></button>
      <div><span className="eyebrow">{lead.reference}</span><h2>{lead.name}</h2><p>{lead.company || "Sin empresa"} · {lead.email}</p></div>
      <div className="detail-head-actions"><StatusPill status={lead.status} /><button className="icon-button"><MoreHorizontal size={20} /></button></div>
    </div>
    <div className="detail-tabs"><button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>{bilingual(language, "Revisión", "Review")}</button><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>{bilingual(language, "Actividad", "Activity")} <span>{lead.activities.length}</span></button></div>
    <div className="detail-scroll">
      {tab === "review" ? <>
        {lead.status === "failed" && <div className="error-banner"><TriangleAlert size={19} /><div><strong>{deliveryFailure ? bilingual(language, "El correo no pudo enviarse", "The email could not be sent") : bilingual(language, "El análisis no pudo completarse", "The analysis could not be completed")}</strong><span>{deliveryFailure ? bilingual(language, "El intento quedó registrado. Puedes reintentar sin crear otro envío en la base de datos.", "The attempt was recorded. You can retry without creating another database delivery.") : `${lastExecution?.error || bilingual(language, "Error inesperado", "Unexpected error")}. ${bilingual(language, "Puedes reintentar de forma segura.", "You can retry safely.")}`}</span></div><button className="button secondary compact" disabled={!!busy} onClick={() => action("retry", () => deliveryFailure ? api.approveLead(lead.id) : api.processLead(lead.id))}><RefreshCw size={15} />{bilingual(language, "Reintentar", "Retry")}</button></div>}
        {lead.status === "processing" && <div className="processing-card"><span className="ai-orb"><Sparkles size={21}/></span><div><strong>{bilingual(language, "Analizando solicitud…", "Analyzing inquiry…")}</strong><p>{bilingual(language, "Extrayendo servicio, prioridad e información faltante.", "Extracting service, priority, and missing information.")}</p></div><span className="loading-dots"><i/><i/><i/></span></div>}
        {lead.assessment && <div className="section-card ai-card">
          <div className="section-title"><span className="section-icon"><Sparkles size={16} /></span><div><h3>{bilingual(language, "Evaluación de IA", "AI assessment")}</h3><p>{Math.round(lead.assessment.confidence * 100)}% {bilingual(language, "de confianza · respuesta estructurada", "confidence · structured response")}</p></div><span className="ai-label">AI</span></div>
          <p className="summary">{lead.assessment.summary}</p>
          <div className="assessment-grid"><div><span>{bilingual(language, "Clasificación", "Classification")}</span><strong><CheckCircle2 size={15}/>{lead.assessment.classification === "qualified" ? bilingual(language, "Calificado", "Qualified") : bilingual(language, "Nutrir", "Nurture")}</strong></div><div><span>{bilingual(language, "Prioridad", "Priority")}</span><strong className={`priority-${lead.assessment.priority}`}><span className="priority-dot"/>{lead.assessment.priority === "high" ? bilingual(language, "Alta", "High") : lead.assessment.priority === "urgent" ? bilingual(language, "Urgente", "Urgent") : bilingual(language, "Media", "Medium")}</strong></div><div><span>{bilingual(language, "Servicio detectado", "Detected service")}</span><strong>{serviceLabels[lead.assessment.detectedService]}</strong></div></div>
          <div className="missing"><span>{bilingual(language, "Información faltante", "Missing information")}</span>{lead.assessment.missingFields.length ? <div>{lead.assessment.missingFields.map((item) => <em key={item}>{missingLabels[item] || item}</em>)}</div> : <strong><Check size={14}/> {bilingual(language, "Solicitud completa", "Complete inquiry")}</strong>}</div>
        </div>}
        <div className="section-card request-card"><div className="section-title"><span className="section-icon neutral"><UserRound size={16}/></span><div><h3>{bilingual(language, "Solicitud original", "Original inquiry")}</h3><p>{bilingual(language, "Recibida", "Received")} {relativeDate(lead.createdAt, language)}</p></div></div><div className="request-meta"><div><span>{bilingual(language, "Servicio", "Service")}</span><strong>{serviceLabels[lead.service]}</strong></div><div><span>{bilingual(language, "Presupuesto", "Budget")}</span><strong>{lead.budget}</strong></div><div><span>{bilingual(language, "Plazo", "Timeline")}</span><strong>{lead.timeline}</strong></div></div><p className="description">{lead.description}</p></div>
        {lead.draft && <div className="section-card draft-card"><div className="section-title"><span className="section-icon lime"><Send size={16}/></span><div><h3>{bilingual(language, "Borrador de respuesta", "Reply draft")}</h3><p>{bilingual(language, "Versión", "Version")} {lead.draft.version} · {bilingual(language, "editable antes de aprobar", "editable before approval")}</p></div><span className="unsent"><ShieldCheck size={13}/> {bilingual(language, "No enviado", "Not sent")}</span></div>
          <label>{bilingual(language, "Asunto", "Subject")}<input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={lead.status !== "needs_review"}/></label>
          <label>{bilingual(language, "Mensaje", "Message")}<textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)} disabled={lead.status !== "needs_review"}/></label>
          {lead.status === "needs_review" && <div className="draft-actions"><button className="button ghost danger" disabled={!!busy} onClick={() => action("discard", () => api.discardLead(lead.id))}><XCircle size={16}/>{bilingual(language, "Descartar", "Discard")}</button><div><button className="button secondary" disabled={!!busy || (subject === lead.draft?.subject && body === lead.draft?.body)} onClick={() => action("save", () => api.updateDraft(lead.id, subject, body))}>{bilingual(language, "Guardar cambios", "Save changes")}</button><button className="button primary" disabled={!!busy} onClick={() => action("approve", async () => { if (subject !== lead.draft?.subject || body !== lead.draft?.body) await api.updateDraft(lead.id, subject, body); return api.approveLead(lead.id); })}><Check size={16}/>{busy === "approve" ? bilingual(language, "Enviando…", "Sending…") : bilingual(language, "Aprobar y enviar", "Approve and send")}</button></div></div>}
          {lead.status === "sent" && <div className="sent-confirmation"><CheckCircle2 size={20}/><div><strong>{mode === "demo" || lead.providerMessageId?.startsWith("demo_gmail_") ? bilingual(language, "Enviado en modo demostración", "Sent in demo mode") : bilingual(language, "Enviado mediante Gmail", "Sent through Gmail")}</strong><span>{lead.providerMessageId} · {lead.sentAt && new Date(lead.sentAt).toLocaleString(language === "en" ? "en-US" : "es-GT")}</span></div></div>}
        </div>}
        {lastExecution && <div className="cost-line"><CircleDollarSign size={15}/><span>Costo IA estimado</span><strong>${lastExecution.estimatedCostUsd.toFixed(4)}</strong><i/>
          <span>{(lastExecution.inputTokens + lastExecution.outputTokens).toLocaleString()} tokens</span><i/><span>{(lastExecution.latencyMs / 1000).toFixed(1)} s</span></div>}
      </> : <ActivityTimeline lead={lead} />}
      {error && <div className="inline-error">{error}</div>}
    </div>
  </section>;
}

function ActivityTimeline({ lead }: { lead: Lead }) {
  const { language } = useLanguage();
  return <div className="timeline-wrap"><div className="timeline-heading"><h3>{bilingual(language, "Historial de actividad", "Activity history")}</h3><p>{bilingual(language, "Registro completo de decisiones y automatizaciones.", "Complete record of decisions and automations.")}</p></div><div className="timeline">{[...lead.activities].reverse().map((item) => <div className={`timeline-item tone-${item.tone}`} key={item.id}><span className="timeline-dot"/><div><strong>{item.title}</strong><p>{item.detail}</p><time>{new Date(item.createdAt).toLocaleString(language === "en" ? "en-US" : "es-GT", { dateStyle: "medium", timeStyle: "short" })}</time></div></div>)}</div>{lead.executions.length > 0 && <div className="execution-list"><h3>{bilingual(language, "Ejecuciones", "Executions")}</h3>{[...lead.executions].reverse().map((execution) => <div className="execution-row" key={execution.id}><span className={`exec-icon ${execution.status}`} >{execution.status === "succeeded" ? <Check size={14}/> : <X size={14}/>}</span><div><strong>{bilingual(language, "Intento", "Attempt")} {execution.attempt} · {execution.model}</strong><span>{execution.inputTokens + execution.outputTokens} tokens · ${execution.estimatedCostUsd.toFixed(4)}</span></div><StatusPill status={execution.status === "failed" ? "failed" : "sent"}/></div>)}</div>}</div>;
}

function InboxView({ leads, loading, selected, onSelect }: { leads: Lead[]; loading: boolean; selected?: Lead; onSelect: (lead: Lead) => void }) {
  const { language } = useLanguage();
  const [filter, setFilter] = useState<"all" | "needs_review" | "failed" | "sent">("all");
  const filtered = filter === "all" ? leads : leads.filter((lead) => lead.status === filter);
  const reviewCount = leads.filter((lead) => lead.status === "needs_review").length;
  const failedCount = leads.filter((lead) => lead.status === "failed").length;
  const sentCount = leads.filter((lead) => lead.status === "sent").length;
  return <div className="inbox-layout">
    <section className={`lead-pane ${selected ? "has-selection" : ""}`}>
      <div className="page-intro"><div><span className="eyebrow">{bilingual(language, "OPERACIONES DE VENTAS", "SALES OPERATIONS")}</span><h1>{bilingual(language, "Bandeja de leads", "Lead inbox")}</h1><p>{bilingual(language, "Revisa las respuestas preparadas por IA antes de enviarlas.", "Review AI-prepared replies before sending them.")}</p></div><div className="date-chip"><Clock3 size={15}/>{new Date().toLocaleDateString(language === "en" ? "en-US" : "es-GT", { weekday: "short", day: "numeric", month: "short" })}</div></div>
      <div className="metrics"><button onClick={() => setFilter("all")} className={filter === "all" ? "active" : ""}><span>{bilingual(language, "Total recibidos", "Total received")}</span><strong>{leads.length}</strong><small>{bilingual(language, "Esta demostración", "This demo")}</small></button><button onClick={() => setFilter("needs_review")} className={filter === "needs_review" ? "active" : ""}><span>{bilingual(language, "Por revisar", "Needs review")}</span><strong>{reviewCount}</strong><small className="warm">{bilingual(language, "Requieren atención", "Require attention")}</small></button><button onClick={() => setFilter("sent")} className={filter === "sent" ? "active" : ""}><span>{bilingual(language, "Enviados", "Sent")}</span><strong>{sentCount}</strong><small className="good">✓ {bilingual(language, "Aprobados", "Approved")}</small></button><button onClick={() => setFilter("failed")} className={filter === "failed" ? "active" : ""}><span>{bilingual(language, "Con errores", "With errors")}</span><strong>{failedCount}</strong><small>{bilingual(language, "Listos para reintentar", "Ready to retry")}</small></button></div>
      <div className="list-toolbar"><div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{bilingual(language, "Todos", "All")} <span>{leads.length}</span></button><button className={filter === "needs_review" ? "active" : ""} onClick={() => setFilter("needs_review")}>{bilingual(language, "Por revisar", "Review")} <span>{reviewCount}</span></button><button className={filter === "failed" ? "active" : ""} onClick={() => setFilter("failed")}>{bilingual(language, "Errores", "Errors")} <span>{failedCount}</span></button></div><button className="sort-button">{bilingual(language, "Más recientes", "Newest")} <ChevronDown size={14}/></button></div>
      <div className="lead-table"><div className="table-head"><span>{bilingual(language, "Contacto", "Contact")}</span><span>{bilingual(language, "Servicio", "Service")}</span><span>{bilingual(language, "Prioridad", "Priority")}</span><span>{bilingual(language, "Estado", "Status")}</span><span>{bilingual(language, "Recibido", "Received")}</span><span/></div>
        {loading ? <div className="loading-state"><RefreshCw size={22}/><span>{bilingual(language, "Cargando leads…", "Loading leads…")}</span></div> : filtered.map((lead) => <button className={`lead-row ${selected?.id === lead.id ? "selected" : ""}`} key={lead.id} onClick={() => onSelect(lead)}><span className="contact-cell"><i>{lead.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</i><b>{lead.name}<small>{lead.company || lead.email}</small></b></span><span className="service-cell"><em className={`service-icon ${lead.service}`}>{lead.service === "shopify" ? "S" : lead.service === "woocommerce" ? "W" : "Wp"}</em>{serviceLabels[lead.service]}</span><span>{lead.assessment ? <strong className={`priority-text ${lead.assessment.priority}`}><i/>{lead.assessment.priority === "high" ? bilingual(language, "Alta", "High") : lead.assessment.priority === "urgent" ? bilingual(language, "Urgente", "Urgent") : bilingual(language, "Media", "Medium")}</strong> : <span className="muted">—</span>}</span><span><StatusPill status={lead.status}/></span><span className="received-cell">{relativeDate(lead.createdAt, language)}<small>{lead.reference}</small></span><span><ArrowRight size={17}/></span></button>)}
        {!loading && !filtered.length && <div className="loading-state"><Inbox size={24}/><span>{bilingual(language, "No hay leads en este estado.", "No leads in this status.")}</span></div>}
      </div>
    </section>
  </div>;
}

function SummaryView({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  const { language } = useLanguage();
  const review = leads.filter((lead) => lead.status === "needs_review").length;
  const sent = leads.filter((lead) => lead.status === "sent").length;
  const failed = leads.filter((lead) => lead.status === "failed").length;
  const executions = leads.flatMap((lead) => lead.executions);
  const tokens = executions.reduce((sum, execution) => sum + execution.inputTokens + execution.outputTokens, 0);
  const cost = executions.reduce((sum, execution) => sum + execution.estimatedCostUsd, 0);
  return <section className="workspace-page"><div className="page-intro"><div><span className="eyebrow">{bilingual(language, "PANORAMA OPERATIVO", "OPERATIONS OVERVIEW")}</span><h1>{bilingual(language, "Resumen", "Overview")}</h1><p>{bilingual(language, "Estado actual de recepción, revisión y automatización.", "Current intake, review, and automation status.")}</p></div></div>
    <div className="overview-grid"><article><span>{bilingual(language, "Leads totales", "Total leads")}</span><strong>{leads.length}</strong><small>{bilingual(language, "En esta sesión", "In this session")}</small></article><article><span>{bilingual(language, "Por revisar", "Needs review")}</span><strong>{review}</strong><small className="warm">{bilingual(language, "Acción humana", "Human action")}</small></article><article><span>{bilingual(language, "Envíos simulados", "Simulated sends")}</span><strong>{sent}</strong><small className="good">{bilingual(language, "Aprobados", "Approved")}</small></article><article><span>{bilingual(language, "Con errores", "With errors")}</span><strong>{failed}</strong><small>{bilingual(language, "Reintentables", "Retryable")}</small></article></div>
    <div className="overview-columns"><div className="page-card"><div className="page-card-head"><div><h2>{bilingual(language, "Actividad reciente", "Recent activity")}</h2><p>{bilingual(language, "Últimos leads recibidos", "Latest received leads")}</p></div></div><div className="recent-list">{leads.slice(0,5).map((lead) => <button key={lead.id} onClick={() => onOpen(lead)}><span className="contact-initials">{lead.name.split(" ").map((part) => part[0]).slice(0,2).join("")}</span><div><strong>{lead.name}</strong><small>{serviceLabels[lead.service]} · {lead.company || lead.email}</small></div><StatusPill status={lead.status}/><ArrowRight size={16}/></button>)}</div></div>
      <div className="page-card automation-card"><div className="page-card-head"><div><h2>{bilingual(language, "Uso de automatización", "Automation usage")}</h2><p>{bilingual(language, "Consumo acumulado de IA", "Accumulated AI usage")}</p></div><Sparkles size={20}/></div><div className="automation-number"><strong>{tokens.toLocaleString()}</strong><span>tokens</span></div><div className="usage-row"><span>{bilingual(language, "Ejecuciones", "Executions")}</span><b>{executions.length}</b></div><div className="usage-row"><span>{bilingual(language, "Costo estimado", "Estimated cost")}</span><b>${cost.toFixed(4)}</b></div><div className="usage-row"><span>{bilingual(language, "Flujo", "Workflow")}</span><b>{bilingual(language, "Aprobación humana", "Human approval")}</b></div></div></div>
  </section>;
}

function ExecutionsView({ leads }: { leads: Lead[] }) {
  const { language } = useLanguage();
  const rows = leads.flatMap((lead) => lead.executions.map((execution) => ({ lead, execution }))).sort((a,b) => b.execution.createdAt.localeCompare(a.execution.createdAt));
  return <section className="workspace-page"><div className="page-intro"><div><span className="eyebrow">{bilingual(language, "OBSERVABILIDAD", "OBSERVABILITY")}</span><h1>{bilingual(language, "Ejecuciones", "Executions")}</h1><p>{bilingual(language, "Intentos, modelos, tokens, costos y errores de automatización.", "Automation attempts, models, tokens, costs, and errors.")}</p></div></div><div className="page-card executions-card"><div className="execution-table-head"><span>{bilingual(language, "Lead", "Lead")}</span><span>{bilingual(language, "Modelo", "Model")}</span><span>{bilingual(language, "Uso", "Usage")}</span><span>{bilingual(language, "Costo", "Cost")}</span><span>{bilingual(language, "Estado", "Status")}</span></div>{rows.length ? rows.map(({lead,execution}) => <div className="execution-table-row" key={execution.id}><div><strong>{lead.reference} · {lead.name}</strong><small>{new Date(execution.createdAt).toLocaleString(language === "en" ? "en-US" : "es-GT")}</small></div><span>{execution.model}</span><span>{(execution.inputTokens + execution.outputTokens).toLocaleString()} tokens</span><span>${execution.estimatedCostUsd.toFixed(4)}</span><StatusPill status={execution.status === "failed" ? "failed" : "sent"}/>{execution.error && <p>{execution.error}</p>}</div>) : <div className="page-empty"><Activity size={28}/><strong>{bilingual(language, "Aún no hay ejecuciones", "No executions yet")}</strong></div>}</div></section>;
}

function TeamView({ mode, userEmail }: { mode: "demo" | "admin"; userEmail?: string }) {
  const { language } = useLanguage();
  return <section className="workspace-page"><div className="page-intro"><div><span className="eyebrow">{bilingual(language, "ACCESO Y ROLES", "ACCESS AND ROLES")}</span><h1>{bilingual(language, "Equipo", "Team")}</h1><p>{bilingual(language, "Personas que pueden revisar y aprobar respuestas.", "People who can review and approve responses.")}</p></div></div><div className="team-layout"><div className="page-card"><div className="team-member"><div className="avatar large">{mode === "demo" ? "DV" : "CM"}</div><div><strong>{mode === "demo" ? bilingual(language, "Visitante demo", "Demo visitor") : (userEmail || bilingual(language, "Administrador principal", "Primary administrator"))}</strong><span>{mode === "demo" ? bilingual(language, "Datos ficticios · permisos temporales", "Fictitious data · temporary permissions") : "portfolio_admin"}</span></div><em>{bilingual(language, "Activo", "Active")}</em></div></div><aside className="page-card role-card"><ShieldCheck size={23}/><h2>{bilingual(language, "Roles protegidos", "Protected roles")}</h2><p>{bilingual(language, "Los permisos se validan en la API usando app_metadata de Supabase, no datos editables por el usuario.", "Permissions are validated by the API using Supabase app_metadata, never user-editable data.")}</p><div><span>portfolio_admin</span><span>lead_operator</span></div></aside></div></section>;
}

function SettingsView({ mode }: { mode: "demo" | "admin" }) {
  const { language, setLanguage } = useLanguage();
  const [gmail, setGmail] = useState<GmailStatus>({ mode: "simulated", configured: false, connected: false });
  const [health, setHealth] = useState<SystemHealth>();
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailMessage, setGmailMessage] = useState("");
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(undefined));
    if (mode === "demo") return;
    const result = new URLSearchParams(window.location.search).get("gmail");
    if (result) {
      setGmailMessage(result === "connected" ? bilingual(language, "Gmail se conectó correctamente.", "Gmail connected successfully.") : bilingual(language, "No se pudo completar la conexión con Gmail.", "The Gmail connection could not be completed."));
      window.history.replaceState({}, "", window.location.pathname);
    }
    api.gmailStatus().then(({ data }) => setGmail(data)).catch((error) => setGmailMessage(error instanceof Error ? error.message : "Gmail status unavailable"));
  }, [mode, language]);
  async function connectGmail() {
    setGmailBusy(true); setGmailMessage("");
    try { const result = await api.connectGmail(); window.location.assign(result.data.authorizationUrl); }
    catch (error) { setGmailMessage(error instanceof Error ? error.message : "Gmail connection failed"); setGmailBusy(false); }
  }
  const gmailLabel = mode === "demo" || gmail.mode === "simulated" ? bilingual(language, "Simulado", "Simulated") : gmail.connected ? gmail.accountEmail || bilingual(language, "Conectado", "Connected") : gmail.configured ? bilingual(language, "Listo para conectar", "Ready to connect") : bilingual(language, "Pendiente de credenciales", "Credentials required");
  return <section className="workspace-page"><div className="page-intro"><div><span className="eyebrow">{bilingual(language, "PREFERENCIAS", "PREFERENCES")}</span><h1>{bilingual(language, "Configuración", "Settings")}</h1><p>{bilingual(language, "Personaliza la experiencia y revisa las integraciones.", "Customize the experience and review integrations.")}</p></div></div><div className="settings-layout"><div className="page-card settings-card"><div><h2>{bilingual(language, "Idioma de la interfaz", "Interface language")}</h2><p>{bilingual(language, "Se guarda en este dispositivo. El idioma del correo se elige por cada lead.", "Saved on this device. Email language is selected per lead.")}</p></div><div className="language-picker" role="group" aria-label="Language"><button className={language === "es" ? "active" : ""} onClick={() => setLanguage("es")}><span>ES</span><strong>Español</strong></button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}><span>EN</span><strong>English</strong></button></div></div><div className="page-card integrations-card"><h2>{bilingual(language, "Integraciones", "Integrations")}</h2><div><span><Database size={17}/>Supabase</span><em className="connected">{bilingual(language, "Conectado", "Connected")}</em></div><div><span><Sparkles size={17}/>Gemini</span><em className={mode === "demo" ? "simulated" : "connected"}>{mode === "demo" ? bilingual(language, "Simulado", "Simulated") : bilingual(language, "Conectado", "Connected")}</em></div><div className="gmail-integration"><span><Send size={17}/>Gmail<small>{gmailLabel}</small></span>{mode === "admin" && gmail.mode === "real" && gmail.configured ? <button className="button secondary compact" disabled={gmailBusy} onClick={connectGmail}>{gmailBusy ? bilingual(language, "Abriendo…", "Opening…") : gmail.connected ? bilingual(language, "Reconectar", "Reconnect") : bilingual(language, "Conectar", "Connect")}</button> : <em className={mode === "demo" || gmail.mode === "simulated" ? "simulated" : ""}>{gmailLabel}</em>}</div>{gmailMessage && <p className="integration-message">{gmailMessage}</p>}<div><span><Activity size={17}/>n8n</span><em className={health?.orchestration === "n8n" ? "connected" : ""}>{health?.orchestration === "n8n" ? bilingual(language, "Conectado", "Connected") : bilingual(language, "Pendiente", "Pending")}</em></div></div></div></section>;
}

function PublicForm({ onCreated, onBack, workspace = false }: { onCreated?: (lead: Lead) => void; onBack: () => void; workspace?: boolean }) {
  const { language } = useLanguage();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<Lead | null>(null);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    data.idempotencyKey = `${(data.email ?? "unknown").toLowerCase()}:${crypto.randomUUID()}`;
    try {
      const created = await (workspace ? api.createLead(data) : api.createPublicLead(data)); setSuccess(created.data); onCreated?.(created.data);
      if (workspace && onCreated) window.setTimeout(async () => { try { onCreated((await api.processLead(created.data.id)).data); } catch { /* timeline shows recoverable state */ } }, 1200);
    } catch (err) { setError(err instanceof Error ? err.message : bilingual(language, "No pudimos enviar la solicitud", "We could not submit the inquiry")); }
    finally { setSubmitting(false); }
  }
  return <div className="public-page">
    <div className="public-nav"><Logo/><button className="button ghost" onClick={onBack}><ArrowLeft size={16}/>{workspace ? bilingual(language, "Volver a la bandeja", "Back to inbox") : bilingual(language, "Volver al inicio", "Back home")}</button></div>
    <main className="form-shell"><div className="form-copy"><span className="eyebrow lime-text">{bilingual(language, "COMENCEMOS SU PROYECTO", "LET'S START YOUR PROJECT")}</span><h1>{bilingual(language, "Convirtamos su idea en una experiencia digital que crece.", "Let's turn your idea into a digital experience that grows.")}</h1><p>{bilingual(language, "Cuéntenos qué necesita. Nuestro equipo revisará personalmente la solicitud y le responderá con los próximos pasos.", "Tell us what you need. Our team will personally review the inquiry and respond with next steps.")}</p><div className="trust-list"><span><CheckCircle2 size={18}/>{bilingual(language, "Respuesta en un día hábil", "Reply within one business day")}</span><span><CheckCircle2 size={18}/>{bilingual(language, "Especialistas en comercio digital", "Digital commerce specialists")}</span><span><ShieldCheck size={18}/>{bilingual(language, "Sus datos se mantienen privados", "Your data stays private")}</span></div><div className="form-testimonial"><p>{bilingual(language, "“Un proceso claro desde el primer contacto. Entendieron el proyecto y llegaron preparados a la llamada.”", "“A clear process from the first contact. They understood the project and came prepared to the call.”")}</p><span>{bilingual(language, "— Directora de e-commerce, marca de retail", "— E-commerce director, retail brand")}</span></div></div>
      <div className="form-card">{success ? <div className="form-success"><span><Check size={28}/></span><p className="eyebrow">{bilingual(language, "SOLICITUD", "REQUEST")} {success.reference}</p><h2>{bilingual(language, `¡Gracias, ${success.name.split(" ")[0]}!`, `Thank you, ${success.name.split(" ")[0]}!`)}</h2><p>{bilingual(language, "Recibimos su proyecto. Nuestro equipo revisará la información y responderá a", "We received your project. Our team will review it and reply to")} <strong>{success.email}</strong>.</p><button className="button primary" onClick={onBack}>{workspace ? bilingual(language, "Ver procesamiento", "View processing") : bilingual(language, "Volver al inicio", "Back home")} <ArrowRight size={16}/></button></div> : <form onSubmit={submit}>
        <div className="form-heading"><span>{bilingual(language, "Paso 1 de 1", "Step 1 of 1")}</span><h2>{bilingual(language, "Háblenos de su proyecto", "Tell us about your project")}</h2><p>{bilingual(language, "Los campos marcados con * son obligatorios.", "Fields marked with * are required.")}</p></div>
        <div className="form-grid"><label>{bilingual(language, "Nombre completo *", "Full name *")}<input name="name" required minLength={2} placeholder={bilingual(language, "Ej. Andrea Morales", "e.g. Andrea Morales")}/></label><label>{bilingual(language, "Correo de trabajo *", "Work email *")}<input name="email" type="email" required placeholder="andrea@company.com"/></label><label>{bilingual(language, "Empresa", "Company")}<input name="company" placeholder={bilingual(language, "Nombre de su empresa", "Company name")}/></label><label>{bilingual(language, "Idioma de respuesta *", "Reply language *")}<select name="preferredLanguage" required defaultValue={language}><option value="es">Español</option><option value="en">English</option></select></label><label>{bilingual(language, "Servicio que necesita *", "Service needed *")}<select name="service" required defaultValue=""><option value="" disabled>{bilingual(language, "Seleccione un servicio", "Select a service")}</option><option value="wordpress">WordPress</option><option value="woocommerce">WooCommerce</option><option value="shopify">Shopify</option><option value="other">{bilingual(language, "Otro / No estoy seguro", "Other / Not sure")}</option></select></label><label>{bilingual(language, "Presupuesto aproximado *", "Approximate budget *")}<select name="budget" required defaultValue=""><option value="" disabled>{bilingual(language, "Seleccione un rango", "Select a range")}</option><option>$2,500 – $5,000</option><option>$5,000 – $10,000</option><option>$10,000 – $25,000</option><option>$25,000+</option><option>{bilingual(language, "Por definir", "To be defined")}</option></select></label><label>{bilingual(language, "Plazo esperado *", "Expected timeline *")}<select name="timeline" required defaultValue=""><option value="" disabled>{bilingual(language, "Seleccione un plazo", "Select a timeline")}</option><option>{bilingual(language, "Urgente / esta semana", "Urgent / this week")}</option><option>4–6 {bilingual(language, "semanas", "weeks")}</option><option>8–12 {bilingual(language, "semanas", "weeks")}</option><option>{bilingual(language, "Flexible", "Flexible")}</option></select></label><label className="full">{bilingual(language, "Descripción del proyecto *", "Project description *")}<textarea name="description" required minLength={20} rows={5} placeholder={bilingual(language, "Objetivos, funciones clave, sitio actual y cualquier detalle importante…", "Goals, key features, current site, and any important details…")}/><small>{bilingual(language, "Entre más contexto comparta, mejor podremos orientarle.", "More context helps us provide better guidance.")}</small></label></div>
        {error && <div className="inline-error">{error}</div>}<button className="button primary submit-button" disabled={submitting}>{submitting ? bilingual(language, "Enviando solicitud…", "Submitting…") : bilingual(language, "Enviar solicitud", "Submit inquiry")}<ArrowRight size={17}/></button><p className="privacy"><ShieldCheck size={14}/>{workspace ? bilingual(language, "Sesión aislada: no se enviarán correos reales.", "Isolated session: no real emails will be sent.") : bilingual(language, "Ningún correo se envía sin revisión y aprobación humana.", "No email is sent without human review and approval.")}</p>
      </form>}</div>
    </main>
  </div>;
}

function Landing({ onDemo, onLogin, onRequest, busy, error }: { onDemo: () => void; onLogin: () => void; onRequest: () => void; busy: boolean; error?: string }) {
  const { language } = useLanguage();
  return <div className="landing-page">
    <nav className="landing-nav"><Logo/><div><button className="button ghost" onClick={onLogin}><LockKeyhole size={16}/>{bilingual(language, "Acceso privado", "Private access")}</button><button className="button primary compact" onClick={onDemo} disabled={busy}><Play size={15}/>{busy ? bilingual(language, "Preparando…", "Preparing…") : bilingual(language, "Explorar demo", "Explore demo")}</button></div></nav>
    <main className="landing-hero"><div className="hero-copy"><span className="eyebrow lime-text">AI-ASSISTED LEAD OPERATIONS</span><h1>{bilingual(language, "De una solicitud nueva a una respuesta lista para aprobar.", "From a new inquiry to an approval-ready response.")}</h1><p>{bilingual(language, "LeadOps AI centraliza la recepción, clasificación y revisión humana de oportunidades para agencias de WordPress, WooCommerce y Shopify.", "LeadOps AI centralizes intake, classification, and human review for WordPress, WooCommerce, and Shopify agencies.")}</p><div className="hero-actions"><button className="button primary hero-button" onClick={onDemo} disabled={busy}><Play size={18}/>{bilingual(language, "Explorar demo aislada", "Explore isolated demo")}</button><button className="button secondary hero-button" onClick={onRequest}>{bilingual(language, "Enviar una solicitud", "Submit an inquiry")} <ArrowRight size={17}/></button></div>{error && <div className="inline-error landing-error">{error}</div>}<div className="hero-proof"><span><ShieldCheck size={16}/>{bilingual(language, "Datos ficticios separados", "Separated fictitious data")}</span><span><Sparkles size={16}/>{bilingual(language, "IA estructurada", "Structured AI")}</span><span><CheckCircle2 size={16}/>{bilingual(language, "Aprobación humana", "Human approval")}</span></div></div>
      <div className="hero-product"><div className="product-window"><div className="product-bar"><i/><i/><i/><span>LeadOps AI · Demo segura</span></div><div className="product-content"><div className="mini-sidebar"><span className="brand-mark">L</span><i/><i/><i/></div><div className="mini-dashboard"><span className="eyebrow">OPERACIONES</span><h3>Bandeja inteligente</h3><div className="mini-metrics"><b>12<small>Leads</small></b><b>4<small>Por revisar</small></b><b>8<small>Procesados</small></b></div><div className="mini-lead active"><span>LM</span><div><strong>Luma Studio</strong><small>Shopify · Prioridad alta</small></div><em>Por revisar</em></div><div className="mini-lead"><span>NF</span><div><strong>Northstar Foods</strong><small>WooCommerce · Calificado</small></div><em>Simulado</em></div></div></div></div></div>
    </main>
    <section className="landing-features"><article><Database size={22}/><h3>{bilingual(language, "Historial persistente", "Persistent history")}</h3><p>{bilingual(language, "Leads, ejecuciones, costos y decisiones quedan auditados.", "Leads, executions, costs, and decisions remain audited.")}</p></article><article><Bot size={22}/><h3>{bilingual(language, "Análisis estructurado", "Structured analysis")}</h3><p>{bilingual(language, "Clasificación, prioridad, faltantes y respuesta en un solo flujo.", "Classification, priority, missing information, and reply in one flow.")}</p></article><article><ShieldCheck size={22}/><h3>{bilingual(language, "Humano en control", "Human in control")}</h3><p>{bilingual(language, "Ningún correo real sale sin una aprobación explícita.", "No real email is sent without explicit approval.")}</p></article></section>
  </div>;
}

function LoginPage({ onBack, authError }: { onBack: () => void; authError?: string }) {
  const { language } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(authError ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    if (!supabase) { setError(bilingual(language, "Supabase Auth no está configurado.", "Supabase Auth is not configured.")); setBusy(false); return; }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(bilingual(language, "Correo o contraseña incorrectos.", "Incorrect email or password."));
    setBusy(false);
  }
  return <div className="login-page"><button className="button ghost login-back" onClick={onBack}><ArrowLeft size={16}/>{bilingual(language, "Volver", "Back")}</button><div className="login-card"><Logo/><span className="login-icon"><LockKeyhole size={24}/></span><h1>{bilingual(language, "Acceso privado", "Private access")}</h1><p>{bilingual(language, "Inicia sesión con el administrador creado en Supabase.", "Sign in with the administrator created in Supabase.")}</p><form onSubmit={submit}><label>{bilingual(language, "Correo autorizado", "Authorized email")}<input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@leadops.ai"/></label><label>{bilingual(language, "Contraseña", "Password")}<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label>{error && <div className="inline-error">{error}</div>}<button className="button primary" disabled={busy}><LogIn size={17}/>{busy ? bilingual(language, "Ingresando…", "Signing in…") : bilingual(language, "Iniciar sesión", "Sign in")}</button></form><button className="text-button" onClick={onBack}>{bilingual(language, "¿Solo quieres conocer el proyecto? Explora la demo.", "Just want to see the project? Explore the demo.")}</button></div></div>;
}

function LoadingAccess() {
  return <div className="access-loading"><Logo/><RefreshCw size={24}/><span>Preparando LeadOps AI…</span></div>;
}

function AppContent() {
  const [view, setView] = useState<View>("inbox");
  const [access, setAccess] = useState<AccessMode>("loading");
  const [guestPage, setGuestPage] = useState<"landing" | "login" | "form">("landing");
  const [accessError, setAccessError] = useState("");
  const [startingDemo, setStartingDemo] = useState(false);
  const [userEmail, setUserEmail] = useState<string>();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = useMemo(() => leads.find((lead) => lead.id === selectedId), [leads, selectedId]);

  useEffect(() => {
    let cancelled = false;
    async function restoreAccess() {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (session) {
        useAdminToken(session.access_token);
        try {
          const current = await api.currentAccess();
          if (!cancelled) { setUserEmail(current.data.email); setAccess("admin"); return; }
        } catch {
          await supabase?.auth.signOut();
          if (!cancelled) setAccessError("Tu cuenta existe, pero todavía no tiene permiso de administrador.");
        }
      }
      const savedDemo = sessionStorage.getItem("leadops_demo_session");
      if (savedDemo) {
        useDemoSession(savedDemo);
        try { await api.currentAccess(); if (!cancelled) { setAccess("demo"); return; } } catch { sessionStorage.removeItem("leadops_demo_session"); }
      }
      clearApiAccess();
      if (!cancelled) setAccess("guest");
    }
    void restoreAccess();
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!session || cancelled) return;
      window.setTimeout(async () => {
        useAdminToken(session.access_token);
        try { const current = await api.currentAccess(); if (!cancelled) { setUserEmail(current.data.email); setAccess("admin"); setGuestPage("landing"); } }
        catch { if (!cancelled) { setAccessError("La cuenta no tiene un rol autorizado."); setAccess("guest"); setGuestPage("login"); } }
      }, 0);
    });
    return () => { cancelled = true; listener?.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (access !== "demo" && access !== "admin") return;
    setLoading(true);
    api.listLeads().then(({ data }) => setLeads(data)).catch((error) => setAccessError(error instanceof Error ? error.message : "No se pudo cargar la bandeja")).finally(() => setLoading(false));
  }, [access]);

  async function startDemo() {
    setStartingDemo(true); setAccessError(""); clearApiAccess();
    try {
      const result = await api.startDemo();
      sessionStorage.setItem("leadops_demo_session", result.data.sessionId);
      useDemoSession(result.data.sessionId);
      setView("inbox"); setSelectedId(undefined); setAccess("demo");
    } catch (error) { setAccessError(error instanceof Error ? error.message : "No se pudo iniciar la demo"); }
    finally { setStartingDemo(false); }
  }

  async function logout() {
    const previous = access;
    sessionStorage.removeItem("leadops_demo_session"); clearApiAccess();
    if (previous === "admin") await supabase?.auth.signOut();
    setLeads([]); setSelectedId(undefined); setUserEmail(undefined); setAccess("guest"); setGuestPage("landing");
  }

  function upsert(updated: Lead) { setLeads((current) => [updated, ...current.filter((lead) => lead.id !== updated.id)]); setSelectedId(updated.id); }

  if (access === "loading") return <LoadingAccess/>;
  if (access === "guest") {
    if (guestPage === "login") return <LoginPage onBack={() => { setGuestPage("landing"); setAccessError(""); }} authError={accessError}/>;
    if (guestPage === "form") return <PublicForm onBack={() => setGuestPage("landing")}/>;
    return <Landing onDemo={startDemo} onLogin={() => setGuestPage("login")} onRequest={() => { clearApiAccess(); setGuestPage("form"); }} busy={startingDemo} error={accessError}/>;
  }
  if (view === "form") return <PublicForm workspace onCreated={upsert} onBack={() => setView("inbox")}/>;
  const reviewCount = leads.filter((lead) => lead.status === "needs_review").length;
  let page;
  if (view === "summary") page = <SummaryView leads={leads} onOpen={(lead) => { setSelectedId(lead.id); setView("inbox"); }}/>;
  else if (view === "executions") page = <ExecutionsView leads={leads}/>;
  else if (view === "team") page = <TeamView mode={access} userEmail={userEmail}/>;
  else if (view === "settings") page = <SettingsView mode={access}/>;
  else page = <main className={`workspace ${selected ? "detail-open" : ""}`}><InboxView leads={leads} loading={loading} selected={selected} onSelect={(lead) => setSelectedId(lead.id)}/>{selected ? <LeadDetail lead={selected} onClose={() => setSelectedId(undefined)} onUpdated={upsert} mode={access}/> : <EmptyDetail/>}</main>;
  return <div className="app-shell"><Sidebar view={view} onView={setView} open={menuOpen} onClose={() => setMenuOpen(false)} mode={access} userEmail={userEmail} onLogout={logout} reviewCount={reviewCount}/><div className="app-main"><Header onMenu={() => setMenuOpen(true)} onNew={() => setView("form")} mode={access}/>{page}</div></div>;
}

export default function App() {
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem("leadops_language") === "es" ? "es" : "en");
  function setLanguage(next: Language) {
    localStorage.setItem("leadops_language", next);
    document.documentElement.lang = next;
    setLanguageState(next);
  }
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage }}><AppContent/></LanguageContext.Provider>;
}


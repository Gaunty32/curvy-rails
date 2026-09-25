import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Trash2, GripVertical, Save, Loader2, CheckCircle,
  Mail, MessageSquare, Clock, Play, ChevronDown, ChevronUp, AlertCircle,
  ToggleLeft, ToggleRight, RefreshCw, GitBranch, OctagonX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { staffAuthHeader } from "@/lib/staff-auth";
import { formatDate } from "@/lib/utils";

const API = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...staffAuthHeader(), ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const TRIGGER_LABELS: Record<string, string> = {
  invoice_sent: "Invoice Sent",
  order_dispatched: "Order Dispatched",
  order_created: "Order Created",
  portal_order_submitted: "Portal Order Submitted",
  enquiry_received: "Enquiry Received",
};

const TRIGGER_HINTS: Record<string, string> = {
  invoice_sent: "Fires when an invoice is emailed or marked as sent. Context: {{order_number}}, {{customer_name}}, {{contact_email}}, {{contact_phone}}, {{shipping_method}} (values: courier, dpd, office_collection, warehouse_collection, local_delivery, free_local)",
  order_dispatched: "Fires when an order is marked as shipped. Context: {{order_number}}, {{customer_name}}, {{contact_email}}, {{contact_phone}}",
  order_created: "Fires when a new order is created. Context: {{order_number}}, {{customer_name}}",
  portal_order_submitted: "Fires when a portal manager approves an order. Context: {{order_number}}, {{customer_name}}, {{contact_email}}, {{contact_name}}",
  enquiry_received: "Fires on any product enquiry (shop or WooCommerce). Context: {{contact_name}}, {{contact_email}}, {{contact_phone}}, {{product_name}}, {{message}}",
};

const STEP_TYPE_LABELS: Record<string, string> = {
  wait: "Wait",
  send_email: "Send Email",
  send_whatsapp: "Send WhatsApp",
  condition: "If / Condition",
  stop: "Stop (end branch)",
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  wait: <Clock className="w-4 h-4" />,
  send_email: <Mail className="w-4 h-4" />,
  send_whatsapp: <MessageSquare className="w-4 h-4" />,
  condition: <GitBranch className="w-4 h-4" />,
  stop: <OctagonX className="w-4 h-4 text-red-500" />,
};

interface Step {
  id?: number;
  tempId?: string; // for new, unsaved steps
  position: number;
  step_type: "wait" | "send_email" | "send_whatsapp" | "condition" | "stop";
  config: Record<string, any>;
}

interface Workflow {
  id: number;
  name: string;
  trigger_type: string;
  is_active: boolean;
  steps: Step[];
}

interface Execution {
  id: number;
  contact_email: string | null;
  contact_name: string | null;
  current_step: number;
  status: string;
  next_run_at: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-800 border-blue-300",
  completed: "bg-green-100 text-green-800 border-green-300",
  failed: "bg-red-100 text-red-800 border-red-300",
};

// ── Step config forms ─────────────────────────────────────────────────────────

function WaitConfig({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">Delay (hours)</Label>
      <Input
        type="number"
        min={1}
        step={1}
        value={config.delay_hours ?? 24}
        onChange={e => onChange({ ...config, delay_hours: Number(e.target.value) })}
        className="w-40"
      />
      <p className="text-xs text-muted-foreground">Wait this many hours before processing the next step.</p>
    </div>
  );
}

function SendEmailConfig({ config, onChange, triggerType }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void; triggerType: string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Subject</Label>
        <Input
          value={config.subject ?? ""}
          onChange={e => onChange({ ...config, subject: e.target.value })}
          placeholder="Your order {{order_number}} has been dispatched"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Body (HTML supported)</Label>
        <Textarea
          rows={6}
          value={config.body ?? ""}
          onChange={e => onChange({ ...config, body: e.target.value })}
          placeholder={`<p>Hi {{contact_name}},</p>\n<p>Your order {{order_number}} is on its way!</p>`}
          className="font-mono text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground">{TRIGGER_HINTS[triggerType]}</p>
    </div>
  );
}

function SendWhatsAppConfig({ config, onChange, triggerType }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void; triggerType: string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Message</Label>
        <Textarea
          rows={4}
          value={config.message ?? ""}
          onChange={e => onChange({ ...config, message: e.target.value })}
          placeholder="Hi {{contact_name}}, your order {{order_number}} has been dispatched!"
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Webhook URL (optional — overrides global High Level setting)</Label>
        <Input
          value={config.webhook_url ?? ""}
          onChange={e => onChange({ ...config, webhook_url: e.target.value })}
          placeholder="https://services.leadconnectorhq.com/hooks/..."
        />
      </div>
      <p className="text-xs text-muted-foreground">{TRIGGER_HINTS[triggerType]}</p>
    </div>
  );
}

const OPERATORS = [
  { value: "is_not_empty", label: "is not empty" },
  { value: "is_empty",     label: "is empty" },
  { value: "equals",       label: "equals" },
  { value: "not_equals",   label: "does not equal" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "does not contain" },
];

const OPERATOR_NEEDS_VALUE = ["equals", "not_equals", "contains", "not_contains"];

function ConditionConfig({ config, onChange, triggerType, stepIndex, totalSteps }: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  triggerType: string;
  stepIndex: number;
  totalSteps: number;
}) {
  const op = config.operator ?? "is_not_empty";
  const needsValue = OPERATOR_NEEDS_VALUE.includes(op);
  const stepsAfter = totalSteps - stepIndex - 1; // how many steps follow this one

  return (
    <div className="space-y-3">
      {/* Condition row */}
      <div className="grid gap-1.5">
        <Label className="text-xs">Check field</Label>
        <Input
          value={config.field ?? ""}
          onChange={e => onChange({ ...config, field: e.target.value })}
          placeholder="contact_email"
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Enter a context variable name without braces, e.g. <code>contact_email</code>, <code>shipping_method</code>, <code>order_number</code>.
          Available: {TRIGGER_HINTS[triggerType]}
        </p>
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        <div className="grid gap-1.5">
          <Label className="text-xs">Operator</Label>
          <Select value={op} onValueChange={v => onChange({ ...config, operator: v, value: needsValue ? config.value : "" })}>
            <SelectTrigger className="w-44 text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsValue && (
          <div className="grid gap-1.5 flex-1 min-w-32">
            <Label className="text-xs">Value</Label>
            <Input
              value={config.value ?? ""}
              onChange={e => onChange({ ...config, value: e.target.value })}
              placeholder="e.g. local_delivery"
              className="text-xs h-8"
            />
          </div>
        )}
      </div>

      {/* On false behaviour */}
      <div className="grid gap-1.5">
        <Label className="text-xs">If condition is FALSE</Label>
        <Select
          value={config.on_false ?? "stop"}
          onValueChange={v => onChange({ ...config, on_false: v })}
        >
          <SelectTrigger className="text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stop" className="text-xs">Stop — end workflow here</SelectItem>
            {Array.from({ length: stepsAfter }, (_, i) => i + 1).map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                Skip next {n} step{n !== 1 ? "s" : ""} (jump to step {stepIndex + 1 + n + 1})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          If TRUE, the workflow continues to the very next step as normal.
        </p>
      </div>

      {/* Visual summary */}
      <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground space-y-0.5">
        <p>
          <span className="font-medium text-green-700">✓ TRUE →</span> continue to next step
        </p>
        <p>
          <span className="font-medium text-red-700">✗ FALSE →</span>{" "}
          {config.on_false === "stop" || !config.on_false
            ? "end workflow"
            : `skip ${config.on_false} step${Number(config.on_false) !== 1 ? "s" : ""}`}
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WorkflowEditor() {
  const params = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  // Detect create-mode via path rather than params — the /workflows/new route
  // has no named param so params.id is undefined on that route.
  const isNew = location.endsWith("/new") || location === "/workflows/new";

  // Local state for the form
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<string>("enquiry_received");
  const [isActive, setIsActive] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load existing workflow
  const { data: wf, isLoading } = useQuery<Workflow>({
    queryKey: ["workflow", params.id],
    queryFn: () => apiFetch(`/workflows/${params.id}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (wf) {
      setName(wf.name);
      setTriggerType(wf.trigger_type);
      setIsActive(wf.is_active);
      setSteps(wf.steps ?? []);
    }
  }, [wf]);

  // Executions
  const { data: executions = [], refetch: refetchExecs } = useQuery<Execution[]>({
    queryKey: ["workflow-executions", params.id],
    queryFn: () => apiFetch(`/workflows/${params.id}/executions`),
    enabled: !isNew,
    refetchInterval: 15_000,
  });

  const markDirty = () => setDirty(true);

  // ── Save all ──────────────────────────────────────────────────────────────
  async function save() {
    if (!name.trim()) { toast({ title: "Workflow name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let wfId: number;

      if (isNew) {
        const created = await apiFetch<Workflow>("/workflows", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), trigger_type: triggerType, is_active: isActive }),
        });
        wfId = created.id;
      } else {
        wfId = Number(params.id);
        await apiFetch(`/workflows/${wfId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), trigger_type: triggerType, is_active: isActive }),
        });
      }

      // Sync steps: delete + re-create is simplest and avoids position drift
      if (!isNew) {
        // Get current DB steps to diff
        const existing = await apiFetch<Workflow>(`/workflows/${wfId}`);
        for (const dbStep of existing.steps) {
          await apiFetch(`/workflows/${wfId}/steps/${dbStep.id}`, { method: "DELETE" });
        }
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        await apiFetch(`/workflows/${wfId}/steps`, {
          method: "POST",
          body: JSON.stringify({ step_type: s.step_type, config: s.config, position: i }),
        });
      }

      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow", String(wfId)] });
      toast({ title: "Workflow saved" });
      setDirty(false);

      if (isNew) navigate(`/workflows/${wfId}`);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Step helpers ──────────────────────────────────────────────────────────
  function addStep() {
    setSteps(prev => [...prev, {
      tempId: Math.random().toString(36).slice(2),
      position: prev.length,
      step_type: "send_email",
      config: {},
    }]);
    markDirty();
  }

  function removeStep(idx: number) {
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i })));
    markDirty();
  }

  function updateStep(idx: number, updates: Partial<Step>) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
    markDirty();
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const newSteps = [...steps];
    const target = idx + dir;
    if (target < 0 || target >= newSteps.length) return;
    [newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]];
    setSteps(newSteps.map((s, i) => ({ ...s, position: i })));
    markDirty();
  }

  if (!isNew && isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  const runningCount = executions.filter(e => e.status === "running").length;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        {/* Header */}
        <div className="flex items-center gap-3 pt-1">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold truncate">{isNew ? "New Workflow" : (name || "Workflow Editor")}</h1>
            <p className="text-sm text-muted-foreground">
              {isNew ? "Configure a new automation" : TRIGGER_LABELS[triggerType] ?? triggerType}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isNew && (
              <button
                onClick={async () => {
                  await apiFetch(`/workflows/${params.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ is_active: !isActive }),
                  });
                  setIsActive(v => !v);
                  qc.invalidateQueries({ queryKey: ["workflows"] });
                }}
                className="flex items-center gap-1.5 text-sm"
              >
                {isActive ? (
                  <><ToggleRight className="w-5 h-5 text-green-600" /><span className="text-green-700 font-medium">Active</span></>
                ) : (
                  <><ToggleLeft className="w-5 h-5 text-muted-foreground" /><span className="text-muted-foreground">Inactive</span></>
                )}
              </button>
            )}
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Workflow settings card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Workflow Settings</h2>

          <div className="grid gap-1.5">
            <Label>Workflow Name</Label>
            <Input
              value={name}
              onChange={e => { setName(e.target.value); markDirty(); }}
              placeholder="e.g. Post-dispatch follow-up"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Trigger</Label>
            <Select value={triggerType} onValueChange={v => { setTriggerType(v); markDirty(); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{TRIGGER_HINTS[triggerType]}</p>
          </div>

          {isNew && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active-new"
                checked={isActive}
                onChange={e => { setIsActive(e.target.checked); markDirty(); }}
                className="rounded border-border"
              />
              <Label htmlFor="active-new" className="cursor-pointer">Active immediately after saving</Label>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Steps</h2>
            <Button size="sm" variant="outline" onClick={addStep} className="gap-1.5">
              <Plus className="w-4 h-4" /> Add Step
            </Button>
          </div>

          {steps.length === 0 ? (
            <div className="py-10 text-center border-2 border-dashed rounded-lg">
              <Play className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No steps yet. Add a step to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <StepCard
                  key={step.id ?? step.tempId ?? idx}
                  step={step}
                  idx={idx}
                  total={steps.length}
                  triggerType={triggerType}
                  onUpdate={upd => updateStep(idx, upd)}
                  onRemove={() => removeStep(idx)}
                  onMoveUp={() => moveStep(idx, -1)}
                  onMoveDown={() => moveStep(idx, 1)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Execution history */}
        {!isNew && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Recent Executions</h2>
                {runningCount > 0 && (
                  <p className="text-xs text-blue-600 mt-0.5">{runningCount} currently running</p>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => refetchExecs()} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>

            {executions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No executions yet — this workflow hasn't been triggered.</p>
            ) : (
              <div className="divide-y divide-border">
                {executions.map(exec => (
                  <div key={exec.id} className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[exec.status] ?? "bg-muted"}`}>
                          {exec.status}
                        </span>
                        {exec.contact_name && <span className="text-sm font-medium truncate">{exec.contact_name}</span>}
                        {exec.contact_email && <span className="text-xs text-muted-foreground truncate">{exec.contact_email}</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground space-x-3">
                        <span>Started {formatDate(exec.started_at)}</span>
                        {exec.completed_at && <span>Completed {formatDate(exec.completed_at)}</span>}
                        {exec.status === "running" && <span>Step {exec.current_step + 1} of {steps.length}</span>}
                      </div>
                      {exec.error && (
                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" /> {exec.error}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {dirty && (
          <div className="fixed bottom-6 right-6 z-50">
            <Button onClick={save} disabled={saving} className="gap-2 shadow-lg">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({
  step, idx, total, triggerType, onUpdate, onRemove, onMoveUp, onMoveDown,
}: {
  step: Step;
  idx: number;
  total: number;
  triggerType: string;
  onUpdate: (upd: Partial<Step>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border bg-background p-4 space-y-3">
      <div className="flex items-center gap-2">
        <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}</span>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {STEP_ICONS[step.step_type]}
          <Select
            value={step.step_type}
            onValueChange={v => onUpdate({ step_type: v as Step["step_type"], config: {} })}
          >
            <SelectTrigger className="h-7 text-xs border-0 bg-transparent p-0 shadow-none font-medium gap-1 focus:ring-0 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onMoveUp} disabled={idx === 0}>
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onMoveDown} disabled={idx === total - 1}>
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(v => !v)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:bg-red-50" onClick={onRemove}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="pl-8">
          {step.step_type === "wait" && (
            <WaitConfig config={step.config} onChange={config => onUpdate({ config })} />
          )}
          {step.step_type === "send_email" && (
            <SendEmailConfig config={step.config} onChange={config => onUpdate({ config })} triggerType={triggerType} />
          )}
          {step.step_type === "send_whatsapp" && (
            <SendWhatsAppConfig config={step.config} onChange={config => onUpdate({ config })} triggerType={triggerType} />
          )}
          {step.step_type === "condition" && (
            <ConditionConfig
              config={step.config}
              onChange={config => onUpdate({ config })}
              triggerType={triggerType}
              stepIndex={idx}
              totalSteps={total}
            />
          )}
          {step.step_type === "stop" && (
            <p className="text-xs text-muted-foreground">
              Ends this branch of the workflow immediately. Use this after the last action in each conditional branch so that later branches don't run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

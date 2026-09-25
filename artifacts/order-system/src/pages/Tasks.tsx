import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Circle, Clock, Plus, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

interface Task {
  id: number;
  title: string;
  description: string | null;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "done";
  customerId: number | null;
  customerName: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

const priorityBadge = (p: Task["priority"]) => {
  const styles = {
    high: "bg-red-100 text-red-700 border-red-200",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-green-100 text-green-700 border-green-200",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border", styles[p])}>
      {p.charAt(0).toUpperCase() + p.slice(1)}
    </span>
  );
};

const statusIcon = (s: Task["status"]) => {
  if (s === "done") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
  if (s === "in_progress") return <Clock className="w-5 h-5 text-amber-500" />;
  return <Circle className="w-5 h-5 text-muted-foreground" />;
};

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

const emptyForm = { title: "", description: "", priority: "medium" as Task["priority"], customerId: null as number | null, customerName: "" };

export default function Tasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [scanning, setScanning] = useState(false);

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => apiFetch("/tasks"),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Task> }) =>
      apiFetch(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const deleteTask = useMutation({
    mutationFn: (id: number) => apiFetch(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: () => toast({ title: "Failed to delete task", variant: "destructive" }),
  });

  const createTask = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/tasks", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setShowCreate(false);
      setForm(emptyForm);
      toast({ title: "Task created" });
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await apiFetch("/tasks/run-check-in-scan", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: res.message });
    } catch {
      toast({ title: "Scan failed", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const filtered = tasks
    .filter((t) => {
      if (statusFilter === "active") return t.status !== "done";
      if (statusFilter === "done") return t.status === "done";
      return true;
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const openCount = tasks.filter((t) => t.status === "open").length;
  const highCount = tasks.filter((t) => t.status !== "done" && t.priority === "high").length;

  const cycleStatus = (task: Task) => {
    const next: Record<Task["status"], Task["status"]> = { open: "in_progress", in_progress: "done", done: "open" };
    updateTask.mutate({ id: task.id, data: { status: next[task.status] } });
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {openCount} open &nbsp;·&nbsp;
              <span className={highCount > 0 ? "text-red-600 font-medium" : ""}>{highCount} high priority</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={runScan} disabled={scanning}>
              <RefreshCw className={cn("w-4 h-4 mr-2", scanning && "animate-spin")} />
              Run 90-day check
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New task
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-border">
          {[{ key: "active", label: "Active" }, { key: "done", label: "Done" }, { key: "all", label: "All" }].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                statusFilter === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Task list */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {statusFilter === "done" ? "No completed tasks yet." : "No open tasks — great work!"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border bg-card transition-opacity",
                  task.status === "done" && "opacity-60"
                )}
              >
                {/* Status toggle */}
                <button
                  className="mt-0.5 flex-shrink-0"
                  onClick={() => cycleStatus(task)}
                  title={`Status: ${task.status} — click to advance`}
                >
                  {statusIcon(task.status)}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={cn("font-medium", task.status === "done" && "line-through text-muted-foreground")}>
                      {task.title}
                    </span>
                    {priorityBadge(task.priority)}
                    {task.status === "in_progress" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-blue-100 text-blue-700 border-blue-200">
                        In Progress
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-sm text-muted-foreground mb-1">{task.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {task.customerName && task.customerId && (
                      <Link href={`/customers/${task.customerId}`} className="flex items-center gap-1 hover:text-primary transition-colors">
                        <ExternalLink className="w-3 h-3" />
                        {task.customerName}
                      </Link>
                    )}
                    <span>Created {new Date(task.createdAt).toLocaleDateString("en-GB")}</span>
                    {task.completedAt && (
                      <span>Completed {new Date(task.completedAt).toLocaleDateString("en-GB")}</span>
                    )}
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={() => deleteTask.mutate(task.id)}
                  className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create task dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Title *</label>
              <Input
                className="mt-1"
                placeholder="Task title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="Optional details..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createTask.mutate(form)}
              disabled={!form.title.trim() || createTask.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

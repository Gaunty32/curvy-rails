import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, Edit2, Info, Eye, Pencil, Loader2 } from "lucide-react";

type Variable = { name: string; description: string };

type Template = {
  id: number;
  key: string;
  name: string;
  channel: "email" | "whatsapp";
  subject: string | null;
  body: string;
  variables: Variable[] | null;
  notes: string | null;
  updated_at: string;
};

const SAMPLE_VARS: Record<string, string> = {
  firstName: "Jane",
  customerName: "Example Company",
  orderNumber: "ORD-1234",
  actorName: "Sarah",
  googleReviewUrl: "https://g.page/r/example-review",
  facebookReviewUrl: "https://www.facebook.com/example/reviews",
  totalIncVat: "£360.00",
  totalExVat: "£300.00",
  portalUrl: "",
};

function applyPreview(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => SAMPLE_VARS[key] ?? `[${key}]`);
}

export default function Templates() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"all" | "email" | "whatsapp">("all");
  const [editing, setEditing] = useState<Template | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [preview, setPreview] = useState(false);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["message-templates"],
    queryFn: () => fetch("/api/message-templates").then((r) => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, subject, body }: { key: string; subject?: string; body: string }) =>
      fetch(`/api/message-templates/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          ...(subject !== undefined ? { subject } : {}),
        }),
      }).then((r) => {
        if (!r.ok) throw new Error("Save failed");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-templates"] });
      toast({ title: "Template saved" });
      setEditing(null);
    },
    onError: (e: Error) =>
      toast({ title: "Error saving template", description: e.message, variant: "destructive" }),
  });

  const filtered =
    tab === "all" ? templates : templates.filter((t) => t.channel === tab);

  function openEdit(t: Template) {
    setEditing(t);
    setEditSubject(t.subject ?? "");
    setEditBody(t.body);
    setPreview(false);
  }

  const emailCount = templates.filter((t) => t.channel === "email").length;
  const waCount = templates.filter((t) => t.channel === "whatsapp").length;

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Message Templates</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            All automated emails and WhatsApp messages sent by the system. Edit the subject and
            body here — changes take effect immediately. Use{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{"{{variableName}}"}</code>{" "}
            placeholders; they're replaced with real values when messages are sent.
          </p>
        </div>

        {/* Channel filter */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All ({templates.length})</TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              Email ({emailCount})
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              WhatsApp ({waCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Template list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />Loading templates…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">No templates found.</div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((t) => (
              <Card key={t.key} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{t.name}</span>
                      <Badge
                        variant={t.channel === "email" ? "secondary" : "outline"}
                        className="text-xs gap-1 py-0"
                      >
                        {t.channel === "email" ? (
                          <Mail className="w-3 h-3" />
                        ) : (
                          <MessageSquare className="w-3 h-3" />
                        )}
                        {t.channel === "email" ? "Email" : "WhatsApp"}
                      </Badge>
                    </div>

                    {t.notes && (
                      <p className="text-xs text-muted-foreground flex items-start gap-1">
                        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {t.notes}
                      </p>
                    )}

                    {t.subject && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">Subject: </span>
                        {t.subject}
                      </p>
                    )}

                    <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-line">
                      {t.body}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 flex-shrink-0 mt-0.5"
                    onClick={() => openEdit(t)}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Edit dialog */}
        {editing && (
          <Dialog open onOpenChange={() => setEditing(null)}>
            <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {editing.channel === "email" ? (
                    <Mail className="w-4 h-4" />
                  ) : (
                    <MessageSquare className="w-4 h-4" />
                  )}
                  {editing.name}
                </DialogTitle>
                {editing.notes && (
                  <p className="text-sm text-muted-foreground pt-0.5">{editing.notes}</p>
                )}
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 py-1 pr-1">
                {/* Subject — email only */}
                {editing.channel === "email" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-subject">Subject Line</Label>
                    <Input
                      id="edit-subject"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      placeholder="Subject…"
                    />
                  </div>
                )}

                {/* Body */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-body">
                      {editing.channel === "whatsapp" ? "Message" : "Body"}
                    </Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs"
                      onClick={() => setPreview((p) => !p)}
                    >
                      {preview ? (
                        <><Pencil className="w-3 h-3" />Edit</>
                      ) : (
                        <><Eye className="w-3 h-3" />Preview</>
                      )}
                    </Button>
                  </div>

                  {preview ? (
                    <div className="border rounded-md p-3 bg-muted/30 min-h-[180px] text-sm whitespace-pre-wrap leading-relaxed">
                      {applyPreview(editBody)}
                    </div>
                  ) : (
                    <Textarea
                      id="edit-body"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={10}
                      className="font-mono text-sm resize-y"
                      placeholder="Template body…"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Separate paragraphs with a blank line. Click{" "}
                    <strong>Preview</strong> to see how it looks with sample data.
                  </p>
                </div>

                {/* Available variables */}
                {editing.variables && editing.variables.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                      Available variables
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {editing.variables.map((v) => (
                        <div
                          key={v.name}
                          className="flex items-start gap-2 text-xs bg-muted/40 rounded px-2 py-1.5"
                        >
                          <code className="font-mono text-primary flex-shrink-0">
                            {`{{${v.name}}}`}
                          </code>
                          <span className="text-muted-foreground">{v.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="pt-2 border-t">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      key: editing.key,
                      body: editBody,
                      ...(editing.channel === "email" ? { subject: editSubject } : {}),
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</>
                  ) : (
                    "Save Template"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </Layout>
  );
}

import { useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, AlertCircle, Loader2, ShoppingCart, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j?.error) message = j.error; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ColumnType =
  | "skip"
  | "full_name"
  | "first_name"
  | "last_name"
  | "employee_number"
  | "job_title"
  | "email"
  | "phone"
  | "team"
  | "manager_name"
  | "size"
  | "notes"
  | "delivery_address"
  | "role";

interface ColumnMapping {
  type: ColumnType;
  sizeLabel?: string;
}

interface ParsedSheet {
  rawRows: string[][];
  headers: string[];
}

interface MappedRow {
  firstName: string;
  lastName?: string;
  employeeNumber?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  teamName?: string;
  managerName?: string;
  notes?: string;
  sizes: { label: string; size: string }[];
  deliveryAddressLabel?: string;
  roleName?: string;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; error: string }[];
  order?: { id: number; orderNumber: string } | null;
}

interface Finish {
  id: number;
  name: string;
  code: string | null;
}

type Step = "upload" | "map" | "preview" | "order" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Only types shown in the "Map to Field" dropdown — size/notes intentionally excluded
const MAPPABLE_COLUMN_TYPES: ColumnType[] = [
  "skip", "full_name", "first_name", "last_name", "employee_number",
  "job_title", "email", "phone", "team", "manager_name", "delivery_address", "role",
];

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  skip: "(Skip)",
  full_name: "Full Name",
  first_name: "First Name",
  last_name: "Last Name",
  employee_number: "Employee No.",
  job_title: "Job Title",
  email: "Email",
  phone: "Phone",
  team: "Team",
  manager_name: "Team Manager",
  size: "Size (specify label →)",
  notes: "Notes",
  delivery_address: "Delivery Address",
  role: "Role",
};

function autoDetectType(header: string): ColumnType {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (h.includes("firstname") || h === "first") return "first_name";
  if (h.includes("lastname") || h === "last" || h === "surname") return "last_name";
  // Apparel export: "Employee Name" column
  if (h === "employeename") return "full_name";
  // "Team Member", "Name", "Full Name", "Member" etc. → full name
  if (h === "member" || h === "teammember" || h.includes("fullname")) return "full_name";
  if (h.includes("name") && !h.includes("team") && !h.includes("company") && !h.includes("manager")) return "full_name";
  if (h.includes("empno") || h.includes("employeeno") || h.includes("empnum") || h.includes("employeeid") || h === "ref") return "employee_number";
  if (h.includes("jobtitle") || h.includes("title") || h.includes("position")) return "job_title";
  if (h.includes("email") || h.includes("mail")) return "email";
  if (h.includes("phone") || h.includes("tel") || h.includes("mobile")) return "phone";
  if (h.includes("manager") || h.includes("linemanager") || h.includes("reportsto") || h.includes("supervisor")) return "manager_name";
  if (h.includes("team") || h.includes("dept") || h.includes("department") || h.includes("group")) return "team";
  // Apparel export: "Depot" column = delivery address label
  if (h === "depot" || h.includes("deliveryaddress") || h.includes("deliverylocation")) return "delivery_address";
  // Apparel export: "CustGrade" column = role (Male/Female etc.)
  if (h === "custgrade" || h === "grade" || h === "role" || h === "roles") return "role";
  // Size and Notes are intentionally not auto-detected (not shown in dropdown)
  return "skip";
}

function autoDetectSizeLabel(header: string): string {
  const clean = header.trim();
  if (!clean || clean.match(/^[a-z]$/i)) return "";
  return clean;
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function parseFile(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows: string[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: "",
          raw: false,
        }) as string[][];

        // Find first non-empty row to use as headers
        const firstNonEmpty = rawRows.find(r => r.some(c => String(c).trim()));
        const headers = (firstNonEmpty ?? []).map((c, i) => String(c).trim() || colLetter(i));
        resolve({ rawRows, headers });
      } catch (err: any) {
        reject(new Error("Could not read file. Make sure it is a valid Excel or CSV file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

function toTitleCase(s: string): string {
  return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function buildMappedRow(rawRow: string[], mappings: ColumnMapping[]): MappedRow | null {
  let firstName = "";
  let lastName: string | undefined;
  let employeeNumber: string | undefined;
  let jobTitle: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let teamName: string | undefined;
  let managerName: string | undefined;
  let notes: string | undefined;
  let deliveryAddressLabel: string | undefined;
  let roleName: string | undefined;
  const sizes: { label: string; size: string }[] = [];

  for (let i = 0; i < mappings.length; i++) {
    const val = String(rawRow[i] ?? "").trim();
    if (!val) continue;
    const m = mappings[i];
    switch (m.type) {
      case "full_name": {
        const parts = toTitleCase(val).split(/\s+/);
        firstName = parts[0] ?? "";
        lastName = parts.slice(1).join(" ") || undefined;
        break;
      }
      case "first_name": firstName = toTitleCase(val); break;
      case "last_name": lastName = toTitleCase(val); break;
      case "employee_number": employeeNumber = val; break;
      case "job_title": jobTitle = val; break;
      case "delivery_address": deliveryAddressLabel = toTitleCase(val); break;
      case "role": roleName = toTitleCase(val); break;
      case "email": email = val; break;
      case "phone": phone = val; break;
      case "team": teamName = val; break;
      case "manager_name": managerName = val; break;
      case "notes": notes = val; break;
      case "size": {
        const label = m.sizeLabel?.trim() || `Size ${i + 1}`;
        sizes.push({ label, size: val });
        break;
      }
    }
  }

  if (!firstName) return null;
  return { firstName, lastName, employeeNumber, jobTitle, email, phone, teamName, managerName, notes, sizes, deliveryAddressLabel, roleName };
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

type RowStatus =
  | { kind: "new" }
  | { kind: "update"; matchName: string }
  | { kind: "duplicate"; matchName: string };

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function classifyRow(row: MappedRow, existingEmployees: any[]): RowStatus {
  if (!existingEmployees.length) return { kind: "new" };
  const rowFull = normName([row.firstName, row.lastName].filter(Boolean).join(" "));

  // 1. Exact employee number match → definite update
  if (row.employeeNumber) {
    const m = existingEmployees.find(e => e.employeeNumber === row.employeeNumber);
    if (m) return { kind: "update", matchName: [m.firstName, m.lastName].filter(Boolean).join(" ") };
  }

  // 2. Exact name match → update
  const exact = existingEmployees.find(e =>
    normName([e.firstName, e.lastName].filter(Boolean).join(" ")) === rowFull
  );
  if (exact) return { kind: "update", matchName: [exact.firstName, exact.lastName].filter(Boolean).join(" ") };

  // 3. Fuzzy word-overlap → potential duplicate
  const rowWords = rowFull.split(" ").filter(Boolean);
  let bestScore = 0;
  let bestMatch: any = null;
  for (const e of existingEmployees) {
    const eName = normName([e.firstName, e.lastName].filter(Boolean).join(" "));
    const eWords = eName.split(" ").filter(Boolean);
    if (!rowWords.length || !eWords.length) continue;
    const shared = rowWords.filter(w => eWords.includes(w)).length;
    const score = shared / Math.max(rowWords.length, eWords.length);
    if (score > bestScore) { bestScore = score; bestMatch = e; }
  }
  if (bestScore >= 0.6 && bestMatch) {
    return { kind: "duplicate", matchName: [bestMatch.firstName, bestMatch.lastName].filter(Boolean).join(" ") };
  }

  return { kind: "new" };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  customerId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ImportSpreadsheetDialog({ customerId, open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [dataStartIndex, setDataStartIndex] = useState(1);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Order creation state
  const [createOrder, setCreateOrder] = useState(false);
  const [selectedFinishId, setSelectedFinishId] = useState<number | null>(null);
  const [finishes, setFinishes] = useState<Finish[]>([]);
  const [loadingFinishes, setLoadingFinishes] = useState(false);
  // Duplicate detection
  const [existingEmployees, setExistingEmployees] = useState<any[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [skippedRowIndices, setSkippedRowIndices] = useState<Set<number>>(new Set());

  const reset = () => {
    setStep("upload");
    setSheet(null);
    setFileName("");
    setHeaderRowIndex(0);
    setDataStartIndex(1);
    setMappings([]);
    setResult(null);
    setLoading(false);
    setCreateOrder(false);
    setSelectedFinishId(null);
    setFinishes([]);
    setExistingEmployees([]);
    setLoadingExisting(false);
    setSkippedRowIndices(new Set());
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const processFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const parsed = await parseFile(file);
      setSheet(parsed);
      setFileName(file.name);

      // Detect header row — Apparel exports have a company row at row 0 and
      // real headers at row 1, followed by a filter-label row at row 2.
      // Look for a row in the first 5 that contains "Employee Name".
      const apparelHdrIdx = parsed.rawRows.findIndex((r, i) =>
        i < 5 && r.some(c => String(c).trim().toLowerCase() === "employee name")
      );

      let hRow: number;
      let dStart: number;
      if (apparelHdrIdx >= 0) {
        hRow = apparelHdrIdx;
        dStart = apparelHdrIdx + 2; // skip the "Grade" filter row below headers
      } else {
        const hIdx = parsed.rawRows.findIndex(r => r.some(c => String(c).trim()));
        hRow = hIdx >= 0 ? hIdx : 0;
        dStart = hRow + 1;
      }

      setHeaderRowIndex(hRow);
      setDataStartIndex(dStart);

      // Auto-detect column types from header row
      const headers = parsed.rawRows[hRow] ?? [];
      const auto: ColumnMapping[] = headers.map((h) => {
        const hStr = String(h).trim();
        const type = autoDetectType(hStr);
        const sizeLabel = type === "size" ? autoDetectSizeLabel(hStr) : undefined;
        return { type, sizeLabel };
      });
      setMappings(auto);
      setStep("map");
    } catch (err: any) {
      toast({ title: "Error reading file", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }, [processFile]);

  // The Radix Dialog overlay intercepts native drag events, so we attach
  // window-level listeners when the dialog is open and on the upload step.
  const dropZoneRef = useRef<HTMLDivElement>(null);
  // Keep processFile in a ref so the effect never needs to re-run due to it changing
  const processFileRef = useRef(processFile);
  processFileRef.current = processFile;

  useEffect(() => {
    if (!open || step !== "upload") return;

    let dragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
      // Accept any drag for visual feedback — email attachments may not report
      // "Files" in dataTransfer.types during the drag phase
      e.preventDefault();
      dragCounter++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault(); // required on every dragover to allow drop to fire
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragOver(false);
      // Try dataTransfer.files first, then items (email attachments may use items)
      let file: File | null = e.dataTransfer?.files?.[0] ?? null;
      if (!file && e.dataTransfer?.items) {
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind === "file") { file = item.getAsFile(); break; }
        }
      }
      if (file) processFileRef.current(file);
    };

    // capture: true — fires before Radix DismissableLayer's stopPropagation
    const opts = { capture: true } as const;
    document.addEventListener("dragenter", onDragEnter, opts);
    document.addEventListener("dragover", onDragOver, opts);
    document.addEventListener("dragleave", onDragLeave, opts);
    document.addEventListener("drop", onDrop, opts);
    return () => {
      document.removeEventListener("dragenter", onDragEnter, opts);
      document.removeEventListener("dragover", onDragOver, opts);
      document.removeEventListener("dragleave", onDragLeave, opts);
      document.removeEventListener("drop", onDrop, opts);
      dragCounter = 0;
      setDragOver(false);
    };
  // Only re-run when open/step changes — processFile read via ref
  }, [open, step]);

  // Data rows based on current settings
  const headers = sheet ? (sheet.rawRows[headerRowIndex] ?? []).map((c, i) => String(c).trim() || colLetter(i)) : [];
  const dataRows = sheet ? sheet.rawRows.slice(dataStartIndex).filter(r => r.some(c => String(c).trim())) : [];
  const totalDataRows = dataRows.length;
  const allMappedWithIdx = dataRows
    .map((r, i) => ({ row: buildMappedRow(r, mappings), idx: i }))
    .filter((x): x is { row: MappedRow; idx: number } => x.row !== null);
  const validMappedRows = allMappedWithIdx.length;
  const importableCount = allMappedWithIdx.filter(x => !skippedRowIndices.has(x.idx)).length;

  const hasNameMapping = mappings.some(m => ["full_name", "first_name"].includes(m.type));
  const hasSizeColumns = mappings.some(m => m.type === "size");

  // Aggregate sizes from all data rows (for the order step preview)
  const sizeAggregation: { size: string; count: number }[] = (() => {
    const counts = new Map<string, number>();
    for (const row of dataRows) {
      for (let i = 0; i < mappings.length; i++) {
        if (mappings[i]?.type === "size") {
          const v = String(row[i] ?? "").trim();
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([size, count]) => ({ size, count }));
  })();

  const firstSizeLabel = mappings.find(m => m.type === "size")?.sizeLabel ?? "Size";

  // Fetch existing employees when entering the preview step (for duplicate detection)
  useEffect(() => {
    if (step !== "preview") return;
    setLoadingExisting(true);
    apiFetch(`/customers/${customerId}/employees`)
      .then((data: any) => setExistingEmployees(data ?? []))
      .catch(() => setExistingEmployees([]))
      .finally(() => setLoadingExisting(false));
  }, [step, customerId]);

  // Fetch finishes when entering the order step
  useEffect(() => {
    if (step !== "order") return;
    setLoadingFinishes(true);
    apiFetch(`/customers/${customerId}/finishes`)
      .then((data: any) => {
        const list: Finish[] = (data ?? []).map((f: any) => ({ id: f.id, name: f.name, code: f.code ?? null }));
        setFinishes(list);
        if (list.length === 1) setSelectedFinishId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingFinishes(false));
  }, [step, customerId]);

  const doImport = async () => {
    setLoading(true);
    try {
      const rows = allMappedWithIdx
        .filter(x => !skippedRowIndices.has(x.idx))
        .map(x => x.row);

      const orderOptions = (createOrder && selectedFinishId)
        ? { finishId: selectedFinishId, sizeLabel: firstSizeLabel }
        : null;

      const res = await apiFetch(`/customers/${customerId}/employees/import`, {
        method: "POST",
        body: JSON.stringify({ rows, orderOptions }),
      });
      setResult(res);
      setStep("done");
      onImported?.();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import from Spreadsheet
          </DialogTitle>
          <DialogDescription className="mt-1">
            Upload an Excel or CSV file, map the columns, and import employees with their sizes.
          </DialogDescription>
          {/* Step indicators */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {(["upload", "map", "preview", "order", "done"] as Step[]).map((s, idx) => {
              const labels = ["1. Upload", "2. Map Columns", "3. Preview", "4. Order", "5. Done"];
              const allSteps = ["upload", "map", "preview", "order", "done"];
              const stepIdx = allSteps.indexOf(step);
              const sIdx = allSteps.indexOf(s);
              const isCurrent = s === step;
              const isDone = sIdx < stepIdx;
              if (s === "order" && !hasSizeColumns) return null;
              return (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    isCurrent ? "bg-primary text-white" : isDone ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {labels[idx]}
                  </span>
                  {idx < 4 && (s !== "order" || hasSizeColumns) && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                ref={dropZoneRef}
                className={cn(
                  "border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer",
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {loading ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-10 h-10 animate-spin" />
                    <p className="text-sm font-medium">Reading file…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Upload className="w-10 h-10 text-primary/50" />
                    <div>
                      <p className="font-medium text-foreground">Drag from desktop or click to browse</p>
                      <p className="text-sm mt-0.5">.xlsx, .xls, .csv supported</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Apparel export instructions */}
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-1.5">
                <p className="font-semibold text-blue-900">How to export from Apparel</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
                  <li>Go to <strong>Reports</strong></li>
                  <li>Select <strong>Manpack</strong></li>
                  <li>Choose your <strong>Customer Name</strong></li>
                  <li>Select <strong>Employee Detail</strong></li>
                  <li>Click <strong>Generate Report</strong></li>
                  <li>Save to Shared Drive as <strong>XLS file</strong></li>
                </ol>
                <p className="text-blue-600 pt-0.5">Columns B (Employee Name), F (Depot) and I (CustGrade) are mapped automatically.</p>
              </div>
            </div>
          )}

          {/* ── Step 2: Map Columns ── */}
          {step === "map" && sheet && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Header row</Label>
                  <Select
                    value={String(headerRowIndex)}
                    onValueChange={v => {
                      const idx = Number(v);
                      setHeaderRowIndex(idx);
                      setDataStartIndex(idx + 1);
                      const row = sheet.rawRows[idx] ?? [];
                      setMappings(row.map((h) => {
                        const hStr = String(h).trim();
                        const type = autoDetectType(hStr);
                        return { type, sizeLabel: type === "size" ? autoDetectSizeLabel(hStr) : undefined };
                      }));
                    }}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sheet.rawRows.slice(0, 10).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>Row {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Data starts at row</Label>
                  <Select
                    value={String(dataStartIndex)}
                    onValueChange={v => setDataStartIndex(Number(v))}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sheet.rawRows.slice(0, 20).map((_, i) => (
                        <SelectItem key={i} value={String(i)}>Row {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground ml-auto">
                  {fileName} — {totalDataRows} data rows detected
                </p>
              </div>

              {/* Column mapping table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid bg-muted/40 border-b border-border px-3 py-2"
                  style={{ gridTemplateColumns: `80px 1fr 1fr 1fr` }}>
                  <span className="text-xs font-semibold text-muted-foreground">Col</span>
                  <span className="text-xs font-semibold text-muted-foreground">Spreadsheet Header</span>
                  <span className="text-xs font-semibold text-muted-foreground">Map to Field</span>
                  <span className="text-xs font-semibold text-muted-foreground">Size Label</span>
                </div>
                <div className="divide-y divide-border max-h-72 overflow-y-auto">
                  {headers.map((header, i) => (
                    <div key={i} className="grid items-center px-3 py-2 gap-2 hover:bg-muted/20"
                      style={{ gridTemplateColumns: `80px 1fr 1fr 1fr` }}>
                      <span className="text-xs font-mono text-muted-foreground">{colLetter(i)}</span>
                      <span className="text-xs font-medium truncate" title={header}>{header || <span className="text-muted-foreground/40">(blank)</span>}</span>
                      <Select
                        value={mappings[i]?.type ?? "skip"}
                        onValueChange={(v) => {
                          const next = [...mappings];
                          next[i] = { ...next[i], type: v as ColumnType };
                          if (v === "size" && !next[i].sizeLabel) {
                            next[i].sizeLabel = autoDetectSizeLabel(header) || header;
                          }
                          setMappings(next);
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MAPPABLE_COLUMN_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{COLUMN_TYPE_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mappings[i]?.type === "size" ? (
                        <Input
                          className="h-7 text-xs"
                          placeholder="e.g. Polo Shirt"
                          value={mappings[i]?.sizeLabel ?? ""}
                          onChange={e => {
                            const next = [...mappings];
                            next[i] = { ...next[i], sizeLabel: e.target.value };
                            setMappings(next);
                          }}
                        />
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!hasNameMapping && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Map at least one name column (Full Name or First Name) to continue.
                </p>
              )}
            </div>
          )}

          {/* ── Step 3: Preview ── */}
          {step === "preview" && (
            <div className="space-y-4">
              {(() => {
                const statuses = allMappedWithIdx.map(({ row, idx }) => ({
                  row, idx, status: loadingExisting ? { kind: "new" as const } : classifyRow(row, existingEmployees),
                }));
                const nDuplicates = statuses.filter(s => s.status.kind === "duplicate" && !skippedRowIndices.has(s.idx)).length;
                const nSkipped = skippedRowIndices.size;
                const hasEmpNum = statuses.some(s => s.row.employeeNumber);
                const hasTeam = statuses.some(s => s.row.teamName);
                const hasManager = statuses.some(s => s.row.managerName);
                const hasJobTitle = statuses.some(s => s.row.jobTitle);
                const hasEmail = statuses.some(s => s.row.email);
                                const hasDeliveryAddress = statuses.some(s => s.row.deliveryAddressLabel || s.row.teamName);
                const hasRole = statuses.some(s => s.row.roleName);
                const dash = <span className="text-muted-foreground/40">—</span>;

                return (
                  <>
                    {/* Summary bar */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {loadingExisting ? (
                        <span className="text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Checking for duplicates…</span>
                      ) : (
                        <>
                          <span className="text-muted-foreground"><strong>{importableCount}</strong> will be imported</span>
                          {nDuplicates > 0 && (
                            <span className="text-amber-600 font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {nDuplicates} possible duplicate{nDuplicates > 1 ? "s" : ""} — review below</span>
                          )}
                          {nSkipped > 0 && <span className="text-muted-foreground">{nSkipped} skipped</span>}
                          {totalDataRows - validMappedRows > 0 && <span className="text-muted-foreground">{totalDataRows - validMappedRows} row(s) ignored (no name)</span>}
                        </>
                      )}
                    </div>

                    {/* Table */}
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40 border-b border-border sticky top-0 z-10">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                              {hasEmpNum && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Emp No.</th>}
                              {hasRole && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Role</th>}
                              {hasDeliveryAddress && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Delivery Address</th>}
                              {hasTeam && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Team</th>}
                              {hasManager && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Manager</th>}
                              {hasJobTitle && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Job Title</th>}
                              {hasEmail && <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Email</th>}
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {statuses.map(({ row, idx, status }) => {
                              const isSkipped = skippedRowIndices.has(idx);
                              const isDuplicate = status.kind === "duplicate";
                              const rowCls = isSkipped
                                ? "bg-muted/30 opacity-50"
                                : isDuplicate
                                  ? "bg-amber-50/60"
                                  : "hover:bg-muted/20";
                              return (
                                <tr key={idx} className={rowCls}>
                                  <td className="px-3 py-2 font-medium">{[row.firstName, row.lastName].filter(Boolean).join(" ")}</td>
                                  {hasEmpNum && <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{row.employeeNumber || dash}</td>}
                                  {hasRole && <td className="px-3 py-2 text-muted-foreground">{row.roleName || dash}</td>}
                                  {hasDeliveryAddress && <td className="px-3 py-2 text-muted-foreground">{row.deliveryAddressLabel || row.teamName || dash}</td>}
                                  {hasTeam && <td className="px-3 py-2 text-muted-foreground">{row.teamName || dash}</td>}
                                  {hasManager && <td className="px-3 py-2 text-muted-foreground">{row.managerName || dash}</td>}
                                  {hasJobTitle && <td className="px-3 py-2 text-muted-foreground">{row.jobTitle || dash}</td>}
                                  {hasEmail && <td className="px-3 py-2 text-muted-foreground">{row.email || dash}</td>}
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {isSkipped ? (
                                      <button
                                        type="button"
                                        onClick={() => setSkippedRowIndices(prev => { const n = new Set(prev); n.delete(idx); return n; })}
                                        className="text-[11px] text-muted-foreground underline hover:text-foreground"
                                      >Undo skip</button>
                                    ) : isDuplicate ? (
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                          <AlertCircle className="w-3 h-3 shrink-0" />
                                          Similar to {(status as { kind: "duplicate"; matchName: string }).matchName}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setSkippedRowIndices(prev => new Set([...prev, idx]))}
                                          className="text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0.5 hover:bg-muted"
                                        >Skip</button>
                                      </div>
                                    ) : status.kind === "update" ? (
                                      <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                                        <Check className="w-3 h-3" /> Update
                                      </span>
                                    ) : (
                                      <span className="text-green-700 font-medium">New</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                      Employees matched by <strong>Employee No.</strong> or exact name will be <strong>updated</strong>. Unmatched rows will be <strong>created</strong>. Teams and managers not yet in the system will be linked automatically.
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Step 4: Order ── */}
          {step === "order" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-primary" /> Size summary from this import
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  These sizes were found across all {validMappedRows} employees. You can create a draft order with one unit per employee in their size.
                </p>
                <div className="flex flex-wrap gap-2">
                  {sizeAggregation.map(({ size, count }) => (
                    <div key={size} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 bg-muted/30 text-sm">
                      <span className="font-semibold">{size}</span>
                      <span className="text-muted-foreground">×{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={createOrder}
                    onClick={() => setCreateOrder(v => !v)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      createOrder ? "bg-primary" : "bg-input"
                    )}
                  >
                    <span className={cn(
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
                      createOrder ? "translate-x-4" : "translate-x-0"
                    )} />
                  </button>
                  <div>
                    <p className="text-sm font-medium leading-none">Also create a draft order from these sizes</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Creates a new draft sales order using the customer's wardrobe configuration</p>
                  </div>
                </div>

                {createOrder && (
                  <div className="space-y-3 pt-2 border-t">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Which wardrobe finish should the order use?</Label>
                      {loadingFinishes ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading finishes…
                        </div>
                      ) : finishes.length === 0 ? (
                        <p className="text-xs text-amber-600">No wardrobe finishes found for this customer.</p>
                      ) : (
                        <Select
                          value={selectedFinishId ? String(selectedFinishId) : ""}
                          onValueChange={v => setSelectedFinishId(Number(v))}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select a finish…" />
                          </SelectTrigger>
                          <SelectContent>
                            {finishes.map(f => (
                              <SelectItem key={f.id} value={String(f.id)}>
                                {f.name}{f.code ? ` (${f.code})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {selectedFinishId && (
                      <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded px-2.5 py-1.5 text-blue-700">
                        Order lines will be created for each product in the selected finish, grouped by size.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 5: Done ── */}
          {step === "done" && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{result.created}</p>
                  <p className="text-xs text-green-600 mt-0.5 font-medium">Created</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                  <p className="text-xs text-blue-600 mt-0.5 font-medium">Updated</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-2xl font-bold text-amber-700">{result.skipped}</p>
                  <p className="text-xs text-amber-600 mt-0.5 font-medium">Skipped (errors)</p>
                </div>
              </div>
              {result.order && (
                <a
                  href={`/orders/${result.order.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    <div>
                      <p className="font-semibold text-primary">Draft order created: {result.order.orderNumber}</p>
                      <p className="text-xs text-muted-foreground">Click to open the order and review before confirming</p>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-primary/60 group-hover:text-primary transition-colors shrink-0" />
                </a>
              )}
              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 border-b border-red-200">
                    <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> {result.errors.length} row(s) had errors
                    </p>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-red-100">
                    {result.errors.map((e, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs text-red-700">
                        <strong>Row {e.row}:</strong> {e.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.errors.length === 0 && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                  <Check className="w-4 h-4" /> Import completed successfully — no errors.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/60 shrink-0 flex items-center justify-between">
          <div>
            {step !== "upload" && step !== "done" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === "map") setStep("upload");
                  else if (step === "preview") setStep("map");
                  else if (step === "order") setStep("preview");
                }}
                className="gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              {step === "done" ? "Close" : "Cancel"}
            </Button>
            {step === "done" && (
              <Button onClick={reset} variant="outline">
                Import Another
              </Button>
            )}
            {step === "map" && (
              <Button onClick={() => setStep("preview")} disabled={!hasNameMapping} className="gap-1.5">
                Preview <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
            {step === "preview" && (
              hasSizeColumns ? (
                <Button onClick={() => setStep("order")} disabled={importableCount === 0} className="gap-1.5">
                  Next <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button onClick={doImport} disabled={loading || importableCount === 0} className="gap-1.5">
                  {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</> : <><Check className="w-3.5 h-3.5" /> Import {importableCount} rows</>}
                </Button>
              )
            )}
            {step === "order" && (
              <Button
                onClick={doImport}
                disabled={loading || importableCount === 0 || (createOrder && !selectedFinishId)}
                className="gap-1.5"
              >
                {loading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                  : createOrder
                    ? <><ShoppingCart className="w-3.5 h-3.5" /> Import & Create Order</>
                    : <><Check className="w-3.5 h-3.5" /> Import {importableCount} rows</>
                }
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { Search, Pencil, Plus, Tag, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MockStockUI({ highlightAction }: { highlightAction?: string }) {
  const isSearch = highlightAction === "search";
  const isVariant = highlightAction === "variant-row";
  const isBtn = highlightAction === "stock-take-btn";
  const isQty = highlightAction === "qty-input";
  const isBin = highlightAction === "bin-input";
  const isPrint = highlightAction === "print-label";
  const isVerify = highlightAction === "verify";
  const isModalOpen = isQty || isBin;

  return (
    <div className="relative w-full max-w-3xl mx-auto bg-background rounded-xl border border-border shadow-sm overflow-hidden text-sm flex flex-col h-[500px]">
      
      {/* Background UI Header */}
      <div className="p-4 border-b border-border flex items-center gap-3 bg-card">
        <div className={cn("relative max-w-sm flex-1 transition-all duration-300", isSearch ? "ring-4 ring-primary/40 rounded-md z-10 scale-[1.02] bg-white shadow-lg" : "opacity-80")}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search SKU, name, colour, size, bin…"
            className="w-full pl-9 py-2 rounded-md border border-input bg-transparent pointer-events-none focus:outline-none text-sm"
            value={isSearch ? "SKU-0001" : ""}
            readOnly
          />
        </div>
      </div>

      {/* Background UI Table */}
      <div className={cn("p-6 flex-1 transition-all duration-300 bg-background", isModalOpen ? "opacity-40 blur-[1px]" : "opacity-100")}>
          <div className={cn("border rounded-lg bg-card shadow-sm overflow-hidden transition-all", isVerify && "ring-4 ring-emerald-400/30")}>
          <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b">
            <div className="w-10 h-10 rounded border bg-white flex-shrink-0 flex items-center justify-center">
              <div className="w-6 h-6 bg-muted-foreground/20 rounded-sm"></div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Heavy Cotton T-Shirt</span>
                <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">SKU-0001</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">2 colours · 2 variants</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-mono font-semibold tabular-nums text-foreground mr-2">150 total</span>
              <div className={cn("transition-all duration-300", isBtn ? "ring-4 ring-primary/40 rounded-md z-10 scale-[1.05] bg-white shadow-lg" : "")}>
                <button className="flex items-center h-8 px-3 text-xs gap-1 border border-input bg-background hover:bg-accent rounded-md pointer-events-none font-medium">
                  <Pencil className="w-3 h-3" /> Stock Take
                </button>
              </div>
            </div>
          </div>
          <div className={cn("px-4 py-0 transition-all", isVariant && "ring-4 ring-primary/30 ring-inset")}>
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="py-2 font-medium">Colour</th>
                  <th className="py-2 font-medium">Size</th>
                   <th className="py-2 font-medium">Supplier Code</th>
                  <th className="py-2 font-medium text-right">Qty</th>
                  <th className="py-2 font-medium text-right">Min</th>
                  <th className="py-2 font-medium pl-4">Bin</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-border/30">
                  <td className="py-3 font-medium">Black</td>
                  <td className="py-3 font-medium">L</td>
                   <td className="py-3 font-mono text-muted-foreground">GD005</td>
                  <td className="py-3 text-right font-mono">75</td>
                  <td className="py-3 text-right font-mono">20</td>
                  <td className="py-3 pl-4 font-mono text-primary">A-101</td>
                </tr>
                <tr>
                  <td className="py-3 font-medium text-transparent select-none">·</td>
                  <td className="py-3 font-medium">M</td>
                   <td className="py-3 font-mono text-muted-foreground">GD005</td>
                  <td className="py-3 text-right font-mono">75</td>
                  <td className="py-3 text-right font-mono">20</td>
                  <td className="py-3 pl-4 font-mono text-primary">A-102</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="absolute inset-0 bg-background/60 flex items-center justify-center p-4 z-20 backdrop-blur-[1px]">
          <div className="w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl flex flex-col">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h2 className="font-display font-semibold text-lg text-foreground">Stock Take — Heavy Cotton T-Shirt</h2>
            </div>
            <div className="p-6 flex-1 bg-background/50">
              <div className="flex justify-between items-center text-xs font-medium text-muted-foreground mb-2 px-3">
                <span className="w-20">Colour</span>
                <span className="w-12">Size</span>
                <span className="w-24 text-right pr-4">Qty</span>
                <span className="w-28 pl-2">Bin</span>
              </div>
              <div className="flex justify-between items-center py-3 px-3 bg-primary/5 rounded-md border border-primary/20 mb-2 shadow-sm">
                <span className="w-20 text-sm font-medium">Black</span>
                <span className="w-12 text-sm font-medium">L</span>
                <div className="w-24 text-right pr-2">
                  <div className={cn("inline-block transition-all duration-300", isQty ? "ring-4 ring-primary/40 rounded-sm z-10 scale-110 shadow-lg bg-white" : "")}>
                    <input type="text" className="w-16 text-right border border-input rounded px-2 py-1.5 text-sm font-mono bg-background pointer-events-none" value="80" readOnly />
                  </div>
                </div>
                <div className="w-28 pl-2">
                  <div className={cn("inline-block transition-all duration-300", isBin ? "ring-4 ring-primary/40 rounded-sm z-10 scale-110 shadow-lg bg-white" : "")}>
                    <input type="text" className="w-24 border border-input rounded px-2 py-1.5 text-sm font-mono uppercase bg-background pointer-events-none" value="A-102" readOnly />
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center py-3 px-3 rounded-md border border-transparent opacity-60">
                <span className="w-20 text-sm font-medium">Black</span>
                <span className="w-12 text-sm font-medium">M</span>
                <div className="w-24 text-right pr-2">
                  <input type="text" className="w-16 text-right border border-border rounded px-2 py-1.5 text-sm font-mono bg-background pointer-events-none" value="75" readOnly />
                </div>
                <div className="w-28 pl-2">
                  <input type="text" className="w-24 border border-border rounded px-2 py-1.5 text-sm font-mono uppercase bg-background pointer-events-none" value="A-102" readOnly />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-muted/30 rounded-b-xl">
              <button className="px-4 py-2 border border-input bg-background rounded-md text-sm font-medium pointer-events-none text-muted-foreground">Cancel</button>
              <button className="px-5 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium pointer-events-none shadow-sm">Save 1 change</button>
            </div>
          </div>
        </div>
      )}

      {isPrint && (
        <div className="absolute inset-0 z-20 bg-background p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">Stock</p>
              <h2 className="text-xl font-display font-bold">Bin View</h2>
            </div>
            <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground pointer-events-none">
              <Plus className="w-3.5 h-3.5" /> New Bin
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative rounded-xl border border-primary/50 bg-card p-4 shadow-md ring-4 ring-primary/20">
              <p className="text-2xl font-black font-mono">A-103</p>
              <p className="mt-2 text-xs text-muted-foreground">New numbered stock box</p>
              <button className="absolute right-3 top-3 rounded-md border bg-background p-2 text-primary shadow-sm pointer-events-none">
                <Tag className="w-4 h-4" />
              </button>
              <div className="mt-5 rounded-md bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                Select the label button to print
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4 opacity-55">
              <p className="text-2xl font-black font-mono">A-102</p>
              <p className="mt-2 text-xs text-muted-foreground">80 units · 1 SKU</p>
            </div>
          </div>
        </div>
      )}

      {isVerify && (
        <div className="absolute right-5 top-20 z-20 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-lg">
          <CheckCircle2 className="w-4 h-4" /> Count and box saved
        </div>
      )}
    </div>
  );
}

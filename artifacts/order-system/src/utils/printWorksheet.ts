import { sortSizes } from "@/lib/sizeUtils";

const A4_PRINTER_KEY = "sbs_a4_printer";

function getA4Printer(): string {
  try { return localStorage.getItem(A4_PRINTER_KEY) ?? ""; } catch { return ""; }
}

function buildQzAutoScript(printer: string): string {
  return `<script>(function(){
    var p=${JSON.stringify(printer)};
    function status(t){var el=document.getElementById('_qz_st');if(el)el.textContent=t;}
    function cleanHtml(){
      var c=document.documentElement.cloneNode(true);
      [].slice.call(c.querySelectorAll('#_qz_st,script')).forEach(function(n){n.parentNode&&n.parentNode.removeChild(n);});
      return '<!DOCTYPE html><html>'+c.innerHTML+'</html>';
    }
    window.addEventListener('load',function(){
      status('Connecting\u2026');
      var s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
      s.onload=function(){
        var qz=window.qz;
        qz.security.setCertificatePromise(function(){return Promise.resolve('');});
        qz.security.setSignatureAlgorithm('SHA512');
        qz.security.setSignaturePromise(function(){return Promise.resolve('');});
        (qz.websocket.isActive()?Promise.resolve():qz.websocket.connect({retries:1,delay:0.5}))
          .then(function(){status('Sending to '+p+'\u2026');return qz.print(qz.configs.create(p),[{type:'pixel',format:'html',flavor:'plain',data:cleanHtml()}]);})
          .then(function(){status('\u2714 Sent to '+p);})
          .catch(function(){status('QZ error \u2014 using dialog');window.print();});
      };
      s.onerror=function(){status('QZ not running \u2014 using dialog');window.print();};
      document.head.appendChild(s);
    });
  })();<\/script>`;
}

const STATUS_DIV = '<div id="_qz_st" style="position:fixed;bottom:8px;right:8px;background:rgba(0,0,0,.75);color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;z-index:9999;font-family:sans-serif;pointer-events:none">Preparing\u2026</div>';

export interface WsPrintProcess {
  name: string;
  type: string | null;
  placement: string | null;
  notes: string | null;
}

export interface WsPrintItem {
  productName: string;
  productSku?: string | null;
  colour: string | null;
  size: string | null;
  quantity: number;
  finishName: string | null;
  supplierCode?: string | null;
  processes: WsPrintProcess[];
}

export interface WsPrintData {
  worksheetNumber: string;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
  notes: string | null;
  items: WsPrintItem[];
}

function buildSheetHtml(ws: WsPrintData, dateStr: string): string {
  const finishMap = new Map<string, WsPrintItem[]>();
  for (const item of ws.items) {
    const fk = item.finishName ?? "Plain (No Finish)";
    if (!finishMap.has(fk)) finishMap.set(fk, []);
    finishMap.get(fk)!.push(item);
  }
  const sortedFinishes = Array.from(finishMap.keys()).sort((a, b) => {
    if (a === "Plain (No Finish)") return 1;
    if (b === "Plain (No Finish)") return -1;
    return a.localeCompare(b);
  });

  const finishSections = sortedFinishes.map((finishName) => {
    const fItems = finishMap.get(finishName)!;
    const repProcesses = fItems.find((i) => i.processes.length > 0)?.processes ?? [];

    const matMap = new Map<string, { productName: string; productSku: string | null; colour: string | null; supplierCode: string | null; sizes: Map<string, number> }>();
    const allSizes = new Set<string>();
    for (const item of fItems) {
      const key = `${item.productName}||${item.colour ?? ""}`;
      if (!matMap.has(key)) matMap.set(key, { productName: item.productName, productSku: item.productSku ?? null, colour: item.colour, supplierCode: item.supplierCode ?? null, sizes: new Map() });
      const sk = item.size ?? "—";
      allSizes.add(sk);
      matMap.get(key)!.sizes.set(sk, (matMap.get(key)!.sizes.get(sk) ?? 0) + item.quantity);
    }
    const sortedSizeList = sortSizes(Array.from(allSizes));
    const matRows = Array.from(matMap.values());
    const finishTotal = fItems.reduce((s, i) => s + i.quantity, 0);

    const processRows = repProcesses.map((p) => `
      <tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:3px 6px;font-weight:600">${p.name}</td>
        <td style="padding:3px 6px;color:#555">${p.type ?? "—"}</td>
        <td style="padding:3px 6px;color:#555">${p.placement ?? "—"}</td>
        <td style="padding:3px 6px;color:#777;font-style:italic">${p.notes ?? "—"}</td>
        <td style="padding:3px 6px;text-align:center"><span style="display:inline-block;width:18px;height:18px;border:1.5px solid #999;border-radius:3px"></span></td>
      </tr>`).join("");

    const processTable = repProcesses.length > 0 ? `
      <div style="padding:5px 10px;background:#f0f4ff;border-bottom:1px solid #dbeafe">
        <div style="font-size:9px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Decoration Processes</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <thead><tr style="background:#dbeafe">
            <th style="padding:2px 6px;text-align:left;font-weight:600">Process</th>
            <th style="padding:2px 6px;text-align:left;font-weight:600">Type</th>
            <th style="padding:2px 6px;text-align:left;font-weight:600">Placement</th>
            <th style="padding:2px 6px;text-align:left;font-weight:600">Notes</th>
            <th style="padding:2px 6px;text-align:center;font-weight:600">Done ✓</th>
          </tr></thead>
          <tbody>${processRows}</tbody>
        </table>
      </div>` : "";

    const sizeHeaders = sortedSizeList.map((s) => `<th style="padding:4px 8px;text-align:center;font-size:10px;white-space:nowrap">${s}</th>`).join("");
    const matrixRows = matRows.map(({ productName, productSku, colour, sizes }, i) => {
      const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
      const sizeCells = sortedSizeList.map((s) => {
        const qty = sizes.get(s) ?? 0;
        return `<td style="padding:4px 8px;text-align:center;font-weight:${qty > 0 ? "bold" : "normal"};color:${qty > 0 ? "#111" : "#ccc"}">${qty > 0 ? qty : "—"}</td>`;
      }).join("");
      return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"};border-bottom:1px solid #e5e7eb">
        <td style="padding:4px 8px;font-weight:600">${productName}</td>
        <td style="padding:4px 8px;font-family:monospace;font-size:10px;color:#1e3a5f;font-weight:600;white-space:nowrap">${productSku ?? "—"}</td>
        <td style="padding:4px 8px;color:#555">${colour ?? "—"}</td>
        ${sizeCells}
        <td style="padding:4px 8px;text-align:center;font-weight:bold;background:#f0f4ff">${rowTotal}</td>
        <td style="padding:4px 8px;text-align:center"><span style="display:inline-block;width:20px;height:20px;border:1.5px solid #999;border-radius:3px"></span></td>
      </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:6mm;page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <div style="background:#e8edf5;color:#1e3a5f;border-left:5px solid #1e3a5f;padding:5px 10px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:800;font-size:13px">${finishName}</span>
          <span style="font-size:11px;color:#374151">${matRows.length} style${matRows.length !== 1 ? "s" : ""} · ${finishTotal} unit${finishTotal !== 1 ? "s" : ""}</span>
        </div>
        ${processTable}
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#374151;color:white">
            <th style="padding:4px 8px;text-align:left;font-size:10px">Product</th>
            <th style="padding:4px 8px;text-align:left;font-size:10px;white-space:nowrap">SKU</th>
            <th style="padding:4px 8px;text-align:left;font-size:10px">Colour</th>
            ${sizeHeaders}
            <th style="padding:4px 8px;text-align:center;font-size:10px;background:#1e3a5f">Total</th>
            <th style="padding:4px 8px;text-align:center;font-size:10px">Done ✓</th>
          </tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </div>`;
  }).join("");

  const notesHtml = ws.notes ? `
    <div style="margin-top:3mm;padding:3mm;background:#fff9c4;border:1px solid #f59e0b;border-radius:4px;font-size:11px">
      <strong>Notes:</strong> ${ws.notes}
    </div>` : "";

  const dueDateStr = ws.requiredDate
    ? new Date(ws.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return `
    <div style="background:white;padding:12mm 15mm;width:210mm;box-sizing:border-box">
      <div style="margin-bottom:5mm;border-bottom:2px solid #1e3a5f;padding-bottom:4mm">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3mm">
          <div>
            ${ws.customerName ? `<div style="font-size:26px;font-weight:900;color:#1e3a5f;margin-bottom:1mm">${ws.customerName}</div>` : ""}
            <div style="font-size:16px;font-weight:700;color:#1e3a5f;letter-spacing:1px">PRODUCTION WORKSHEET</div>
          </div>
          <div style="text-align:right;font-size:11px;color:#555">
             <div style="font-weight:bold;font-size:13px">Your business</div>
            <div>Printed: ${dateStr}</div>
            <div style="margin-top:1mm">${ws.items.length} item${ws.items.length !== 1 ? "s" : ""} · ${sortedFinishes.length} finish${sortedFinishes.length !== 1 ? "es" : ""}</div>
          </div>
        </div>
        <div style="display:flex;gap:0;border:2px solid #1e3a5f;border-radius:6px;overflow:hidden;font-family:Arial,sans-serif">
          <div style="flex:1;padding:5px 10px;border-right:1px solid #1e3a5f;background:#1e3a5f">
            <div style="font-size:9px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:.8px;margin-bottom:1px">Worksheet</div>
            <div style="font-size:20px;font-weight:900;color:white;letter-spacing:.5px">${ws.worksheetNumber}</div>
          </div>
          <div style="flex:1;padding:5px 10px;border-right:1px solid #1e3a5f;background:#e8edf5">
            <div style="font-size:9px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.8px;margin-bottom:1px">Order</div>
            <div style="font-size:20px;font-weight:900;color:#1e3a5f">${ws.orderNumber ?? "—"}</div>
          </div>
          <div style="flex:1;padding:5px 10px;background:${dueDateStr ? "#fef2f2" : "#e8edf5"}">
            <div style="font-size:9px;font-weight:700;color:${dueDateStr ? "#be123c" : "#1e3a5f"};text-transform:uppercase;letter-spacing:.8px;margin-bottom:1px">Date Required</div>
            <div style="font-size:20px;font-weight:900;color:${dueDateStr ? "#be123c" : "#9ca3af"}">${dueDateStr ?? "—"}</div>
          </div>
        </div>
      </div>
      ${finishSections}
      ${notesHtml}
      <div style="margin-top:6mm;display:flex;gap:20px">
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Produced by: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Date completed: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Checked by: ___________________________</div>
      </div>
      <div style="margin-top:6mm;padding-top:3mm;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:9px;color:#aaa">
         <span>Your business — Internal Use Only</span>
        <span>${ws.worksheetNumber} · ${dateStr}</span>
      </div>
    </div>`;
}

function openPrintWindow(title: string, toolbarLabel: string, sheetsHtml: string): void {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;

  const printer = getA4Printer();

  const html = `<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600;letter-spacing:.5px}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-print:hover{background:#16a34a}
      #btn-close{background:rgba(255,255,255,.15);color:white}#btn-close:hover{background:rgba(255,255,255,.25)}
      .sheet-wrap{display:flex;justify-content:center;padding:24px 0}
      .sheet-wrap+.sheet-wrap{padding-top:0}
      @media print{
        #toolbar{display:none}
        body{background:white}
        .sheet-wrap{padding:0;display:block}
        .page-break{page-break-before:always}
        @page{size:A4 portrait;margin:12mm}
      }
    </style>
    ${printer ? buildQzAutoScript(printer) : ""}
  </head><body>
    <div id="toolbar">
      <span>📋 ${toolbarLabel}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    ${sheetsHtml}
    ${printer ? STATUS_DIV : ""}
  </body></html>`;

  win.document.write(html);
  win.document.close();
  win.focus();
  if (!printer) {
    win.onload = () => win.print();
  }
}

export function printWorksheetFromData(ws: WsPrintData): void {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const sheetHtml = `<div class="sheet-wrap">${buildSheetHtml(ws, dateStr)}</div>`;
  const label = `${ws.worksheetNumber} — ${ws.customerName ?? ws.orderNumber ?? "Worksheet"}`;
  openPrintWindow(`Worksheet ${ws.worksheetNumber}`, label, sheetHtml);
}

export function printWorksheetsFromData(sheets: WsPrintData[]): void {
  if (sheets.length === 0) return;
  if (sheets.length === 1) { printWorksheetFromData(sheets[0]); return; }

  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const sheetsHtml = sheets
    .map((ws, idx) => `<div class="sheet-wrap${idx > 0 ? " page-break" : ""}">${buildSheetHtml(ws, dateStr)}</div>`)
    .join("\n");

  const label = `Production Worksheets (${sheets.length}) — ${dateStr}`;
  openPrintWindow(`Production Worksheets (${sheets.length})`, label, sheetsHtml);
}

const LABEL_PRINTER_KEY = "sbs_label_printer";

function getLabelPrinter(): string {
  try { return localStorage.getItem(LABEL_PRINTER_KEY) ?? ""; } catch { return ""; }
}

function buildQzScript(printer: string): string {
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
          .then(function(){status('\u2714 Sent');})
          .catch(function(){status('QZ error \u2014 using dialog');window.print();});
      };
      s.onerror=function(){status('QZ not running \u2014 using dialog');window.print();};
      document.head.appendChild(s);
    });
  })();<\/script>`;
}

const STATUS_DIV = '<div id="_qz_st" style="position:fixed;bottom:8px;right:8px;background:rgba(0,0,0,.75);color:#fff;padding:4px 12px;border-radius:4px;font-size:11px;z-index:9999;font-family:sans-serif;pointer-events:none">Preparing\u2026</div>';

/**
 * Print a DPD label HTML string.
 * If a label printer is saved in Settings → Printing (QZ Tray), it sends directly
 * to that printer with no dialog. Falls back to the browser print dialog if QZ Tray
 * is not running or no printer is configured.
 */
export function printDpdLabelHtml(html: string): void {
  const win = window.open("", "_blank");
  if (!win) return;

  const thermalCss = `<style>
    @page { size: 4in 4in; margin: 0mm; }
    html, body { margin: 0 !important; padding: 0 !important; }
  </style>`;

  const printer = getLabelPrinter();

  let modified = html;
  if (modified.includes("</head>")) {
    modified = modified.replace("</head>", thermalCss + (printer ? buildQzScript(printer) : "") + "</head>");
  } else {
    modified = thermalCss + (printer ? buildQzScript(printer) : "") + modified;
  }
  if (printer && modified.includes("</body>")) {
    modified = modified.replace("</body>", STATUS_DIV + "</body>");
  }

  win.document.open();
  win.document.write(modified);
  win.document.close();

  if (!printer) {
    setTimeout(() => win.print(), 600);
  }
}

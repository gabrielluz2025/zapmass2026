/** Abre janela de impressão (Salvar como PDF) com resumo do relatório. */
export function printReportsPdf(params: {
  title: string;
  periodLabel: string;
  kpis: Array<{ label: string; value: string }>;
  campaigns: Array<{ name: string; date: string; total: number; success: number; failed: number; rate: number }>;
}): void {
  const rows = params.campaigns
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${esc(c.date)}</td><td>${c.total}</td><td>${c.success}</td><td>${c.failed}</td><td>${c.rate}%</td></tr>`
    )
    .join('');

  const kpiHtml = params.kpis
    .map((k) => `<div class="kpi"><strong>${esc(k.label)}</strong><span>${esc(k.value)}</span></div>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(params.title)}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:900px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#555;font-size:12px;margin-bottom:20px}
  .kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:24px}
  .kpi{border:1px solid #ddd;border-radius:8px;padding:12px} .kpi strong{display:block;font-size:11px;color:#666;text-transform:uppercase}
  .kpi span{font-size:18px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #ddd;padding:8px;text-align:left}
  th{background:#f5f5f5}
  @media print{body{padding:12px}}
</style></head><body>
<h1>${esc(params.title)}</h1>
<p class="sub">ZapMass · Período: ${esc(params.periodLabel)} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
<div class="kpis">${kpiHtml}</div>
<h2 style="font-size:14px">Campanhas</h2>
<table><thead><tr><th>Nome</th><th>Data</th><th>Total</th><th>Sucesso</th><th>Falhas</th><th>Taxa</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">Sem campanhas no período</td></tr>'}</tbody></table>
<script>window.onload=function(){window.print();}</script>
</body></html>`;

  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

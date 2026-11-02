// Página de cadastro (só para a equipe do Combinado): custos fixos, material por
// serviço e liga/desliga do recurso financeiro (plano Premium).

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function paginaCadastro({ client, chave, fixos, variaveis, financeiro, aviso }) {
  const linhas = fixos.concat(Array(Math.max(0, 8 - fixos.length)).fill({ nome: "", valor: "" }));
  const fx = linhas.map((f) => `<tr><td><input name="nome" value="${esc(f.nome)}" placeholder="Ex.: Aluguel"></td><td><input name="valor" inputmode="decimal" value="${esc(f.valor)}" placeholder="0,00"></td></tr>`).join("");
  const mat = Object.keys(client.services).map((s) => `<tr><td>${esc(s)} (R$ ${esc(client.services[s].price)})</td><td><input name="mat_${esc(s)}" inputmode="decimal" value="${esc(variaveis[s] || "")}" placeholder="0,00"></td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadastro de custos</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:20px auto;padding:0 16px;color:#16231f}h1{font-size:22px}h2{font-size:17px;margin-top:24px}
table{width:100%;border-collapse:collapse}td{padding:4px 2px}input[type=text],input:not([type]){width:100%;padding:9px;border:1px solid #bcc9c3;border-radius:6px;font-size:16px;box-sizing:border-box}
button{background:#1f4d43;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-size:16px;margin-top:20px}.ok{background:#dcebe4;padding:10px;border-radius:6px}.dica{color:#55665f;font-size:14px}</style>
<h1>${esc(client.displayName)}: cadastro de custos</h1>
${aviso ? `<p class="ok">${esc(aviso)}</p>` : ""}
<form method="post" action="/admin/cadastro"><input type="hidden" name="chave" value="${esc(chave)}">
<h2>Custos fixos por mês</h2><p class="dica">Aluguel, luz, água, internet, produtos de uso geral, comissão fixa. Em reais por mês. Deixe a linha em branco para não usar.</p>
<table>${fx}</table>
<h2>Material gasto por atendimento</h2><p class="dica">Quanto se gasta de material (lâmina, talco etc.) em cada serviço. Opcional.</p>
<table>${mat}</table>
<h2>Plano</h2><label><input type="checkbox" name="financeiro" value="1" ${financeiro ? "checked" : ""}> Plano Premium: liga custos e lucro no WhatsApp do dono</label>
<br><button type="submit">Salvar</button></form>`;
}

module.exports = { paginaCadastro };

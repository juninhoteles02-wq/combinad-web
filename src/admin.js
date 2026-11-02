// Página de cadastro (só para a equipe do Combinado): custos fixos, custos sobre o
// faturamento, meta de lucro, material por serviço e liga/desliga do recurso financeiro.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const vazias = (lista, n) => lista.concat(Array(Math.max(0, n - lista.length)).fill({ nome: "", valor: "" }));

function linhas(lista, campoNome, campoValor, phNome, phValor, n) {
  return vazias(lista, n).map((f) => `<tr><td><input name="${campoNome}" value="${esc(f.nome)}" placeholder="${phNome}"></td><td style="width:34%"><input name="${campoValor}" inputmode="decimal" value="${esc(f.valor)}" placeholder="${phValor}"></td></tr>`).join("");
}

function paginaCadastro({ client, chave, fixos, percentuais = [], meta = 0, variaveis, financeiro, aviso }) {
  const mat = Object.keys(client.services).map((s) => `<tr><td>${esc(s)} (R$ ${esc(client.services[s].price)})</td><td style="width:34%"><input name="mat_${esc(s)}" inputmode="decimal" value="${esc(variaveis[s] || "")}" placeholder="0,00"></td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadastro de custos</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:20px auto;padding:0 16px;color:#16231f}h1{font-size:22px}h2{font-size:17px;margin-top:26px;margin-bottom:2px}
table{width:100%;border-collapse:collapse}td{padding:4px 2px}input[type=text],input:not([type]){width:100%;padding:9px;border:1px solid #bcc9c3;border-radius:6px;font-size:16px;box-sizing:border-box}
button{background:#1f4d43;color:#fff;border:0;padding:12px 20px;border-radius:8px;font-size:16px;margin-top:20px}.ok{background:#dcebe4;padding:10px;border-radius:6px}.dica{color:#55665f;font-size:14px;margin:2px 0 8px}details{margin-top:22px}</style>
<h1>${esc(client.displayName)}: cadastro de custos</h1>
${aviso ? `<p class="ok">${esc(aviso)}</p>` : ""}
<form method="post" action="/admin/cadastro"><input type="hidden" name="chave" value="${esc(chave)}">
<h2>1. Custos fixos por mês (R$)</h2><p class="dica">Aluguel, luz, água, internet, produtos de uso geral. Para MEI, coloque o imposto aqui, como "Imposto (DAS do MEI)", com o valor da guia mensal. Linha em branco não conta.</p>
<table>${linhas(fixos, "nome", "valor", "Ex.: Aluguel", "0,00", 8)}</table>
<h2>2. Custos sobre o faturamento (%)</h2><p class="dica">O que desconta uma porcentagem de cada venda: taxa da maquininha, comissão. Se não houver, deixe em branco.</p>
<table>${linhas(percentuais, "pnome", "pvalor", "Ex.: Taxa da maquininha", "%", 3)}</table>
<h2>3. Meta de lucro por mês (R$)</h2><p class="dica">Quanto o dono quer que sobre no mês, depois de pagar tudo. Com isso o bot diz quanto precisa faturar.</p>
<table><tr><td><input name="meta" inputmode="decimal" value="${esc(meta || "")}" placeholder="0,00"></td></tr></table>
<details><summary>Refinar (opcional): material gasto por atendimento (R$)</summary><p class="dica">Lâmina, talco etc. Só preencha se quiser a margem de cada serviço mais precisa.</p><table>${mat}</table></details>
<h2>Plano</h2><label><input type="checkbox" name="financeiro" value="1" ${financeiro ? "checked" : ""}> Plano Premium: liga custos e lucro no WhatsApp do dono</label>
<br><button type="submit">Salvar</button></form>`;
}

module.exports = { paginaCadastro };

// Contas de custos e lucro do dono. Só matemática: não fala com o Google nem com a IA.

const r2 = (n) => Math.round(n * 100) / 100;

// "Aluguel:800|Luz:150" <-> [{nome, valor}]
function limparNome(s) { return String(s || "").replace(/[|:,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40); }

function fixosParaTexto(fixos) { return fixos.map((f) => `${limparNome(f.nome)}:${r2(f.valor)}`).join("|"); }
function textoParaFixos(txt) {
  return String(txt || "").split("|").filter(Boolean).map((p) => {
    const i = p.lastIndexOf(":");
    return { nome: p.slice(0, i), valor: Number(p.slice(i + 1)) || 0 };
  });
}
function variaveisParaTexto(v) { return Object.entries(v).map(([s, n]) => `${s}:${r2(n)}`).join("|"); }
function textoParaVariaveis(txt) {
  const out = {};
  String(txt || "").split("|").filter(Boolean).forEach((p) => { const i = p.lastIndexOf(":"); out[p.slice(0, i)] = Number(p.slice(i + 1)) || 0; });
  return out;
}

// Junta o que o dono pediu com o que já estava salvo. valor 0 remove o item.
function mesclarFixos(atuais, novos, substituir) {
  const mapa = new Map(substituir ? [] : atuais.map((f) => [limparNome(f.nome).toLowerCase(), { nome: limparNome(f.nome), valor: f.valor }]));
  (novos || []).forEach((n) => {
    const nome = limparNome(n.nome); const valor = Number(n.valor);
    if (!nome || !(valor >= 0)) return;
    if (valor === 0) mapa.delete(nome.toLowerCase()); else mapa.set(nome.toLowerCase(), { nome, valor });
  });
  return [...mapa.values()];
}

function totalFixos(fixos) { return r2(fixos.reduce((t, f) => t + f.valor, 0)); }

// services: { Corte: {price, min} }; variaveis: { Corte: custo de material por atendimento }
function margemPorServico(services, variaveis, fixosPorAtendimento, pct = 0) {
  return Object.entries(services).map(([nome, s]) => {
    const cv = variaveis[nome] || 0;
    const margem = s.price - cv - s.price * pct;
    return {
      servico: nome, preco: s.price, custo_variavel: r2(cv), margem: r2(margem),
      margem_pct: s.price ? Math.round((margem / s.price) * 100) : 0,
      lucro_apos_custo_fixo: fixosPorAtendimento == null ? null : r2(margem - fixosPorAtendimento),
    };
  });
}

// dados: {
//   fixos, variaveis, services,
//   faturamento, atendimentosPorServico: {Corte: n},   (só dias já fechados)
//   diasAbertosDecorridos, diasAbertosNoMes
// }
// percentuais: [{nome, valor}] em % do faturamento (taxa de maquininha, comissão etc.)
function totalPercentual(percentuais) { return r2((percentuais || []).reduce((t, p) => t + p.valor, 0)); }

function analisar(d) {
  const fixos = totalFixos(d.fixos);
  const atendidos = Object.values(d.atendimentosPorServico).reduce((t, n) => t + n, 0);
  const custoVar = r2(Object.entries(d.atendimentosPorServico).reduce((t, [s, n]) => t + n * (d.variaveis[s] || 0), 0));
  const pct = totalPercentual(d.percentuais) / 100;
  const meta = Number(d.meta) || 0;
  const custoPct = r2(d.faturamento * pct);
  const frac = d.diasAbertosNoMes ? Math.min(1, d.diasAbertosDecorridos / d.diasAbertosNoMes) : 0;
  const fixosProporcionais = r2(fixos * frac);
  const lucroAteAgora = r2(d.faturamento - custoVar - custoPct - fixosProporcionais);
  const ticket = atendidos ? d.faturamento / atendidos : 0;
  const margemMedia = atendidos ? (d.faturamento - custoVar - custoPct) / atendidos : 0;
  const equilibrioAtend = margemMedia > 0 ? Math.ceil(fixos / margemMedia) : null;
  const projecaoAtend = d.diasAbertosDecorridos ? Math.round((atendidos / d.diasAbertosDecorridos) * d.diasAbertosNoMes) : null;
  const fixoPorAtend = projecaoAtend ? fixos / projecaoAtend : null;
  return {
    custos_fixos_mensais: fixos,
    custos_fixos_proporcionais_ate_agora: fixosProporcionais,
    custo_variavel_ate_agora: custoVar,
    faturamento_fechado: r2(d.faturamento),
    atendimentos_fechados: atendidos,
    ticket_medio: r2(ticket),
    lucro_estimado_ate_agora: lucroAteAgora,
    ponto_de_equilibrio_atendimentos_no_mes: equilibrioAtend,
    ponto_de_equilibrio_faturamento: equilibrioAtend ? r2(equilibrioAtend * ticket) : null,
    projecao_atendimentos_no_mes: projecaoAtend,
    projecao_lucro_no_mes: projecaoAtend !== null ? r2(projecaoAtend * margemMedia - fixos) : null,
    custo_fixo_por_atendimento_no_ritmo_atual: fixoPorAtend === null ? null : r2(fixoPorAtend),
    custos_sobre_faturamento_pct: r2(pct * 100),
    custos_sobre_faturamento_ate_agora: custoPct,
    meta_de_lucro_mensal: meta,
    atendimentos_para_bater_a_meta: meta > 0 && margemMedia > 0 ? Math.ceil((fixos + meta) / margemMedia) : null,
    faturamento_para_bater_a_meta: meta > 0 && margemMedia > 0 ? r2(Math.ceil((fixos + meta) / margemMedia) * ticket) : null,
    diferenca_projecao_para_meta: meta > 0 && projecaoAtend !== null ? r2(projecaoAtend * margemMedia - fixos - meta) : null,
    custo_total_por_atendimento: fixoPorAtend === null || !atendidos ? null : r2(fixoPorAtend + custoVar / atendidos + custoPct / atendidos),
    margem_por_servico: margemPorServico(d.services, d.variaveis, fixoPorAtend, pct),
  };
}

// Converte o corpo do formulário (nomes e valores em listas) em { fixos, variaveis }.
function paraLista(v) { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }
function numero(v) { const n = Number(String(v || "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; }
function formParaCustos(body, services) {
  const nomes = paraLista(body.nome), valores = paraLista(body.valor);
  const itens = nomes.map((n, i) => ({ nome: n, valor: numero(valores[i]) })).filter((f) => limparNome(f.nome) && f.valor > 0);
  const fixos = mesclarFixos([], itens, true);
  const variaveis = {};
  Object.keys(services).forEach((s) => { const n = numero(body["mat_" + s]); if (n > 0) variaveis[s] = n; });
  const pn = paraLista(body.pnome), pv = paraLista(body.pvalor);
  const percentuais = mesclarFixos([], pn.map((n, i) => ({ nome: n, valor: numero(pv[i]) })).filter((x) => limparNome(x.nome) && x.valor > 0 && x.valor < 100), true);
  const meta = numero(body.meta); 
  return { fixos, variaveis, percentuais, meta: meta > 0 ? meta : 0, financeiro: body.financeiro === "1" };
}

module.exports = { totalPercentual, formParaCustos, numero, analisar, margemPorServico, mesclarFixos, totalFixos, fixosParaTexto, textoParaFixos, variaveisParaTexto, textoParaVariaveis, limparNome };

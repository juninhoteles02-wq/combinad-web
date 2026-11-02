const assert = require("assert");
const f = require("../src/financeiro");
// mesclar
let fx = f.mesclarFixos([], [{ nome: "Aluguel", valor: 800 }, { nome: "Luz", valor: 150 }]);
assert.strictEqual(f.totalFixos(fx), 950);
fx = f.mesclarFixos(fx, [{ nome: "luz", valor: 200 }, { nome: "Internet", valor: 100 }]);
assert.strictEqual(f.totalFixos(fx), 1100);
fx = f.mesclarFixos(fx, [{ nome: "Internet", valor: 0 }]);
assert.strictEqual(fx.length, 2);
assert.strictEqual(f.mesclarFixos(fx, [{ nome: "X", valor: 10 }], true).length, 1);
assert.strictEqual(f.mesclarFixos(fx, [{ nome: "", valor: 10 }, { nome: "Y", valor: -5 }]).length, 2, "ignora inválidos");
// texto ida e volta (nomes com : | , são limpos)
const txt = f.fixosParaTexto([{ nome: "Água: conta|", valor: 80.5 }]);
assert.deepStrictEqual(f.textoParaFixos(txt), [{ nome: "Água conta", valor: 80.5 }]);
assert.deepStrictEqual(f.textoParaVariaveis(f.variaveisParaTexto({ "Corte + Barba": 5, Corte: 3 })), { "Corte + Barba": 5, Corte: 3 });
// análise: 10 dias abertos de 20 passaram, 40 cortes (30) e 10 barbas (25), material 3 e 2
const services = { Corte: { price: 30 }, Barba: { price: 25 } };
const r = f.analisar({ fixos: [{ nome: "Aluguel", valor: 800 }, { nome: "Luz", valor: 200 }], variaveis: { Corte: 3, Barba: 2 }, services,
  faturamento: 40 * 30 + 10 * 25, atendimentosPorServico: { Corte: 40, Barba: 10 }, diasAbertosDecorridos: 10, diasAbertosNoMes: 20 });
assert.strictEqual(r.custos_fixos_mensais, 1000);
assert.strictEqual(r.custos_fixos_proporcionais_ate_agora, 500);
assert.strictEqual(r.custo_variavel_ate_agora, 140);
assert.strictEqual(r.atendimentos_fechados, 50);
assert.strictEqual(r.lucro_estimado_ate_agora, 1450 - 140 - 500);
assert.strictEqual(r.ponto_de_equilibrio_atendimentos_no_mes, Math.ceil(1000 / ((1450 - 140) / 50)));
assert.strictEqual(r.projecao_atendimentos_no_mes, 100);
assert.strictEqual(r.projecao_lucro_no_mes, Math.round((100 * 26.2 - 1000) * 100) / 100);
const corte = r.margem_por_servico.find((s) => s.servico === "Corte");
assert.strictEqual(corte.margem, 27); assert.strictEqual(corte.margem_pct, 90);
assert.strictEqual(corte.lucro_apos_custo_fixo, 17);
// sem atendimentos: sem divisão por zero
const z = f.analisar({ fixos: [{ nome: "A", valor: 500 }], variaveis: {}, services, faturamento: 0, atendimentosPorServico: {}, diasAbertosDecorridos: 0, diasAbertosNoMes: 20 });
assert.strictEqual(z.ponto_de_equilibrio_atendimentos_no_mes, null);
assert.strictEqual(z.projecao_atendimentos_no_mes, null);
// formulário
const fo = f.formParaCustos({ nome: ["Aluguel", "Luz", ""], valor: ["1.200,50", "150", "99"], mat_Corte: "3,5", mat_Barba: "", financeiro: "1" }, services);
assert.strictEqual(f.totalFixos(fo.fixos), 1350.5);
assert.deepStrictEqual(fo.variaveis, { Corte: 3.5 });
assert.strictEqual(fo.financeiro, true);
const um = f.formParaCustos({ nome: "Aluguel", valor: "800" }, services);
assert.strictEqual(um.fixos.length, 1); assert.strictEqual(um.financeiro, false);
assert.strictEqual(f.formParaCustos({}, services).fixos.length, 0);
// MEI: imposto fixo, taxa de maquininha em %, meta de lucro
const m = f.analisar({ fixos: [{ nome: "Aluguel", valor: 800 }, { nome: "DAS", valor: 80 }, { nome: "Luz", valor: 120 }], variaveis: {}, percentuais: [{ nome: "Maquininha", valor: 5 }], meta: 1500, services,
  faturamento: 1000, atendimentosPorServico: { Corte: 40 }, diasAbertosDecorridos: 10, diasAbertosNoMes: 20 });
assert.strictEqual(m.custos_sobre_faturamento_pct, 5);
assert.strictEqual(m.custos_sobre_faturamento_ate_agora, 50);
assert.strictEqual(m.lucro_estimado_ate_agora, 1000 - 50 - 500);            // 1000 - 5% - metade dos fixos
assert.strictEqual(m.ponto_de_equilibrio_atendimentos_no_mes, Math.ceil(1000 / 23.75));  // margem por atend: 25 - 1,25
assert.strictEqual(m.atendimentos_para_bater_a_meta, Math.ceil(2500 / 23.75));
assert.strictEqual(m.faturamento_para_bater_a_meta, Math.ceil(2500 / 23.75) * 25);
assert.strictEqual(m.diferenca_projecao_para_meta, Math.round((80 * 23.75 - 1000 - 1500) * 100) / 100);
assert.strictEqual(f.analisar({ fixos: [{ nome: "A", valor: 100 }], variaveis: {}, services, faturamento: 0, atendimentosPorServico: {}, diasAbertosDecorridos: 0, diasAbertosNoMes: 20 }).atendimentos_para_bater_a_meta, null);
const fm = f.formParaCustos({ nome: "DAS do MEI", valor: "80", pnome: ["Maquininha", ""], pvalor: ["3,5", "2"], meta: "1.500" }, services);
assert.strictEqual(fm.percentuais.length, 1); assert.strictEqual(fm.percentuais[0].valor, 3.5); assert.strictEqual(fm.meta, 1500);
console.log("financeiro-test OK");

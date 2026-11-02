// Ferramentas do "modo dono" (fechamento do dia). Só chamadas depois que o
// Elias (ou o dono de cada barbearia) já passou pelo código de acesso.

const gcal = require("./googleCalendar");
const sched = require("./scheduling");
const fin = require("./financeiro");

// Resolve qual dia a ferramenta deve usar: o que veio em args.data (validado),
// ou hoje se o dono não especificou outro dia. Isso é o que faltava antes —
// sem isso, toda pergunta sobre "sábado" ou "terça" caía sempre em hoje.
function resolveDia(args, tz) {
  const bruto = args && args.data ? String(args.data).trim() : "";
  if (!bruto) return sched.isoToday(tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
    throw new Error("Data deve estar no formato AAAA-MM-DD.");
  }
  return bruto;
}

function buildOwnerTools(client) {
  const DATA_PARAM = {
    data: {
      type: "string",
      description: "Dia a consultar, no formato AAAA-MM-DD. Se o dono não citou outro dia, omita — o padrão é hoje. Se ele citou um dia da semana, uma data ou 'ontem'/'anteontem', calcule a data exata (AAAA-MM-DD) a partir de hoje e informe aqui — nunca assuma que é hoje quando ele citou outro dia.",
    },
  };

  return [
    {
      name: "ver_agenda_do_dia",
      description: "Mostra a agenda de um dia (hora, cliente, serviço, status) só pra consulta — não é o fechamento do dia, não fala de faturamento e não pergunta sobre faltas ou encaixes. Aceita um parâmetro de data opcional; sem ele, mostra hoje.",
      parameters: { type: "object", properties: { ...DATA_PARAM } },
      async execute(args) {
        const dia = resolveDia(args);
        const events = await gcal.listEventsForDay(client.calendarId, dia);
        const ativos = events.filter((e) => e.situacao !== "cancelado").sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
        return {
          dia: `${sched.WEEK[sched.fromIso(dia).getDay()]} ${sched.br(dia)}`,
          quantidade: ativos.length,
          agendamentos: ativos.map((e) => ({ hora: e.hora, cliente: e.cliente, servico: e.servico, status: e.situacao })),
        };
      },
    },
    {
      name: "resumo_do_dia",
      description: "Mostra os agendamentos de um dia (cliente, hora, serviço, valor, status) e o valor previsto se todos vierem. Aceita um parâmetro de data opcional; sem ele, mostra hoje.",
      parameters: { type: "object", properties: { ...DATA_PARAM } },
      async execute(args) {
        const dia = resolveDia(args);
        const events = await gcal.listEventsForDay(client.calendarId, dia);
        const ativos = events.filter((e) => e.situacao !== "cancelado");
        const previsto = ativos.reduce((t, e) => t + (client.services[e.servico]?.price || 0), 0);
        return {
          dia: `${sched.WEEK[sched.fromIso(dia).getDay()]} ${sched.br(dia)}`,
          agendamentos: ativos.map((e) => ({
            cliente: e.cliente, hora: e.hora, servico: e.servico,
            valor: client.services[e.servico]?.price || 0,
            status: e.situacao === "faltou" ? "faltou" : "agendado",
          })),
          quantidade: ativos.length,
          previsto,
        };
      },
    },
    {
      name: "resumo_do_periodo",
      description: "Soma o faturamento da semana atual (desde segunda-feira) ou do mês atual (desde o dia 1), até hoje. Usa os fechamentos que o dono já fez dia a dia; dias que ele ainda não fechou entram como estimativa (baseada nos agendamentos, supondo que todos vieram), nunca como valor confirmado.",
      parameters: {
        type: "object",
        properties: { periodo: { type: "string", enum: ["semana", "mes"] } },
        required: ["periodo"],
      },
      async execute(args) {
        const today = sched.isoToday();
        const inicio = args.periodo === "mes" ? sched.startOfMonth(today) : sched.startOfWeek(today);
        const dias = sched.daysBetween(inicio, today);

        let confirmado = 0;
        let atendidosConfirmados = 0;
        let diasFechados = 0;
        const diasNaoFechados = [];
        let estimadoNaoFechado = 0;

        for (const dia of dias) {
          const fechamento = await gcal.buscarFechamentoDia(client.calendarId, dia);
          if (fechamento) {
            confirmado += fechamento.real;
            atendidosConfirmados += fechamento.atendidos;
            diasFechados++;
            continue;
          }
          if (!sched.isOpenDay(dia, client.businessHours)) continue;
          const events = await gcal.listEventsForDay(client.calendarId, dia);
          const ativos = events.filter((e) => e.situacao !== "cancelado");
          if (ativos.length === 0) continue;
          estimadoNaoFechado += ativos.reduce((t, e) => t + (client.services[e.servico]?.price || 0), 0);
          diasNaoFechados.push(dia);
        }

        return {
          periodo: args.periodo,
          de: inicio,
          ate: today,
          faturamento_confirmado: confirmado,
          atendidos_confirmados: atendidosConfirmados,
          dias_fechados: diasFechados,
          dias_ainda_nao_fechados: diasNaoFechados,
          faturamento_estimado_dias_nao_fechados: estimadoNaoFechado,
          faturamento_total_projetado: confirmado + estimadoNaoFechado,
        };
      },
    },
    {
      name: "ver_custos",
      description: "Mostra a lista de custos fixos mensais cadastrada (aluguel, luz etc.), o total, e o custo de material por serviço. Use quando o dono perguntar o que está cadastrado.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const c = await gcal.buscarCustos(client.calendarId);
        const fixos = fin.textoParaFixos(c.fixos);
        return { custos_fixos: fixos, total_fixos_mensais: fin.totalFixos(fixos), custo_de_material_por_servico: fin.textoParaVariaveis(c.variaveis) };
      },
    },
    {
      name: "definir_custos",
      description: "Cadastra ou atualiza a lista de custos. 'fixos' são gastos mensais (aluguel, luz, água, internet, produtos de uso geral, comissão fixa etc.) com valor em reais por mês. 'material_por_servico' é quanto se gasta de material em cada atendimento daquele serviço (lâmina, talco, navalha etc.), em reais. Itens novos são somados aos que já existem; um item com o mesmo nome é atualizado; valor 0 remove o item. Só use 'substituir_tudo' se o dono pedir para apagar a lista e começar de novo. Nunca invente valores: só registre o que o dono disse.",
      parameters: {
        type: "object",
        properties: {
          fixos: { type: "array", items: { type: "object", properties: { nome: { type: "string" }, valor: { type: "number" } }, required: ["nome", "valor"] } },
          material_por_servico: { type: "array", items: { type: "object", properties: { servico: { type: "string", enum: Object.keys(client.services) }, valor: { type: "number" } }, required: ["servico", "valor"] } },
          substituir_tudo: { type: "boolean" },
        },
      },
      async execute(args) {
        const atual = await gcal.buscarCustos(client.calendarId);
        const base = args.substituir_tudo ? [] : fin.textoParaFixos(atual.fixos);
        const fixos = fin.mesclarFixos(base, args.fixos || [], !!args.substituir_tudo);
        const variaveis = args.substituir_tudo ? {} : fin.textoParaVariaveis(atual.variaveis);
        (args.material_por_servico || []).forEach((m) => {
          if (client.services[m.servico] && Number(m.valor) >= 0) { if (Number(m.valor) === 0) delete variaveis[m.servico]; else variaveis[m.servico] = Number(m.valor); }
        });
        await gcal.salvarCustos(client.calendarId, { fixos: fin.fixosParaTexto(fixos), variaveis: fin.variaveisParaTexto(variaveis) });
        return { ok: true, custos_fixos: fixos, total_fixos_mensais: fin.totalFixos(fixos), custo_de_material_por_servico: variaveis };
      },
    },
    {
      name: "analise_financeira",
      description: "Calcula lucro do mês até agora, ponto de equilíbrio (quantos atendimentos por mês pagam as contas), projeção do mês e custo/margem de cada serviço. Usa só os dias que o dono já fechou (faturamento confirmado). Precisa dos custos cadastrados; se não houver, devolve um aviso para cadastrar primeiro.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const c = await gcal.buscarCustos(client.calendarId);
        const fixos = fin.textoParaFixos(c.fixos);
        const variaveis = fin.textoParaVariaveis(c.variaveis);
        if (fixos.length === 0) return { aviso: "Ainda não há custos fixos cadastrados. Peça ao dono a lista (aluguel, luz, água, internet, produtos, etc.) e use definir_custos." };

        const hoje = sched.isoToday();
        const inicio = sched.startOfMonth(hoje);
        const [y, m] = hoje.split("-").map(Number);
        const ultimo = `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
        const diasMes = sched.daysBetween(inicio, ultimo).filter((d) => sched.isOpenDay(d, client.businessHours));
        const diasPassados = diasMes.filter((d) => d <= hoje);

        let faturamento = 0; const porServico = {}; const naoFechados = [];
        for (const dia of diasPassados) {
          const f = await gcal.buscarFechamentoDia(client.calendarId, dia);
          if (!f) { if ((await gcal.listEventsForDay(client.calendarId, dia)).some((e) => e.situacao !== "cancelado")) naoFechados.push(dia); continue; }
          faturamento += f.real;
          const evs = (await gcal.listEventsForDay(client.calendarId, dia)).filter((e) => e.situacao !== "cancelado" && e.situacao !== "faltou");
          evs.forEach((e) => { porServico[e.servico] = (porServico[e.servico] || 0) + 1; });
          (f.encaixes || []).forEach((e) => { porServico[e.servico] = (porServico[e.servico] || 0) + e.quantidade; });
        }
        const diasFechados = diasPassados.filter((d) => !naoFechados.includes(d)).length;
        const r = fin.analisar({ fixos, variaveis, services: client.services, faturamento, atendimentosPorServico: porServico, diasAbertosDecorridos: diasPassados.length - naoFechados.length, diasAbertosNoMes: diasMes.length });
        return { mes: `${String(m).padStart(2, "0")}/${y}`, dias_fechados: diasFechados, dias_com_agenda_ainda_nao_fechados: naoFechados, material_cadastrado_para: Object.keys(variaveis), ...r };
      },
    },
    {
      name: "registrar_fechamento",
      description: "Fecha um dia: registra quem faltou (nomes dos clientes agendados naquele dia) e os encaixes feitos no balcão (serviço e quantidade). Pode ser chamada de novo para corrigir; cada chamada substitui a anterior daquele dia. Devolve o faturamento real. Aceita um parâmetro de data opcional; sem ele, fecha hoje — use-o sempre que o dono estiver fechando um dia passado (ex.: 'fechamento de sábado').",
      parameters: {
        type: "object",
        properties: {
          ...DATA_PARAM,
          faltas: { type: "array", items: { type: "string" }, description: "Nomes dos clientes agendados que não vieram. Vazio se todos vieram." },
          encaixes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                servico: { type: "string", enum: Object.keys(client.services) },
                quantidade: { type: "integer" },
              },
              required: ["servico", "quantidade"],
            },
            description: "Atendimentos sem agendamento feitos no balcão. Vazio se não teve.",
          },
        },
        required: ["faltas", "encaixes"],
      },
      async execute(args) {
        const dia = resolveDia(args);
        if (dia > sched.isoToday()) {
          throw new Error("Não é possível fechar um dia que ainda não chegou.");
        }
        const events = await gcal.listEventsForDay(client.calendarId, dia);
        const ativos = events.filter((e) => e.situacao !== "cancelado");

        // Limpa marcações de falta de uma chamada anterior, para esta ser a fonte da verdade.
        for (const ev of ativos) {
          if (ev.situacao === "faltou") await gcal.setSituacao(client.calendarId, ev.id, "agendado");
        }

        const naoAchei = [];
        const faltaram = [];
        for (const nome of args.faltas || []) {
          const alvo = String(nome).trim().toLowerCase();
          const ev = ativos.find((e) =>
            e.situacao !== "faltou" &&
            (e.cliente.toLowerCase() === alvo || e.cliente.toLowerCase().split(" ")[0] === alvo.split(" ")[0])
          );
          if (ev) {
            await gcal.setSituacao(client.calendarId, ev.id, "faltou");
            faltaram.push(ev);
          } else {
            naoAchei.push(nome);
          }
        }

        const encaixes = (args.encaixes || [])
          .map((e) => ({ servico: e.servico, quantidade: Math.max(0, parseInt(e.quantidade, 10) || 0) }))
          .filter((e) => e.quantidade > 0 && client.services[e.servico]);

        const previsto = ativos.reduce((t, e) => t + (client.services[e.servico]?.price || 0), 0);
        const perdido = faltaram.reduce((t, e) => t + (client.services[e.servico]?.price || 0), 0);
        const extra = encaixes.reduce((t, e) => t + e.quantidade * client.services[e.servico].price, 0);
        const nEncaixes = encaixes.reduce((t, e) => t + e.quantidade, 0);
        const real = previsto - perdido + extra;
        const atendidos = ativos.length - faltaram.length + nEncaixes;

        const fechamento = {
          data: dia, previsto, faltas: faltaram.map((e) => `${e.cliente} (${e.hora}, ${e.servico})`),
          perdido, encaixes, extra, real, atendidos,
        };
        await gcal.salvarFechamentoDia(client.calendarId, dia, fechamento);

        return {
          ok: true, dia: `${sched.WEEK[sched.fromIso(dia).getDay()]} ${sched.br(dia)}`,
          previsto, faltas: fechamento.faltas, valor_perdido_com_faltas: perdido,
          encaixes, valor_encaixes: extra, faturamento_real: real, clientes_atendidos: atendidos,
          nomes_nao_encontrados_na_agenda: naoAchei,
        };
      },
    },
  ];
}

module.exports = { buildOwnerTools };

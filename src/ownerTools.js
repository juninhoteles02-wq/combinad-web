// Ferramentas do "modo dono" (fechamento do dia). Só chamadas depois que o
// Elias (ou o dono de cada barbearia) já passou pelo código de acesso.

const gcal = require("./googleCalendar");
const sched = require("./scheduling");

function buildOwnerTools(client) {
  const today = sched.isoToday();

  return [
    {
      name: "ver_agenda_do_dia",
      description: "Mostra a agenda de hoje (hora, cliente, serviço, status) só pra consulta — não é o fechamento do dia, não fala de faturamento e não pergunta sobre faltas ou encaixes.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const events = await gcal.listEventsForDay(client.calendarId, today);
        const ativos = events.filter((e) => e.situacao !== "cancelado").sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
        return {
          dia: `${sched.WEEK[sched.fromIso(today).getDay()]} ${sched.br(today)}`,
          quantidade: ativos.length,
          agendamentos: ativos.map((e) => ({ hora: e.hora, cliente: e.cliente, servico: e.servico, status: e.situacao })),
        };
      },
    },
    {
      name: "resumo_do_dia",
      description: "Mostra os agendamentos de hoje (cliente, hora, serviço, valor, status) e o valor previsto se todos vierem.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const events = await gcal.listEventsForDay(client.calendarId, today);
        const ativos = events.filter((e) => e.situacao !== "cancelado");
        const previsto = ativos.reduce((t, e) => t + (client.services[e.servico]?.price || 0), 0);
        return {
          dia: `${sched.WEEK[sched.fromIso(today).getDay()]} ${sched.br(today)}`,
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
      name: "registrar_fechamento",
      description: "Fecha o dia: registra quem faltou (nomes dos clientes agendados hoje) e os encaixes feitos no balcão (serviço e quantidade). Pode ser chamada de novo para corrigir; cada chamada substitui a anterior. Devolve o faturamento real.",
      parameters: {
        type: "object",
        properties: {
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
        const events = await gcal.listEventsForDay(client.calendarId, today);
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
          data: today, previsto, faltas: faltaram.map((e) => `${e.cliente} (${e.hora}, ${e.servico})`),
          perdido, encaixes, extra, real, atendidos,
        };
        await gcal.salvarFechamentoDia(client.calendarId, today, fechamento);

        return {
          ok: true, previsto, faltas: fechamento.faltas, valor_perdido_com_faltas: perdido,
          encaixes, valor_encaixes: extra, faturamento_real: real, clientes_atendidos: atendidos,
          nomes_nao_encontrados_na_agenda: naoAchei,
        };
      },
    },
  ];
}

module.exports = { buildOwnerTools };

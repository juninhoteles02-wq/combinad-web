// Números de uso do Combinado, calculados a partir da própria agenda do cliente.
// Só leitura: não altera nenhum evento. Usado pela rota /metricas e pelos testes.

const sched = require("./scheduling");

function horaBrasilia(iso) {
  // devolve { dia: AAAA-MM-DD, hm: "HH:MM", dow } no fuso de Brasília
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const p = (n) => String(n).padStart(2, "0");
  return { dia: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hm: `${p(d.getHours())}:${p(d.getMinutes())}`, dow: d.getDay() };
}

function foraDoExpediente(criadoIso, hours) {
  if (!criadoIso) return null;
  const { dia, hm } = horaBrasilia(criadoIso);
  if (!sched.isOpenDay(dia, hours)) return true;
  const h = Number(hm.slice(0, 2));
  return h < hours.openHour || h >= hours.closeHour;
}

// events: lista de parseEvent (com raw). Só conta agendamentos de verdade.
function calcular(events, hours, hojeISO) {
  const reais = events.filter((e) => e.hora && !(e.raw && e.raw.extendedProperties && e.raw.extendedProperties.private && e.raw.extendedProperties.private.tipo));
  const porBot = reais.filter((e) => e.origem === "assistente");
  const passados = reais.filter((e) => e.raw.start.dateTime.slice(0, 10) < hojeISO);
  const faltas = passados.filter((e) => e.situacao === "faltou").length;
  const comLembrete = reais.filter((e) => e.lembreteEm);
  const confirmados = comLembrete.filter((e) => e.situacao === "confirmado").length;
  const fora = porBot.filter((e) => foraDoExpediente(e.raw.created, hours) === true).length;

  const tel = {};
  reais.forEach((e) => { if (e.telefone) tel[e.telefone] = (tel[e.telefone] || 0) + 1; });
  const clientes = Object.keys(tel).length;
  const retornantes = Object.values(tel).filter((n) => n >= 2).length;

  const semanas = {};
  reais.forEach((e) => {
    const s = sched.startOfWeek(e.raw.start.dateTime.slice(0, 10));
    semanas[s] = semanas[s] || { total: 0, bot: 0 };
    semanas[s].total++;
    if (e.origem === "assistente") semanas[s].bot++;
  });

  return {
    total: reais.length,
    pelaAssistente: porBot.length,
    pctAssistente: reais.length ? Math.round((porBot.length / reais.length) * 100) : 0,
    foraDoExpediente: fora,
    atendimentosPassados: passados.length,
    faltas,
    pctFaltas: passados.length ? Math.round((faltas / passados.length) * 1000) / 10 : null,
    lembretesEnviados: comLembrete.length,
    lembretesConfirmados: confirmados,
    clientes,
    clientesRetornantes: retornantes,
    porSemana: Object.keys(semanas).sort().map((s) => ({ semana: s, ...semanas[s] })),
  };
}

function paraHtml(r, titulo) {
  const linhas = [
    ["Agendamentos no período", r.total],
    ["Marcados pelo assistente (WhatsApp)", `${r.pelaAssistente} (${r.pctAssistente}%)`],
    ["Marcados fora do horário da barbearia", r.foraDoExpediente],
    ["Atendimentos já passados", r.atendimentosPassados],
    ["Faltas registradas", r.faltas + (r.pctFaltas === null ? "" : ` (${r.pctFaltas}%)`)],
    ["Lembretes da véspera enviados", r.lembretesEnviados],
    ["Lembretes confirmados pelo cliente", r.lembretesConfirmados],
    ["Clientes diferentes", r.clientes],
    ["Clientes que voltaram (2 ou mais)", r.clientesRetornantes],
  ].map(([a, b]) => `<tr><td>${a}</td><td><b>${b}</b></td></tr>`).join("");
  const sem = r.porSemana.map((s) => `<tr><td>${s.semana}</td><td>${s.total}</td><td>${s.bot}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Métricas Combinado</title>
<body style="font-family:system-ui;max-width:640px;margin:24px auto;padding:0 16px"><h2>${titulo}</h2>
<table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">${linhas}</table>
<h3>Por semana (início na segunda)</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%"><tr><th>Semana</th><th>Total</th><th>Pelo assistente</th></tr>${sem}</table>
<p style="color:#666">Faltas só aparecem se o fechamento do dia foi feito. Lembrete confirmado = cliente respondeu ao lembrete.</p></body>`;
}

module.exports = { calcular, paraHtml, foraDoExpediente };

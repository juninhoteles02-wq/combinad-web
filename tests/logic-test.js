// Teste manual de lógica (não faz parte do projeto entregue). Substitui o
// Google Calendar real por uma agenda falsa em memória, pra validar as
// contas de horário sem precisar de credenciais de verdade.
process.env.ELIAS_PHONE_NUMBER_ID = "PN123";
process.env.ELIAS_CALENDAR_ID = "cal123";
process.env.ELIAS_OWNER_PHONE = "5521999990000";
process.env.ELIAS_OWNER_CODE = "1234";

const assert = require("assert");
const { getClientById } = require("../src/config");
const gcal = require("../src/googleCalendar");
const sched = require("../src/scheduling");
const { buildTools } = require("../src/tools");
const { buildOwnerTools } = require("../src/ownerTools");

const client = getClientById("elias");
const today = sched.isoToday();
const tomorrow = sched.nextOpenDays(client.businessHours, 6)[1];
// Preços lidos do config (assim o teste não quebra quando o dono muda os valores).
const PRECO = Object.fromEntries(Object.entries(client.services).map(([nome, sv]) => [nome, sv.price]));

// ---- agenda falsa em memória ----
let seq = 1;
let events = [];
function addMinutes(hm, min) {
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
function makeEvent({ dateISO, hora, minutos, cliente, servico, barbeiro, telefone, origem, situacao }) {
  return {
    id: "EV" + seq++,
    hora,
    fimHora: addMinutes(hora, minutos),
    cliente, servico, barbeiro, telefone,
    origem: origem || "assistente",
    situacao: situacao || "agendado",
    raw: { start: { dateTime: `${dateISO}T${hora}:00-03:00` }, end: { dateTime: `${dateISO}T${addMinutes(hora, minutos)}:00-03:00` } },
  };
}

gcal.listEventsForDay = async (calendarId, dateISO) => events.filter((e) => e.raw.start.dateTime.slice(0, 10) === dateISO && e.situacao !== "cancelado");
gcal.listUpcomingForPhone = async (calendarId, telefone) => events.filter((e) => e.telefone === telefone && e.situacao !== "cancelado");
gcal.createEvent = async (calendarId, args) => { const ev = makeEvent(args); events.push(ev); return ev; };
gcal.patchEvent = async (calendarId, eventId, patch) => {
  const ev = events.find((e) => e.id === eventId);
  const priv = (patch.extendedProperties && patch.extendedProperties.private) || {};
  Object.assign(ev, priv);
  if (patch.start) { ev.hora = patch.start.dateTime.slice(11, 16); ev.raw.start.dateTime = patch.start.dateTime.includes("T") ? `${patch.start.dateTime}` : ev.raw.start.dateTime; }
  if (patch.start) ev.raw.start.dateTime = `${patch.start.dateTime}`;
  if (patch.end) ev.raw.end.dateTime = `${patch.end.dateTime}`;
  return ev;
};
gcal.moveEvent = async (calendarId, eventId, { dateISO, hora, minutos, barbeiro }) => {
  const ev = events.find((e) => e.id === eventId);
  ev.hora = hora; ev.barbeiro = barbeiro; ev.situacao = "agendado";
  ev.raw.start.dateTime = `${dateISO}T${hora}:00-03:00`;
  ev.raw.end.dateTime = `${dateISO}T${addMinutes(hora, minutos)}:00-03:00`;
  return ev;
};
gcal.setSituacao = async (calendarId, eventId, situacao) => { const ev = events.find((e) => e.id === eventId); ev.situacao = situacao; return ev; };
gcal.cancelEvent = async (calendarId, eventId) => { events = events.filter((e) => e.id !== eventId); return { ok: true }; };

gcal.nomeConhecido = async () => null;
gcal.salvarNomeCliente = async () => ({ ok: true });
gcal.salvarFechamentoDia = async () => ({ ok: true });
gcal.buscarFechamentoDia = async () => null;
let custosSalvos = { id: null, fixos: "", variaveis: "" };
gcal.buscarCustos = async () => custosSalvos;
gcal.salvarCustos = async (cal, c) => { custosSalvos = { id: "C1", ...c }; };

async function run() {
  const telefone = "5521988887777";
  const ctx = { lastReminderEventId: null, onCallBarber: async () => {} };
  const tools = buildTools(client, telefone, ctx);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  // 1) sem serviço deve falhar
  try {
    await byName.ver_horarios_livres.execute({ data: tomorrow });
    throw new Error("deveria ter falhado sem serviço");
  } catch (e) {
    assert.match(e.message, /Serviço não informado/);
    console.log("OK: exige serviço antes de ver horários");
  }

  // 2) ver horários livres para Corte
  const livres = await byName.ver_horarios_livres.execute({ data: tomorrow, servico: "Corte" });
  assert.ok(livres.livres.Elias.includes("15:00"));
  console.log("OK: 15:00 livre para Corte");

  // 3) criar agendamento às 15:00 Corte
  const criado = await byName.criar_agendamento.execute({ data: tomorrow, hora: "15:00", servico: "Corte", nome_cliente: "Lucas" });
  assert.strictEqual(criado.ok, true);
  assert.strictEqual(criado.hora, "15:00");
  console.log("OK: agendamento criado", criado.codigo);

  // 4) buscar agendamentos do cliente
  const meus = await byName.buscar_agendamentos.execute({});
  assert.strictEqual(meus.length, 1);
  console.log("OK: buscar_agendamentos encontra o agendamento");

  // 5) trocar serviço para Corte + Barba (1h) não deve caber às 15:00 se 15:30 ocupado por outro
  events.push(makeEvent({ dateISO: tomorrow, hora: "15:30", minutos: 30, cliente: "Outro", servico: "Corte", barbeiro: "Elias", telefone: "000" }));
  const troca = await byName.trocar_servico.execute({ codigo: criado.codigo, servico: "Corte + Barba" });
  assert.strictEqual(troca.ok, false);
  assert.ok(troca.horarios_mais_proximos_no_mesmo_dia.length > 0);
  console.log("OK: trocar_servico recusa e sugere horários:", troca.horarios_mais_proximos_no_mesmo_dia);

  // 6) remarcar para 17:00
  const remarcado = await byName.remarcar_agendamento.execute({ codigo: criado.codigo, data: tomorrow, hora: "17:00" });
  assert.strictEqual(remarcado.hora, "17:00");
  console.log("OK: remarcar_agendamento move o horário");

  // 7) confirmar presença
  const confirmado = await byName.confirmar_presenca.execute({ codigo: criado.codigo });
  assert.strictEqual(confirmado.status, "confirmado");
  console.log("OK: confirmar_presenca marca confirmado");

  // 8) cancelar
  const cancelado = await byName.cancelar_agendamento.execute({ codigo: criado.codigo });
  assert.strictEqual(cancelado.ok, true);
  const meusDepois = await byName.buscar_agendamentos.execute({});
  assert.strictEqual(meusDepois.length, 0);
  console.log("OK: cancelar_agendamento remove da lista do cliente");

  // ---- modo dono ----
  events = [];
  events.push(makeEvent({ dateISO: today, hora: "09:00", minutos: 30, cliente: "Marcos", servico: "Corte", barbeiro: "Elias", telefone: "111" }));
  events.push(makeEvent({ dateISO: today, hora: "10:00", minutos: 60, cliente: "Caio", servico: "Corte + Barba", barbeiro: "Elias", telefone: "222" }));
  const ownerTools = buildOwnerTools(client);
  const ownerByName = Object.fromEntries(ownerTools.map((t) => [t.name, t]));

  const resumo = await ownerByName.resumo_do_dia.execute({});
  assert.strictEqual(resumo.quantidade, 2);
  assert.strictEqual(resumo.previsto, PRECO["Corte"] + PRECO["Corte + Barba"]);
  console.log("OK: resumo_do_dia soma previsto corretamente:", resumo.previsto);

  const fechamento = await ownerByName.registrar_fechamento.execute({ faltas: ["Marcos"], encaixes: [{ servico: "Corte", quantidade: 2 }] });
  assert.strictEqual(fechamento.faturamento_real, (PRECO["Corte"] + PRECO["Corte + Barba"]) - PRECO["Corte"] + 2 * PRECO["Corte"]);
  console.log("OK: registrar_fechamento calcula faturamento real:", fechamento.faturamento_real);

  // ---- lembrete da véspera sobrevive a reinício do servidor ----
  const { lembretePendente } = require("../src/state");
  const wa = require("../src/whatsapp");
  const reminders = require("../src/reminders");
  const { clientConversations } = require("../src/state");

  events = [];
  const amanha = (() => { const d = sched.fromIso(sched.isoToday()); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const aberto = sched.isOpenDay(amanha, client.businessHours);
  const evA = makeEvent({ dateISO: amanha, hora: "10:00", minutos: 30, cliente: "Ana", servico: "Corte", barbeiro: "Elias", telefone: "5521911112222" });
  events.push(evA);
  const enviados = [];
  wa.sendTemplate = async (pn, to) => { enviados.push(to); return true; };
  client.calendarId = client.calendarId || "cal123"; client.phoneNumberId = client.phoneNumberId || "PN123";

  if (aberto) {
    await reminders.sendRemindersForClient(client);
    assert.deepStrictEqual(enviados, ["5521911112222"]);
    assert.ok(evA.lembreteEm, "deveria gravar lembreteEm no evento");
    console.log("OK: lembrete enviado e marcador gravado no evento");

    await reminders.sendRemindersForClient(client);
    assert.strictEqual(enviados.length, 1);
    console.log("OK: segundo disparo não reenvia o lembrete");
  } else {
    console.log("(amanhã é dia fechado: testes de envio do lembrete pulados)");
    evA.lembreteEm = new Date().toISOString();
  }

  // simula reinício: a memória some, mas o evento ainda tem o marcador
  clientConversations.clear();
  assert.strictEqual(lembretePendente(null, [evA]), evA.id);
  console.log("OK: depois do reinício, o lembrete pendente é achado pela agenda");

  evA.situacao = "confirmado";
  assert.strictEqual(lembretePendente(null, [evA]), null);
  console.log("OK: agendamento já confirmado não é tratado como lembrete pendente");

  const evB = makeEvent({ dateISO: amanha, hora: "11:00", minutos: 30, cliente: "Ana", servico: "Barba", barbeiro: "Elias", telefone: "5521911112222" });
  evB.lembreteEm = "2026-01-01T00:00:00.000Z"; evA.situacao = "agendado"; evA.lembreteEm = "2026-02-01T00:00:00.000Z";
  assert.strictEqual(lembretePendente(null, [evB, evA]), evA.id);
  console.log("OK: com dois lembretes, vale o mais recente");

  // ---- custos do dono ----
  assert(!buildOwnerTools(client).some((t) => t.name === "analise_financeira"), "financeiro desligado por padrão");
  const ownerToolsFin = buildOwnerTools({ ...client, recursos: { financeiro: true } });
  const semCustos = await ownerToolsFin.find((t) => t.name === "analise_financeira").execute({});
  assert(semCustos.aviso, "sem custos cadastrados deve avisar");
  const def = await ownerToolsFin.find((t) => t.name === "definir_custos").execute({
    fixos: [{ nome: "Aluguel", valor: 800 }, { nome: "Luz", valor: 150 }],
    material_por_servico: [{ servico: "Corte", valor: 3 }],
  });
  assert.strictEqual(def.total_fixos_mensais, 950);
  const def2 = await ownerToolsFin.find((t) => t.name === "definir_custos").execute({ fixos: [{ nome: "Luz", valor: 0 }, { nome: "Internet", valor: 100 }] });
  assert.strictEqual(def2.total_fixos_mensais, 900);
  assert.strictEqual(def2.custo_de_material_por_servico.Corte, 3, "material anterior preservado");
  const ver = await ownerToolsFin.find((t) => t.name === "ver_custos").execute({});
  assert.strictEqual(ver.custos_fixos.length, 2);
  const an = await ownerToolsFin.find((t) => t.name === "analise_financeira").execute({});
  assert.strictEqual(an.custos_fixos_mensais, 900);
  assert(Array.isArray(an.margem_por_servico) && an.margem_por_servico.length === Object.keys(client.services).length);
  console.log("OK: custos do dono cadastrados e analisados");

  console.log("\nTodos os testes de lógica passaram.");
}

run().catch((err) => { console.error("FALHOU:", err); process.exit(1); });

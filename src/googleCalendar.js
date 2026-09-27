// Camada fina sobre a API do Google Calendar.
// Guardamos os dados do agendamento (cliente, serviço, status, origem) em
// extendedProperties.private, que não aparece para o Elias na tela do app do
// Google Agenda, mas o servidor consegue ler e filtrar.

const { google } = require("googleapis");
const path = require("path");
const { env } = require("./config");

let calendarClientPromise = null;

function getCalendarClient() {
  if (!calendarClientPromise) {
    const keyFile = path.resolve(process.cwd(), env.googleKeyPath);
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    calendarClientPromise = auth.getClient().then(
      (authClient) => google.calendar({ version: "v3", auth: authClient })
    );
  }
  return calendarClientPromise;
}

function toRFC3339(dateISO, timeHM, timeZone = "America/Sao_Paulo") {
  // dateISO: "2026-09-26", timeHM: "14:30"
  return { dateTime: `${dateISO}T${timeHM}:00`, timeZone };
}

function addMinutes(timeHM, minutes) {
  const [h, m] = timeHM.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

async function listEvents(calendarId, timeMin, timeMax) {
  const calendar = await getCalendarClient();
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  return (res.data.items || [])
    .filter((ev) => ev.status !== "cancelled")
    .map(parseEvent);
}

// Lista os eventos (não cancelados) de um dia inteiro na agenda do cliente.
async function listEventsForDay(calendarId, dateISO) {
  return listEvents(calendarId, `${dateISO}T00:00:00-03:00`, `${dateISO}T23:59:59-03:00`);
}

// Busca os agendamentos futuros (próximos N dias) de um telefone específico,
// varrendo a agenda inteira do cliente (independente do dia).
async function listUpcomingForPhone(calendarId, telefone, diasAFrente = 45) {
  const now = new Date();
  const until = new Date(now.getTime() + diasAFrente * 24 * 60 * 60 * 1000);
  const events = await listEvents(calendarId, now.toISOString(), until.toISOString());
  return events.filter((ev) => ev.telefone === telefone && ev.situacao !== "cancelado");
}

function parseEvent(ev) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  const hora = ev.start && ev.start.dateTime ? ev.start.dateTime.slice(11, 16) : null;
  return {
    id: ev.id,
    hora,
    fimHora: ev.end && ev.end.dateTime ? ev.end.dateTime.slice(11, 16) : null,
    cliente: priv.cliente || (ev.summary || "").split(" - ")[0] || "Cliente",
    servico: priv.servico || "Corte",
    barbeiro: priv.barbeiro || "Elias",
    telefone: priv.telefone || "",
    origem: priv.origem || "balcao",
    situacao: priv.situacao || "agendado", // agendado | confirmado | cancelado | faltou
    raw: ev,
  };
}

async function createEvent(calendarId, { dateISO, hora, minutos, cliente, servico, barbeiro, telefone, origem }) {
  const calendar = await getCalendarClient();
  const fim = addMinutes(hora, minutos);
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${cliente} - ${servico}`,
      description: `Agendado via Combinado.\nCliente: ${cliente}\nTelefone: ${telefone}\nServiço: ${servico}`,
      start: toRFC3339(dateISO, hora),
      end: toRFC3339(dateISO, fim),
      extendedProperties: {
        private: { cliente, servico, barbeiro, telefone, origem: origem || "assistente", situacao: "agendado" },
      },
    },
  });
  return parseEvent(res.data);
}

// ---------- cadastro de clientes (nome por telefone, permanente) ----------
// Guardamos como um evento oculto (datado no passado, "2020-01-01") pra não
// aparecer na agenda do dia a dia do Elias. Um evento por telefone.
const REGISTRO_DATA = "2020-01-01";

async function findRegistroCliente(calendarId, telefone) {
  const calendar = await getCalendarClient();
  const res = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`tipo=cadastro_cliente`, `telefone=${telefone}`],
    maxResults: 1,
    showDeleted: false,
  });
  const ev = (res.data.items || [])[0];
  if (!ev) return null;
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  return { id: ev.id, cliente: priv.cliente || null };
}

// Busca só o nome (usado pra montar o contexto da conversa).
async function nomeConhecido(calendarId, telefone) {
  const registro = await findRegistroCliente(calendarId, telefone);
  return registro ? registro.cliente : null;
}

// Salva ou atualiza o nome do cliente pra aquele telefone. Chamado sempre que
// um agendamento é criado, pra ir "aprendendo" os clientes com o tempo.
async function salvarNomeCliente(calendarId, telefone, nome) {
  if (!telefone || !nome) return;
  const calendar = await getCalendarClient();
  const existente = await findRegistroCliente(calendarId, telefone);
  if (existente) {
    if (existente.cliente === nome) return; // já está certo, não precisa gravar de novo
    await calendar.events.patch({
      calendarId,
      eventId: existente.id,
      requestBody: { extendedProperties: { private: { tipo: "cadastro_cliente", telefone, cliente: nome } } },
    });
    return;
  }
  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: "Cadastro de cliente (Combinado)",
      description: "Registro interno do Combinado, não é um agendamento.",
      start: { date: REGISTRO_DATA },
      end: { date: "2020-01-02" }, // eventos de dia inteiro: data final é exclusiva
      transparency: "transparent",
      visibility: "private",
      extendedProperties: {
        private: { tipo: "cadastro_cliente", telefone, cliente: nome },
      },
    },
  });
}

// ---------- fechamento do dia (permanente, no Google Calendar) ----------
// Guardado como um evento oculto de dia inteiro, datado no próprio dia do
// fechamento (ex.: 2026-09-26), pra facilitar somar por semana/mês depois.
// Isso substitui o antigo store.writeJSON local (disco do Render free não é
// permanente — some a cada reinício do servidor).

async function findFechamentoDia(calendarId, dateISO) {
  const calendar = await getCalendarClient();
  const res = await calendar.events.list({
    calendarId,
    privateExtendedProperty: [`tipo=fechamento_dia`, `data=${dateISO}`],
    maxResults: 1,
    showDeleted: false,
  });
  return (res.data.items || [])[0] || null;
}

// Salva (ou substitui) o fechamento de um dia. "dados" vem de registrar_fechamento.
async function salvarFechamentoDia(calendarId, dateISO, dados) {
  const calendar = await getCalendarClient();
  const priv = {
    tipo: "fechamento_dia",
    data: dateISO,
    previsto: String(dados.previsto || 0),
    real: String(dados.real || 0),
    perdido: String(dados.perdido || 0),
    extra: String(dados.extra || 0),
    atendidos: String(dados.atendidos || 0),
    // arrays viram texto simples pra caber em extendedProperties (só strings).
    faltas: (dados.faltas || []).join("|").slice(0, 1000),
    encaixes: (dados.encaixes || []).map((e) => `${e.servico}:${e.quantidade}`).join(",").slice(0, 1000),
  };
  const existente = await findFechamentoDia(calendarId, dateISO);
  if (existente) {
    await calendar.events.patch({ calendarId, eventId: existente.id, requestBody: { extendedProperties: { private: priv } } });
    return;
  }
  const [y, m, d] = dateISO.split("-").map(Number);
  const amanha = new Date(y, m - 1, d + 1);
  const amanhaISO = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, "0")}-${String(amanha.getDate()).padStart(2, "0")}`;
  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Fechamento ${dateISO} (Combinado)`,
      description: "Registro interno do Combinado, não é um agendamento.",
      start: { date: dateISO },
      end: { date: amanhaISO },
      transparency: "transparent",
      visibility: "private",
      extendedProperties: { private: priv },
    },
  });
}

// Devolve o fechamento salvo daquele dia, ou null se o dono nunca fechou esse dia.
async function buscarFechamentoDia(calendarId, dateISO) {
  const ev = await findFechamentoDia(calendarId, dateISO);
  if (!ev) return null;
  const p = (ev.extendedProperties && ev.extendedProperties.private) || {};
  return {
    data: dateISO,
    previsto: Number(p.previsto || 0),
    real: Number(p.real || 0),
    perdido: Number(p.perdido || 0),
    extra: Number(p.extra || 0),
    atendidos: Number(p.atendidos || 0),
    faltas: p.faltas ? p.faltas.split("|").filter(Boolean) : [],
    encaixes: p.encaixes
      ? p.encaixes.split(",").filter(Boolean).map((s) => {
          const [servico, quantidade] = s.split(":");
          return { servico, quantidade: Number(quantidade || 0) };
        })
      : [],
  };
}

async function getEvent(calendarId, eventId) {
  const calendar = await getCalendarClient();
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}

// A API do Calendar substitui o mapa extendedProperties.private inteiro a
// cada patch (não faz merge por chave). Por isso, sempre buscamos o evento
// atual e mesclamos manualmente antes de enviar o patch.
async function patchEvent(calendarId, eventId, patch) {
  const calendar = await getCalendarClient();
  if (patch.extendedProperties && patch.extendedProperties.private) {
    const current = await getEvent(calendarId, eventId);
    const currentPrivate = (current.extendedProperties && current.extendedProperties.private) || {};
    patch = {
      ...patch,
      extendedProperties: { private: { ...currentPrivate, ...patch.extendedProperties.private } },
    };
  }
  const res = await calendar.events.patch({ calendarId, eventId, requestBody: patch });
  return parseEvent(res.data);
}

async function moveEvent(calendarId, eventId, { dateISO, hora, minutos, barbeiro }) {
  const fim = addMinutes(hora, minutos);
  return patchEvent(calendarId, eventId, {
    start: toRFC3339(dateISO, hora),
    end: toRFC3339(dateISO, fim),
    extendedProperties: { private: { barbeiro, situacao: "agendado" } },
  });
}

async function setSituacao(calendarId, eventId, situacao) {
  return patchEvent(calendarId, eventId, { extendedProperties: { private: { situacao } } });
}

async function cancelEvent(calendarId, eventId) {
  const calendar = await getCalendarClient();
  await calendar.events.patch({ calendarId, eventId, requestBody: { status: "cancelled" } });
  return { ok: true };
}

module.exports = {
  listEvents,
  listEventsForDay,
  listUpcomingForPhone,
  createEvent,
  patchEvent,
  moveEvent,
  setSituacao,
  cancelEvent,
  addMinutes,
  nomeConhecido,
  salvarNomeCliente,
  salvarFechamentoDia,
  buscarFechamentoDia,
};

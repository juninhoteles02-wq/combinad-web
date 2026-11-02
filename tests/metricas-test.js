process.env.ELIAS_PHONE_NUMBER_ID = "PN"; process.env.ELIAS_CALENDAR_ID = "cal";
const assert = require("assert");
const { getClientById } = require("../src/config");
const m = require("../src/metricas");
const H = getClientById("elias").businessHours;
const ev = (dia, hora, o = {}) => ({ hora, telefone: o.tel || "1", origem: o.origem || "assistente", situacao: o.sit || "agendado", lembreteEm: o.lem || null,
  raw: { start: { dateTime: `${dia}T${hora}:00-03:00` }, created: o.created || `${dia}T08:00:00-03:00` } });
const evs = [
  ev("2026-10-27", "10:00", { sit: "faltou", created: "2026-10-26T23:30:00-03:00" }),         // criado domingo/noite: fora do expediente
  ev("2026-10-28", "10:30", { tel: "2", lem: "x", sit: "confirmado", created: "2026-10-27T11:00:00-03:00" }),
  ev("2026-10-29", "14:00", { tel: "1", origem: "balcao" }),
  { hora: null, raw: { start: { date: "2026-10-29" } } },                                     // evento de dia inteiro (fechamento): ignorado
  { hora: "10:00", telefone: "9", raw: { start: { dateTime: "2020-01-01T10:00:00-03:00" }, extendedProperties: { private: { tipo: "cadastro_cliente" } } } },
];
const r = m.calcular(evs, H, "2026-11-02");
assert.strictEqual(r.total, 3);
assert.strictEqual(r.pelaAssistente, 2);
assert.strictEqual(r.pctAssistente, 67);
assert.strictEqual(r.foraDoExpediente, 1);
assert.strictEqual(r.faltas, 1);
assert.strictEqual(r.pctFaltas, 33.3);
assert.strictEqual(r.lembretesEnviados, 1);
assert.strictEqual(r.lembretesConfirmados, 1);
assert.strictEqual(r.clientes, 2);
assert.strictEqual(r.clientesRetornantes, 1);
assert(m.paraHtml(r, "t").includes("Faltas registradas"));
console.log("metricas-test OK");

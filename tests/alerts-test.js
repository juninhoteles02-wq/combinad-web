// Teste do alerta de falhas (alerts.js) e do envio com nova tentativa (whatsapp.js).
// Não usa WhatsApp nem Google de verdade: o envio e o fetch são trocados por versões falsas.
process.env.ELIAS_PHONE_NUMBER_ID = "PN123";
process.env.ELIAS_CALENDAR_ID = "cal123";
process.env.ELIAS_OWNER_PHONE = "5521999990000";

const assert = require("assert");
const { env } = require("../src/config");
const alerts = require("../src/alerts");
const wa = require("../src/whatsapp");

async function run() {
  // ---- limpeza de segredos ----
  assert.ok(!alerts.limpar("falhou com Bearer EAAGabc123456789012345 no header").includes("EAAG"));
  console.log("OK: token some do texto do alerta");

  // ---- classificação de erros ----
  assert.strictEqual(alerts.ehPassageiro({ status: 503 }), true);
  assert.strictEqual(alerts.ehPassageiro({ status: 429 }), true);
  assert.strictEqual(alerts.ehPassageiro(new Error("fetch failed")), true);
  assert.strictEqual(alerts.ehPassageiro({ status: 400 }), false);
  assert.strictEqual(alerts.ehErroDeInfra({ code: 403 }), true);
  assert.strictEqual(alerts.ehErroDeInfra(new Error("Esse horário não está livre.")), false);
  console.log("OK: erro de rede/5xx é passageiro; regra de negócio não é erro de infra");

  // ---- retry ----
  let n = 0;
  const v = await alerts.comRetry(async () => { n++; if (n < 3) { const e = new Error("x"); e.status = 503; throw e; } return "ok"; }, { baseMs: 1 });
  assert.strictEqual(v, "ok"); assert.strictEqual(n, 3);
  let m = 0;
  await assert.rejects(alerts.comRetry(async () => { m++; const e = new Error("x"); e.status = 400; throw e; }, { baseMs: 1 }));
  assert.strictEqual(m, 1);
  console.log("OK: tenta de novo em falha passageira e desiste na hora em erro definitivo");

  // ---- notify: sem ALERT_PHONE só registra no log ----
  const enviados = [];
  const sendTextOriginal = wa.sendText, sendTemplateOriginal = wa.sendTemplate;
  wa.sendText = async (pn, to, texto) => { enviados.push({ pn, to, texto }); return true; };
  env.alertPhone = "";
  assert.strictEqual(await alerts.notify("teste sem telefone", { erro: new Error("a") }), false);
  assert.strictEqual(enviados.length, 0);
  console.log("OK: sem ALERT_PHONE nada é enviado");

  // ---- notify: envia, mascara o telefone do cliente, evita repetir ----
  env.alertPhone = "5521988880000";
  const ok = await alerts.notify("processamento de uma mensagem", { erro: new Error("OpenAI 429"), telefone: "5521977776666", detalhe: "Barbearia do Elias" });
  assert.strictEqual(ok, true);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "5521988880000");
  assert.strictEqual(enviados[0].pn, "PN123");
  assert.ok(enviados[0].texto.includes("processamento de uma mensagem"));
  assert.ok(enviados[0].texto.includes("final 6666"));
  assert.ok(!enviados[0].texto.includes("5521977776666"));
  console.log("OK: alerta enviado ao telefone certo, com o cliente só pelos 4 últimos dígitos");

  assert.strictEqual(await alerts.notify("processamento de uma mensagem", { erro: new Error("OpenAI 429") }), false);
  assert.strictEqual(enviados.length, 1);
  console.log("OK: o mesmo erro não gera um segundo alerta em sequência");

  // ---- teste manual ignora dedupe ----
  assert.strictEqual(await alerts.notify("teste manual", { erro: new Error("t"), forcar: true }), true);
  assert.strictEqual(await alerts.notify("teste manual", { erro: new Error("t"), forcar: true }), true);
  console.log("OK: o teste manual (forcar) sempre envia, mesmo repetido");

  // ---- limite por hora ----
  for (let i = 0; i < 20; i++) await alerts.notify("falha distinta " + i, { erro: new Error("e" + i) });
  assert.ok(enviados.length <= 8, "passou do limite por hora: " + enviados.length);
  console.log("OK: limite de alertas por hora respeitado (" + enviados.length + ")");

  // ---- template quando o texto livre não chega ----
  env.alertTemplate = "alerta_falha";
  let viaTemplate = null;
  wa.sendText = async () => false;
  wa.sendTemplate = async (pn, to, nome, lang, comps) => { viaTemplate = { nome, texto: comps[0].parameters[0].text }; return true; };
  // limpa o limite da hora esperando outro contexto: usa import novo do módulo
  delete require.cache[require.resolve("../src/alerts")];
  const alerts2 = require("../src/alerts");
  assert.strictEqual(await alerts2.notify("fora das 24h", { erro: new Error("janela fechada") }), true);
  assert.strictEqual(viaTemplate.nome, "alerta_falha");
  assert.ok(!viaTemplate.texto.includes("\n"));
  console.log("OK: se o texto livre falha, usa o template");

  // ---- whatsapp.js: nova tentativa e alerta ----
  wa.sendText = sendTextOriginal; wa.sendTemplate = sendTemplateOriginal;
  env.alertTemplate = "";
  env.whatsappToken = "token-falso";
  const respostas = [{ ok: false, status: 503, text: async () => "indisponivel" }, { ok: true, status: 200, text: async () => "" }];
  let chamadas = 0;
  global.fetch = async () => { chamadas++; return respostas.shift() || { ok: true, status: 200, text: async () => "" }; };
  assert.strictEqual(await wa.sendText("PN123", "5521977776666", "oi"), true);
  assert.strictEqual(chamadas, 2);
  console.log("OK: envio do WhatsApp tenta de novo depois de um 503 e conclui");

  chamadas = 0;
  global.fetch = async () => { chamadas++; return { ok: false, status: 400, text: async () => '{"error":"numero invalido"}' }; };
  assert.strictEqual(await wa.sendText("PN123", "5521977776666", "oi"), false);
  assert.strictEqual(chamadas, 1);
  console.log("OK: erro definitivo (400) não é repetido e devolve false");

  console.log("\nTodos os testes de alerta passaram.");
}

run().catch((err) => { console.error("FALHOU:", err); process.exit(1); });

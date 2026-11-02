// Alerta de falhas: quando algo dá errado no servidor (WhatsApp, Google, IA ou
// um erro inesperado), manda uma mensagem curta para o telefone de quem cuida
// do Combinado (ALERT_PHONE), em vez de deixar o erro só nos logs do Render.
//
// Regras de segurança do módulo:
//  - notify() nunca lança erro e nunca derruba o fluxo que chamou.
//  - não repete o mesmo alerta em sequência (dedupe) e limita o total por hora,
//    para uma pane não virar uma enxurrada de mensagens.
//  - não manda dados do cliente final: só os 4 últimos dígitos do telefone.
//  - limpa tokens e chaves que apareçam no texto do erro.
//
// ATENÇÃO (regra do WhatsApp): mensagem de texto livre só chega se a pessoa
// escreveu para o número do Combinado nas últimas 24h. Fora disso, só chega um
// template aprovado pela Meta. Por isso existe ALERT_TEMPLATE (opcional): nome
// de um template com 1 variável no corpo, usado quando o texto livre falha.

const { env, CLIENTS } = require("./config");

const DEDUPE_MS = 30 * 60 * 1000; // mesmo alerta: no máximo 1 a cada 30 min
const MAX_POR_HORA = 8;

const ultimoEnvio = new Map(); // chave -> { em: timestamp, suprimidos: n }
let enviadosNaHora = []; // timestamps dos envios da última hora
let enviando = false; // evita recursão se o próprio alerta falhar ao enviar

function limpar(texto) {
  return String(texto == null ? "" : texto)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/\b(sk|EAA|ya29)[A-Za-z0-9._-]{12,}/g, "***")
    .replace(/\s+/g, " ")
    .trim();
}

function ultimos4(telefone) {
  const d = String(telefone || "").replace(/\D/g, "");
  return d ? `final ${d.slice(-4)}` : "";
}

function horaAgora() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

function montarMensagem({ contexto, erro, detalhe, suprimidos }) {
  const msg = erro && erro.message ? erro.message : erro;
  const partes = [`Combinado: falha em ${contexto}.`];
  if (detalhe) partes.push(limpar(detalhe).slice(0, 120));
  const textoErro = limpar(msg).slice(0, 220);
  if (textoErro) partes.push(`Erro: ${textoErro}`);
  if (suprimidos > 0) partes.push(`(mais ${suprimidos} igual${suprimidos > 1 ? "is" : ""} nos últimos minutos)`);
  partes.push(horaAgora());
  return partes.join("\n");
}

function numeroDoCombinado() {
  const c = CLIENTS.find((x) => x.phoneNumberId);
  return c ? c.phoneNumberId : null;
}

// contexto: onde falhou, em palavras simples (ex.: "envio de WhatsApp").
// opts: { erro, detalhe, telefone } — telefone do cliente final só aparece mascarado.
async function notify(contexto, opts = {}) {
  try {
    const erro = opts.erro;
    console.error(`[ALERTA] ${contexto}`, erro && erro.stack ? erro.stack : erro || "");
    if (!env.alertPhone) return false; // alerta não configurado: só log
    if (enviando) return false;

    const msgErro = erro && erro.message ? erro.message : String(erro || "");
    const chave = `${contexto}|${limpar(msgErro).slice(0, 80)}`;
    const agora = Date.now();
    const anterior = ultimoEnvio.get(chave);
    const forcar = !!opts.forcar; // usado só no teste manual: ignora dedupe e limite
    if (!forcar && anterior && agora - anterior.em < DEDUPE_MS) {
      anterior.suprimidos += 1;
      return false;
    }
    enviadosNaHora = enviadosNaHora.filter((t) => agora - t < 60 * 60 * 1000);
    if (!forcar && enviadosNaHora.length >= MAX_POR_HORA) return false;

    const phoneNumberId = numeroDoCombinado();
    if (!phoneNumberId) return false;

    const detalhe = [opts.detalhe, opts.telefone ? `cliente ${ultimos4(opts.telefone)}` : ""].filter(Boolean).join(", ");
    const texto = montarMensagem({ contexto, erro: msgErro, detalhe, suprimidos: anterior ? anterior.suprimidos : 0 });

    enviando = true;
    try {
      const wa = require("./whatsapp"); // carregado aqui para não criar dependência circular
      let ok = await wa.sendText(phoneNumberId, env.alertPhone, texto);
      if (!ok && env.alertTemplate) {
        // fora da janela de 24h: tenta o template (variável única, sem quebra de linha)
        ok = await wa.sendTemplate(phoneNumberId, env.alertPhone, env.alertTemplate, "pt_BR", [
          { type: "body", parameters: [{ type: "text", text: texto.replace(/\s*\n\s*/g, " | ").slice(0, 900) }] },
        ]);
      }
      if (ok) {
        ultimoEnvio.set(chave, { em: agora, suprimidos: 0 });
        enviadosNaHora.push(agora);
      }
      return ok;
    } finally {
      enviando = false;
    }
  } catch (e) {
    enviando = false;
    console.error("Falha ao enviar o alerta:", e && e.message);
    return false;
  }
}

// Tenta de novo quando o erro é passageiro (rede, 429, 5xx). Espera 0,5s e 1,5s.
// fn() deve lançar erro quando falha. Erros que não são passageiros sobem na hora.
async function comRetry(fn, { tentativas = 3, baseMs = 500, passageiro = ehPassageiro } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (i === tentativas - 1 || !passageiro(err)) break;
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(3, i)));
    }
  }
  throw ultimo;
}

// Erro de infraestrutura passageiro: falha de rede, limite de uso ou erro 5xx.
function ehPassageiro(err) {
  if (!err) return false;
  const status = Number(err.status || err.code || (err.response && err.response.status));
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const msg = String(err.message || "");
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(msg);
}

// Erro de infraestrutura (Google, rede, OpenAI) em vez de regra de negócio
// ("esse horário não está livre"). Usado para decidir se vale alertar.
function ehErroDeInfra(err) {
  if (!err) return false;
  if (ehPassageiro(err)) return true;
  const status = Number(err.status || err.code || (err.response && err.response.status));
  if (status >= 400 && status < 600) return true; // 401/403/404 da API: credencial, permissão ou agenda errada
  return /invalid_grant|unauthorized|forbidden|quota|rate limit|credentials/i.test(String(err.message || ""));
}

module.exports = { notify, comRetry, ehPassageiro, ehErroDeInfra, limpar, montarMensagem };

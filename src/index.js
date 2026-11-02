process.env.TZ = process.env.TZ || "America/Sao_Paulo"; // horário de Brasília por padrão
const express = require("express");
const { env, CLIENTS, getClientByPhoneNumberId } = require("./config");
const wa = require("./whatsapp");
const gcal = require("./googleCalendar");
const sched = require("./scheduling");
const { buildTools, describe } = require("./tools");
const { buildOwnerTools } = require("./ownerTools");
const { clientRules, ownerRules } = require("./prompts");
const ownerSession = require("./ownerSession");
const ai = require("./ai");
const alerts = require("./alerts");
const metricas = require("./metricas");
const { ePerguntaDeServico } = require("./botoes");
require("./reminders"); // agenda o lembrete da véspera (node-cron)

const app = express();
app.use(express.json());

// ---------- estado em memória (por conversa) ----------
const { getClientConvo, lembretePendente } = require("./state");
const ownerConversations = new Map(); // phone -> { history }
const ownerPending = new Map(); // phone -> { awaitingCode: bool, pendingText: string|null }
const seenMessageIds = [];
const seenMessageSet = new Set();

function markSeen(id) {
  if (!id) return false;
  if (seenMessageSet.has(id)) return true;
  seenMessageSet.add(id);
  seenMessageIds.push(id);
  if (seenMessageIds.length > 1000) {
    const old = seenMessageIds.shift();
    seenMessageSet.delete(old);
  }
  return false;
}

function getOwnerConvo(phone) {
  if (!ownerConversations.has(phone)) ownerConversations.set(phone, { history: [] });
  return ownerConversations.get(phone);
}

// ---------- verificação do webhook (GET) ----------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === env.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- recebimento de mensagens (POST) ----------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido pra Meta; processamos em seguida
  try {
    const incoming = wa.parseIncoming(req.body);
    for (const msg of incoming) {
      if (markSeen(msg.waMessageId)) continue; // evita responder duplicado
      const client = getClientByPhoneNumberId(msg.phoneNumberId);
      if (!client) {
        console.warn("Mensagem recebida para phone_number_id sem cliente configurado:", msg.phoneNumberId);
        continue;
      }
      if (msg.unsupported) {
        const marca = (client.emoji && client.emoji.marca) || "💈";
        wa.sendText(
          client.phoneNumberId,
          msg.from,
          `Só leio mensagem de texto por aqui, não consigo abrir isso (${msg.unsupported}). Pode me escrever, por favor? ${marca}`
        ).catch((err) => console.error("Erro ao responder mensagem não suportada:", err));
        continue;
      }
      handleMessage(client, msg.from, msg.text).catch((err) => falhaAoProcessar(client, msg.from, err));
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
    alerts.notify("recebimento de mensagens (webhook)", { erro: err });
  }
});

// Quando o processamento de uma mensagem falha (IA fora do ar, Google com erro,
// bug inesperado), antes o cliente ficava sem resposta nenhuma. Agora ele recebe
// um aviso simples e quem cuida do Combinado é alertado.
async function falhaAoProcessar(client, from, err) {
  console.error("Erro ao processar mensagem:", err);
  alerts.notify("processamento de uma mensagem", { erro: err, telefone: from, detalhe: client.displayName });
  try {
    await wa.sendText(client.phoneNumberId, from, "Tive um problema aqui agora e não consegui responder direito. Pode mandar sua mensagem de novo em alguns instantes?");
  } catch (e) {
    console.error("Também não consegui avisar o cliente do problema:", e && e.message);
  }
}

// Erros que escapam de tudo: avisa e, no caso grave, deixa o Render reiniciar o servidor.
process.on("unhandledRejection", (reason) => {
  alerts.notify("erro inesperado (promessa rejeitada)", { erro: reason instanceof Error ? reason : new Error(String(reason)) });
});
process.on("uncaughtException", async (err) => {
  await Promise.race([alerts.notify("erro grave: o servidor vai reiniciar", { erro: err }), new Promise((r) => setTimeout(r, 4000))]);
  process.exit(1);
});

async function handleMessage(client, from, text) {
  const isOwner = client.owner.phone && from === client.owner.phone;
  if (isOwner) return handleOwnerMessage(client, from, text);
  return handleClientMessage(client, from, text);
}

async function handleClientMessage(client, from, text) {
  const convo = getClientConvo(from);
  if (convo.history.length === 0 && !convo.historicoCarregado) {
    // Servidor reiniciou (ou conversa nova): tenta recuperar o contexto salvo.
    convo.historicoCarregado = true;
    try {
      convo.history = await gcal.carregarHistorico(client.calendarId, from);
    } catch (err) {
      console.error("Não consegui carregar o histórico salvo:", err.message);
    }
  }
  convo.history.push({ role: "user", content: text });

  const upcoming = await gcal.listUpcomingForPhone(client.calendarId, from);
  const agendaTexto = upcoming
    .map((e) => `${e.id}: ${e.servico} com ${e.barbeiro}, ${sched.WEEK[sched.fromIso(e.raw.start.dateTime.slice(0, 10)).getDay()]} ${sched.br(e.raw.start.dateTime.slice(0, 10))} às ${e.hora} (${e.situacao})`)
    .join("; ");
  const nomeSalvo = upcoming[0]?.cliente || (await gcal.nomeConhecido(client.calendarId, from));

  const lembreteId = lembretePendente(convo.lastReminderEventId, upcoming);

  let botoesEnviados = false;
  const ctx = {
    lastReminderEventId: lembreteId,
    onCallBarber: async (motivo) => {
      if (client.owner.phone) {
        await wa.sendText(client.phoneNumberId, client.owner.phone, `🔔 Um cliente pediu atendimento pelo Combinado.\nMotivo: ${motivo}`);
      }
    },
    enviarOpcoesServico: async () => {
      const marca = (client.emoji && client.emoji.marca) || "💈";
      const linhas = Object.entries(client.services).map(([nome, s]) => `${nome} - R$ ${s.price}`).join("\n");
      await wa.sendButtons(
        client.phoneNumberId,
        from,
        `Qual serviço você quer? ${marca}\n\n${linhas}`,
        Object.keys(client.services).map((nome) => ({ id: nome, title: nome }))
      );
      botoesEnviados = true;
    },
  };
  const tools = buildTools(client, from, ctx);
  const systemPrompt = clientRules(client, from, agendaTexto, lembreteId, nomeSalvo);

  const { text: reply, messages } = await ai.runConversation({
    systemPrompt,
    history: convo.history.slice(-16),
    tools,
  });

  convo.history = trimHistory(messages);
  const finalText = (reply || "").trim();
  convo.history.push({ role: "assistant", content: finalText || "(opções de serviço enviadas por botões)" });
  // Guarda o contexto em segundo plano; se falhar, a conversa segue normal.
  gcal.salvarHistorico(client.calendarId, from, convo.history).catch((err) => console.error("Não consegui salvar o histórico:", err.message));
  if (finalText && !botoesEnviados && ePerguntaDeServico(finalText, client.services)) {
    // A IA perguntou o serviço em texto: troca pelos botões.
    await ctx.enviarOpcoesServico();
  } else if (finalText) {
    // A IA escreveu algo: manda normal (cobre também o caso raro de ela
    // escrever algo mesmo depois de mandar os botões).
    await wa.sendText(client.phoneNumberId, from, finalText);
  } else if (!botoesEnviados) {
    // Resposta vazia e nenhum botão foi enviado neste turno: usa o fallback.
    await wa.sendText(client.phoneNumberId, from, "Desculpa, pode repetir?");
  }
  // Se botoesEnviados e finalText vazio: os botões já carregam a pergunta,
  // não manda nada a mais.
}

async function handleOwnerMessage(client, from, text) {
  const pending = ownerPending.get(from) || { awaitingCode: false, pendingText: null };

  if (ownerSession.isBlocked(client.id)) {
    await wa.sendText(client.phoneNumberId, from, "Acesso bloqueado por algumas tentativas erradas. Tenta de novo daqui a pouco.");
    return;
  }

  if (!ownerSession.isUnlocked(client.id)) {
    if (pending.awaitingCode && /^\d{4}$/.test(text.trim())) {
      if (text.trim() === client.owner.code) {
        ownerSession.unlock(client.id, client.owner.unlockHours);
        const toProcess = pending.pendingText;
        ownerPending.set(from, { awaitingCode: false, pendingText: null });
        if (toProcess) return processOwnerText(client, from, toProcess);
        await wa.sendText(client.phoneNumberId, from, "Código conferido. O que você quer ver?");
        return;
      }
      const { blocked, triesLeft } = ownerSession.registerFailedAttempt(client.id);
      if (blocked) {
        await wa.sendText(client.phoneNumberId, from, "Código errado 3 vezes. Por segurança, o acesso ficou bloqueado por 15 minutos.");
      } else {
        await wa.sendText(client.phoneNumberId, from, `Código incorreto. Tenta de novo (${triesLeft} ${triesLeft === 1 ? "tentativa" : "tentativas"}).`);
      }
      return;
    }
    ownerPending.set(from, { awaitingCode: true, pendingText: text });
    await wa.sendText(client.phoneNumberId, from, "Oi! Esse assunto é restrito. Me manda seu código de acesso de 4 dígitos, por favor.");
    return;
  }

  return processOwnerText(client, from, text);
}

async function processOwnerText(client, from, text) {
  const convo = getOwnerConvo(from);
  convo.history.push({ role: "user", content: text });
  const tools = buildOwnerTools(client);
  const systemPrompt = ownerRules(client);
  const { text: reply, messages } = await ai.runConversation({
    systemPrompt,
    history: convo.history.slice(-16),
    tools,
  });
  convo.history = trimHistory(messages);
  const finalText = reply || "Pronto.";
  convo.history.push({ role: "assistant", content: finalText });
  await wa.sendText(client.phoneNumberId, from, finalText);
}

// Mantém só role/content (user/assistant) no histórico salvo entre mensagens;
// as chamadas de ferramenta em si não precisam ser lembradas de uma mensagem
// para a outra, só o que foi dito.
function trimHistory(messages) {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length > 0)
    .slice(-16);
}

app.get("/", (req, res) => res.send("Combinado está de pé."));

// Teste manual do alerta de falhas. Só funciona se ALERT_TEST_KEY estiver definida no
// ambiente e a chave da URL for igual. Manda um alerta de verdade para o ALERT_PHONE e
// diz na tela se o WhatsApp aceitou. Não mexe em nenhum dado.
app.get("/teste-alerta", async (req, res) => {
  if (!env.alertTestKey || req.query.chave !== env.alertTestKey) return res.sendStatus(404);
  if (!env.alertPhone) return res.status(400).send("ALERT_PHONE não está configurado no Render.");
  const ok = await alerts.notify("teste do alerta de falhas", { erro: new Error("Isto é só um teste. Se você recebeu esta mensagem, o alerta está funcionando."), forcar: true });
  res
    .status(ok ? 200 : 502)
    .send(ok
      ? "Alerta enviado ao WhatsApp. Confira o seu telefone."
      : "O WhatsApp não aceitou o alerta. Provável causa: você não escreveu para o número do bot nas últimas 24h. Mande uma mensagem para ele e tente de novo (veja também os logs do Render).");
});

// Números de uso (só leitura), protegido pela mesma senha do teste de alerta.
// /metricas?chave=SENHA&dias=30  (padrão: desde o início do piloto, 60 dias)
app.get("/metricas", async (req, res) => {
  if (!env.alertTestKey || req.query.chave !== env.alertTestKey) return res.sendStatus(404);
  try {
    const client = CLIENTS.find((c) => c.calendarId);
    const dias = Math.min(180, Math.max(1, Number(req.query.dias) || 60));
    const fim = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const ini = new Date(Date.now() - dias * 24 * 3600 * 1000);
    const eventos = await gcal.listEventsAll(client.calendarId, ini.toISOString(), fim.toISOString());
    const r = metricas.calcular(eventos, client.businessHours, sched.isoToday());
    if (req.query.formato === "json") return res.json(r);
    res.send(metricas.paraHtml(r, `${client.displayName}: últimos ${dias} dias (e próximos 14)`));
  } catch (err) {
    alerts.notify("relatório de métricas", { erro: err });
    res.status(500).send("Não consegui montar o relatório agora. Veja os logs do Render.");
  }
});

app.listen(env.port, () => {
  console.log(`Combinado rodando na porta ${env.port}`);
  if (env.alertOnBoot) alerts.notify("início do servidor (reinício ou volta do sono)", { erro: "" });
});

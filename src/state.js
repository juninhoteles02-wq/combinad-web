// Estado de conversa em memória, compartilhado entre o servidor (index.js) e
// o job de lembretes (reminders.js). Some se o processo reiniciar - para
// persistir de verdade entre reinícios, trocar por store.js (arquivo) ou um
// banco de dados.

const clientConversations = new Map(); // phone -> { history, lastReminderEventId }

function getClientConvo(phone) {
  if (!clientConversations.has(phone)) clientConversations.set(phone, { history: [], lastReminderEventId: null });
  return clientConversations.get(phone);
}

// Qual agendamento o cliente está confirmando quando responde "1"/"confirmo"?
// Primeiro vale o que está na memória (lembrete enviado desde a última vez que o
// servidor iniciou). Se o servidor reiniciou, a memória some, então cai para o
// marcador `lembreteEm` gravado no próprio evento do Google Agenda: pega o
// lembrete enviado mais recentemente que ainda não foi confirmado.
function lembretePendente(memoriaId, upcoming) {
  if (memoriaId && upcoming.some((e) => e.id === memoriaId)) return memoriaId;
  const candidatos = upcoming
    .filter((e) => e.lembreteEm && e.situacao === "agendado")
    .sort((a, b) => String(b.lembreteEm).localeCompare(String(a.lembreteEm)));
  return candidatos[0] ? candidatos[0].id : memoriaId || null;
}

module.exports = { clientConversations, getClientConvo, lembretePendente };

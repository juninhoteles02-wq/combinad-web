// Configuração central do Combinado.
// Cada barbearia (cliente) vira uma entrada em CLIENTS. Para adicionar um novo
// cliente no futuro, basta copiar o bloco do Elias, trocar os dados e criar as
// variáveis de ambiente correspondentes (ex: NOVOCLIENTE_PHONE_NUMBER_ID etc.).

require("dotenv").config();

// staffLabel: como a IA chama, no texto, quem atende (plural/singular). Isso é
// o que muda a "voz" do Combinado de um nicho pro outro sem duplicar código.
// Se um cliente não tiver staffLabel definido, o código usa um padrão genérico
// ("profissional/profissionais") — ver prompts.js e tools.js.

const CLIENTS = [
  {
    id: "elias",
    displayName: "Barbearia do Elias",
    address: "Av. Henrique Duque Estrada Meyer, 540, Posse, Nova Iguaçu - RJ, 26030-380",
    phoneNumberId: process.env.ELIAS_PHONE_NUMBER_ID,
    calendarId: process.env.ELIAS_CALENDAR_ID,
    barbers: ["Elias"],
    staffLabel: { singular: "barbeiro", plural: "barbeiros" },
    // emoji.estilo: "reservado" (só a marca + funcionais, nada fofo/de rosto),
    // "equilibrado" (um emoji leve de vez em quando) ou "caloroso" (emoji
    // fofo/de rosto liberado, combina com nichos mais afetivos). Ver prompts.js.
    emoji: { marca: "💈", estilo: "reservado" },
    services: {
      "Corte": { min: 30, price: 45 },
      "Barba": { min: 30, price: 35 },
      "Corte + Barba": { min: 60, price: 70 },
    },
    // openDay/closeDay: 0=domingo .. 6=sábado
    businessHours: { openDay: 2, closeDay: 6, openHour: 9, closeHour: 19, lunchStart: 12, lunchEnd: 13 },
    owner: {
      phone: (process.env.ELIAS_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.ELIAS_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.ELIAS_REMINDER_TEMPLATE || "lembrete_vespera",
  },

  // ---------------------------------------------------------------------
  // A partir daqui: modelos prontos pros outros nichos (mesma lógica do
  // Elias, só muda o vocabulário e os serviços). Ficam "desligados" até
  // existir um cliente de verdade: sem as variáveis de ambiente (ex.:
  // SALAO_PHONE_NUMBER_ID) preenchidas no Render, phoneNumberId fica
  // undefined e nenhuma mensagem real bate nessa entrada. Pra ativar um
  // desses de verdade: cria a agenda no Google Calendar, os números de
  // ambiente (igual foi feito pro Elias) e ajusta nome/serviços/preços reais.
  // ---------------------------------------------------------------------
  {
    id: "salao",
    displayName: "Studio Bela",
    address: "Endereço a definir",
    phoneNumberId: process.env.SALAO_PHONE_NUMBER_ID,
    calendarId: process.env.SALAO_CALENDAR_ID,
    barbers: ["Bia"],
    staffLabel: { singular: "profissional", plural: "profissionais" },
    emoji: { marca: "💅", estilo: "caloroso" },
    services: {
      "Escova": { min: 30, price: 60 },
      "Manicure": { min: 45, price: 40 },
      "Escova + Manicure": { min: 75, price: 90 },
    },
    businessHours: { openDay: 2, closeDay: 6, openHour: 9, closeHour: 19, lunchStart: 12, lunchEnd: 13 },
    owner: {
      phone: (process.env.SALAO_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.SALAO_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.SALAO_REMINDER_TEMPLATE || "lembrete_vespera",
  },
  {
    id: "clinica-estetica",
    displayName: "Clínica Renove",
    address: "Endereço a definir",
    phoneNumberId: process.env.CLINICA_PHONE_NUMBER_ID,
    calendarId: process.env.CLINICA_CALENDAR_ID,
    barbers: ["Dra. Ana"],
    staffLabel: { singular: "profissional", plural: "profissionais" },
    emoji: { marca: "✨", estilo: "equilibrado" },
    services: {
      "Limpeza de Pele": { min: 60, price: 150 },
      "Massagem Relaxante": { min: 50, price: 130 },
      "Limpeza + Massagem": { min: 100, price: 250 },
    },
    businessHours: { openDay: 1, closeDay: 6, openHour: 9, closeHour: 18, lunchStart: 12, lunchEnd: 13 },
    owner: {
      phone: (process.env.CLINICA_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.CLINICA_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.CLINICA_REMINDER_TEMPLATE || "lembrete_vespera",
  },
  {
    id: "estudio-tatuagem",
    displayName: "Studio Ink",
    address: "Endereço a definir",
    phoneNumberId: process.env.TATUAGEM_PHONE_NUMBER_ID,
    calendarId: process.env.TATUAGEM_CALENDAR_ID,
    barbers: ["Duda"],
    staffLabel: { singular: "tatuador", plural: "tatuadores" },
    emoji: { marca: "🖤", estilo: "reservado" },
    services: {
      "Sessão Pequena": { min: 60, price: 200 },
      "Sessão Média": { min: 120, price: 400 },
      "Sessão Grande": { min: 180, price: 600 },
    },
    businessHours: { openDay: 2, closeDay: 6, openHour: 11, closeHour: 20, lunchStart: 14, lunchEnd: 15 },
    owner: {
      phone: (process.env.TATUAGEM_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.TATUAGEM_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.TATUAGEM_REMINDER_TEMPLATE || "lembrete_vespera",
  },
  {
    id: "petshop",
    displayName: "Petshop Amigo",
    address: "Endereço a definir",
    phoneNumberId: process.env.PETSHOP_PHONE_NUMBER_ID,
    calendarId: process.env.PETSHOP_CALENDAR_ID,
    barbers: ["Léo"],
    staffLabel: { singular: "profissional", plural: "profissionais" },
    emoji: { marca: "🐾", estilo: "caloroso" },
    services: {
      "Banho": { min: 40, price: 50 },
      "Tosa": { min: 50, price: 60 },
      "Banho + Tosa": { min: 80, price: 95 },
    },
    businessHours: { openDay: 1, closeDay: 6, openHour: 8, closeHour: 18, lunchStart: 12, lunchEnd: 13 },
    owner: {
      phone: (process.env.PETSHOP_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.PETSHOP_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.PETSHOP_REMINDER_TEMPLATE || "lembrete_vespera",
  },
  {
    id: "nutricionista",
    displayName: "Nutri Ana",
    address: "Endereço a definir",
    phoneNumberId: process.env.NUTRI_PHONE_NUMBER_ID,
    calendarId: process.env.NUTRI_CALENDAR_ID,
    barbers: ["Ana"],
    staffLabel: { singular: "nutricionista", plural: "nutricionistas" },
    emoji: { marca: "🥗", estilo: "equilibrado" },
    services: {
      "Consulta": { min: 50, price: 180 },
      "Retorno": { min: 30, price: 100 },
    },
    businessHours: { openDay: 1, closeDay: 5, openHour: 8, closeHour: 18, lunchStart: 12, lunchEnd: 13 },
    owner: {
      phone: (process.env.NUTRI_OWNER_PHONE || "").replace(/\D/g, ""),
      code: process.env.NUTRI_OWNER_CODE || "1234",
      unlockHours: 4,
    },
    reminderTemplate: process.env.NUTRI_REMINDER_TEMPLATE || "lembrete_vespera",
  },
];

function getClientByPhoneNumberId(phoneNumberId) {
  return CLIENTS.find((c) => c.phoneNumberId === phoneNumberId) || null;
}

function getClientById(id) {
  return CLIENTS.find((c) => c.id === id) || null;
}

module.exports = {
  CLIENTS,
  getClientByPhoneNumberId,
  getClientById,
  env: {
    whatsappToken: process.env.WHATSAPP_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "combinado-verify-2026",
    graphVersion: process.env.GRAPH_API_VERSION || "v21.0",
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    googleKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || "./secrets/combinado-servidor.json",
    port: parseInt(process.env.PORT || "3000", 10),
  },
};

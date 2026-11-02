// Rede de segurança dos botões de serviço: se a IA perguntar "qual serviço?"
// em texto (em vez de chamar a ferramenta dos botões), o código percebe e troca
// a resposta pelos botões.

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// true se o texto é a IA perguntando qual serviço o cliente quer.
function ePerguntaDeServico(texto, services) {
  const t = semAcento(texto);
  if (!t.includes("?")) return false;
  if (/(agendad|confirmad|marcad|cancelad|remarcad)/.test(t)) return false; // confirmação, não pergunta
  const perguntaDireta = /(qual|que|quais) (servico|tipo de servico)|o que (voce )?(vai|quer|deseja|gostaria)|que servico/.test(t);
  const nomes = Object.keys(services || {}).filter((n) => t.includes(semAcento(n))).length;
  return perguntaDireta || (t.includes("servico") && nomes >= 2) || nomes >= 3;
}

module.exports = { ePerguntaDeServico };

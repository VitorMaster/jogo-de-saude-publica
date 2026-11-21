// Aba de feedback: perguntas, texto do relatório e envio (Google Forms, compartilhar ou copiar).
// Nada aqui lê dados de saúde reais: só respostas digitadas e informações técnicas do aparelho/jogo.

export const VERSAO_JOGO = 'v0.8';

export const PERGUNTAS = [
  { id: 'nota', tipo: 'estrelas', rot: 'Nota geral do jogo' },
  { id: 'entendeu', tipo: 'opcoes', rot: 'Você entendeu o que fazer?', opcoes: ['Sim, fácil', 'Mais ou menos', 'Não entendi'] },
  { id: 'graficos', tipo: 'estrelas', rot: 'Como achou os gráficos e o cenário?' },
  { id: 'controle', tipo: 'estrelas', rot: 'Como achou controlar o personagem (menu "Fazer algo")?' },
  { id: 'aprendeu', tipo: 'opcoes', rot: 'Aprendeu algo sobre saúde?', opcoes: ['Sim, bastante', 'Um pouco', 'Nada'] },
  { id: 'jogaria', tipo: 'opcoes', rot: 'Jogaria de novo?', opcoes: ['Sim', 'Talvez', 'Não'] },
  { id: 'indicaria', tipo: 'opcoes', rot: 'Indicaria para alguém?', opcoes: ['Sim', 'Talvez', 'Não'] },
  { id: 'pagaria', tipo: 'opcoes', rot: 'Pagaria por mais histórias e conteúdo?', opcoes: ['Sim', 'Talvez', 'Não'] },
  { id: 'gostou', tipo: 'texto', rot: 'O que mais gostou?' },
  { id: 'incomodou', tipo: 'texto', rot: 'O que mais te incomodou ou travou?' },
  { id: 'ideias', tipo: 'texto', rot: 'Ideias, doenças ou situações que gostaria de ver' },
  { id: 'contato', tipo: 'texto', rot: 'Nome ou contato (opcional)', curto: true },
];

/** Informações técnicas anexadas (ajudam a achar problemas por aparelho). */
export function contextoTecnico(info) {
  const ua = (info.userAgent || '').replace(/\s+/g, ' ').slice(0, 140);
  return {
    versao: VERSAO_JOGO,
    graficos: info.graficos || '?',
    cenario: info.cenario || '-',
    personagem: info.personagem || '-',
    mesesJogados: info.mesesJogados === undefined ? '-' : String(info.mesesJogados),
    instalado: info.instalado ? 'sim (tela inicial)' : 'não (navegador)',
    tela: info.tela || '?',
    aparelho: ua,
    testador: info.testador || '-',
  };
}

export function textoRelatorio(resp, ctx) {
  const linhas = ['Feedback — Saudedavida - SV ' + ctx.versao, ''];
  for (const p of PERGUNTAS) {
    const v = resp[p.id];
    if (v === undefined || v === '' || v === null) continue;
    linhas.push(`${p.rot}\n  ${p.tipo === 'estrelas' ? `${v}/5` : v}`);
  }
  linhas.push('', '— Informações técnicas —');
  linhas.push(`Gráficos: ${ctx.graficos} · Cenário: ${ctx.cenario} · Personagem: ${ctx.personagem}`);
  linhas.push(`Mês no jogo: ${ctx.mesesJogados} · Instalado: ${ctx.instalado} · Tela: ${ctx.tela}`);
  linhas.push(`Aparelho: ${ctx.aparelho} · Testador: ${ctx.testador}`);
  return linhas.join('\n');
}

/** Só pede enviar se houver ao menos uma resposta. */
export function temResposta(resp) {
  return PERGUNTAS.some((p) => resp[p.id] !== undefined && resp[p.id] !== '' && p.id !== 'contato');
}

/**
 * Envia o feedback. Ordem: Google Forms (se configurado em data/game.json › feedback) →
 * compartilhar do sistema → copiar para a área de transferência.
 * Retorna { ok, via } e nunca lança.
 */
export async function enviarFeedback(resp, ctx, conf, ambiente = globalThis) {
  const texto = textoRelatorio(resp, ctx);
  const c = conf || {};
  if (c.formAction && c.campos) {
    try {
      const corpo = new URLSearchParams();
      for (const p of PERGUNTAS) if (c.campos[p.id] && resp[p.id] !== undefined && resp[p.id] !== '') corpo.append(c.campos[p.id], String(resp[p.id]));
      if (c.campos.tecnico) corpo.append(c.campos.tecnico, texto.split('— Informações técnicas —')[1].trim());
      await ambiente.fetch(c.formAction, { method: 'POST', mode: 'no-cors', body: corpo });
      return { ok: true, via: 'forms' };
    } catch (e) { /* sem rede: cai para compartilhar/copiar */ }
  }
  try {
    if (ambiente.navigator && ambiente.navigator.share) {
      await ambiente.navigator.share({ title: 'Feedback — Saudedavida - SV', text: texto });
      return { ok: true, via: 'compartilhar' };
    }
  } catch (e) { if (e && e.name === 'AbortError') return { ok: false, via: 'cancelado' }; }
  try {
    await ambiente.navigator.clipboard.writeText(texto);
    return { ok: true, via: 'copia' };
  } catch (e) { return { ok: false, via: 'falha', texto }; }
}

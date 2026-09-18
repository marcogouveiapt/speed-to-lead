/**
 * Adaptadores de parsing por portal.
 *
 * Duas camadas, por decisao de arquitetura:
 *   1. Regex determinista por portal — rapido, gratuito, previsivel
 *   2. Fallback LLM — robusto a mudancas de template
 *
 * IMPORTANTE: os padroes abaixo sao a melhor aproximacao conhecida ao formato
 * de cada portal. Tem de ser VALIDADOS com emails reais antes de producao.
 * Quando um padrao falha, o email cai no fallback LLM e fica registado com
 * parser='llm' — consultar esses registos indica que um portal mudou o template.
 */

const limpar = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Normaliza telefone portugues para E.164 sem '+' (351XXXXXXXXX). */
export function normalizarTelefone(bruto) {
  if (!bruto) return null;
  let d = String(bruto).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^351\d{9}$/.test(d)) return d;
  if (/^9[1236]\d{7}$/.test(d) || /^2\d{8}$/.test(d)) return '351' + d;
  return d.length >= 9 ? d : null;
}

/** Extrai o primeiro grupo de captura do primeiro padrao que corresponder. */
function primeiro(texto, padroes) {
  for (const p of padroes) {
    const m = texto.match(p);
    if (m && m[1]) return limpar(m[1]);
  }
  return null;
}

const CAMPOS_GENERICOS = {
  nome: [
    /(?:Nome|Name|Contacto de|De)\s*[:\-]\s*([^\n\r<|]{2,80})/i,
    /(?:O|A)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\n\r,]{2,60})\s+(?:est[aá] interessad|contactou|enviou)/i,
  ],
  email: [/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i],
  telefone: [
    /(?:Telefone|Telem[oó]vel|Contacto|Phone|Tel\.?)\s*[:\-]\s*([+\d][\d\s().\-]{7,20})/i,
    /(\+351\s?\d{3}\s?\d{3}\s?\d{3})/,
    /\b(9[1236]\d{7})\b/,
  ],
  referencia: [
    /(?:Refer[eê]ncia|Ref\.?|ID do im[oó]vel|C[oó]digo)\s*[:\-]?\s*([A-Z0-9\-\/]{4,20})/i,
  ],
  mensagem: [
    /(?:Mensagem|Coment[aá]rio|Message|Observa[cç][oõ]es)\s*[:\-]\s*([\s\S]{5,1200}?)(?:\n\s*\n|--|Este email|Responder|$)/i,
  ],
  url: [/(https?:\/\/[^\s<>"]+(?:idealista|imovirtual|casa\.sapo|remax)[^\s<>"]*)/i],
  titulo: [
    /(?:Im[oó]vel|An[uú]ncio|Property)\s*[:\-]\s*([^\n\r]{5,140})/i,
  ],
};

/** Deteta o portal a partir do remetente e do assunto. */
export function detetarPortal({ de = '', assunto = '', texto = '' }) {
  const h = `${de} ${assunto}`.toLowerCase();
  const corpo = (texto || '').toLowerCase();
  if (h.includes('idealista') || corpo.includes('idealista.pt')) return 'idealista';
  if (h.includes('imovirtual') || h.includes('olx')) return 'imovirtual';
  if (h.includes('sapo') || h.includes('janeladigital') || corpo.includes('casa.sapo.pt')) return 'casasapo';
  if (h.includes('remax')) return 'remax';
  return null;
}

/**
 * Tentativa determinista. Devolve null se nao tiver confianca suficiente —
 * e melhor cair no LLM do que gravar uma lead com campos errados.
 */
export function parseDeterminista(email) {
  const texto = `${email.assunto || ''}\n${email.texto || ''}`;
  const portal = detetarPortal(email);

  const nome = primeiro(texto, CAMPOS_GENERICOS.nome);
  const emails = [...texto.matchAll(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi)]
    .map((m) => m[1].toLowerCase())
    // descarta os enderecos do proprio portal e do consultor
    .filter((e) => !/(idealista|imovirtual|sapo|remax|noreply|no-reply|donotreply|mailer)/i.test(e));
  const telefone = normalizarTelefone(primeiro(texto, CAMPOS_GENERICOS.telefone));

  // Confianca minima: precisamos de pelo menos um canal de contacto.
  if (!emails[0] && !telefone) return null;

  return {
    portal,
    parser: portal ? `regex:${portal}` : 'regex:generico',
    nome,
    email: emails[0] || null,
    telefone,
    imovel_ref: primeiro(texto, CAMPOS_GENERICOS.referencia),
    imovel_titulo: primeiro(texto, CAMPOS_GENERICOS.titulo),
    imovel_url: primeiro(texto, CAMPOS_GENERICOS.url),
    mensagem: primeiro(texto, CAMPOS_GENERICOS.mensagem) || null,
  };
}

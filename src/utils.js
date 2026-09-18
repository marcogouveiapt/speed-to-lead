/** Utilitarios partilhados. */

export const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

export const erro = (mensagem, status = 400) => json({ erro: mensagem }, status);

export const id = () => crypto.randomUUID();

export const agora = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Assina um valor com HMAC-SHA256. Usado nos cookies de sessao. */
export async function assinar(valor, segredo) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(valor));
  const hex = [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${valor}.${hex}`;
}

export async function verificar(assinado, segredo) {
  if (!assinado || !assinado.includes('.')) return null;
  const i = assinado.lastIndexOf('.');
  const valor = assinado.slice(0, i);
  const esperado = await assinar(valor, segredo);
  // comparacao de tempo constante
  if (esperado.length !== assinado.length) return null;
  let diff = 0;
  for (let k = 0; k < esperado.length; k++) diff |= esperado.charCodeAt(k) ^ assinado.charCodeAt(k);
  return diff === 0 ? valor : null;
}

/** Definicoes guardadas na base de dados, nao em ficheiros .env. */
export async function lerDefinicao(db, chave, omissao = null) {
  const r = await db.prepare('SELECT valor FROM definicoes WHERE chave = ?').bind(chave).first();
  return r?.valor ?? omissao;
}

export async function gravarDefinicao(db, chave, valor) {
  await db.prepare(
    `INSERT INTO definicoes (chave, valor, atualizado) VALUES (?, ?, datetime('now'))
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado = excluded.atualizado`
  ).bind(chave, valor).run();
}

/** Constroi o link wa.me com a mensagem ja escrita — o Modo 1 do WhatsApp. */
export function linkWhatsApp(telefone, mensagem) {
  if (!telefone) return null;
  const numero = String(telefone).replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem || '')}`;
}

/**
 * Cadencia de follow-up.
 * Base: 6 toques. A investigacao mundial mostra que a maioria dos consultores
 * faz 1 ou 2 e desiste — e e entre o 3.o e o 6.o que a maioria das respostas
 * aparece. Os tempos sao propositadamente agressivos no inicio.
 */
export const CADENCIA = [
  { passo: 1, minutos: 0,     canal: 'whatsapp', instrucao: 'Primeiro contacto. Agora, nao daqui a uma hora.' },
  { passo: 2, minutos: 60,    canal: 'chamada',  instrucao: 'Se nao respondeu ao WhatsApp, liga. Uma chamada, sem mensagem de voz longa.' },
  { passo: 3, minutos: 1440,  canal: 'whatsapp', instrucao: 'Dia seguinte. Traz algo novo: outro imovel, um dado da zona.' },
  { passo: 4, minutos: 4320,  canal: 'chamada',  instrucao: 'Dia 3. Ultima tentativa telefonica desta ronda.' },
  { passo: 5, minutos: 10080, canal: 'whatsapp', instrucao: 'Dia 7. Mensagem curta de valor, sem pedir nada.' },
  { passo: 6, minutos: 20160, canal: 'email',    instrucao: 'Dia 14. Fecho educado: "fico por aqui, diga-me se voltar a fazer sentido."' },
];

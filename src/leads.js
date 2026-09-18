/** Ingestao e ciclo de vida das leads. */

import { id, agora, lerDefinicao, linkWhatsApp, CADENCIA } from './utils.js';
import { qualificar, MODELO_OMISSAO } from './ai.js';
import { normalizarTelefone } from './parsers.js';

/**
 * Deduplicacao: a mesma pessoa a pedir o mesmo imovel duas vezes em 24h
 * e uma lead, nao duas. Mas NUNCA se apaga — junta-se.
 */
async function procurarDuplicada(db, { email, telefone, imovel_ref }) {
  if (!email && !telefone) return null;
  return db.prepare(
    `SELECT id FROM leads
      WHERE (email = ? OR telefone = ?)
        AND IFNULL(imovel_ref,'') = IFNULL(?,'')
        AND criado_em > datetime('now','-1 day')
      LIMIT 1`
  ).bind(email || '\u0000', telefone || '\u0000', imovel_ref || null).first();
}

/** Distribuicao por consultor: round-robin simples entre os ativos. */
async function escolherConsultor(db) {
  const r = await db.prepare(
    `SELECT c.id FROM consultores c
      WHERE c.ativo = 1
      ORDER BY (SELECT COUNT(*) FROM leads l
                 WHERE l.consultor_id = c.id
                   AND l.criado_em > datetime('now','-7 day')) ASC,
               RANDOM()
      LIMIT 1`
  ).first();
  return r?.id ?? null;
}

async function agendarCadencia(db, leadId) {
  const base = Date.now();
  const stmts = CADENCIA.map((p) =>
    db.prepare(
      `INSERT INTO follow_ups (id, lead_id, passo, agendado_para, canal, instrucao, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente')`
    ).bind(
      id(), leadId, p.passo,
      new Date(base + p.minutos * 60000).toISOString().replace('T', ' ').slice(0, 19),
      p.canal, p.instrucao
    )
  );
  await db.batch(stmts);
}

/**
 * Entrada unica para TODAS as fontes de lead.
 * A lead e SEMPRE gravada, mesmo que a IA falhe ou nao esteja configurada.
 * Falhar a qualificacao nunca pode significar perder a lead.
 */
export async function criarLead(env, dados, { qualificarAgora = true, ctx = null } = {}) {
  const db = env.DB;
  const leadId = id();

  const telefone = normalizarTelefone(dados.telefone);
  const email = (dados.email || '').trim().toLowerCase() || null;

  const dup = await procurarDuplicada(db, { email, telefone, imovel_ref: dados.imovel_ref });
  if (dup) {
    await db.prepare(
      `INSERT INTO atividades (id, lead_id, tipo, detalhe) VALUES (?, ?, 'criada', ?)`
    ).bind(id(), dup.id, 'Contacto repetido da mesma pessoa em menos de 24h').run();
    return { id: dup.id, duplicada: true };
  }

  const consultorId = dados.consultor_id ?? (await escolherConsultor(db));

  await db.prepare(
    `INSERT INTO leads (id, nome, email, telefone, origem, portal, imovel_ref,
                        imovel_titulo, imovel_url, mensagem, estado, consultor_id,
                        raw_key, parser)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'nova', ?,?,?)`
  ).bind(
    leadId, dados.nome || null, email, telefone,
    dados.origem || 'webhook', dados.portal || null, dados.imovel_ref || null,
    dados.imovel_titulo || null, dados.imovel_url || null, dados.mensagem || null,
    consultorId, dados.raw_key || null, dados.parser || null
  ).run();

  await db.prepare(
    `INSERT INTO atividades (id, lead_id, consultor_id, tipo, detalhe) VALUES (?,?,?,'criada',?)`
  ).bind(id(), leadId, consultorId, `Origem: ${dados.origem || 'webhook'}`).run();

  await agendarCadencia(db, leadId);

  if (qualificarAgora) {
    // A qualificacao demora 8 a 9 segundos. Nunca pode fazer o formulario
    // esperar: a lead ja esta gravada e visivel, o score chega a seguir.
    const trabalho = qualificarLead(env, leadId, dados.bruto || montarBruto(dados));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(trabalho);
    else await trabalho;
  }

  return { id: leadId, duplicada: false, consultor_id: consultorId };
}

function montarBruto(d) {
  return [
    d.nome && `Nome: ${d.nome}`,
    d.email && `Email: ${d.email}`,
    d.telefone && `Telefone: ${d.telefone}`,
    d.imovel_titulo && `Imovel: ${d.imovel_titulo}`,
    d.imovel_ref && `Referencia: ${d.imovel_ref}`,
    d.mensagem && `Mensagem: ${d.mensagem}`,
  ].filter(Boolean).join('\n');
}

/** Qualifica e grava. Se a IA falhar, a lead fica sem score — nunca desaparece. */
export async function qualificarLead(env, leadId, bruto) {
  const db = env.DB;
  const apiKey = await lerDefinicao(db, 'anthropic_api_key');
  if (!apiKey) return null;

  const modelo = await lerDefinicao(db, 'modelo_ia', MODELO_OMISSAO);
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return null;

  const q = await qualificar({
    apiKey, modelo,
    bruto: bruto || montarBruto(lead),
    contexto: { portal: lead.portal, imovel_titulo: lead.imovel_titulo },
  });
  if (!q) return null;

  const tel = normalizarTelefone(q.telefone) || lead.telefone;

  await db.prepare(
    `UPDATE leads SET
       nome = COALESCE(nome, ?), email = COALESCE(email, ?), telefone = COALESCE(telefone, ?),
       tipo = ?, zona = ?, orcamento = ?, timing = ?, financiamento = ?,
       imovel_ref = COALESCE(imovel_ref, ?),
       score = ?, categoria = ?, sinais = ?, resumo_ia = ?, rascunho_whatsapp = ?,
       qualificada_em = datetime('now')
     WHERE id = ?`
  ).bind(
    q.nome, q.email, tel,
    q.tipo, q.zona, q.orcamento, q.timing, q.financiamento, q.imovel_ref,
    q.score, q.categoria, JSON.stringify(q.sinais || []), q.resumo, q.rascunho_whatsapp,
    leadId
  ).run();

  await db.prepare(
    `INSERT INTO atividades (id, lead_id, tipo, detalhe) VALUES (?,?,'qualificada',?)`
  ).bind(id(), leadId, `Score ${q.score} (${q.categoria}) · ${modelo}`).run();

  return q;
}

/**
 * Regista a primeira resposta. Esta e a metrica central do produto:
 * quantos segundos passaram entre a lead entrar e o consultor falar com ela.
 */
export async function registarContacto(db, leadId, consultorId, canal) {
  const lead = await db.prepare('SELECT criado_em, primeira_resposta_em FROM leads WHERE id = ?')
    .bind(leadId).first();
  if (!lead) return null;

  const primeira = !lead.primeira_resposta_em;
  const segundos = primeira
    ? Math.max(0, Math.round((Date.now() - new Date(lead.criado_em + 'Z').getTime()) / 1000))
    : null;

  if (primeira) {
    await db.prepare(
      `UPDATE leads SET estado = 'contactada', primeira_resposta_em = datetime('now'),
                        segundos_ate_resposta = ? WHERE id = ?`
    ).bind(segundos, leadId).run();
    await db.prepare(
      `UPDATE follow_ups SET estado = 'feito', feito_em = datetime('now')
        WHERE lead_id = ? AND passo = 1`
    ).bind(leadId).run();
  }

  await db.prepare(
    `INSERT INTO atividades (id, lead_id, consultor_id, tipo, detalhe) VALUES (?,?,?,?,?)`
  ).bind(id(), leadId, consultorId || null, canal, primeira ? `Primeiro contacto em ${segundos}s` : 'Contacto adicional').run();

  return { primeira, segundos };
}

export function enriquecer(lead) {
  let sinais = [];
  try { sinais = JSON.parse(lead.sinais || '[]'); } catch { /* ignora */ }
  return {
    ...lead,
    sinais,
    link_whatsapp: linkWhatsApp(lead.telefone, lead.rascunho_whatsapp),
  };
}

/**
 * Speed-to-Lead — Worker principal.
 * Serve a API, a interface e recebe email reencaminhado dos portais.
 */

import PostalMime from 'postal-mime';
import { json, erro, id, assinar, verificar, lerDefinicao, gravarDefinicao } from './utils.js';
import { parseDeterminista, detetarPortal } from './parsers.js';
import { criarLead, qualificarLead, registarContacto, enriquecer } from './leads.js';
import { testarChave, MODELO_OMISSAO } from './ai.js';

const COOKIE = 'stl_sessao';

async function segredo(db) {
  let s = await lerDefinicao(db, '_segredo');
  if (!s) {
    s = crypto.randomUUID() + crypto.randomUUID();
    await gravarDefinicao(db, '_segredo', s);
  }
  return s;
}

async function sessao(req, db) {
  const cookies = req.headers.get('cookie') || '';
  const m = cookies.match(new RegExp(COOKIE + '=([^;]+)'));
  if (!m) return null;
  const valor = await verificar(decodeURIComponent(m[1]), await segredo(db));
  if (!valor) return null;
  const [consultorId, expira] = valor.split('|');
  if (Number(expira) < Date.now()) return null;
  return db.prepare('SELECT * FROM consultores WHERE id = ?').bind(consultorId).first();
}

const exigeSessao = (u) => (u ? null : erro('Sessao expirada. Volte a entrar.', 401));

function enriquecerConsultor(c) {
  return { id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, papel: c.papel };
}

export default {
  /** ---------------------------------------------------------------- HTTP */
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const db = env.DB;

    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

    try {
      // ---------- Publico: entrada de leads (formulario, webhook, palco)
      if (p === '/api/leads' && req.method === 'POST') {
        const corpo = await req.json().catch(() => null);
        if (!corpo) return erro('Corpo invalido');
        if (!corpo.email && !corpo.telefone) {
          return erro('E preciso pelo menos um email ou um telefone');
        }
        const r = await criarLead(env, {
          nome: corpo.nome,
          email: corpo.email,
          telefone: corpo.telefone,
          mensagem: corpo.mensagem,
          imovel_ref: corpo.imovel_ref,
          imovel_titulo: corpo.imovel_titulo,
          imovel_url: corpo.imovel_url,
          origem: corpo.origem || 'formulario',
          portal: corpo.portal || 'proprio',
          parser: 'nativo',
        }, { ctx });
        return json({ ok: true, ...r }, 201);
      }

      // ---------- Publico: primeira instalacao
      if (p === '/api/arranque') {
        const n = await db.prepare('SELECT COUNT(*) AS n FROM consultores').first();
        if (req.method === 'GET') return json({ instalado: n.n > 0 });
        if (req.method === 'POST') {
          if (n.n > 0) return erro('Ja instalado', 409);
          const c = await req.json();
          if (!c || !c.nome || !c.email || !c.pin) {
            return erro('Nome, email e PIN sao obrigatorios');
          }
          if (String(c.pin).length < 4) return erro('O PIN tem de ter pelo menos 4 digitos');
          const cid = id();
          await db.prepare(
            'INSERT INTO consultores (id, nome, email, telefone, papel) VALUES (?,?,?,?,?)'
          ).bind(cid, c.nome, c.email.toLowerCase(), c.telefone || null, 'broker').run();
          await gravarDefinicao(db, 'pin', String(c.pin));
          return json({ ok: true });
        }
      }

      if (p === '/api/entrar' && req.method === 'POST') {
        const corpo = await req.json().catch(() => ({}));
        const guardado = await lerDefinicao(db, 'pin');
        const c = await db.prepare('SELECT * FROM consultores WHERE email = ? AND ativo = 1')
          .bind(String(corpo.email || '').toLowerCase()).first();
        if (!c || !guardado || String(corpo.pin) !== guardado) {
          return erro('Email ou PIN errados', 401);
        }
        const token = await assinar(c.id + '|' + (Date.now() + 30 * 864e5), await segredo(db));
        const cookie = COOKIE + '=' + encodeURIComponent(token) +
          '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
        return json({ ok: true, consultor: enriquecerConsultor(c) }, 200, { 'set-cookie': cookie });
      }

      if (p === '/api/sair' && req.method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': COOKIE + '=; Path=/; Max-Age=0' });
      }

      // ---------- Dai para baixo exige sessao
      const eu = await sessao(req, db);

      if (p === '/api/eu') return eu ? json(enriquecerConsultor(eu)) : erro('Sem sessao', 401);

      const bloqueio = exigeSessao(eu);
      if (bloqueio) return bloqueio;

      // ---------- Leads
      if (p === '/api/leads' && req.method === 'GET') {
        const estado = url.searchParams.get('estado');
        const minhas = url.searchParams.get('minhas') === '1';
        const cond = [];
        const args = [];
        if (estado && estado !== 'todas') { cond.push('l.estado = ?'); args.push(estado); }
        if (minhas) { cond.push('l.consultor_id = ?'); args.push(eu.id); }
        const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
        const { results } = await db.prepare(
          'SELECT l.*, c.nome AS consultor_nome FROM leads l ' +
          'LEFT JOIN consultores c ON c.id = l.consultor_id ' +
          where +
          " ORDER BY (l.estado = 'nova') DESC, l.score DESC, l.criado_em DESC LIMIT 300"
        ).bind(...args).all();
        return json(results.map(enriquecer));
      }

      const mLead = p.match(/^\/api\/leads\/([a-f0-9-]{36})(\/[a-z]+)?$/);
      if (mLead) {
        const leadId = mLead[1];
        const accao = mLead[2];

        if (req.method === 'GET' && !accao) {
          const lead = await db.prepare(
            'SELECT l.*, c.nome AS consultor_nome FROM leads l ' +
            'LEFT JOIN consultores c ON c.id = l.consultor_id WHERE l.id = ?'
          ).bind(leadId).first();
          if (!lead) return erro('Lead nao encontrada', 404);
          const hist = await db.prepare(
            'SELECT * FROM atividades WHERE lead_id = ? ORDER BY criado_em DESC'
          ).bind(leadId).all();
          const fups = await db.prepare(
            'SELECT * FROM follow_ups WHERE lead_id = ? ORDER BY passo'
          ).bind(leadId).all();
          return json({ ...enriquecer(lead), atividades: hist.results, follow_ups: fups.results });
        }

        if (req.method === 'POST' && accao === '/contacto') {
          const corpo = await req.json().catch(() => ({}));
          const r = await registarContacto(db, leadId, eu.id, corpo.canal || 'whatsapp');
          return json({ ok: true, ...r });
        }

        if (req.method === 'POST' && accao === '/estado') {
          const corpo = await req.json();
          const validos = ['nova', 'contactada', 'em_conversa', 'visita', 'proposta', 'ganha', 'perdida'];
          if (!validos.includes(corpo.estado)) return erro('Estado invalido');
          await db.prepare('UPDATE leads SET estado = ? WHERE id = ?').bind(corpo.estado, leadId).run();
          await db.prepare(
            "INSERT INTO atividades (id, lead_id, consultor_id, tipo, detalhe) VALUES (?,?,?,'estado',?)"
          ).bind(id(), leadId, eu.id, corpo.nota ? corpo.estado + ' — ' + corpo.nota : corpo.estado).run();
          return json({ ok: true });
        }

        if (req.method === 'POST' && accao === '/atribuir') {
          const corpo = await req.json();
          await db.prepare('UPDATE leads SET consultor_id = ? WHERE id = ?')
            .bind(corpo.consultor_id, leadId).run();
          await db.prepare(
            "INSERT INTO atividades (id, lead_id, consultor_id, tipo, detalhe) VALUES (?,?,?,'atribuida',?)"
          ).bind(id(), leadId, eu.id, 'Reatribuida').run();
          return json({ ok: true });
        }

        if (req.method === 'POST' && accao === '/requalificar') {
          const q = await qualificarLead(env, leadId, null);
          return q
            ? json({ ok: true, ...q })
            : erro('A IA nao respondeu. Verifique a chave em Definicoes.', 502);
        }
      }

      // ---------- Equipa
      if (p === '/api/equipa') {
        if (req.method === 'GET') {
          const { results } = await db.prepare(
            'SELECT c.*, ' +
            '(SELECT COUNT(*) FROM leads l WHERE l.consultor_id = c.id) AS total, ' +
            "(SELECT COUNT(*) FROM leads l WHERE l.consultor_id = c.id AND l.estado = 'nova') AS por_contactar, " +
            "(SELECT COUNT(*) FROM leads l WHERE l.consultor_id = c.id AND l.estado = 'ganha') AS ganhas, " +
            '(SELECT ROUND(AVG(l.segundos_ate_resposta)) FROM leads l ' +
            '  WHERE l.consultor_id = c.id AND l.segundos_ate_resposta IS NOT NULL) AS media_resposta ' +
            'FROM consultores c WHERE c.ativo = 1 ' +
            'ORDER BY media_resposta IS NULL, media_resposta ASC'
          ).all();
          return json(results);
        }
        if (req.method === 'POST') {
          if (eu.papel !== 'broker') {
            return erro('So um broker pode acrescentar pessoas a equipa', 403);
          }
          const c = await req.json();
          if (!c || !c.nome || !c.email) return erro('Nome e email sao obrigatorios');
          await db.prepare(
            'INSERT INTO consultores (id, nome, email, telefone, papel) VALUES (?,?,?,?,?)'
          ).bind(id(), c.nome, c.email.toLowerCase(), c.telefone || null, c.papel || 'consultor').run();
          return json({ ok: true }, 201);
        }
      }

      // ---------- Estatisticas
      if (p === '/api/estatisticas') {
        const g = await db.prepare(
          'SELECT COUNT(*) AS total, ' +
          "SUM(estado = 'nova') AS novas, " +
          "SUM(estado = 'ganha') AS ganhas, " +
          'SUM(segundos_ate_resposta IS NOT NULL) AS respondidas, ' +
          'SUM(segundos_ate_resposta <= 300) AS em_5min, ' +
          'ROUND(AVG(segundos_ate_resposta)) AS media_segundos, ' +
          "SUM(criado_em > datetime('now','-1 day')) AS ultimas_24h " +
          'FROM leads'
        ).first();
        const porDia = await db.prepare(
          'SELECT date(criado_em) AS dia, COUNT(*) AS n FROM leads ' +
          "WHERE criado_em > datetime('now','-14 day') GROUP BY dia ORDER BY dia"
        ).all();
        return json({ ...g, por_dia: porDia.results });
      }

      // ---------- Definicoes
      if (p === '/api/definicoes') {
        if (req.method === 'GET') {
          const chave = await lerDefinicao(db, 'anthropic_api_key');
          return json({
            tem_chave: !!chave,
            chave_mascara: chave ? chave.slice(0, 12) + '…' + chave.slice(-4) : null,
            modelo: await lerDefinicao(db, 'modelo_ia', MODELO_OMISSAO),
            endereco_leads: await lerDefinicao(db, 'endereco_leads'),
            assinatura: await lerDefinicao(db, 'assinatura'),
          });
        }
        if (req.method === 'POST') {
          const d = await req.json();
          if (d.anthropic_api_key) {
            await gravarDefinicao(db, 'anthropic_api_key', d.anthropic_api_key.trim());
          }
          if (d.modelo_ia) await gravarDefinicao(db, 'modelo_ia', d.modelo_ia);
          if (d.assinatura !== undefined) await gravarDefinicao(db, 'assinatura', d.assinatura);
          if (d.endereco_leads !== undefined) {
            await gravarDefinicao(db, 'endereco_leads', d.endereco_leads);
          }
          return json({ ok: true });
        }
      }

      // ---------- Estado do sistema (o ecra que evita 700 pedidos de ajuda)
      if (p === '/api/estado-sistema') {
        const chave = await lerDefinicao(db, 'anthropic_api_key');
        const modelo = await lerDefinicao(db, 'modelo_ia', MODELO_OMISSAO);
        const ia = chave
          ? await testarChave(chave, modelo)
          : { ok: false, erro: 'Sem chave de API configurada' };
        const ultimaEmail = await db.prepare(
          "SELECT criado_em FROM leads WHERE origem = 'email' ORDER BY criado_em DESC LIMIT 1"
        ).first();
        const semQualificar = await db.prepare(
          'SELECT COUNT(*) AS n FROM leads WHERE qualificada_em IS NULL ' +
          "AND criado_em > datetime('now','-1 day')"
        ).first();
        return json({
          base_dados: { ok: true, detalhe: 'Ligada' },
          ia: { ok: ia.ok, detalhe: ia.erro || 'Modelo ' + modelo, modelo },
          email: {
            ok: !!ultimaEmail,
            detalhe: ultimaEmail
              ? 'Ultima lead por email: ' + ultimaEmail.criado_em
              : 'Ainda nao chegou nenhuma lead por email. Confirme o reencaminhamento.',
          },
          whatsapp: {
            ok: true,
            detalhe: 'Modo assistido (wa.me) — sem custos e sem configuracao',
          },
          por_qualificar: semQualificar.n,
        });
      }

      return erro('Rota desconhecida', 404);
    } catch (e) {
      console.error('Erro nao tratado:', (e && e.stack) || e);
      return erro('Erro interno. Consulte os registos do Worker.', 500);
    }
  },

  /** ------------------------------------------------- Email Worker (leads) */
  async email(mensagem, env, ctx) {
    try {
      const buffer = await new Response(mensagem.raw).arrayBuffer();
      const analisado = await PostalMime.parse(buffer);

      const texto = analisado.text || (analisado.html || '').replace(/<[^>]+>/g, ' ');
      const contexto = { de: mensagem.from, assunto: analisado.subject || '', texto };

      // Guarda sempre o original: quando um portal mudar o template,
      // reprocessa-se sem ter perdido nada.
      const brutoId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO emails_brutos (id, remetente, assunto, corpo) VALUES (?,?,?,?)'
      ).bind(brutoId, mensagem.from, analisado.subject || null, texto).run();

      const determinista = parseDeterminista(contexto);
      const portal = detetarPortal(contexto);

      await criarLead(env, {
        ...(determinista || {}),
        portal: (determinista && determinista.portal) || portal,
        origem: 'email',
        raw_key: brutoId,
        parser: (determinista && determinista.parser) || 'llm',
        // Se o regex falhou, a IA recebe o email inteiro e extrai o que conseguir.
        bruto: 'Assunto: ' + (analisado.subject || '') + '\nDe: ' + mensagem.from + '\n\n' + texto,
        mensagem: (determinista && determinista.mensagem) || null,
      });
    } catch (e) {
      console.error('Falha a processar email:', (e && e.stack) || e);
    }
  },
};

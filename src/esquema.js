/**
 * Esquema da base de dados, aplicado pela propria aplicacao.
 *
 * PORQUE E QUE ISTO EXISTE: o botao "Deploy to Cloudflare" cria a base de
 * dados mas nao corre migracoes. Um consultor que instale a aplicacao pelo
 * botao ficaria com uma base vazia e um erro no primeiro ecra, sem saber
 * porque. Pedir-lhe que corra um comando no terminal anula a promessa de
 * "sem programacao".
 *
 * Por isso a aplicacao cria o esquema sozinha ao primeiro pedido. Todas as
 * instrucoes sao IF NOT EXISTS, por isso correr de novo nao faz mal nenhum.
 */

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS consultores (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  telefone      TEXT,                       -- formato E.164 sem '+', ex: 351912345678
  papel         TEXT NOT NULL DEFAULT 'consultor',  -- consultor | broker
  zonas         TEXT,                       -- JSON array de zonas que trabalha
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS leads (
  id                  TEXT PRIMARY KEY,
  nome                TEXT,
  email               TEXT,
  telefone            TEXT,
  origem              TEXT NOT NULL,        -- email | formulario | meta | google | webhook | demo
  portal              TEXT,                 -- idealista | casasapo | imovirtual | remax | proprio
  imovel_ref          TEXT,
  imovel_titulo       TEXT,
  imovel_url          TEXT,
  mensagem            TEXT,                 -- o que a pessoa escreveu
  tipo                TEXT,                 -- comprador | vendedor | arrendamento | investidor | indefinido
  zona                TEXT,
  orcamento           TEXT,
  timing              TEXT,                 -- imediato | 3meses | 6meses | explorar | desconhecido
  financiamento       TEXT,                 -- aprovado | em_curso | necessita | nao_precisa | desconhecido
  score               INTEGER DEFAULT 0,    -- 0-100
  categoria           TEXT,                 -- A | B | C
  resumo_ia           TEXT,
  sinais              TEXT,                 -- JSON array de sinais detetados
  rascunho_whatsapp   TEXT,
  rascunho_email      TEXT,
  estado              TEXT NOT NULL DEFAULT 'nova',
  consultor_id        TEXT REFERENCES consultores(id),
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  qualificada_em      TEXT,
  primeira_resposta_em TEXT,
  segundos_ate_resposta INTEGER,
  raw_key             TEXT,                 -- id em emails_brutos
  parser              TEXT                  -- regex:idealista | llm | nativo
)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_estado    ON leads(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_consultor ON leads(consultor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_criado    ON leads(criado_em DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_score     ON leads(score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_dedup     ON leads(email, telefone, imovel_ref)`,
  `CREATE TABLE IF NOT EXISTS atividades (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  consultor_id  TEXT REFERENCES consultores(id),
  tipo          TEXT NOT NULL,   -- criada | qualificada | atribuida | whatsapp | chamada | email | nota | estado
  detalhe       TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_atividades_lead ON atividades(lead_id, criado_em DESC)`,
  `CREATE TABLE IF NOT EXISTS follow_ups (
  id             TEXT PRIMARY KEY,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  passo          INTEGER NOT NULL,       -- 1..N da cadencia
  agendado_para  TEXT NOT NULL,
  canal          TEXT NOT NULL,          -- whatsapp | chamada | email
  instrucao      TEXT,                   -- o que fazer neste toque
  mensagem       TEXT,                   -- rascunho pre-escrito
  estado         TEXT NOT NULL DEFAULT 'pendente',  -- pendente | feito | saltado
  feito_em       TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_followups_agenda ON follow_ups(estado, agendado_para)`,
  `CREATE TABLE IF NOT EXISTS emails_brutos (
  id         TEXT PRIMARY KEY,
  lead_id    TEXT REFERENCES leads(id) ON DELETE CASCADE,
  remetente  TEXT,
  assunto    TEXT,
  corpo      TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_lead ON emails_brutos(lead_id)`,
  `CREATE TABLE IF NOT EXISTS definicoes (
  chave      TEXT PRIMARY KEY,
  valor      TEXT,
  atualizado TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS acessos (
  token       TEXT PRIMARY KEY,
  consultor_id TEXT NOT NULL REFERENCES consultores(id),
  expira_em   TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
)`,
];

let feito = false;

export async function garantirEsquema(db) {
  if (feito) return;

  // Verificacao barata: na esmagadora maioria dos pedidos o esquema ja existe
  // e isto custa uma leitura. O batch() da D1 nao aceita bem DDL, por isso as
  // instrucoes correm uma a uma quando e mesmo preciso criar.
  try {
    await db.prepare('SELECT 1 FROM consultores LIMIT 1').first();
    feito = true;
    return;
  } catch {
    // Tabelas em falta. Instalacao nova: criar tudo.
  }

  for (const sql of INSTRUCOES) {
    await db.prepare(sql).run();
  }
  feito = true;
}

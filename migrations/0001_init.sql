-- Speed-to-Lead — esquema inicial
-- Principio de desenho: a IA ORDENA, nunca descarta. Nenhuma lead e arquivada
-- automaticamente. O consultor decide sempre.

CREATE TABLE IF NOT EXISTS consultores (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  telefone      TEXT,                       -- formato E.164 sem '+', ex: 351912345678
  papel         TEXT NOT NULL DEFAULT 'consultor',  -- consultor | broker
  zonas         TEXT,                       -- JSON array de zonas que trabalha
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id                  TEXT PRIMARY KEY,
  -- Identificacao
  nome                TEXT,
  email               TEXT,
  telefone            TEXT,
  -- Proveniencia
  origem              TEXT NOT NULL,        -- email | formulario | meta | google | webhook | demo
  portal              TEXT,                 -- idealista | casasapo | imovirtual | remax | proprio
  imovel_ref          TEXT,
  imovel_titulo       TEXT,
  imovel_url          TEXT,
  mensagem            TEXT,                 -- o que a pessoa escreveu
  -- Qualificacao (preenchida pela IA, editavel pelo humano)
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
  -- Fluxo
  estado              TEXT NOT NULL DEFAULT 'nova',
                      -- nova | contactada | em_conversa | visita | proposta | ganha | perdida
  consultor_id        TEXT REFERENCES consultores(id),
  -- Metrica central do produto: speed-to-lead
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  qualificada_em      TEXT,
  primeira_resposta_em TEXT,
  segundos_ate_resposta INTEGER,
  -- Rastreabilidade
  raw_key             TEXT,                 -- id em emails_brutos
  parser              TEXT                  -- regex:idealista | llm | nativo
);

CREATE INDEX IF NOT EXISTS idx_leads_estado    ON leads(estado);
CREATE INDEX IF NOT EXISTS idx_leads_consultor ON leads(consultor_id);
CREATE INDEX IF NOT EXISTS idx_leads_criado    ON leads(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score     ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_dedup     ON leads(email, telefone, imovel_ref);

CREATE TABLE IF NOT EXISTS atividades (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  consultor_id  TEXT REFERENCES consultores(id),
  tipo          TEXT NOT NULL,   -- criada | qualificada | atribuida | whatsapp | chamada | email | nota | estado
  detalhe       TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_atividades_lead ON atividades(lead_id, criado_em DESC);

-- Cadencia de follow-up: o que impede a lead de morrer no silencio
CREATE TABLE IF NOT EXISTS follow_ups (
  id             TEXT PRIMARY KEY,
  lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  passo          INTEGER NOT NULL,       -- 1..N da cadencia
  agendado_para  TEXT NOT NULL,
  canal          TEXT NOT NULL,          -- whatsapp | chamada | email
  instrucao      TEXT,                   -- o que fazer neste toque
  mensagem       TEXT,                   -- rascunho pre-escrito
  estado         TEXT NOT NULL DEFAULT 'pendente',  -- pendente | feito | saltado
  feito_em       TEXT
);

CREATE INDEX IF NOT EXISTS idx_followups_agenda ON follow_ups(estado, agendado_para);

-- Copia do email original. Fica aqui e nao em armazenamento de objetos
-- porque o R2 exige subscricao paga, e esta aplicacao tem de correr numa
-- conta gratuita sem cartao. Um email de lead sao poucos KB; a D1 gratuita
-- tem 5 GB, o que chega para centenas de milhares de leads.
CREATE TABLE IF NOT EXISTS emails_brutos (
  id         TEXT PRIMARY KEY,
  lead_id    TEXT REFERENCES leads(id) ON DELETE CASCADE,
  remetente  TEXT,
  assunto    TEXT,
  corpo      TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_lead ON emails_brutos(lead_id);

-- Definicoes da instalacao (chaves de API guardadas aqui, nao em ficheiros)
CREATE TABLE IF NOT EXISTS definicoes (
  chave      TEXT PRIMARY KEY,
  valor      TEXT,
  atualizado TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessoes de acesso por codigo enviado para email
CREATE TABLE IF NOT EXISTS acessos (
  token       TEXT PRIMARY KEY,
  consultor_id TEXT NOT NULL REFERENCES consultores(id),
  expira_em   TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

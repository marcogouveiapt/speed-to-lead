/**
 * Qualificacao de leads com Claude.
 *
 * PRINCIPIO DE PRODUTO: a IA ORDENA, nunca descarta.
 * Nenhuma lead e arquivada automaticamente por causa de um score. O score serve
 * para decidir a ORDEM por onde o consultor ataca a lista, nada mais.
 * E tambem uma decisao de RGPD: evita a discussao de decisao automatizada
 * do art. 22.o do RGPD.
 */

import Anthropic from '@anthropic-ai/sdk';

// Modelo por omissao. Alteravel nas Definicoes da app.
// claude-opus-5   — melhor qualidade de extracao e de portugues de Portugal
// claude-haiku-4-5 — ~5x mais barato, suficiente para extracao simples
export const MODELO_OMISSAO = 'claude-opus-5';

const ESQUEMA_QUALIFICACAO = {
  type: 'object',
  properties: {
    nome: { type: ['string', 'null'], description: 'Nome da pessoa que contactou' },
    email: { type: ['string', 'null'] },
    telefone: { type: ['string', 'null'], description: 'Apenas digitos, com indicativo 351 se portugues' },
    tipo: {
      type: 'string',
      enum: ['comprador', 'vendedor', 'arrendamento', 'investidor', 'indefinido'],
    },
    zona: { type: ['string', 'null'], description: 'Zona ou concelho de interesse' },
    orcamento: { type: ['string', 'null'], description: 'Valor ou intervalo mencionado, tal como aparece' },
    timing: {
      type: 'string',
      enum: ['imediato', '3meses', '6meses', 'explorar', 'desconhecido'],
    },
    financiamento: {
      type: 'string',
      enum: ['aprovado', 'em_curso', 'necessita', 'nao_precisa', 'desconhecido'],
    },
    imovel_ref: { type: ['string', 'null'] },
    score: {
      type: 'integer',
      description: 'Prioridade de contacto de 0 a 100. NAO e probabilidade de venda.',
    },
    categoria: { type: 'string', enum: ['A', 'B', 'C'] },
    sinais: {
      type: 'array',
      items: { type: 'string' },
      description: 'Sinais concretos detetados no texto, 2 a 5, curtos',
    },
    resumo: {
      type: 'string',
      description: 'Uma frase para o consultor ler em 3 segundos antes de ligar',
    },
    rascunho_whatsapp: {
      type: 'string',
      description: 'Mensagem de primeiro contacto pronta a enviar, PT-PT, ate 400 caracteres',
    },
  },
  required: [
    'nome', 'email', 'telefone', 'tipo', 'zona', 'orcamento', 'timing',
    'financiamento', 'imovel_ref', 'score', 'categoria', 'sinais',
    'resumo', 'rascunho_whatsapp',
  ],
  additionalProperties: false,
};

const SISTEMA = `Es um assistente de qualificacao de leads para consultores imobiliarios em Portugal.

Recebes o conteudo em bruto de um contacto (email de portal, formulario, mensagem) e extrais os dados estruturados.

REGRAS DE EXTRACAO
- Extrai apenas o que esta no texto. Nunca inventes um telefone, um orcamento ou uma zona.
- Se um campo nao estiver presente, devolve null ou "desconhecido". Um campo vazio e uma resposta correta.
- Telefone: apenas digitos. Numeros portugueses levam o indicativo 351 a frente (ex: 351912345678).
- Ignora enderecos e telefones do proprio portal (idealista, imovirtual, sapo, remax, noreply).

REGRAS DE SCORE (0-100)
O score mede URGENCIA DE CONTACTO, nao qualidade da pessoa. Baseia-te em sinais reais:
- Sobe: pediu visita, deixou telefone, menciona prazo curto, credito aprovado, quer vender, refere imovel especifico, escreveu mensagem personalizada.
- Desce: mensagem generica automatica, sem telefone, "so a ver precos", sem qualquer especificidade.
- Categoria: A = 70-100, B = 40-69, C = 0-39.
- Na duvida, sobe. O custo de ligar a uma lead fraca e cinco minutos. O custo de ignorar uma lead boa e uma comissao.

RASCUNHO DE WHATSAPP
- Portugues de Portugal. Natural, como uma pessoa escreve, nao como um robo.
- Trata por "voce" de forma implicita, sem soar formal de mais. Nunca uses "tu".
- Comeca pelo nome proprio se o souberes.
- Refere o imovel concreto se existir. Isto prova que nao e automatico.
- Uma pergunta unica e facil de responder no fim. Nunca duas perguntas.
- Sem emojis a abrir. No maximo um, e so se assentar.
- Nunca prometas precos, condicoes de credito ou disponibilidade que nao conheces.
- Assina de forma neutra: quem envia e o consultor, o nome dele e acrescentado pela app.
- Proibido: "Espero que esteja bem", "Venho por este meio", "Nao hesite em contactar".`;

/**
 * Qualifica uma lead. Devolve os campos estruturados ou null se a IA falhar —
 * a lead e SEMPRE gravada, com ou sem qualificacao.
 */
export async function qualificar({ apiKey, modelo, bruto, contexto = {} }) {
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const partes = [
    contexto.portal ? `Portal de origem: ${contexto.portal}` : null,
    contexto.imovel_titulo ? `Imovel: ${contexto.imovel_titulo}` : null,
    contexto.consultor ? `Consultor que vai contactar: ${contexto.consultor}` : null,
    '',
    'CONTEUDO EM BRUTO DO CONTACTO:',
    '---',
    String(bruto || '').slice(0, 12000),
    '---',
  ].filter((p) => p !== null).join('\n');

  try {
    const resposta = await client.messages.parse({
      model: modelo || MODELO_OMISSAO,
      max_tokens: 2000,
      system: SISTEMA,
      messages: [{ role: 'user', content: partes }],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA_QUALIFICACAO } },
    });

    if (resposta.stop_reason === 'refusal') return null;
    return resposta.parsed_output ?? null;
  } catch (erro) {
    console.error('Falha na qualificacao:', erro?.message || erro);
    return null;
  }
}

/** Testa se a chave de API funciona — usado pelo ecra "Estado do sistema". */
export async function testarChave(apiKey, modelo) {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: modelo || MODELO_OMISSAO,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Responde apenas: ok' }],
    });
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: erro?.message || String(erro) };
  }
}

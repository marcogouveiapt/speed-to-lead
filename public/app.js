/* Speed-to-Lead, interface. Sem framework, sem build. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const api = async (caminho, opcoes = {}) => {
  const r = await fetch('/api' + caminho, {
    headers: { 'content-type': 'application/json' },
    ...opcoes,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Erro ' + r.status);
  return dados;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------- tempo decorrido
   O relogio e o produto. E o que cria a pressao certa: nao "tens 12 leads",
   mas "esta lead esta a arrefecer ha 6 minutos". */
function decorrido(desde) {
  const seg = Math.max(0, Math.round((Date.now() - new Date(desde + 'Z').getTime()) / 1000));
  if (seg < 60) return { txt: seg + 's', seg };
  if (seg < 3600) return { txt: Math.floor(seg / 60) + 'min', seg };
  if (seg < 86400) return { txt: Math.floor(seg / 3600) + 'h', seg };
  return { txt: Math.floor(seg / 86400) + 'd', seg };
}

const duracao = (seg) => {
  if (seg == null) return '·';
  if (seg < 60) return seg + 's';
  if (seg < 3600) return Math.floor(seg / 60) + 'min';
  return (seg / 3600).toFixed(1) + 'h';
};

const ESTADOS = {
  nova: 'Por contactar', contactada: 'Contactada', em_conversa: 'Em conversa',
  visita: 'Visita marcada', proposta: 'Proposta', ganha: 'Ganha', perdida: 'Perdida',
};

let eu = null;
let filtro = { estado: 'nova', minhas: false };
let leads = [];
let procura = '';
let ordem = 'score';

/* Tira acentos e maiusculas, para "sofia" encontrar "Sófia" e vice-versa.
   Em palco procura-se pelo nome que a pessoa disse, nao pelo que esta escrito. */
const normalizar = (t) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ------------------------------------------------------------------ arranque */
(async function iniciar() {
  const { instalado } = await api('/arranque');
  if (!instalado) return mostrar('ecra-arranque');
  try {
    eu = await api('/eu');
    abrirApp();
  } catch {
    mostrar('ecra-entrar');
  }
})();

function mostrar(ecraId) {
  ['ecra-arranque', 'ecra-entrar', 'ecra-app'].forEach((e) => { $('#' + e).hidden = e !== ecraId; });
}

$('#form-arranque').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(ev.target));
  try {
    await api('/arranque', { method: 'POST', corpo: d });
    await api('/entrar', { method: 'POST', corpo: { email: d.email, pin: d.pin } });
    eu = await api('/eu');
    abrirApp();
  } catch (e) { $('#erro-arranque').textContent = e.message; }
});

$('#form-entrar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/entrar', { method: 'POST', corpo: Object.fromEntries(new FormData(ev.target)) });
    eu = await api('/eu');
    abrirApp();
  } catch (e) { $('#erro-entrar').textContent = e.message; }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/sair', { method: 'POST' });
  location.reload();
});

function abrirApp() {
  mostrar('ecra-app');
  $('#quem').textContent = eu.nome;
  $('#bloco-add-consultor').hidden = eu.papel !== 'broker';
  $('#url-webhook').textContent = location.origin + '/api/leads';
  carregarLeads();
  carregarMetricas();
  setInterval(carregarLeads, 8000);    // atualiza a lista: em palco tem de parecer vivo
  setInterval(actualizarRelogios, 1000); // o relogio corre sempre
}

/* --------------------------------------------------------------------- abas */
$$('.abas button').forEach((b) => b.addEventListener('click', () => {
  $$('.abas button').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
  $$('.painel').forEach((p) => { p.hidden = p.id !== 'painel-' + b.dataset.painel; });
  if (b.dataset.painel === 'equipa') carregarEquipa();
  if (b.dataset.painel === 'definicoes') carregarDefinicoes();
  if (b.dataset.painel === 'estado') carregarEstado();
}));

/* ------------------------------------------------------------------ filtros */
$('#filtros').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.minhas) {
    filtro.minhas = !filtro.minhas;
    b.setAttribute('aria-pressed', String(filtro.minhas));
  } else {
    filtro.estado = b.dataset.estado;
    $$('#filtros button[data-estado]').forEach((o) =>
      o.setAttribute('aria-pressed', String(o === b)));
  }
  carregarLeads();
});

/* -------------------------------------------------------------------- leads */
async function carregarLeads() {
  const q = new URLSearchParams({ estado: filtro.estado, minhas: filtro.minhas ? '1' : '0' });
  leads = await api('/leads?' + q);
  desenharLeads();
}

function ordenarEFiltrar() {
  const termo = normalizar(procura).trim();
  let lista = leads;

  if (termo) {
    lista = lista.filter((l) => normalizar(
      [l.nome, l.telefone, l.email, l.zona, l.mensagem, l.resumo_ia, l.imovel_titulo, l.imovel_ref]
        .filter(Boolean).join(' ')
    ).includes(termo));
  }

  const instante = (l) => new Date(l.criado_em + 'Z').getTime();
  const copia = [...lista];
  if (ordem === 'recentes') copia.sort((a, b) => instante(b) - instante(a));
  else if (ordem === 'espera') copia.sort((a, b) => instante(a) - instante(b));
  else copia.sort((a, b) => (b.score || 0) - (a.score || 0) || instante(b) - instante(a));
  return copia;
}

function desenharLeads() {
  const alvo = $('#lista-leads');
  const visiveis = ordenarEFiltrar();

  if (procura && !visiveis.length) {
    alvo.innerHTML = `<div class="vazio-estado cartao">
      <strong>Nada encontrado para "${esc(procura)}".</strong>
      Experimente só o primeiro nome, ou os últimos dígitos do telefone.</div>`;
    return;
  }
  if (!leads.length) {
    alvo.innerHTML = `<div class="vazio-estado cartao">
      <strong>Nenhuma lead aqui.</strong>
      Quando chegar uma, aparece no topo e o relógio começa a contar.</div>`;
    return;
  }
  alvo.innerHTML = visiveis.map((l) => {
    const t = decorrido(l.criado_em);
    const nova = l.estado === 'nova';
    const cls = nova ? (t.seg > 300 ? 'urgente' : '') : 'ok';
    const selo = l.categoria
      ? `<div class="selo ${l.categoria}">${l.categoria}</div>`
      : `<div class="selo vazio">·</div>`;
    return `<article class="cartao lead ${nova ? 'nova' : ''}" data-id="${l.id}" tabindex="0">
      ${selo}
      <div>
        <div class="nome">${esc(l.nome || 'Sem nome')}</div>
        <div class="resumo">${esc(l.resumo_ia || l.mensagem || 'Sem qualificação ainda.')}</div>
        <div class="meta">
          ${l.portal ? `<span>${esc(l.portal)}</span>` : ''}
          ${l.zona ? `<span>${esc(l.zona)}</span>` : ''}
          ${l.orcamento ? `<span>${esc(l.orcamento)}</span>` : ''}
          ${l.consultor_nome ? `<span>${esc(l.consultor_nome)}</span>` : ''}
        </div>
      </div>
      <div class="direita">
        <span class="relogio ${cls}" data-desde="${l.criado_em}" data-nova="${nova}">
          ${nova ? t.txt : duracao(l.segundos_ate_resposta)}</span>
        <span class="etiqueta ${l.estado === 'ganha' ? 'verde' : nova ? 'azul' : ''}">
          ${ESTADOS[l.estado] || l.estado}</span>
      </div>
    </article>`;
  }).join('');
}

function actualizarRelogios() {
  $$('.relogio[data-nova="true"]').forEach((el) => {
    const t = decorrido(el.dataset.desde);
    el.textContent = t.txt;
    el.classList.toggle('urgente', t.seg > 300);
  });
}

/* A pesquisa e local: a lista ja esta em memoria, por isso filtra ao ritmo
   de quem escreve, sem ir a rede. Em palco isso e a diferenca entre encontrar
   a lead do voluntario de imediato ou ficar a olhar para um ecra a carregar. */
$('#procura').addEventListener('input', (ev) => {
  procura = ev.target.value;
  desenharLeads();
});
$('#ordem').addEventListener('change', (ev) => {
  ordem = ev.target.value;
  desenharLeads();
});

$('#lista-leads').addEventListener('click', (ev) => {
  const c = ev.target.closest('.lead');
  if (c) abrirLead(c.dataset.id);
});

/* ------------------------------------------------------------------- gaveta */
async function abrirLead(leadId) {
  const l = await api('/leads/' + leadId);
  const sinais = (l.sinais || []).map((s) => `<span class="etiqueta">${esc(s)}</span>`).join('');
  const tel = l.telefone ? `<a href="tel:+${esc(l.telefone)}">+${esc(l.telefone)}</a>` : '·';

  $('#gaveta-conteudo').innerHTML = `
    <div style="display:flex;align-items:start;gap:12px;margin-bottom:14px">
      <div style="flex:1">
        <h1>${esc(l.nome || 'Sem nome')}</h1>
        <div class="nota-rodape" style="margin-top:2px">
          ${l.categoria ? `Prioridade ${l.categoria} · score ${l.score}` : 'Ainda sem qualificação'}
          ${l.portal ? ' · ' + esc(l.portal) : ''}
        </div>
      </div>
      <button class="botao" id="fechar-gaveta" aria-label="Fechar">✕</button>
    </div>

    ${l.resumo_ia ? `<p style="margin:0 0 10px">${esc(l.resumo_ia)}</p>` : ''}
    <div class="sinais">${sinais}</div>

    ${l.telefone ? `
      <label class="campo" style="margin-top:14px">
        <span>Mensagem de primeiro contacto, leia antes de enviar</span>
        <textarea id="msg-whatsapp">${esc(l.rascunho_whatsapp || '')}</textarea>
      </label>
      <a class="botao whatsapp" id="btn-whatsapp" href="#">Abrir no WhatsApp e enviar</a>
      <p class="nota-rodape" style="text-align:center;margin-top:8px">
        <a href="#" id="btn-whatsapp-web">Não abriu? Usar o WhatsApp Web</a>
      </p>
      <p class="nota-rodape" style="text-align:center">
        A mensagem é enviada por si, do seu WhatsApp. A app nunca envia nada sozinha.</p>
    ` : `<div class="aviso">Sem telemóvel nesta lead, só é possível responder por email.</div>`}

    <div class="botoes" style="margin:16px 0">
      ${l.email ? `<a class="botao" href="mailto:${esc(l.email)}">Email</a>` : ''}
      ${l.telefone ? `<a class="botao" href="tel:+${esc(l.telefone)}" id="btn-chamada">Ligar</a>` : ''}
      <button class="botao" id="btn-requalificar">Voltar a qualificar</button>
    </div>

    <label class="campo"><span>Estado</span>
      <select id="sel-estado">
        ${Object.entries(ESTADOS).map(([k, v]) =>
          `<option value="${k}" ${k === l.estado ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>

    <div class="cartao" style="padding:0;margin-top:8px">
      <table><tbody>
        <tr><th>Telefone</th><td>${tel}</td></tr>
        <tr><th>Email</th><td>${esc(l.email || '·')}</td></tr>
        <tr><th>Imóvel</th><td>${l.imovel_url
          ? `<a href="${esc(l.imovel_url)}" target="_blank" rel="noopener">${esc(l.imovel_titulo || l.imovel_ref || 'ver')}</a>`
          : esc(l.imovel_titulo || l.imovel_ref || '·')}</td></tr>
        <tr><th>Tipo</th><td>${esc(l.tipo || '·')}</td></tr>
        <tr><th>Prazo</th><td>${esc(l.timing || '·')}</td></tr>
        <tr><th>Financiamento</th><td>${esc(l.financiamento || '·')}</td></tr>
        <tr><th>Resposta</th><td>${duracao(l.segundos_ate_resposta)}</td></tr>
      </tbody></table>
    </div>

    ${l.mensagem ? `<label class="campo" style="margin-top:14px"><span>O que a pessoa escreveu</span>
      <div class="cartao" style="padding:12px;font-size:.9rem">${esc(l.mensagem)}</div></label>` : ''}

    <h2 style="margin:20px 0 8px">Próximos toques</h2>
    <div class="cartao" style="padding:0">
      <table><tbody>${(l.follow_ups || []).map((f) => `<tr>
        <th>${f.passo}</th>
        <td>${esc(f.canal)}<div class="nota-rodape">${esc(f.instrucao)}</div></td>
        <td style="text-align:right;white-space:nowrap">
          <span class="etiqueta ${f.estado === 'feito' ? 'verde' : ''}">${esc(f.estado)}</span></td>
      </tr>`).join('')}</tbody></table>
    </div>

    <h2 style="margin:20px 0 8px">Histórico</h2>
    <div class="cartao" style="padding:0">
      <table><tbody>${(l.atividades || []).map((a) => `<tr>
        <td>${esc(a.tipo)}<div class="nota-rodape">${esc(a.detalhe || '')}</div></td>
        <td style="text-align:right;white-space:nowrap;color:var(--tinta-ténue);font-size:.8rem">
          ${esc(a.criado_em)}</td>
      </tr>`).join('')}</tbody></table>
    </div>`;

  $('#gaveta').hidden = false;
  $('#fechar-gaveta').onclick = () => { $('#gaveta').hidden = true; };

  /* Abrir o WhatsApp sem passar pela pagina intermedia da Meta.
     No telemovel, o wa.me abre a aplicacao diretamente.
     No computador, o wa.me mostra um ecra "Abrir app / Continuar para o Web",
     que em palco e um clique a mais e um ecra da Meta projetado a meio da
     demonstracao. O esquema whatsapp:// salta essa pagina e abre a aplicacao
     de secretaria. Fica sempre um link para o Web, para quem nao a tiver. */
  const caixa = $('#msg-whatsapp');
  const zap = $('#btn-whatsapp');
  const zapWeb = $('#btn-whatsapp-web');

  if (zap) {
    const numero = (l.telefone || '').replace(/\D/g, '');
    const telemovel = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const actualizarLinks = () => {
      const texto = encodeURIComponent(caixa ? caixa.value : (l.rascunho_whatsapp || ''));
      zap.href = telemovel
        ? 'https://wa.me/' + numero + '?text=' + texto
        : 'whatsapp://send?phone=' + numero + '&text=' + texto;
      if (zapWeb) {
        zapWeb.href = 'https://web.whatsapp.com/send?phone=' + numero + '&text=' + texto;
      }
    };
    actualizarLinks();
    if (caixa) caixa.addEventListener('input', actualizarLinks);
    if (zapWeb) {
      zapWeb.target = '_blank';
      zapWeb.rel = 'noopener';
    }
  }

  // Carregar em enviar marca a primeira resposta, e para o cronometro.
  const marcarContacto = async () => {
    await api('/leads/' + leadId + '/contacto', { method: 'POST', corpo: { canal: 'whatsapp' } });
    carregarLeads(); carregarMetricas();
  };
  if (zap) zap.addEventListener('click', marcarContacto);
  if (zapWeb) zapWeb.addEventListener('click', marcarContacto);

  const chamada = $('#btn-chamada');
  if (chamada) chamada.addEventListener('click', async () => {
    await api('/leads/' + leadId + '/contacto', { method: 'POST', corpo: { canal: 'chamada' } });
    carregarLeads(); carregarMetricas();
  });

  $('#sel-estado').addEventListener('change', async (ev) => {
    await api('/leads/' + leadId + '/estado', { method: 'POST', corpo: { estado: ev.target.value } });
    carregarLeads(); carregarMetricas();
  });

  $('#btn-requalificar').addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'A qualificar…';
    try { await api('/leads/' + leadId + '/requalificar', { method: 'POST' }); abrirLead(leadId); }
    catch (e) { ev.target.textContent = e.message; }
    carregarLeads();
  });
}

$('#gaveta').addEventListener('click', (ev) => {
  if (ev.target.id === 'gaveta') $('#gaveta').hidden = true;
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') $('#gaveta').hidden = true;
});

/* ---------------------------------------------------------------- metricas */
async function carregarMetricas() {
  const m = await api('/estatisticas');
  const pct = m.respondidas ? Math.round((m.em_5min / m.respondidas) * 100) : 0;
  $('#metricas').innerHTML = `
    <div class="cartao metrica">
      <div class="valor">${m.novas || 0}</div>
      <div class="rotulo">Por contactar</div>
      <div class="nota">${m.ultimas_24h || 0} chegaram nas últimas 24h</div>
    </div>
    <div class="cartao metrica">
      <div class="valor">${duracao(m.media_segundos)}</div>
      <div class="rotulo">Tempo médio de resposta</div>
      <div class="nota">Abaixo de 5 minutos é onde está o ganho</div>
    </div>
    <div class="cartao metrica">
      <div class="valor">${pct}%</div>
      <div class="rotulo">Respondidas em menos de 5 min</div>
      <div class="nota">${m.em_5min || 0} de ${m.respondidas || 0}</div>
    </div>
    <div class="cartao metrica">
      <div class="valor">${m.ganhas || 0}</div>
      <div class="rotulo">Ganhas</div>
      <div class="nota">De ${m.total || 0} leads no total</div>
    </div>`;
}

/* ------------------------------------------------------------------ equipa */
async function carregarEquipa() {
  const e = await api('/equipa');
  $('#tabela-equipa').innerHTML = e.map((c) => `<tr>
    <td><strong>${esc(c.nome)}</strong>
      <div class="nota-rodape">${esc(c.papel)}</div></td>
    <td><span class="relogio ${c.media_resposta != null && c.media_resposta <= 300 ? 'ok' : c.media_resposta != null ? 'urgente' : ''}">
      ${duracao(c.media_resposta)}</span></td>
    <td>${c.por_contactar}</td><td>${c.total}</td><td>${c.ganhas}</td>
  </tr>`).join('');
}

const formConsultor = $('#form-consultor');
if (formConsultor) formConsultor.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await api('/equipa', { method: 'POST', corpo: Object.fromEntries(new FormData(ev.target)) });
  ev.target.reset();
  carregarEquipa();
});

/* -------------------------------------------------------------- definicoes */
async function carregarDefinicoes() {
  const d = await api('/definicoes');
  const f = $('#form-definicoes');
  f.modelo_ia.value = d.modelo || 'claude-opus-5';
  f.assinatura.value = d.assinatura || '';
  f.endereco_leads.value = d.endereco_leads || '';
  $('#estado-chave').textContent = d.tem_chave
    ? 'Configurada: ' + d.chave_mascara + ', deixe em branco para manter.'
    : 'Sem chave. Sem ela as leads são gravadas, mas não são qualificadas.';
}

$('#form-definicoes').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(ev.target));
  if (!d.anthropic_api_key) delete d.anthropic_api_key;
  await api('/definicoes', { method: 'POST', corpo: d });
  $('#guardado').textContent = 'Guardado.';
  setTimeout(() => { $('#guardado').textContent = ''; }, 2500);
  carregarDefinicoes();
});

/* ---------------------------------------------------------------- estado */
async function carregarEstado() {
  const s = await api('/estado-sistema');
  // ok === true verde, ok === false vermelho, ok === null ambar (por configurar)
  const cor = (ok) => (ok === true ? 'on' : ok === false ? 'off' : 'espera');
  const linha = (nome, v) => `<div class="estado-linha">
    <span class="pisca ${cor(v.ok)}"></span>
    <div style="flex:1"><strong>${nome}</strong>
      <div class="nota-rodape" style="margin:0">${esc(v.detalhe || '')}</div></div>
  </div>`;
  $('#lista-estado').innerHTML =
    linha('Base de dados', s.base_dados) +
    linha('Inteligência artificial', s.ia) +
    linha('Entrada de email', s.email) +
    linha('WhatsApp', s.whatsapp) +
    (s.por_qualificar
      ? `<div class="estado-linha"><span class="pisca off"></span><div>
          <strong>${s.por_qualificar} lead(s) por qualificar nas últimas 24h</strong>
          <div class="nota-rodape" style="margin:0">Estão gravadas. Abra cada uma e carregue em
          "Voltar a qualificar".</div></div></div>`
      : '');
}

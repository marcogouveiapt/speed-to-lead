/**
 * Envia para o Speed-to-Lead os emails de lead que chegam ao Gmail.
 *
 * PORQUE E QUE ISTO EXISTE
 * O Cloudflare Email Routing so funciona se o dominio estiver alojado na
 * Cloudflare. A maioria dos consultores tem o dominio no alojamento do site,
 * e muitos nem sequer tem dominio proprio. Este script resolve o mesmo
 * problema sem dominio, sem DNS e sem custo: corre dentro da conta Gmail.
 *
 * COMO INSTALAR (5 minutos, sem programacao)
 *  1. Va a script.google.com e crie um projeto novo
 *  2. Apague o que la estiver e cole este ficheiro todo
 *  3. Na linha ENDERECO_DA_APP, ponha o endereco da sua aplicacao
 *  4. Menu Executar, escolha "instalar". Autorize quando pedir
 *  5. Pronto. De 5 em 5 minutos, as leads novas entram sozinhas
 *
 * O script so le emails dos portais, marca-os com uma etiqueta depois de
 * enviar, e nunca envia o mesmo duas vezes.
 */

const ENDERECO_DA_APP = 'https://a-sua-app.workers.dev';

// Remetentes que contam como lead. Acrescente os que usar.
const PORTAIS = [
  'idealista.pt',
  'imovirtual.com',
  'casa.sapo.pt',
  'janeladigital.com',
  'remax.pt',
];

const ETIQUETA = 'Enviado para o Speed-to-Lead';

/** Corre uma vez, para ligar tudo. */
function instalar() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verificar').timeBased().everyMinutes(5).create();
  if (!GmailApp.getUserLabelByName(ETIQUETA)) GmailApp.createLabel(ETIQUETA);
  verificar();
  Logger.log('Instalado. As leads novas passam a entrar de 5 em 5 minutos.');
}

/** Procura emails de lead por tratar e manda-os para a aplicacao. */
function verificar() {
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  const de = PORTAIS.map((d) => 'from:' + d).join(' OR ');
  const procura = '(' + de + ') -label:"' + ETIQUETA + '" newer_than:7d';

  const conversas = GmailApp.search(procura, 0, 25);
  let enviadas = 0;

  conversas.forEach((conversa) => {
    conversa.getMessages().forEach((msg) => {
      const corpo = msg.getPlainBody() || msg.getBody().replace(/<[^>]+>/g, ' ');
      const carga = {
        origem: 'email',
        portal: detetarPortal(msg.getFrom()),
        mensagem: corpo.slice(0, 8000),
        assunto: msg.getSubject(),
        // A aplicacao extrai nome, telefone e o resto com inteligencia
        // artificial. Aqui mandamos o email tal como chegou.
        email: extrairEmail(corpo),
        telefone: extrairTelefone(corpo),
      };

      if (!carga.email && !carga.telefone) {
        // Sem qualquer contacto a aplicacao recusa. Manda-se na mesma o corpo
        // com um marcador, para nao se perder a lead, e trata-se a mao.
        carga.email = 'sem-contacto@lead-por-tratar.local';
      }

      try {
        UrlFetchApp.fetch(ENDERECO_DA_APP.replace(/\/$/, '') + '/api/leads', {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(carga),
          muteHttpExceptions: true,
        });
        enviadas++;
      } catch (e) {
        Logger.log('Falhou: ' + e);
      }
    });
    conversa.addLabel(etiqueta);
  });

  if (enviadas) Logger.log(enviadas + ' lead(s) enviada(s).');
}

function detetarPortal(remetente) {
  const r = String(remetente).toLowerCase();
  if (r.indexOf('idealista') >= 0) return 'idealista';
  if (r.indexOf('imovirtual') >= 0 || r.indexOf('olx') >= 0) return 'imovirtual';
  if (r.indexOf('sapo') >= 0 || r.indexOf('janeladigital') >= 0) return 'casasapo';
  if (r.indexOf('remax') >= 0) return 'remax';
  return null;
}

function extrairEmail(texto) {
  const todos = String(texto).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const util = todos.filter((e) =>
    !/idealista|imovirtual|sapo|remax|noreply|no-reply|donotreply|mailer/i.test(e));
  return util[0] || null;
}

function extrairTelefone(texto) {
  const m = String(texto).match(/(?:\+351\s?)?9[1236]\d{7}/);
  if (!m) return null;
  return '351' + m[0].replace(/\D/g, '').slice(-9);
}

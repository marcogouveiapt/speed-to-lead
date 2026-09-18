/**
 * Semeia leads de demonstracao numa instalacao do Speed-to-Lead.
 *
 * Serve para dois momentos:
 *  1. Ensaiar a demo antes do evento
 *  2. Ter o painel com conteudo em palco caso ninguem use o QR code
 *
 * Uso:  node semear-demo.mjs https://a-tua-app.workers.dev
 */

const base = process.argv[2];
if (!base) {
  console.error('Falta o endereco. Ex: node semear-demo.mjs https://a-tua-app.workers.dev');
  process.exit(1);
}

const LEADS = [
  {
    nome: 'Ana Ribeiro', telefone: '913222111', email: 'ana.ribeiro@exemplo.pt',
    imovel_titulo: 'T3 Matosinhos Sul, 142 m2', imovel_ref: 'MTS-2291', portal: 'idealista',
    mensagem: 'Boa tarde. Vi o anuncio e gostava de visitar esta semana se possivel. Temos o credito ja aprovado ate 350 mil e queremos mudar antes do fim do ano, porque o contrato de arrendamento acaba em dezembro.',
  },
  {
    nome: 'Carlos Mendes', telefone: '967554321',
    imovel_titulo: 'T2 Campo de Ourique', imovel_ref: 'LIS-8842', portal: 'imovirtual',
    mensagem: 'Qual e o valor do condominio?',
  },
  {
    nome: 'Sofia Tavares', telefone: '935118877', email: 'sofia.tavares@exemplo.pt',
    imovel_titulo: 'Pedido de avaliacao — moradia em Gaia', portal: 'proprio',
    mensagem: 'Herdei a casa dos meus pais com a minha irma e queremos vender. Sao duas moradias lado a lado na mesma rua. Precisamos de saber quanto valem para dividir a heranca. Estamos com alguma pressa por causa do imposto.',
  },
  {
    nome: 'Miguel Santos', email: 'miguel.santos@exemplo.pt',
    imovel_titulo: 'T4 Cascais, vista mar', imovel_ref: 'CSC-1120', portal: 'idealista',
    mensagem: 'Bom dia, so queria saber o preco. Obrigado.',
  },
  {
    nome: 'Beatriz Lopes', telefone: '918443210', email: 'b.lopes@exemplo.pt',
    imovel_titulo: 'Apartamento para investimento, Porto centro', portal: 'casasapo',
    mensagem: 'Procuro imovel para arrendamento de longa duracao no Porto, ate 250 mil, com rentabilidade acima de 5 por cento. Ja comprei dois este ano atraves de outra agencia. Se tiver algo fora do mercado, tenho interesse. Pago a pronto.',
  },
  {
    nome: 'Rui Fernandes', telefone: '926778899',
    imovel_titulo: 'T1 Braga, zona universitaria', imovel_ref: 'BRG-0455', portal: 'imovirtual',
    mensagem: 'Boa noite, e possivel visitar no sabado de manha? A minha filha entra na universidade em setembro.',
  },
];

let ok = 0;
for (const lead of LEADS) {
  const r = await fetch(base.replace(/\/$/, '') + '/api/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...lead, origem: 'demo' }),
  });
  const dados = await r.json().catch(() => ({}));
  if (r.ok) { ok++; console.log('OK  ', lead.nome, dados.duplicada ? '(duplicada)' : ''); }
  else console.error('FALHA', lead.nome, dados.erro || r.status);
  await new Promise((s) => setTimeout(s, 900)); // espaca para a IA acompanhar
}
console.log(`\n${ok} de ${LEADS.length} leads criadas.`);

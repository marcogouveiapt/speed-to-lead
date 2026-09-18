# Speed-to-Lead

**Responde a cada lead em minutos. Organiza a equipa. Custa perto de zero.**

Uma aplicação para consultores imobiliários que recebe as leads dos portais,
usa inteligência artificial para as ordenar por urgência e escrever a primeira
mensagem, e deixa **sempre** a decisão e o envio nas suas mãos.

Construída por [Marco Gouveia](https://marcogouveia.pt) para o RE/MAX Golden Club,
setembro de 2026. **Gratuita. É sua. Não há versão paga.**

---

## O que faz

- **Recebe leads** do Idealista, Casa SAPO, Imovirtual, RE/MAX, Meta Lead Ads,
  Google Ads e do formulário do seu site
- **Ordena por urgência de contacto**, A, B ou C, com os sinais que justificam
- **Escreve a mensagem de primeiro contacto** em português de Portugal,
  a falar do imóvel concreto
- **Abre o WhatsApp com a mensagem pronta**, você lê, ajusta e envia
- **Cronómetro por lead** desde o segundo em que entrou
- **Cadência de 6 toques** agendada automaticamente
- **Ranking da equipa** por tempo médio de primeira resposta

### Duas regras que nunca mudam

1. **A inteligência artificial ordena, nunca descarta.** Nenhuma lead é
   arquivada por causa de um score. A máquina sugere a ordem; você decide.
2. **A aplicação nunca envia nada sozinha.** Prepara a mensagem e abre o
   WhatsApp. Quem carrega em enviar é sempre uma pessoa.

---

## Instalação · cerca de 10 minutos, sem programação

Não precisa de instalar nada no computador. Não precisa de terminal.
Precisa de **duas contas gratuitas**.

### Passo 1 · Criar conta na Cloudflare (2 min)

Vá a [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
É gratuita e **não pede cartão de crédito**.

### Passo 2 · Instalar a aplicação (3 min)

Carregue no botão:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/marcogouveiapt/remax)

Vai pedir-lhe autorização para criar uma cópia do projeto na sua conta e
depois cria sozinho tudo o que é preciso, base de dados incluída.
**Aceite os nomes que sugere** e carregue em criar.

No fim aparece um endereço terminado em `.workers.dev`. **Esse endereço é a sua
aplicação.** Guarde-o nos favoritos do telemóvel.

### Passo 3 · Criar a sua conta na aplicação (1 min)

Abra o endereço. Preencha nome, email, telemóvel e um PIN.
O telemóvel é importante: é o que gera os links de WhatsApp.

### Passo 4 · Ligar a inteligência artificial (2 min)

1. Vá a [console.anthropic.com](https://console.anthropic.com) e crie conta
2. **Settings → API keys → Create Key**
3. Copie a chave **nesse momento**, só é mostrada uma vez
4. Em **Plans & Billing**, adicione saldo. 5 € chegam para milhares de leads
5. Na aplicação: **Definições** → cole a chave → **Guardar**

A chave fica guardada na sua base de dados. **Nunca sai da sua instalação.**

> **Sem chave a aplicação continua a funcionar**, as leads entram e ficam
> gravadas. Só não são qualificadas nem têm mensagem escrita.

### Passo 5 · Fazer chegar as leads dos portais (5 min)

As leads do Idealista, Casa SAPO, Imovirtual e RE/MAX chegam-lhe por email.
Este passo faz com que entrem sozinhas na aplicação.

1. Vá a [script.google.com](https://script.google.com) e crie um projeto novo
2. Apague o que lá estiver e cole o conteúdo do ficheiro **`gmail-para-app.gs`**
   deste repositório
3. Na linha `ENDERECO_DA_APP`, ponha o endereço da sua aplicação
4. Menu **Executar** → escolha **instalar** → autorize quando pedir
5. Pronto. De 5 em 5 minutos, as leads novas entram sozinhas

O script só lê emails dos portais, marca-os com uma etiqueta depois de enviar,
e nunca envia o mesmo duas vezes. **Não precisa de domínio próprio nem de mexer
em DNS.**

> **Se o seu domínio estiver alojado na Cloudflare**, existe um caminho
> alternativo mais direto: ativar o Email Routing e encaminhar para o Worker.
> Exige ter o domínio lá, o que a maioria não tem. O script do Gmail funciona
> para toda a gente.

### Passo 6 (opcional) · Outras origens

Em **Definições** encontra um endereço para onde qualquer sistema pode enviar
leads, Meta Lead Ads, Google Ads, o formulário do seu site, Make, n8n ou Zapier:

```
POST https://a-sua-app.workers.dev/api/leads
Content-Type: application/json

{
  "nome": "Ana Ribeiro",
  "telefone": "912345678",
  "email": "ana@exemplo.pt",
  "mensagem": "Procuro T3 em Matosinhos até 350.000 €",
  "imovel_titulo": "T3 Matosinhos Sul",
  "imovel_ref": "REF-2291"
}
```

É preciso pelo menos um **email** ou um **telefone**.

### Formulário para o seu site

A aplicação traz um formulário pronto em `/captar`.
Pode personalizá-lo pelo endereço:

```
https://a-sua-app.workers.dev/captar?titulo=Avaliação grátis da sua casa&ref=CAMP-01
```

---

## Quanto custa por mês

| | Leads/mês | Custo real |
|---|---|---|
| Um consultor | 50 | **menos de 1 €** |
| Equipa de 5 | 300 | **cerca de 6 €** |
| Agência de 30 | 2.000 | **cerca de 56 €** |

A Cloudflare é gratuita nestes volumes. O único custo é a inteligência
artificial, e paga-se ao consumo.

Para gastar ainda menos, mude o modelo em **Definições** para
**Claude Haiku 4.5**, é cerca de cinco vezes mais barato.

---

## Se alguma coisa não funcionar

Abra o separador **Estado do sistema**. Verde significa a funcionar, âmbar
significa por configurar, vermelho significa a falhar.

**Problemas mais comuns:**

| Sintoma | Causa provável |
|---|---|
| Leads entram sem letra A/B/C | Sem chave de API, ou sem saldo na Anthropic |
| Não chega nenhuma lead por email | O script do Gmail não foi instalado, ou o endereço da app está errado nele |
| Não aparece botão de WhatsApp | A lead não trazia telemóvel |
| Leads de um portal ficam sem nome | O portal mudou o formato do email · abra a lead e carregue em *Voltar a qualificar* |

Os emails originais ficam sempre guardados. **Nenhuma lead se perde**, mesmo
quando a leitura automática falha.

---

## Proteção de dados (RGPD)

Esta aplicação guarda dados pessoais de clientes. Antes de a usar a sério:

- Os dados ficam **na sua conta Cloudflare**, não numa empresa terceira
- O formulário de captação já inclui o pedido de consentimento
- Informe os titulares de que trata os dados e durante quanto tempo
- Apague leads que já não precise
- Se tiver equipa, dê acesso apenas a quem precisa

A aplicação **não toma decisões automáticas sobre pessoas**, ordena uma lista
e sugere texto. A decisão é sempre humana. Isto foi deliberado, e é o que a
mantém confortável face ao artigo 22.º do RGPD.

---

## Para quem percebe de código

Cloudflare Workers + D1 (SQLite) + assets estáticos. Sem framework,
sem passo de build na interface.

```bash
npm install
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

| Ficheiro | Função |
|---|---|
| `src/index.js` | Router HTTP e handler de email |
| `src/leads.js` | Ciclo de vida das leads, deduplicação, cadência |
| `src/ai.js` | Qualificação com Claude (structured output) |
| `src/parsers.js` | Adaptadores por portal + normalização de telefones |
| `src/utils.js` | Sessões, definições, links de WhatsApp |
| `src/esquema.js` | Cria o esquema ao primeiro arranque |
| `gmail-para-app.gs` | Script do Gmail que envia as leads dos portais |

Os adaptadores em `parsers.js` estão desenhados em duas camadas: regex por
portal, com recurso ao modelo quando o regex falha. O email original vai
sempre para a tabela `emails_brutos` na D1, para reprocessamento quando um
portal muda o template. Nada de R2: exige subscrição paga e esta aplicação
tem de correr numa conta gratuita sem cartão.

O handler `email()` em `src/index.js` existe para quem tenha o domínio na
Cloudflare e queira usar o Email Routing. Para todos os outros, a entrada de
email faz-se pelo script `gmail-para-app.gs`, que usa o mesmo
`POST /api/leads` de qualquer outra origem.

**Contribuições bem-vindas**, sobretudo adaptadores para portais novos.

---

## Licença

MIT. Faça o que quiser com isto.

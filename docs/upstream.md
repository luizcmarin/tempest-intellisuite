# Upstream — issues e PRs para o Tempest

> Fila de tudo que queremos **do** framework: recurso que nos falta, bug que encontramos, melhoria
> que percebemos. Um item aqui é candidato a issue ou PR em
> [`tempestphp/tempest-framework`](https://github.com/tempestphp/tempest-framework).
>
> **Como usar:** qualquer um de nós (você ou eu) adiciona um item ao perceber a necessidade —
> durante a implementação, lendo o `vendor/`, ou quando um workaround nosso ficar feio demais.
> Todo workaround por limitação do framework **deve** ter um item aqui; se não tem, ou não é
> limitação do framework, ou esquecemos de registrar.

## Legenda

`aberto` proposto, ainda não submetido · `submetido` issue/PR no ar · `aceito` mergeado ·
`recusado` fechado sem merge (registrar o motivo — vira decisão de arquitetura nossa) ·
`contornado` resolvemos do nosso lado e desistimos do upstream

---

## U-001 — `routes --json` não serializa o handler

**Status:** `aberto` · **Tipo:** bug/melhoria · **Prioridade:** alta · **Bloqueia:** Fase 2
(Route Map)

`./tempest routes --json` devolve `"handler": {}` — objeto vazio. A saída *tabular* do mesmo comando
mostra o handler corretamente (`App\HomeController::__invoke()`), então a informação existe e só não
sobrevive à serialização.

```json
{"/:GET":{"isDynamic":false,"uri":"/","method":"GET","parameters":[],
          "optionalParameters":[],"middleware":[],"handler":{},"without":[]}}
```

**Por que importa:** sem a classe/método do handler não dá para oferecer "clique na rota → abre o
arquivo", que é o principal valor de um mapa de rotas em IDE. Qualquer ferramenta que consuma esse
JSON tem o mesmo problema — não é uma necessidade só nossa.

**Proposta:** serializar o handler como `{"class": "App\\HomeController", "method": "__invoke"}`.
Se houver motivo para o objeto vazio (closure, serialização intencional), um par de campos planos
`handlerClass`/`handlerMethod` já resolve.

**Nosso workaround enquanto isso:** cruzar o JSON com a saída tabular e parsear o handler do texto —
o único parse de ANSI do projeto (§3.2.1 do planejamento). **Se este item for aceito, apagamos esse
parser.**

---

## U-002 — `--json` em `container:show`, `config:show` e `discovery:status`

**Status:** `aberto` · **Tipo:** recurso · **Prioridade:** **média** (era alta) · **Afeta:** Fase 6
(IntelliSense ciente do projeto)

> 📉 **Prioridade rebaixada em 18/07/2026, durante a Fase 3.** Descobrimos que a saída do
> `config:show` **já é JSON** — só vem com escapes ANSI intercalados. Tirar os escapes produz um
> documento válido (confirmado: 30 configs parseadas). Ou seja, a fonte que mais precisávamos já é
> estruturada de fato, ainda que não por contrato.
>
> Isso resolveu na prática a resolução dos caminhos de log da Fase 3, sem parse de tabela. Restam
> `container:show` e `discovery:status`, que continuam tabulares de verdade.
>
> A parte do `config:show` no pedido vira então: **assumir o que já acontece** — declarar a flag
> `--json` (hoje o JSON sai com cor mesmo quando redirecionado, o que é acidental e pode regredir a
> qualquer commit sem ninguém perceber que era contrato de alguém).

`about` e `routes` já têm `--json`. Esses três não têm — saída com escapes ANSI e preenchimento por
pontinhos, que é formato de **apresentação**, não de dados (quebra com largura de terminal e com
mudança de layout).

**Por que importa:** são as fontes que descrevem o que o framework realmente montou — serviços do
container, config resolvida, estado do discovery. É o que qualquer integração de IDE precisa para
sugerir os serviços *do projeto* em vez de uma lista fixa.

**Proposta:** seguir o precedente de `about --json` — mesma flag, mesmo formato. Provavelmente
mudança pequena, e nos oferecemos para fazer o PR.

**Bônus para `about --json`:** hoje todo valor vem como array de string
(`"tempest_version": ["3.16.2"]`), que é resquício do formato de renderização. Valor escalar seria
mais natural — mas **é breaking change** para quem já consome; só vale como proposta separada e de
prioridade baixa.

---

## U-003 — Gancho de ciclo de vida de request

**Status:** `aberto` · **Tipo:** recurso · **Prioridade:** média · **Afeta:** Fase 5 (timeline do
Lens)

Não existe evento equivalente a `RequestHandled`/`ResponseSent` (busca em `http/src` e `router/src`
não encontrou). Para medir tempo/memória de uma request é preciso instalar um middleware no projeto.

**Por que importa:** `QueryExecuted` já é um ótimo precedente — evento rico, com `durationMs` e
`failed`, que permite observabilidade sem acoplamento. Um evento análogo para request fecharia a
lacuna e serviria a qualquer profiler ou APM, não só a nós.

**Proposta:** evento com rota casada, status, duração e pico de memória.

**Nosso workaround:** middleware opt-in oferecido pelo Forge (§3.3 do planejamento). Funciona, mas
faz o usuário colocar código nosso no projeto dele — exatamente o que o princípio P1 tenta evitar.

---

## U-004 — `tail:debug` apaga o log ao iniciar

**Status:** `aberto` · **Tipo:** discussão · **Prioridade:** baixa

`TailDebugCommand` tem `bool $clear = true`, então o default de tailar o debug log é **destruí-lo**
antes de começar a ler.

**Por que importa:** para um tail interativo faz sentido (tela limpa). Para qualquer ferramenta que
observe o arquivo, o default surpreende — e um usuário que rode `tail:debug` perde o histórico que a
nossa extensão estava exibindo.

**Proposta:** só levantar a questão do default. Pode muito bem ser intencional; se for, documentar
o efeito destrutivo na ajuda do comando já ajuda.

**Nosso workaround:** nunca chamamos `tail:debug` — lemos `.tempest/logs/debug.log` direto.

---

## U-005 — O console resolve o autoloader por `getcwd()`

**Status:** `aberto` · **Tipo:** discussão · **Prioridade:** baixa

O executável `tempest` faz `require_once getcwd() . '/vendor/autoload.php'` — o autoloader vem do
diretório de trabalho, não do diretório do próprio script.

**Por que importa:** `php /caminho/para/projeto/tempest about` a partir de qualquer outro diretório
falha. O modo silencioso é pior: num monorepo cujo diretório-pai também tem `vendor/` (o nosso tem),
ele carrega um autoloader **real, porém alheio**, e morre com `Class "Tempest\Console\ConsoleApplication"
not found` — mensagem que não sugere em nada que a causa é o cwd.

**Proposta:** resolver a partir de `__DIR__`, com fallback para `getcwd()`. Um `__DIR__ . '/vendor/autoload.php'`
cobre o layout padrão sem quebrar nada.

**Nosso workaround:** o `CliRunner` roda com `cwd` no diretório do console, não na pasta do
workspace (`consoleDirectory()` em `src/core/cli.ts`).

---

## Ideias não maduras

Coisas percebidas mas ainda sem caso de uso forte o bastante para virar issue. Promover quando doer
de verdade.

- **Schema JSON publicado para o `commands.json`.** Ele já é versionado (`"version": 1`), o que é
  ótimo. Um schema formal daria a consumidores externos uma garantia de contrato.
- **Argumentos posicionais no `commands.json`.** Hoje só descreve flags — o Forge/Runner não sabe
  os argumentos posicionais de um comando.
- **Classe implementadora no `commands.json`.** Permitiria "clique no comando → abre o arquivo",
  como U-001 faz para rotas.

---

## Antes de submeter qualquer item

- [ ] Reproduzir na **versão mais recente** do framework (o achado é da v3.16.2 — a doc pública
      descreve a 3.0, então checar sempre contra o código, não contra a doc).
- [ ] Procurar issue existente antes de abrir.
- [ ] Reprodução mínima + saída real observada.
- [ ] Oferecer o PR quando a mudança for pequena — proposta com patch anda mais rápido.
- [ ] Atualizar o status aqui **e** a mitigação correspondente no
      [PLANEJAMENTO.md](PLANEJAMENTO.md) quando houver resposta.

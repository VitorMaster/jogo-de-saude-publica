# Saúde Sim — contexto do projeto (leia antes de mexer)

Este repositório é a casa definitiva do jogo. O repositório antigo (`assistente-saude-idosos`) não recebe mais atualizações.
Todo o trabalho novo acontece aqui, na branch `main`, salvo instrução em contrário do dono (Vitor, estudante de medicina; fala português do Brasil — responda sempre em português).

## Visão do produto
Jogo mobile-first para o **público geral** (não só idosos), estilo The Sims (com a dinâmica de progressão de Clash of Clans), que ensina cuidado com a saúde de forma implícita.
- O jogador escolhe **um único personagem** e só joga com ele: um **paciente** (qualquer idade, fisiologia "surpresa", doenças comuns e curáveis que evoluem com hábitos e cuidado) ou um **profissional** (ACS, técnico de enfermagem, enfermeiro, médico). Os demais agem sozinhos (NPCs autônomos). Nunca dar acesso aos outros personagens.
- Cenários com desafios diferentes: metrópole, cidade do interior, zona rural.
- Jogabilidade tipo Sims: personagens caminham, têm necessidades e rotinas; as ações combinam com a imagem (sentar de frente para a TV, ler na poltrona, cozinhar e comer à mesa, dormir na cama, caminhada de verdade).
- Tempo mais lento das 7h às 17h, com opção de acelerar.
- **Menu por ações** ("🎬 Fazer algo…"): o jogador indica a ação e o jogo escolhe móvel e rota, para reduzir falhas de comando.
- Conteúdo clínico baseado na literatura; todos os parâmetros são marcados **"a validar com consultoria clínica"** (`data/*.json`).
- Foco em ajudar pessoas; monetização futura sem vender dados de saúde, sem anúncios de remédio/plano e sem mecânicas viciantes (ideias: licenças para escolas/prefeituras, premium cosmético/conteúdo, editais, parcerias éticas).

## Preferências do usuário (histórico de feedback)
- Gráficos precisam ser bons: já reclamou várias vezes ("muito longe de aceitável"); cenário aberto e acabamento importam muito.
- Ações dos personagens devem corresponder ao que se vê; móveis necessários devem existir (cama, poltrona, estante, TV…).
- Teste fácil: link de Artifact abrindo no iPhone, dentro do app Claude.
- Já houve tela em branco no iPhone (v0.3 e v0.5). Por isso: faixa de diagnóstico na abertura, tela de erro, evitar sintaxe nova (`||=`), página pequena e **plano B em 2D**.

## Arquitetura
- JS puro em módulos ES + JSON; **sem dependências de runtime** além do Three.js r128 (`vendor/three.min.js`, MIT).
- `src/rng.js` (aleatório determinístico), `src/engine.js` (motor de saúde: estágios das condições has/dm/dep, dengue sazonal, tick mensal, adesão), `src/mundo.js` (mundo em tempo real: mapa em tiles, BFS, necessidades, rotinas, filas da UBS, equipe e NPCs, controle do jogador, `acoesPaciente`, `comandar`), `src/render.js` (3D com Three.js: malhas fundidas, câmera orbital, luz/sombra, personagens articulados, sobreposições DOM), `src/render2d.js` (plano B em canvas 2D), `src/main.js` (interface, loop, folhas/menus, `window.__jogo` para depuração).
- Dados: `data/game.json`, `data/conditions.json`, `data/cenarios.json` (modelos de edifícios, objetos, três cenários, papéis).
- Regras de jogo ficam em `engine`/`mundo`/JSON; **nenhuma regra mora em `render*.js`**.
- Salvamento: `localStorage` (`saude-sim-save-v3`); preferência de gráficos em `saude-sim-3d` (`ok` | `travou`).
- Seleção do renderizador em `main.js` (`criarRendererSeguro`): 3D se `THREE` existe e não travou antes; senão 2D.

## Build e publicação
- `npm test` — testes (node:test, 48 passam). Rode antes de commitar.
- `npm start` — servidor local.
- `node scripts/build-single.mjs [saida.html] [--inline]` — gera a página única. Por padrão o Three.js vem do cdnjs (`three.js/r128`), mantendo a página em ~300 KB; `--inline` embute o arquivo local (~850 KB).
  - Nomes de topo precisam ser únicos entre módulos concatenados (o build valida com `new Function`); `render2d.js` é embrulhado em IIFE para isolar nomes.
- Publicação: Artifact `https://claude.ai/artifact/CoGPx41maRiqTh7oticcp6` (mesmo URL a cada atualização): gerar o build, copiar para o diretório temporário da sessão e republicar com a ferramenta Artifact usando o mesmo caminho de arquivo.
- Teste visual: Playwright/Chromium com `--use-gl=swiftshader`; roteie o cdnjs para `vendor/three.min.js` (o cdnjs é bloqueado no ambiente de sessão). Cubra 3D, CDN indisponível (2D) e `saude-sim-3d=travou` (2D).

## Estado atual (v0.5+)
Entregue: 3D com luz e sombras, câmera giratória, móveis (estante, poltrona, plantas, fonte), ler/caminhada de verdade, menu por ações, atrações por cenário, profissionais com ações próprias, plano B 2D, 37 testes.
Aberto / ideias: confirmar abertura no iPhone do usuário; casas maiores com mais cômodos; mais roupas e cabelos; transições de sentar/levantar mais suaves; sons; mais doenças e histórias (gestação, puericultura, vacinação, saúde mental); papel de gestor; eventos do mundo; validação clínica com colegas; painel do professor e piloto com escola/UBS (ver monetização).

## Vida da equipe e demanda por localidade (v0.7)
- Cada cenário tem em `data/cenarios.json › mundo`: `procura` (fração de moradores que busca a unidade por dia útil: metrópole 0.8 > interior 0.4 > rural 0.18), `medicoDias` (5 / 4 / 2 dias), `afazeres` (nº de afazeres por papel/dia) e `campo` (peso das tarefas de visita domiciliar por papel). Queixas leves (`meta.leve`) geram atendimento sem diagnóstico novo; só quem tem doença não diagnosticada passa pelo motor clínico.
- **Afazeres do dia** (`AFAZERES` em `mundo.js`): agenda diária por profissional (`W.agenda`, não salva). NPCs executam sozinhos quando não há fila; o jogador escolhe em 🎬 Ações → "Afazeres do dia". Todos os dias úteis todo papel tem trabalho; o médico fica na unidade mesmo nos dias sem consultório (visitas domiciliares, receitas, estoque, reuniões). Efeitos reais: estoque (+insumos), receitas (vínculo), roda de conversa, aferição na sala de espera, visitas médicas/de enfermagem, busca ativa.
- **Trocar de personagem** sem reiniciar a história: botão 👥 no mapa e em Sobre (`trocarPersonagem` em `mundo.js`). Tocar num profissional mostra o que ele faz ("Ver o que está fazendo").

## Teste com amigos (v0.6)
- **Confidencialidade (pedido do dono):** testadores só acessam a versão protegida (`scripts/build-protegido.mjs` → `dist-teste/`, jogo criptografado AES-GCM, código pessoal com validade, marca d'água com o ID). **Nunca** ativar GitHub Pages neste repositório, nunca commitar `testers.local.json`/`dist-teste/`, manter o repositório privado. Detalhes e limites em `docs/TESTE-PROTEGIDO.md`.
- PWA do app completo (`sw.js` + `manifest.webmanifest`) é só para desenvolvimento local; subir `VERSAO` ao mudar arquivos.
- Imports com alias (`import { a as b }`) quebram o build de página única (o script remove imports): exporte com o nome final.
- Aba **💬 Feedback** (`src/feedback.js` + `viewFeedback` em `main.js`): perguntas fixas, rascunho em `localStorage` (`saude-sim-feedback-v1`), envio via Google Forms se `data/game.json › feedback` estiver preenchido; senão compartilhar/copiar. Nenhum dado de saúde é enviado, só respostas e informações técnicas.

## Convenções
- Commits em português, descritivos. Não criar PR sem pedido. Não incluir identificador de modelo em arquivos do repositório.
- Não inventar fontes clínicas; manter o aviso "Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento…".
- Dados do jogador ficam no aparelho (LGPD); não coletar dados de saúde reais.

# Saúde Sim

Simulador de saúde para o **público geral**, jogável no **celular**. Você escolhe **um personagem** — uma pessoa do bairro
(paciente) ou um profissional da unidade de saúde — e vive o que ele viver. Os outros moradores e profissionais agem sozinhos.

> Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.

## Como rodar

```bash
npm start        # http://localhost:8080  (abra no celular na mesma rede)
npm test         # testes do motor e do mundo
node scripts/build-single.mjs saida.html   # gera uma página única autocontida
```

Sem dependências: HTML + CSS + JavaScript (módulos ES) e dados em JSON.
`dist/saude-sim.html` é o jogo inteiro em um único arquivo (abre direto no navegador, sem servidor).
Se o jogo não abrir, uma tela de erro oferece recarregar ou apagar o progresso salvo.

## Como se joga (v0.5)

1. **Escolha o cenário**: 🏙️ metrópole, 🏘️ cidade do interior ou 🌾 zona rural (distâncias, médico poucos dias, poucos insumos…).
2. **Escolha quem você será** — e fique só com ele:
   - **Paciente**: qualquer morador. Você vê as necessidades (fome, energia, higiene, disposição, humor), dá ordens tocando em móveis e no chão
     (cama, sofá com TV, fogão, mesa, chuveiro, praça, academia, trabalho, escola, unidade de saúde) e decide se vai ao posto, se toma o remédio, se se cuida.
     Há **vontade própria** (ele segue a rotina quando você não manda nada). As doenças são surpresa: algumas dão sintomas, outras (pressão alta) são silenciosas.
   - **Agente comunitário**: percorre o território, afere pressão/glicemia, orienta hábitos, convida para a unidade, visita famílias e faz mutirões contra focos de dengue.
   - **Técnico de enfermagem**: faz a triagem e encaminha (enfermagem, médico ou liberar).
   - **Enfermeiro(a)**: consulta de enfermagem (rastreio e orientação de hábitos).
   - **Médico(a)**: consulta, diagnóstico e decisão de tratamento; atende só nos dias de médico do cenário.
3. **Tempo**: devagar no expediente (7h–17h), mais rápido à noite; ⏸ 1× 3× 8×, "☀ dia" e "📅 mês". A cada 30 dias, relatório do mês.

## O que a simulação faz

- **Mundo 3D** (Three.js) em forma de maquete/ilha, com luz e sombras reais, céu, mar, nuvens e aves: casas com cômodos (quarto, banheiro, cozinha, sala com TV de frente para o sofá, estante de livros e poltrona, mesa de jantar), UBS com
  recepção, triagem, consultórios e farmácia, escola, escritórios/comércio, lanchonete, praça com fonte, roça, ruas com postes e sebes. Cada cenário tem atrações próprias
  (arranha-céus na metrópole; igreja, caixa-d'água e lago no interior; celeiro, silo, moinho girando, pasto com vacas e lago com patos na zona rural).
  Dia e noite com janelas acesas. A câmera **gira** (dois dedos ou botões ⟳ ⟲) e as paredes do lado da câmera ficam baixas para você ver o interior (🧱 abaixa todas).
- **Ações com correspondência visual**: dormir (deitado na cama), cozinhar (fogão com vapor) e depois comer **sentado à mesa**, assistir TV (sentado no sofá de frente para a TV acesa),
  **ler** (sentado na poltrona com um livro), banho (chuveiro com água), **caminhada de verdade** (circuito pela praça/quarteirão e volta para casa), trabalhar (sentado ao computador), roça, academia, fumar, esperar na cadeira da unidade.
  Personagens 3D animados (andar, sentar, deitar, cozinhar, comer, digitar, exercitar, capinar). Cada móvel tem ocupação (ninguém senta no colo de ninguém).
- **Menu por ações**: o paciente toca em **🎬 Fazer algo…** e escolhe uma ação da lista (o jogo escolhe o móvel e o caminho); também pode tocar nos móveis. Os profissionais têm listas próprias.
- **Hábitos reais**: o que cada pessoa faz no dia a dia vira hábito (atividade, alimentação, sono, estresse) e alimenta o risco de hipertensão, diabetes, depressão; dengue como surto sazonal.
- **Fila real na unidade**: demanda espontânea, retornos, convites do agente comunitário; triagem → enfermagem/consulta; tempo de espera; desistências.
- **Profissionais autônomos** (quando não são o seu personagem): agente comunitário que visita famílias por prioridade, técnico, enfermeiro e médico que atendem a fila e iniciam tratamento.

## Onde editar as regras

| Arquivo | Conteúdo |
|---|---|
| `data/cenarios.json` | mapas (modelos de construção e posições), famílias, ocupações, papéis profissionais, parâmetros de cada cenário |
| `data/conditions.json` | doenças: fatores de risco, probabilidades, textos, lições e **fontes (a validar)** |
| `data/game.json` | custos, economia, dengue |

`src/mundo.js` (mundo, rotinas, fila, papéis) e `src/engine.js` (saúde) não usam DOM e são determinísticos por semente; `src/render.js` desenha; `src/main.js` é a interface.

## Créditos

3D: [Three.js](https://threejs.org) r128 (MIT), incluído em `vendor/`.

## Aviso sobre a base científica

Os parâmetros são **plausíveis e calibrados para jogabilidade** (tempo acelerado), não estimativas epidemiológicas validadas.
As fontes em `conditions.json` são pontos de partida e **precisam de revisão por consultoria clínica**. Veja `docs/ROADMAP.md`.

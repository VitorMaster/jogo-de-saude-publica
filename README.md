# Saúde Sim

Simulador de saúde para o **público geral**, jogável no **celular**. Você cuida de uma unidade básica de saúde (UBS)
e de um bairro cheio de gente que **vive a própria rotina** (dorme, trabalha, come, passeia) — como numa vida simulada.
Os hábitos das pessoas e o seu cuidado decidem quem adoece.

> Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.

## Como rodar

```bash
npm start        # http://localhost:8080  (abra no celular na mesma rede)
npm test         # testes do motor e do mundo
node scripts/build-single.mjs saida.html   # gera uma página única autocontida
```

Sem dependências: HTML + CSS + JavaScript (módulos ES) e dados em JSON.

## O que existe na v0.3

- **Visão isométrica** (estilo Sims): casas com paredes recortadas, móveis com volume, ruas, praça, roça, iluminação de dia e noite (janelas acesas) e plumbob na pessoa selecionada. Paredes que escondem alguém ficam translúcidas; o botão 🧱 abaixa todas.
- **Personagens animados**: andam, sentam, deitam, cozinham, comem, digitam, tomam banho, fumam, se exercitam e capinam, com balões de ação e partículas (vapor, água, "zzz").
- **Ritmo de tempo ajustável**: devagar no expediente (7h–17h) e mais rápido à noite; ⏸ 1× 3× 8×, "☀ dia" (pula até as 7h) e "📅 mês".
- **Mundo em tempo real**: moradores caminham, entram em casa, vão ao trabalho, à escola, à praça e à lanchonete. Dia e noite, dias úteis e fins de semana.
- **Necessidades estilo Sims** (fome, energia, higiene, disposição, humor) e rotina autônoma. O comportamento real vira **hábitos** (atividade, alimentação, sono, estresse), que alimentam o risco de doenças.
- **Três cenários** com desafios diferentes:
  - 🏙️ **Metrópole**: alta demanda, estresse, sedentarismo e lanchonetes;
  - 🏘️ **Interior**: praça central, poucos recursos, dengue forte;
  - 🌾 **Zona rural**: longas distâncias, médico só 2 dias por semana, poucos insumos, trabalho na roça.
- **Equipe da UBS em movimento**: agente comunitário (visitas e orientação em casa, mutirões), técnico (triagem) e médico (consulta), com fila, horário de funcionamento e dias de médico.
- **Doenças**: hipertensão, diabetes tipo 2, depressão (silenciosas até a complicação) e dengue como surto sazonal.
- **Recursos**: insumos, verba, vínculo. Melhorias da unidade (mais médicos, mais agentes, farmácia, vigilância).
- Controle de tempo (⏸ 1× 3× 8× e "pular mês"), relatório mensal, diário com lições, indicadores e "liga".
- Salva sozinho no aparelho.

## Onde editar as regras

| Arquivo | Conteúdo |
|---|---|
| `data/cenarios.json` | mapas (por blocos e modelos de construção), famílias e ocupações, parâmetros de cada cenário |
| `data/conditions.json` | doenças: fatores de risco (pesos), probabilidades, textos, lições e **fontes (a validar)** |
| `data/game.json` | custos, economia, dengue, melhorias da unidade |

O mundo (`src/mundo.js`) e o motor de saúde (`src/engine.js`) não têm DOM e são determinísticos por semente; o desenho está em `src/render.js` e a interface em `src/main.js`.

## Aviso sobre a base científica

Os parâmetros são **plausíveis e calibrados para jogabilidade** (tempo acelerado), não estimativas epidemiológicas validadas.
As fontes em `conditions.json` são pontos de partida e **precisam de revisão por consultoria clínica**. Veja `docs/ROADMAP.md`.

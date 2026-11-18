# Saúde Sim

Simulador de saúde para o **público geral**, jogável no **celular** (PWA, funciona offline).
Você cuida de uma unidade básica de saúde (UBS) e das famílias do seu território — gente de todas as
idades — e aprende, jogando, como o cuidado, os hábitos e o acesso mudam a saúde das pessoas.

> Jogo educativo. Não substitui avaliação, diagnóstico ou tratamento por profissionais de saúde.

## Como rodar

```bash
npm start        # http://localhost:8080  (abra no celular na mesma rede)
npm test         # testes do motor de simulação
```

Sem dependências: HTML + CSS + JavaScript (módulos ES) e dados em JSON.
No celular, abra a URL e use "Adicionar à tela inicial".

## O que existe na v0.1

- **Território** com 6 famílias (18 pessoas, de bebês a idosos), com hábitos, genética oculta e vínculo.
- **Doenças silenciosas e surpresa**: hipertensão, diabetes tipo 2 e depressão evoluem de
  risco → doença → complicação conforme hábitos, idade, genética e o seu cuidado. Você só descobre medindo e consultando.
- **Dengue** como surto sazonal: infestação do mosquito, mutirões, vigilância; mais grave em crianças pequenas, idosos e quem tem comorbidades.
- **Recursos limitados** (inspirados em jogos de gestão em tempo real): horas de equipe, insumos, verba, vínculo.
  Faltar remédio, ter pouco vínculo e demorar para agir têm consequências.
- **Melhorias da unidade** com obras que levam meses (uma por vez).
- **Indicadores** e uma "liga" da unidade; bom desempenho rende mais verba.
- **Diário** com "💡 lições" explicando o *porquê* dos eventos.
- Salva sozinho no aparelho.

## Onde editar as regras

Tudo que é regra fica em `data/` — revisável por profissionais de saúde sem programar:

| Arquivo | Conteúdo |
|---|---|
| `data/conditions.json` | doenças: fatores de risco (pesos), probabilidades, textos, lições e **fontes (a validar)** |
| `data/game.json` | custos das ações, economia, dengue, melhorias da unidade |
| `data/territorio.json` | famílias e moradores |

O motor (`src/engine.js`) não tem DOM e é determinístico por semente; a interface está em `src/main.js`.

## Aviso sobre a base científica

Os parâmetros desta versão são **plausíveis e calibrados para jogabilidade** (ritmo acelerado),
não estimativas epidemiológicas validadas. As fontes listadas em `conditions.json` (Cadernos de Atenção Básica,
diretrizes das sociedades, manuais do MS) são pontos de partida e **precisam de revisão por consultoria clínica**
antes de qualquer afirmação científica. Veja `docs/ROADMAP.md`.

# Roadmap e decisões de design

## Visão
Jogo de simulação de saúde para o público geral, mobile-first. Dois modos que compartilham o mesmo mundo:
- **Paciente**: acompanhar uma pessoa/família ao longo da vida (cuidar do outro para aprender a cuidar de si).
- **Profissional**: ACS, técnico de enfermagem, enfermeiro e médico, com dificuldades reais da prática.

Inspiração de mecânica: jogos de gestão com loop curto e retenção (vila, recursos, construtores, clã, ligas),
adaptados para cooperação contra a doença — **nunca PvP contra pacientes**.

| Jogo de estratégia | Saúde Sim |
|---|---|
| Vila / construções | UBS e território |
| Recursos | horas de equipe, insumos, verba, **vínculo** |
| Construtores | equipe (profissionais) |
| Ataques | surtos (dengue, gripe…) |
| Clã / guerra | rede de saúde / campanhas cooperativas |
| Doar tropas | matriciamento / interconsulta entre jogadores |
| Ligas | qualidade da unidade (indicadores) |

## Princípios
1. Divertido primeiro; o aprendizado vem por consequência, não por pop-up.
2. Realismo seletivo: decisões clínicas e de gestão reais, tempo acelerado.
3. Sessão curta (3–5 min). Sem pay-to-win. Sem "matar" ou "vencer" paciente.
4. Regras em dados (JSON) com fonte citada; revisão por profissionais.
5. Aviso educativo claro; cuidado com temas sensíveis.

## Estado atual (v0.2)
Mundo em tempo real com moradores autônomos, três cenários e equipe da UBS em movimento. Próximos passos de jogabilidade:
- [ ] Modo paciente: controlar diretamente uma pessoa (necessidades, ordens, rotina) em vez da equipe.
- [ ] Modo profissional individual: assumir o agente comunitário, o técnico, o enfermeiro ou o médico.
- [ ] Mais animações (sentar, deitar, cozinhar), sons e sprites ilustrados; interior das casas com mais cômodos.
- [ ] Cenário com mais gente (metrópole maior), transporte público e custo de deslocamento.
- [ ] Eventos do mundo (surto de gripe, enchente, greve, falta de insumo) e clãs/campanhas cooperativas.

## Próximos passos sugeridos
- [ ] Validar parâmetros e textos com consultoria clínica (HAS, DM2, depressão, dengue).
- [ ] Mais condições comuns e tratáveis: asma, anemia, infecções respiratórias, saúde bucal, vacinação, pré-natal, puericultura, quedas.
- [ ] Papéis profissionais com mecânicas próprias (ACS: mapa/visitas; técnico: sinais vitais e medicação; enfermeiro: classificação de risco; médico: raciocínio clínico).
- [ ] Modo paciente: uma pessoa ao longo da vida com rotina e escolhas.
- [ ] Rede/clã: campanhas cooperativas, interconsulta, metas coletivas.
- [ ] Determinantes sociais (renda, território, acesso) afetando risco e adesão.
- [ ] Medir aprendizado (pré/pós-teste) com estudantes e leigos.
- [ ] Fora do escopo da v0.1: óbitos, gestação, outras faixas de risco.

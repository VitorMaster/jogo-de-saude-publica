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

## Estado atual (v0.5)
Um único personagem controlado (paciente ou profissional), três cenários, mundo 3D com ações visíveis, menu por ações e equipe autônoma. Próximos passos:
- [ ] Mais cômodos e móveis (casas com mais ambientes), roupas e cabelos variados, transições de sentar/levantar mais suaves, sons.
- [ ] Mais histórias de paciente: gestação, puericultura, vacinação, asma, anemia, quedas em idosos.
- [ ] Gestor/coordenador da unidade (obras, escalas, insumos) como papel jogável.
- [ ] Eventos do mundo (surto de gripe, enchente, falta de insumo) e campanhas cooperativas.
- [ ] Validação clínica dos parâmetros e textos; teste de aprendizado com estudantes e leigos.

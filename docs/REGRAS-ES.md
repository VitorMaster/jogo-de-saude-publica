# Regras do Espírito Santo usadas no jogo

Fontes **lidas integralmente** (baixadas e conferidas):

1. **SESA-ES — Protocolo de Encaminhamento para Atenção Especializada – Hipertensão e Diabetes** (Rede Estadual de Atenção às Pessoas com Doenças Crônicas, homologado pela CIB/ES, Vitória, julho/2017), que reproduz as **Diretrizes para Manuseio da Hipertensão Arterial Sistêmica e Diabetes Mellitus, 2ª ed. 2016**. Arquivo: <https://saude.es.gov.br/Media/Protocolo/Linha_de_Cuidado_Hipertens%C3%A3o_e_Diabetes%2012_07%20(2)%20(1).pdf>
2. **SESA-ES — Nota Técnica nº 06/2023 NEAPRI/GEPORAS/SSAS/SESA-ES** (17/03/2023): orientações para a gestão dos serviços e assistência a pacientes com suspeita de arboviroses na APS. Arquivo: <https://mosquito.saude.es.gov.br/Media/dengue/COE-ARBOVIROSES/Notastecnicas/NT_006-2023_Recomendações_para_APS_em_ARBOVIROSES.pdf>

## O que o jogo aplica
| Regra (documento) | Onde no jogo |
|---|---|
| Médico: confirmar diagnóstico de HAS/DM, estratificar risco, identificar comorbidades, solicitar exames, decidir tratamento pela estratificação, prescrever, avaliar e encaminhar emergências hipertensivas (Diretrizes, "Participação do médico") | consulta médica; competência `consulta` |
| Enfermeiro: medir PA, investigar fatores de risco, **estratificar o risco**, orientar, **solicitar exames por protocolo**, acompanhar quem está controlado, **encaminhar ao médico pelo menos anualmente** e com maior frequência se não controlado, controlar retornos e faltosos, **delegar ao técnico/auxiliar** (Diretrizes, "Participação do enfermeiro") | consulta de enfermagem: mostra a estratificação (`estratoHAS`), renova receita só se controlado **e** com consulta médica nos últimos 12 meses (`p.medTurno`); senão encaminha ao médico |
| Estratificação de risco do hipertenso: estágios 1–3 por PA × fatores de risco/lesão de órgão-alvo/DM (Quadro 3, VII Diretrizes Brasileiras de Hipertensão 2016); **estágio 3 = PAS ≥180 ou PAD ≥110** | `estratoHAS` (engine); sinal de alerta do técnico para PA ≥180/110 |
| ACS: **rastrear HAS em maiores de 20 anos pelo menos 1×/ano**, encaminhar suspeitos **à consulta de enfermagem**, verificar comparecimento às consultas e uso regular dos medicamentos, buscar faltosos | busca ativa/convite do ACS gera consulta de enfermagem com rastreamento (não triagem direta) |
| Equipe mínima de Saúde da Família: 1 médico, 1 enfermeiro, 1–2 auxiliares de enfermagem e 4–6 ACS; ~800 famílias/4.000 pessoas | o jogo simplifica: população pequena por cenário (diferença assumida) |
| NT 06/2023: acolhimento com **classificação de risco** de suspeitos de arboviroses; **hidratação oral desde a sala de espera**; **notificar** e preencher o **cartão da dengue**; busca ativa e visitas em territórios de alta incidência; articular com Vigilância (mutirões); agendar retorno para reavaliação; fluxo rápido para a referência | afazer `hidratacao` (técnico); notificação na consulta de dengue (`metricas.notificacoes`); busca ativa/visita priorizam famílias com dengue; mutirão contra focos |
| Prevenção de escaras é essencial em pacientes de alto risco (seção AVE) e acompanhamento domiciliar de sequelas de AVC | acamados, cuidadores e `visita_acam` |
| Indicadores sugeridos: cobertura, **% com estratificação de risco atualizada**, % com metas cumpridas, taxa de internação | aba Desempenho |
| Metas de PA (<140/90; <130/85 se risco alto; PAS<140 em idosos) e de DM (HbA1c ~7%; glicemia de jejum <110) | usadas como referência de "controlado"; o jogo não simula exames laboratoriais |

## O que **não** foi encontrado / não é regra do ES no jogo
- Não achei documento da SESA-ES específico de **acolhimento com classificação de risco na APS** nem a **Carteira de Serviços da APS** do estado; busquei apenas na web aberta. Um **protocolo de enfermagem do COREN-ES** também não apareceu. Se você tiver esses arquivos, envie que eu confiro.
- As Diretrizes de HAS/DM têm seção de participação do médico, enfermeiro, ACS (e nutricionista, psicólogo, assistente social, educador físico, farmacêutico e administrativo), mas **não descrevem atribuições do técnico/auxiliar de enfermagem** além da delegação pelo enfermeiro; as do técnico no jogo seguem a PNAB.
- Os limiares de **glicemia** do sinal de alerta (<60 ou ≥300 mg/dL) são do jogo (a validar): o documento estadual traz metas, não um limiar de alerta.
- Critérios de encaminhamento à **Unidade Cuidar** (atenção especializada: HAS secundária/resistente, DM com insulina em dose otimizada, DRC TFG<30, DM1) existem no documento, mas ainda não foram modelados (a referência do jogo é UPA/hospital).
- Valores, tempos e probabilidades são do jogo. Documento de 2016/2017 e NT de 2023: podem ter versões mais novas.

# Competências na APS (PNAB) e como o jogo as usa

Base: Política Nacional de Atenção Básica (Portaria GM/MS nº 2.436/2017) e Lei nº 13.595/2018 (agente comunitário de saúde).
**Texto resumido para fins de jogo — a validar com consultoria clínica/jurídica antes de qualquer uso didático formal.** Os parâmetros numéricos (tempos, probabilidades) são do jogo, não da norma.

| Papel | Atribuições usadas no jogo | Onde aparece |
|---|---|---|
| ACS | cadastro e acompanhamento das famílias da microárea; visita domiciliar e busca ativa; orientação (inclusive de cuidadores); aferição de PA e glicemia capilar com capacitação; mobilização comunitária; integra equipe e população. Não faz consulta nem procedimentos privativos. | afazeres `cadastro_acs`, `busca_ativa`, `visita_acam`, `repasse`, `grupo_atividade`; ações sobre pessoas |
| Técnico de enfermagem | procedimentos regulamentados sob supervisão (aferição de sinais vitais/glicemia, curativos, medicação); participa do gerenciamento de insumos (confere estoque e entrega relatório); organiza e esteriliza a sala; **não** classifica risco nem prescreve. | serviço `triagem` (aferição) → entrega ao acolhimento; afazeres `estoque`, `curativos`, `esterilizar`, `registros`; sinal de alerta com prioridade |
| Enfermeiro | acolhimento e classificação de risco; consulta de enfermagem, solicitação de exames e prescrição conforme protocolos (ex.: renovação de receitas de HAS/DM já diagnosticadas); planeja, gerencia e avalia o trabalho de ACS e técnicos (agenda de visitas e mutirões); gerencia insumos (analisa relatório, cobra atualização, solicita reposição); educação em saúde e grupos; visita domiciliar; encaminha à rede. | serviços `acolhimento` e `enfermagem`; pedidos da equipe; afazeres `gestao_estoque`, `supervisao`, `cadastro`, `educacao`, `grupo_atividade` |
| Médico | consulta clínica, diagnóstico, prescrição; visita domiciliar (agendada pela coordenação); encaminha à UPA/hospital e mantém a responsabilização pelo cuidado (contrarreferência); reunião de equipe/educação permanente; propõe ações coletivas. | serviço `consulta`; afazeres `visita_med`, `visita_acam`, `caso`, `propor_mutirao` |

## Fluxo de demanda espontânea no jogo
1. Adulto → **aferição pelo técnico** (PA, glicemia) → entrega à enfermeira (com **prioridade** se houver sinal de alerta: PA ≥ 180/110 ou glicemia < 60 ou ≥ 300).
2. **Acolhimento da enfermeira**: escuta qualificada e **classificação de risco** → liberar com orientação, consulta de enfermagem (protocolos), consulta médica ou referência.
3. Médico e enfermeira **encaminham direto** à UPA/hospital quando o caso extrapola a APS; na alta, a pessoa volta para **acompanhamento pós-procedimento**.
4. O jogador que joga como enfermeira recebe retorno do acerto da classificação; como técnico, sobre comunicar sinais de alerta. Cada competência explica a regra na primeira vez que é praticada (aba Desempenho mostra a cobertura).

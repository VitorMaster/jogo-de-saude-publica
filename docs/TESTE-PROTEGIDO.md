# Versão de teste protegida (só para testadores autorizados)

O que protege e o que **não** protege — sem promessas falsas: em jogo web nenhum método impede 100% print ou cópia.
O que fazemos é tornar o acesso **controlado, rastreável e inútil para quem não tem código**.

## O que a versão protegida faz
- **Jogo criptografado (AES-256-GCM).** Quem abrir o endereço vê só uma tela pedindo código; o código do jogo não está legível em
  lugar nenhum (nem em "ver código-fonte"). Sem código válido não há como ler regras, dados ou lógica.
- **Código pessoal por testador** (`T01-XXXXX-XXXXX`), com **validade** (padrão 45 dias). Código errado/expirado não abre.
- **Marca d'água** discreta com o código do testador em toda tela → qualquer print vazado identifica quem vazou.
- **Feedback identificado** (o relatório da aba Feedback leva o `Testador: T01`).
- Bloqueios de seleção de texto, menu de contexto e "salvar imagem"; página marcada `noindex` (não aparece em buscadores).
- Aviso de confidencialidade na tela de entrada.

## Limites (seja claro com os testadores)
- Print de tela e gravação de tela **não** podem ser bloqueados em navegador/PWA. A marca d'água e o combinado por escrito é que dissuadem.
- Quem tiver um código válido roda o jogo no próprio aparelho; com muito conhecimento técnico poderia tentar extrair o código
  durante o uso. Por isso: poucos testadores, pessoas de confiança, validade curta, e envie um combinado por escrito (NDA simples).
- Repasse de código: cada código é individual; se aparecer uso indevido, o `T..` na marca d'água diz de quem foi. Para revogar,
  gere uma nova versão **sem** aquele testador (o link/código antigo deixa de funcionar nas próximas atualizações; instalações já
  baixadas continuam abrindo até o código expirar).

## Como gerar
```bash
node scripts/build-protegido.mjs --nomes "Ana,Bruno,Carla" --dias 30
```
- Cria `dist-teste/` (pasta pronta para publicar) e `testers.local.json` (nomes + códigos + validade).
- **`testers.local.json` e `dist-teste/` ficam fora do git** (`.gitignore`). Guarde uma cópia do `testers.local.json` em local seguro
  (ele tem os códigos). Sem ele, gere códigos novos.
- Para adicionar um testador, rode de novo com `--nomes` incluindo o novo nome: os existentes mantêm o código.
- A cada nova versão do jogo, gere de novo e republique a pasta.

## Onde hospedar `dist-teste/` (sem expor este repositório)
O conteúdo de `dist-teste/` já é criptografado, então pode ficar em endereço público sem revelar o jogo.
1. **Netlify Drop / Cloudflare Pages** (mais simples): arraste a pasta `dist-teste/`; endereço próprio e https.
2. **Outro repositório do GitHub só para a pasta** (com nome neutro, ex.: `teste-app`) + Pages. Nunca ative o Pages **neste** repositório.

## Regras do repositório do jogo
- Mantenha **este repositório privado** (Settings → General → Danger Zone → Change visibility). Se estiver público, qualquer pessoa vê todo o código.
- **Não** ative o GitHub Pages neste repositório (publicaria o código sem proteção).

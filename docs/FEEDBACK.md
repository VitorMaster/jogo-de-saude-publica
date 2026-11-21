# Testar com amigos e receber feedback

## 1. Publicar como app instalável (GitHub Pages) — uma vez
1. No GitHub: repositório `jogo-de-saude-publica` → **Settings → Pages**.
2. Em **Build and deployment**, escolha *Deploy from a branch*, branch **main**, pasta **/ (root)** → **Save**.
3. Em 1–2 minutos o endereço aparece (algo como `https://vitormaster.github.io/jogo-de-saude-publica/`).

## 2. Como seus amigos instalam
- **iPhone (Safari):** abrir o link → botão Compartilhar → **Adicionar à Tela de Início**.
- **Android (Chrome):** abrir o link → menu ⋮ → **Instalar app** / *Adicionar à tela inicial*.
- Depois da primeira abertura o jogo funciona offline. O progresso fica salvo no aparelho (o app instalado e o navegador guardam saves separados).
- Para forçar a versão mais nova: fechar o app e abrir de novo com internet.

## 3. Receber os feedbacks (Google Forms, grátis)
A aba **💬 Feedback** do jogo funciona sem configuração: o jogador compartilha/copia o texto e manda para você. Para receber tudo
organizado numa planilha:
1. Crie um Google Forms com perguntas curtas (resposta curta ou parágrafo) para: nota, entendeu, graficos, controle, aprendeu,
   jogaria, indicaria, pagaria, gostou, incomodou, ideias, contato e **tecnico** (informações técnicas).
2. No Forms: ⋮ → **Receber link pré-preenchido**, preencha tudo com texto qualquer e copie o link. Nele aparecem os códigos
   `entry.123456789` de cada pergunta.
3. Troque `viewform` por `formResponse` no começo do link: esse é o **formAction**
   (`https://docs.google.com/forms/d/e/ID/formResponse`).
4. Em `data/game.json`, preencha:
```json
"feedback": {
  "formAction": "https://docs.google.com/forms/d/e/ID/formResponse",
  "campos": { "nota": "entry.111", "entendeu": "entry.222", "graficos": "entry.333", "controle": "entry.444",
              "aprendeu": "entry.555", "jogaria": "entry.666", "indicaria": "entry.777", "pagaria": "entry.888",
              "gostou": "entry.999", "incomodou": "entry.101", "ideias": "entry.102", "contato": "entry.103", "tecnico": "entry.104" }
}
```
5. Faça commit e push na `main`: o jogo publicado passa a enviar direto para o seu Forms. Se o aparelho estiver sem internet,
   o jogo oferece copiar/compartilhar o texto como reserva.

## 4. O que ler nos resultados para decidir se segue com o projeto
`jogaria` e `indicaria` (proporção de "Sim"), `nota` e `graficos` (média), `entendeu` (quantos "Não entendi"), `pagaria`
(interesse comercial) e os textos de `incomodou` (problemas que travam o jogo no celular).

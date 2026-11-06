# 🌸 Baile de Primavera — Votação de Rei e Rainha

Site para eleger **1 Rei** e **1 Rainha** do Baile de Primavera. Cada pessoa vota uma única vez
(escolhendo um rei e uma rainha no mesmo voto), os votos ficam salvos em banco de dados e a
organização acompanha a apuração ao vivo num painel protegido por senha.

- **Página de votação:** `/`
- **Painel da organização:** `/admin` (apuração ao vivo, abrir/encerrar votação, códigos, zerar testes)

Os candidatos estão em [`candidates.js`](candidates.js) (11 para Rei, 6 para Rainha).

---

## 🔒 Como funciona o "1 voto por pessoa"

São três camadas, que você liga/desliga no painel `/admin` sem precisar mexer no código:

| Camada | O que faz | Padrão |
|---|---|---|
| **Aparelho (cookie)** | Cada celular/navegador recebe um identificador. Depois de votar, aquele aparelho não vota de novo. | Sempre ligado |
| **Limite por IP** | Máximo de votos por conexão de internet. | `1` |
| **Código de votação** | Cada aluno recebe um código impresso de uso único (ex.: `K7P2QX`). Sem código válido, não vota. | Desligado |

### ⚠️ Importante sobre o IP

Todos os celulares conectados **no mesmo Wi-Fi** (da escola, de casa, do salão do baile) saem para a
internet com o **mesmo IP**. Com limite = 1, só a primeira pessoa daquela rede consegue votar.
Já no 4G/5G cada operadora também pode agrupar muita gente num IP só.

Recomendações:

- **Votação em casa, pelo celular de cada um:** limite por IP = 1 ou 2 funciona razoavelmente,
  mas alguém pode votar de novo trocando de rede ou limpando os dados do navegador.
- **Votação na escola ou no baile (mesmo Wi-Fi):** ✅ **ligue "Exigir código" e coloque o limite por IP em 0.**
  Gere um código por aluno no painel, imprima (já sai em formato de cartõezinhos para recortar) e
  entregue um para cada pessoa. É o único jeito realmente confiável de garantir 1 voto por pessoa.

O IP nunca é salvo em texto puro — o banco guarda apenas um *hash* dele.

---

## ▶️ Rodar no seu computador

Precisa do [Node.js 22.13 ou mais novo](https://nodejs.org).

```bash
npm install
ADMIN_PASSWORD=minhasenha npm run dev
```

Abra http://localhost:3000 (votação) e http://localhost:3000/admin (painel).
Localmente os votos ficam no arquivo `data/votos.db` (SQLite) — nada para instalar.

> No Windows (PowerShell): `$env:ADMIN_PASSWORD="minhasenha"; $env:TRUST_PROXY="0"; npm start`

---

## 🌐 Colocar no ar (grátis, no Render)

1. Crie uma conta em [render.com](https://render.com) entrando com o GitHub.
2. Clique em **New → Blueprint** e escolha este repositório.
3. O Render lê o arquivo `render.yaml` e cria sozinho o **site** + um **banco PostgreSQL**.
   Ele vai pedir o valor de `ADMIN_PASSWORD`: escolha uma senha forte para o painel.
4. Em alguns minutos o site estará em algo como `https://baile-de-primavera.onrender.com`.
   Mande esse link (ou um QR Code dele) para os alunos.

Observações do plano grátis do Render:
- O site "dorme" após 15 min sem acesso; o primeiro acesso depois disso demora ~1 min. Abra o
  link um pouco antes da votação começar.
- O banco PostgreSQL grátis expira **30 dias** após ser criado — suficiente para o baile, mas crie
  perto da data.

Funciona em qualquer outra hospedagem Node (Railway, Fly.io, VPS...). Basta definir as variáveis
abaixo. **Use PostgreSQL (`DATABASE_URL`)** sempre que o disco da hospedagem não for permanente,
senão os votos somem a cada reinício.

### Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha do painel `/admin`. Sem ela o painel fica desativado. | — |
| `DATABASE_URL` | Conexão PostgreSQL. Se não tiver, usa SQLite em `data/votos.db`. | — |
| `SQLITE_PATH` | Caminho do arquivo SQLite (ex.: num volume persistente). | `data/votos.db` |
| `MAX_VOTES_PER_IP` | Limite inicial por IP (depois muda pelo painel). `0` = sem limite. | `1` |
| `REQUIRE_CODE` | `true` para já começar exigindo código. | `false` |
| `TRUST_PROXY` | Quantos proxies existem na frente do app. `1` em Render/Railway, `0` rodando direto no PC. | `1` |
| `IP_SALT` | Texto secreto usado no hash dos IPs. | fixo |
| `PORT` | Porta do servidor. | `3000` |

No painel aparece "Seu IP detectado pelo servidor" — use para conferir se o `TRUST_PROXY` está
certo (deve mostrar o seu IP real, e não um IP interno tipo `10.x.x.x`).

---

## ✅ Checklist para o dia

1. Entre em `/admin`, faça alguns votos de teste e depois clique em **Zerar todos os votos**.
2. Escolha as regras (código ou não, limite por IP) e clique em **Salvar regras**.
3. Se for usar códigos: gere a quantidade de alunos, clique em **Imprimir não usados**, recorte e distribua.
4. Divulgue o link / QR Code. Acompanhe a apuração ao vivo no painel (atualiza a cada 5 s).
5. Na hora de encerrar, desmarque **Votação aberta** e salve. O ranking final fica no painel. 👑

## 🛠️ Estrutura

```
server.js        servidor Express + API
db.js            banco (SQLite local ou PostgreSQL), regras de voto atômicas
candidates.js    lista de candidatos
public/          páginas (votação e painel)
render.yaml      deploy automático no Render
```

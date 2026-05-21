# Painel Afiliado MultiPlataforma Pro - Original + Login

Esta versão usa o projeto original como base das plataformas e adiciona:

- Registro e login de usuários
- Senhas criptografadas com bcryptjs
- Sessão com cookie HTTP-only
- Configurações separadas por usuário
- Dados salvos em `data/database.json`
- Mantém as funções originais das plataformas do ZIP base

## Instalar

```bash
npm install
npm start
```

Acesse:

```txt
http://localhost:3000
```

## Importante

Não envie para o GitHub:

```txt
.env
node_modules
data/database.json
.ml-auth.json
```

As configurações do painel agora ficam salvas por usuário, não no `.env`.

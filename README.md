# Central Auto Web

Sistema web/PWA de gerenciamento de anúncios de veículos, com login multiusuário, veículos, anúncios, múltiplas contas por usuário, histórico e estrutura para integrações oficiais.

## Rodar localmente

Requer Node.js 20+.

```bash
npm install
npm start
```

Abra `http://localhost:10000`.

O primeiro usuário cadastrado recebe o papel de administrador. Os seguintes recebem usuário comum.

## Deploy no Render

1. Crie um repositório no GitHub e envie todos estes arquivos.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Adicione `JWT_SECRET` como variável secreta (o `render.yaml` pode gerar uma automaticamente).
6. Faça o deploy.

### Banco de dados

A versão inicial usa SQLite. No Render, o filesystem do serviço não deve ser tratado como armazenamento permanente. Para produção, troque a camada de persistência por PostgreSQL e use armazenamento de objetos para fotos. A arquitetura da API já separa a persistência o suficiente para essa evolução.

## Meta/Facebook

Não há senha do Facebook no sistema. Não há captura de cookies nem automação de navegador. A camada de publicação registra a solicitação e informa que a publicação real depende das APIs oficiais e permissões disponibilizadas pela Meta para o caso de uso.

Antes de ativar OAuth real, configure client IDs/segredos no servidor, nunca no frontend. Use variáveis de ambiente e um fluxo OAuth oficial.

## PWA

O app possui `manifest.json` e pode ser instalado pelo navegador quando servido em HTTPS.

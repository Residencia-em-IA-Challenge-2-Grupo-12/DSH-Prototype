# Configuração de modelos

O planejador determinístico e os testes offline não exigem modelo. O DSH usa o perfil isolado `.runtime/dsh`. Nunca copie credenciais para o repositório ou para cenários.

Para instalar a versão 0.9.12 do [plugin de assinaturas solicitado](https://github.com/V1ki/dsh-plugin-subscriptions), pare o DSH e execute `npm run install:codex-plugin`. O comando desativa scripts de instalação. No DSH, acesse **Settings → Subscriptions → Codex (ChatGPT) → Log in** e conclua pessoalmente a autenticação e o consentimento. O plugin é de terceiros, mantém sua própria credencial OAuth no perfil isolado e acessa endpoints Codex do ChatGPT; não é um plugin oficial da OpenAI. Uma execução real com dados sintéticos ainda precisa ser verificada após o login.

O fluxo oficial de [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) e o [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) têm requisitos próprios. O app-server pode adicionar o ciclo de agente do próprio Codex; registre essa diferença em comparações.

O DSH também permite configurar provedores por chave e endpoints auto-hospedados compatíveis. Escolha o modelo explicitamente, registre configuração e uso e envie apenas dados sintéticos. O uso de OpenRouter está adiado até decisão da pessoa usuária.

# Resultados das integrações

Esta investigação não é uma auditoria de segurança. Versões fixadas e observações históricas de plugins se referem ao ambiente testado, não às versões mais recentes. A [prontidão de 17 de novembro](review/onboarding-readiness-2026-11-17.md) distingue as rotas atuais.

| Componente | Resultado | Situação |
| --- | --- | --- |
| DeepSeek Harness 0.2.2-rc.1 | Interface web, perguntas, planos, modelos e MCP; exige Node >=24.9. | Iniciado; protocolo MCP testado; execução autenticada com GPT-6 Luna usou as ferramentas de estudo. |
| Calendarpit 0.9.7 | Simula parte da API do Google, OAuth local, cenários e uma interface administrativa. | A rota descartável atual testa leitura/escrita pela API compatível com Google e OAuth sintético. Administração fica com o orquestrador confiável. O protótipo legado usa administração; não comprova Google real, recorrência ou recuperação completa. |
| [dsh-calendar](https://github.com/STARDUSTLC666/dsh-calendar) | Usa CalDAV; a superfície REST do Calendarpit não é CalDAV. | Código/documentação examinados; não conectado. |
| [dsh-daily-kit](https://github.com/zhouwei713/dsh-daily-kit) | Inclui ferramentas Google e CalDAV; escrita desativada por padrão. | Redirecionamento para Calendarpit não comprovado. |
| [dsh-genui](https://github.com/omdsh-dev/dsh-genui) | Formulários e gráficos para DSH. A versão publicada 0.15.0 foi instalada em perfil isolado com scripts de instalação desativados; houve avisos de dependências. | Não auditado/carregado no perfil principal; o companion leva a demonstração, sem selecionar a interface final (#44). |
| [Plugin de assinaturas](https://github.com/V1ki/dsh-plugin-subscriptions) 0.9.12 | Plugin comunitário com OAuth próprio e rota de modelo Codex. | Instalado em perfil isolado; após login feito pela pessoa, uma requisição sintética com GPT-6 Luna funcionou pelo ciclo do DSH. Não é plugin oficial da OpenAI. |

O modo de plano do DSH é orientação textual, não bloqueio de escrita. O protótipo faz a revisão na interface complementar. As perguntas nativas são úteis para interações, mas não constituem por si só armazenamento durável de feedback.

Antes de usar dados reais, implemente autenticação e isolamento por usuário, controles de rede e credenciais, aprovação no limite real de escrita, transporte seguro e testes de contrato com o Google para recorrência, fusos, convites e permissões.

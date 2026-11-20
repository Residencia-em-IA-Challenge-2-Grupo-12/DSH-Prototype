# Study Atlas — demonstração sintética de planejamento de estudos

[English](README.md) · **Português**

> **Rascunho experimental; ainda não é uma demonstração confiável.** A recuperação de alterações no calendário continua incompleta, inclusive após falha do processo ou resposta atrasada do provedor. Use somente dados sintéticos descartáveis. Veja [o estado da recuperação](docs/recovery-work-in-progress.md) (em inglês). GPT-6 Luna continua sendo a rota padrão. Uma comparação limitada foi autorizada separadamente para `deepseek/deepseek-v4.1-flash-1017` pelo provedor oficial DeepSeek no OpenRouter, com fallback desativado e meta compartilhada aproximada de US$ 5 para configuração, agente e avaliador. Essa rota paga está desativada até que preço, saída de rede e contabilização sejam verificados; ela não é o modelo padrão. Consulte [a configuração de modelos](docs/models.pt-BR.md) para os limites da rota.

Este README descreve o **branch de rascunho executável**. O branch `main` atual é um esqueleto de documentação e não contém o `package.json` executável mostrado aqui. Use o branch de rascunho pretendido antes destes comandos; não presuma que o código já foi integrado a `main`. A entrega atual está acompanhada por [#9 prontidão da base](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/9), [#40 percurso no navegador e pacote bilíngue](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/40) e [#41 revisão de integração sem perda](https://github.com/Residencia-em-IA-Challenge-2-Grupo-12/DSH-Prototype/issues/41). O percurso real operado pelo agente no navegador verificou a escrita somente próxima; outro teste verificou arquivamento pela página. A apresentação bilíngue e o replay real estão prontos para revisão. Avaliação humana completa permanece pendente; não houve vídeo contínuo. Esses gates não autorizam merge nem escolhem uma base de implementação. Veja a [sequência atual de trabalho](docs/project-work-sequence.md) (em inglês).

Rota Luna local no navegador: [inicialização e aprovação explícita](docs/host-luna-preview.md). A rota gerenciada e o fallback no host têm garantias diferentes; veja [a prontidão atual](docs/review/onboarding-readiness-2026-11-17.md).

O Study Atlas explora um assistente colaborativo usando DeepSeek Harness (DSH), dois espaços de trabalho sintéticos e um calendário local Calendarpit. A interface complementar propõe blocos de estudo, permite aprová-los separadamente, registra feedback opcional e apresenta um resumo da rotina.

O planejador de exemplo é determinístico. O DSH pode usar as ferramentas MCP e acrescentar uma interpretação quando um modelo estiver configurado. Nenhuma conta real do Google ou arquivo pessoal é necessária.

## Demonstração atual do grupo

Usar [o pacote/guia de geração bilíngue](docs/onboarding/README.md) e [o checklist autossuficiente](docs/onboarding/facilitator-checklist.md). A demonstração interativa atual fica em `http://127.0.0.1:4176/` no computador do facilitador, com o fallback Luna no host identificado. Ela usa uma execução descartável autoritativa, API compatível com Google e OAuth sintético, além de revisão próxima/futura separada. O [relatório atual](docs/review/onboarding-readiness-2026-11-17.md) registra testes e limites.

## Execução do protótipo legado

O fluxo abaixo na porta 4174 e API administrativa preserva recursos anteriores, como formulários de feedback/relatórios. É outra entrada; não usar seu reset/administração para alterar uma execução gerenciada.


Instale Docker, Docker Compose, Node.js/npm e `pdftotext` (Poppler). O pacote instala um Node 24 local ao projeto para o DSH.

```bash
npm install
docker compose up -d
npm start
```

Abra http://127.0.0.1:4174. A interface complementar escuta em todas as interfaces para permitir acesso pela rede local e não possui autenticação: use apenas em uma rede confiável. O Calendarpit fica restrito ao endereço local http://127.0.0.1:4173.

Em outro terminal, execute `npm run dsh:study`, abra a URL local apresentada, configure um modelo e selecione um espaço sintético em `.runtime/workspaces/`. Reinicie o cenário na interface complementar antes de usar as ferramentas MCP.

Para conversar na aba **Colaborar**, conclua primeiro a autenticação Codex indicada em [modelos](docs/models.pt-BR.md) e instale o plugin também no perfil SDK com `npm run install:codex-plugin:sdk`. Abra `http://localhost:4174` ou `http://127.0.0.1:4174` no computador de desenvolvimento: o controle do modelo não aceita conexões da LAN ou do Tailscale enquanto a prévia não tiver autenticação. GPT-6 Luna é a rota padrão. A rota limitada de comparação com DeepSeek não está habilitada neste caminho executável. As conversas ficam em memória e não são retomadas após reiniciar o servidor.

## Roteiro legado

1. Escolha Ana ou Bruno e reinicie o cenário. Explore os arquivos e leia uma ementa.
2. Crie e revise a proposta. Nenhum evento é alterado antes da aprovação.
3. Aprove a semana próxima; blocos futuros provisórios exigem aprovação separada.
4. Registre feedback opcional e gere o relatório. Altere o calendário sintético no Calendarpit e faça um acompanhamento para revisar diferenças.
5. Na aba Calendário, revise e aprove uma anotação de categoria; o texto original é preservado.

O dia simulado é 02/11/2026, no fuso de São Paulo. Horas agendadas não comprovam realização.

## Verificação legada e limites compartilhados

Execute `npm test` para os testes determinísticos e `npm run test:integration` para testar o Calendarpit em execução. O teste de integração reinicia o calendário sintético de Ana.

O Calendarpit simula apenas parte da API do Google; o protótipo usa sua API administrativa local e não testa autenticação real, convites ou todos os casos de calendário. Os serviços são de demonstração para uma pessoa. A interface MCP não disponibiliza aprovação nem escrita no calendário, mas processos locais ainda podem alcançar a API administrativa: não use esse protótipo com dados reais sem isolamento adicional.

O planejador usa regras simplificadas, datas reconhecíveis nas ementas e categorias heurísticas. Ele não é avaliação de saúde nem comprovação de aprendizagem. O relatório JSON e Markdown fica em `.runtime/`; a interpretação do agente aparece somente após um modelo fornecê-la.

A aba Calendário mostra uma semana navegável com eventos existentes e adições ou remoções pendentes. Ela agrupa eventos pela data de início; ainda não é uma grade proporcional de horas e não expande eventos recorrentes ou de vários dias. Propostas só são aplicadas após aprovação separada no Plano de estudos.

Na aba Colaborar, a conversa e o calendário dividem a tela. O agente pode fazer perguntas e atualizar a proposta, que continua exigindo aprovação separada. As revisões podem preferir manhã, tarde ou noite e evitar datas indicadas dentro das janelas informadas; a preferência pode usar outra janela informada quando necessário e ainda não representa todas as restrições possíveis.

Na primeira semana, Ana tem 20 horas de trabalho e 9 de aulas; Bruno tem 40 horas de trabalho e 9 de aulas, além de janelas de estudo diferentes. Os calendários têm seis semanas de eventos fictícios explícitos e uma exceção na segunda semana. São rotinas ilustrativas, não uma recomendação universal. O planejador usa janelas e intervalos informados: se não houver janelas, informa que a meta não coube em vez de tratar o calendário vazio como disponibilidade. Ainda não altera as janelas recorrentes nem expande recorrências de calendários reais.

Interrompa as interfaces com Ctrl-C e execute `docker compose down` para parar o simulador. Consulte [etapas de implementação](docs/implementation-stages.pt-BR.md), [integrações](docs/integrations.pt-BR.md), [modelos](docs/models.pt-BR.md), [pesquisa](docs/research.pt-BR.md) e [arquitetura](docs/architecture.pt-BR.md).

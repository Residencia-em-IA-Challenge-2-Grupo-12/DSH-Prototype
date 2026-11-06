# Study Atlas — demonstração sintética de planejamento de estudos

[English](README.md) · **Português**

O Study Atlas explora um assistente colaborativo usando DeepSeek Harness (DSH), dois espaços de trabalho sintéticos e um calendário local Calendarpit. A interface complementar propõe blocos de estudo, permite aprová-los separadamente, registra feedback opcional e apresenta um resumo da rotina.

O planejador de exemplo é determinístico. O DSH pode usar as ferramentas MCP e acrescentar uma interpretação quando um modelo estiver configurado. Nenhuma conta real do Google ou arquivo pessoal é necessária.

## Pré-requisitos e execução

Instale Docker, Docker Compose, Node.js/npm e `pdftotext` (Poppler). O pacote instala um Node 24 local ao projeto para o DSH.

```bash
npm install
docker compose up -d
npm start
```

Abra http://127.0.0.1:4174. A interface complementar escuta em todas as interfaces para permitir acesso pela rede local e não possui autenticação: use apenas em uma rede confiável. O Calendarpit fica restrito ao endereço local http://127.0.0.1:4173.

Em outro terminal, execute `npm run dsh:study`, abra a URL local apresentada, configure um modelo e selecione um espaço sintético em `.runtime/workspaces/`. Reinicie o cenário na interface complementar antes de usar as ferramentas MCP.

Para conversar na aba **Colaborar**, conclua primeiro a autenticação Codex indicada em [modelos](docs/models.pt-BR.md) e instale o plugin também no perfil SDK com `npm run install:codex-plugin:sdk`. Abra `http://localhost:4174` ou `http://127.0.0.1:4174` no computador de desenvolvimento: o controle do modelo não aceita conexões da LAN ou do Tailscale enquanto a prévia não tiver autenticação. Apenas GPT-6 Luna está configurado. As conversas ficam em memória e não são retomadas após reiniciar o servidor.

## Roteiro

1. Escolha Ana ou Bruno e reinicie o cenário. Explore os arquivos e leia uma ementa.
2. Crie e revise a proposta. Nenhum evento é alterado antes da aprovação.
3. Aprove a semana próxima; blocos futuros provisórios exigem aprovação separada.
4. Registre feedback opcional e gere o relatório. Altere o calendário sintético no Calendarpit e faça um acompanhamento para revisar diferenças.
5. Na aba Calendário, revise e aprove uma anotação de categoria; o texto original é preservado.

O dia simulado é 02/11/2026, no fuso de São Paulo. Horas agendadas não comprovam realização.

## Verificação e limites

Execute `npm test` para os testes determinísticos e `npm run test:integration` para testar o Calendarpit em execução. O teste de integração reinicia o calendário sintético de Ana.

O Calendarpit simula apenas parte da API do Google; o protótipo usa sua API administrativa local e não testa autenticação real, convites ou todos os casos de calendário. Os serviços são de demonstração para uma pessoa. A interface MCP não disponibiliza aprovação nem escrita no calendário, mas processos locais ainda podem alcançar a API administrativa: não use esse protótipo com dados reais sem isolamento adicional.

O planejador usa regras simplificadas, datas reconhecíveis nas ementas e categorias heurísticas. Ele não é avaliação de saúde nem comprovação de aprendizagem. O relatório JSON e Markdown fica em `.runtime/`; a interpretação do agente aparece somente após um modelo fornecê-la.

A aba Calendário mostra uma semana navegável com eventos existentes e adições ou remoções pendentes. Ela agrupa eventos pela data de início; ainda não é uma grade proporcional de horas e não expande eventos recorrentes ou de vários dias. Propostas só são aplicadas após aprovação separada no Plano de estudos.

Na aba Colaborar, a conversa e o calendário dividem a tela. O agente pode fazer perguntas e atualizar a proposta, que continua exigindo aprovação separada. As revisões podem preferir manhã, tarde ou noite e evitar datas indicadas dentro das janelas informadas; a preferência pode usar outra janela informada quando necessário e ainda não representa todas as restrições possíveis.

Na primeira semana, Ana tem 20 horas de trabalho e 9 de aulas; Bruno tem 40 horas de trabalho e 9 de aulas, além de janelas de estudo diferentes. Os calendários têm seis semanas de eventos fictícios explícitos e uma exceção na segunda semana. São rotinas ilustrativas, não uma recomendação universal. O planejador usa janelas e intervalos informados: se não houver janelas, informa que a meta não coube em vez de tratar o calendário vazio como disponibilidade. Ainda não altera as janelas recorrentes nem expande recorrências de calendários reais.

Interrompa as interfaces com Ctrl-C e execute `docker compose down` para parar o simulador. Consulte [etapas de implementação](docs/implementation-stages.pt-BR.md), [integrações](docs/integrations.pt-BR.md), [modelos](docs/models.pt-BR.md), [pesquisa](docs/research.pt-BR.md) e [arquitetura](docs/architecture.pt-BR.md).

# Arquitetura e cenários

O DSH acessa arquivos e calendário sintéticos por MCP; a interface complementar usa uma API Node local para consultar o Calendarpit e salvar dados em `.runtime/`. A aprovação é feita na interface complementar.

O contrato de feedback é uma lista com `eventId`, `completion`, `actualMinutes`, `effort`, `note` e `recordedAt`. Os cenários e o formulário usam a mesma validação. Tempo agendado, atividade informada e dados ausentes são distintos.

O reset carrega `fixtures/calendars/<student>.json`, copia o espaço de `fixtures/students/<student>/` para uma área mutável isolada e carrega o feedback sintético. O simulador mantém um estudante ativo por vez; uma implementação multiusuário exigirá separação de estado e identidade.

Cada proposta guarda um resumo verificável do calendário. As duas seções são aprovadas separadamente e verificadas antes da aplicação. Eventos do agente alterados pela pessoa são protegidos ao observar a diferença. Falhas parciais registram alterações realizadas e exigem reconciliação manual.

Categorias são heurísticas até confirmação. As descrições preservam o texto original fora de uma seção delimitada. O relatório separa semana anterior e próxima; eventos sobrepostos são somados e podem superestimar tempo ocupado.

O planejador usa blocos de uma hora, dias úteis das 09h às 18h e horizonte limitado pelo pedido, pelo prazo mais próximo e por 16 semanas. É uma regra demonstrativa, não uma otimização personalizada. As datas sintéticas usam o deslocamento fixo de São Paulo.

Para criar cenários, siga a estrutura JSON e de diretórios existente, usando apenas dados fictícios e campos aceitos pelo Calendarpit. Os testes são sequenciais por compartilharem `.runtime`; o teste de integração reinicia o simulador.

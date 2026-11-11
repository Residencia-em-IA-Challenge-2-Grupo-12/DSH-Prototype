# Ambiente experimental do OpenRouter

A chave do OpenRouter fica em um arquivo privado na máquina, fora deste repositório e das execuções descartáveis. O caminho padrão no servidor de desenvolvimento é `~/.config/study-atlas/openrouter.env`:

```dotenv
OPENROUTER_API_KEY=sua-chave-aqui
```

Edite o arquivo localmente; não coloque uma chave real no chat, nos dados fictícios, no Git, nos relatórios ou neste exemplo. Restrinja o diretório (`chmod 700 ~/.config/study-atlas`) e o arquivo (`chmod 600 ~/.config/study-atlas/openrouter.env`). O usuário Docker que executa o gateway precisa ter permissão para ler o arquivo. Para usar outro caminho, defina `STUDY_OPENROUTER_ENV_FILE` com o caminho absoluto antes de iniciar o Compose.

O perfil experimental `model-gateway` monta o arquivo somente para leitura como segredo do Docker Compose, apenas no gateway confiável. Seu conteúdo não é colocado nas variáveis de ambiente do contêiner. A recriação normal do contêiner e `docker compose down` preservam o arquivo e o volume separado de controle de gastos. Recrie o gateway após alterar o arquivo para que ele leia o novo valor. Administradores do Docker e o dono do arquivo ainda podem acessá-lo; isso não protege contra um usuário privilegiado da máquina.

**Limitação atual:** o serviço ainda não está conectado à aplicação nem ao DSH. Sua rede é interna e os preços não estão configurados, portanto ele não pode fazer chamadas reais ao modelo. Esta é uma parte testada de persistência e isolamento, não uma integração OpenRouter funcional. A rota Luna padrão continua igual. Não faça chamadas pagas até concluir a integração DSH, a seleção do provedor oficial, a verificação de preços e o orçamento compartilhado.

O controle local é uma meta aproximada de US$ 5, não um limite aplicado pelo provedor. Ele deve durar toda a comparação: `docker compose down --volumes`, excluir o volume, mudar o nome do projeto Compose ou mover o banco cria um controle novo e perde o histórico local. Recupere ou contabilize os gastos anteriores antes de outra chamada paga. Outros usos da chave, cobranças do provedor e uso informado com atraso podem ultrapassar a estimativa local.

O teste Docker usa uma chave fictícia temporária e remove apenas seu próprio projeto e volumes de teste, com nomes únicos:

```sh
STUDY_DOCKER_TEST=1 ./node_modules/.bin/node --test tests/gateway-docker.integration.mjs
```

# ASTROS — PIX automático e baixa dos números

## Estado: sistema preparado, mas NÃO ativado

GitHub Pages é um site estático. Ele não pode consultar o banco nem validar o PIX sozinho.
Para operar: GitHub Pages (visual), Supabase (API + banco), Mercado Pago (PIX e webhooks).

**Antes de ligar o pagamento real, confirme a autorização aplicável à campanha e se o
intermediador de pagamentos aceita esse tipo de operação.**

## O que foi preparado

- Reserva atômica e exclusiva de 1 a 20 números, impedindo duas reservas simultâneas.
- PIX dinâmico para cada pedido: R$ 2,50 por número.
- Verificação pela API oficial do Mercado Pago, incluindo status aprovado, valor,
  método PIX e referência do pedido antes de qualquer baixa.
- Webhook com assinatura HMAC validada.
- Números pagos ficam como 'sold' no banco; 'reserved' são temporariamente indisponíveis.
- 010 e 024 começam bloqueados.
- Clientes veem disponibilidade compartilhada; pagamentos não são aprovados pelo navegador.

## Etapas para ativação

### 1. Conta recebedora
É necessária conta Mercado Pago com credenciais de API, autorizada pelo
provedor para esta modalidade. Confirme em qual conta o dinheiro cairá.
A chave PIX CNPJ e QR Code fixo antigos NÃO permitem associar PIX a pedidos.
Quando o modo automático estiver ativo, só usar o PIX exclusivo gerado para cada pedido.

### 2. Configurar Supabase
- Crie um projeto em https://supabase.com
- Abra o SQL Editor e execute o arquivo payment-backend/schema.sql.
- Instale e autentique a Supabase CLI.
- Vincule ao projeto: supabase link --project-ref SEU_PROJECT_REF
- Defina variáveis privadas pelo painel Secrets ou por supabase secrets set:
  MERCADO_PAGO_ACCESS_TOKEN=SEU_TOKEN
  MERCADO_PAGO_WEBHOOK_SECRET=SEGREDO_WEBHOOK
  ALLOWED_SITE_ORIGIN=https://flackoclf44.github.io
  PUBLIC_FUNCTION_URL=https://SEU_PROJECT_REF.supabase.co/functions/v1/astros-checkout
- Faça deploy: supabase functions deploy astros-checkout --no-verify-jwt
- SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam existir nos secrets da função;
  normalmente são fornecidas pelo ambiente. NUNCA coloque service_role na página web.

### 3. Configurar Mercado Pago
- Cadastre como webhook HTTPS do evento 'payment':
  https://SEU_PROJECT_REF.supabase.co/functions/v1/astros-checkout/webhook
- Copie o segredo de assinatura webhook para os secrets do Supabase.
- Verifique eventos no modo teste e depois no modo produção.

Documentação:
https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications

### 4. Ativar no GitHub Pages APENAS após testar
Edite checkout-config.js para:
window.ASTROS_CHECKOUT_API = "https://SEU_PROJECT_REF.supabase.co/functions/v1/astros-checkout";

O arquivo começa vazio. Por isso o site atual NÃO passa a confirmar pagamentos
sozinho. Nunca cole credenciais de API, token ou chaves privadas nesse arquivo.

### 5. Testes necessários
- Concorrência: abrir dois navegadores e disputar o mesmo número.
- 010 e 024 devem permanecer bloqueados.
- PIX pendente não pode aparecer como vendido.
- PIX aprovado deve alterar os números reservados para vendidos.
- Webhook repetido não pode causar baixa duplicada.
- PIX encerrado sem pagar só libera os números quando o provedor confirmar.
- Falhas de rede não devem liberar reservas antes de verificar com o provedor.
- Os dados devem continuar consistentes após atualizar a página.

## Cuidados na produção

- Recomenda-se CAPTCHA, limite por IP e monitoramento de pedidos: limitar pelo e-mail
  no SQL é somente uma proteção inicial contra abuso.
- Pagamentos fora do prazo ou que não correspondem à reserva vão para 'review';
  devem ser analisados manualmente, sem vender o mesmo número duas vezes.
- CPF vai diretamente da página para a função e dela para o provedor, sem salvar no banco;
  o e-mail fica em tabela com RLS. Siga as regras de proteção de dados aplicáveis.
- A função verifica o pagamento consultando o Mercado Pago. Não aceite fotos,
  mensagens WhatsApp nem textos do cliente como prova técnica de pagamento.
- A página de sorteio ainda é uma demonstração; para sorteio oficial, use a
  lista de pagamentos aprovados e um procedimento de apuração verificável.
- Preços e tarifas dos serviços dependem do plano/volume.

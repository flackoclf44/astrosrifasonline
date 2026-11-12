# ASTROS — PIX automático com PagBank

## Situação: código preparado, pagamentos reais NÃO ativados

O PagBank será o provedor PIX. O site permanece no GitHub Pages, com o backend
no Supabase (Edge Functions + PostgreSQL). O QR Code fixo antigo não permite
conciliar pagamentos individuais. No modo automático cada pedido gera um QR único.

### Recursos preparados
- Banco com 150 números, incluindo 010 e 024 previamente bloqueados.
- Reserva transacional que impede duas compras simultâneas do mesmo número.
- PIX exclusivo por pedido no PagBank pelo endpoint `POST /orders`, método `PIX`.
- Consulta autenticada do pedido no PagBank (`GET /orders/{order_id}`).
- Só altera reservado para vendido após confirmar uma cobrança `PAID`,
  `payment_method.type=PIX`, BRL, valor correto e referência do pedido.
- Webhooks de status com validação de assinatura; conciliação periódica.
- Se o PIX não foi pago e o provedor confirma o cancelamento, libera o número.
- Se ocorrer divergência, mantém reservado/em análise para evitar venda duplicada.

### Primeiro: aprovação comercial e técnica
Antes de ativar vendas, confirme que a campanha tem a autorização exigida, que
o PagBank permite esse tipo de campanha no contrato da conta recebedora e que
a API Order PIX está habilitada (eventual homologação/allowlist).
Se houver mais de uma chave PIX no PagBank, o PagBank pode escolher uma chave
aleatória ativa. Confira a titularidade da conta antes de oferecer pagamentos.

### 1. Configurar Supabase
1. Crie um projeto em https://supabase.com.
2. Execute `payment-backend/schema.sql` no SQL Editor do projeto.
3. Conecte a Supabase CLI com `supabase login` e
   `supabase link --project-ref SEU_PROJETO`.
4. Defina os secrets da Edge Function no painel do Supabase, nunca no GitHub:
   - `ASTROS_PAYMENTS_ENABLED`: use `false` durante a configuração; somente `true` quando a integração estiver testada e aprovada.
   - `PAGBANK_ACCESS_TOKEN`: token emitido no painel PagBank
   - `PAGBANK_ENV`: `sandbox` para testes, `production` após aprovação
   - `ALLOWED_SITE_ORIGIN`: `https://flackoclf44.github.io`
   - `PUBLIC_FUNCTION_URL`: `https://SEU_PROJETO.supabase.co/functions/v1/astros-checkout`
   - `PAGBANK_WEBHOOK_PUBLIC_KEY`: chave pública X.509 base64 do PagBank para
     validar webhooks `x-payload-signature` (se aplicável ao seu ambiente)
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` quando não forem
     fornecidos automaticamente pelo Supabase.
5. Implante com:
   `supabase functions deploy astros-checkout --no-verify-jwt`

Observação: as rotas públicas exigem medidas adicionais de proteção contra
abusos (rate limit/IP, CAPTCHA, logs e monitoramento) antes de produção.

### 2. Token PagBank
- Sandbox: Portal do Desenvolvedor > Tokens.
- Produção: PagBank no computador > Vendas > Integrações > Gerar Token.
- Tokens são privados. **Não os cole em chats, commits, páginas JS ou HTML.**
- Utilize um token para o ambiente correto; produção não é sandbox.
- Antes de ir ao ar confirme a habilitação real da API na sua conta.

### 3. Webhook PagBank
A função inclui a URL da notificação em cada pedido:
`https://SEU_PROJETO.supabase.co/functions/v1/astros-checkout/webhook`

Webhooks antigos podem enviar `x-authenticity-token`, validado por SHA-256
do token + hífen + corpo original. Os novos podem enviar
`x-payload-signature` com assinatura ECDSA; neste caso configure a chave
pública específica do PagBank. Eventos não autenticados são recusados.
Mesmo com webhook válido, a baixa ocorre somente depois da consulta
autenticada diretamente na API Order do PagBank.

Documentação oficial:
- https://developer.pagbank.com.br/reference/criar-pedido-com-qr-code-pix-v2
- https://developer.pagbank.com.br/reference/consultar-pedido
- https://developer.pagbank.com.br/reference/webhooks
- https://developer.pagbank.com.br/reference/validacao-de-autenticidade
- https://developer.pagbank.com.br/docs/token-de-autenticacao

### 4. Testar e ativar
1. Realize testes sandbox de PIX pendente, pago, negado, expirado,
   webhook repetido e competição simultânea pelo mesmo número.
2. Verifique que 010 e 024 seguem indisponíveis e PIX pendente não baixa números.
3. Confirme que cobranças PagBank são emitidas na conta correta.
4. Verifique autorização, aprovação do provedor, antifraude, privacidade/LGPD.
5. Depois de publicar a função e testar, edite somente `checkout-config.js`:
   `window.ASTROS_CHECKOUT_API = "https://SEU_PROJETO.supabase.co/functions/v1/astros-checkout";`

**Enquanto a URL estiver vazia, o site continua com o checkout anterior,
sem confirmação ou baixa automática. Não ative antes de testar.**

### Limitações / observações
- O frontend de pagamento solicita nome completo, e-mail e CPF do pagador.
  O CPF não deve ser armazenado em dados públicos do GitHub Pages.
- A função não guarda o CPF no banco e só envia dados ao PagBank.
- A interface pública não decide que o PIX foi pago.
- Falhas ou pagamentos fora de prazo devem ser analisados antes de liberar
  a reserva, para evitar números vendidos duas vezes.
- A página `sorteio.html` ainda é demonstrativa e não apura pagamentos reais.
- Verifique taxas/custos da API, do banco e da hospedagem.


### Endpoint de diagnóstico
A função Supabase já está publicada em `https://lrbcyyrczpthkfadngvd.supabase.co/functions/v1/astros-checkout/health`.
A rota informa `ready:false` enquanto o token ou a ativação estiver ausente. A publicação do endpoint **não ativa cobrança**.

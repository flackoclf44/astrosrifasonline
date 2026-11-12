// ASTROS - Supabase Edge Function + Mercado Pago Pix
// Deploy: supabase functions deploy astros-checkout --no-verify-jwt
// Variáveis secretas: MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_WEBHOOK_SECRET,
// ALLOWED_SITE_ORIGIN, PUBLIC_FUNCTION_URL.
// NÃO publicar estas variáveis em arquivos do GitHub Pages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "";
const SITE_ORIGIN = Deno.env.get("ALLOWED_SITE_ORIGIN") ?? "";
const FUNCTION_URL = Deno.env.get("PUBLIC_FUNCTION_URL") ?? "";
const PRICE_CENTS = 250;
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status, headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin || "null",
      "vary": "Origin"
    }
  });
}
function fail(message: string, status=400, origin="") {
  return json({ error: message }, status, origin);
}
async function mp(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + MP_TOKEN);
  headers.set("Accept","application/json");
  const response = await fetch("https://api.mercadopago.com" + path, {
    ...init, headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("MERCADO_PAGO_HTTP_" + response.status);
  return data;
}
function isUuid(s: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
}
function validCpfFormat(s: string) {
  return /^\d{11}$/.test(s);
}
function onlyNumbers(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new Error("Selecione de 1 a 20 números.");
  const numbers = raw.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 150) ||
      new Set(numbers).size !== numbers.length) throw new Error("Seleção de números inválida.");
  return numbers.sort((a,b) => a-b);
}
function getPaymentId(data: unknown): string {
  return String(data ?? "");
}
async function getOrder(id: string) {
  const { data, error } = await db.from("astros_orders")
    .select("id,numbers,amount_cents,status,payment_id,pix_payload,pix_image_base64,reservation_expires_at")
    .eq("id",id).maybeSingle();
  if (error) throw error;
  return data;
}
// Toda baixa é feita após consulta autenticada à API do provedor. Nunca
// confiar em 'aprovado' vindo de um navegador ou diretamente do webhook.
async function verifyAndSync(paymentId: string) {
  if (!/^\d{1,25}$/.test(paymentId)) throw new Error("ID de pagamento inválido.");
  const payment = await mp("/v1/payments/" + paymentId);
  const orderId = String(payment.external_reference || "");
  if (!isUuid(orderId)) throw new Error("Pagamento sem pedido ASTROS associado.");
  const order = await getOrder(orderId);
  if (!order) throw new Error("Pedido associado não encontrado.");
  if (payment.payment_method_id !== "pix" ||
      Math.round(Number(payment.transaction_amount) * 100) !== order.amount_cents ||
      (order.payment_id && String(order.payment_id)!==paymentId)) {
    throw new Error("Pagamento incompatível com a reserva.");
  }
  if (payment.status === "approved") {
    const { data, error } = await db.rpc("astros_approve",{
      p_id:order.id,p_payment_id:paymentId
    });
    if (error) throw error;
    return data;
  }
  if (["cancelled","rejected","refunded","charged_back"].includes(payment.status)) {
    const {error}=await db.rpc("astros_release",{p_id:order.id});
    if(error)throw error;
    return "expired";
  }
  return "pending";
}
// Libera reservas vencidas APENAS se o provedor já encerrou o pagamento.
// A consulta é limitada por requisição, para não sobrecarregar o banco.
async function reconcileExpired() {
  const { data, error } = await db.from("astros_orders")
    .select("id,payment_id,status").in("status",["pending","reserved"])
    .lt("reservation_expires_at",new Date().toISOString())
    .not("payment_id","is",null).limit(4);
  if (error) throw error;
  for (const row of data || []) {
    try { await verifyAndSync(String(row.payment_id)); }
    catch (error) { console.warn("Falha ao conciliar pedido",row.id,String(error)); }
  }
}
function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return new Uint8Array(0);
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h,16)));
}
async function validWebhook(request: Request, dataId: string) {
  if (!WEBHOOK_SECRET) return false;
  const requestId=request.headers.get("x-request-id") || "";
  const signature=request.headers.get("x-signature") || "";
  const ts=signature.match(/(?:^|,)ts=([^,]+)/)?.[1];
  const v1=signature.match(/(?:^|,)v1=([0-9a-f]+)/i)?.[1];
  if (!ts || !v1 || !requestId || !dataId) return false;
  const manifest="id:"+dataId.toLowerCase()+";request-id:"+requestId+";ts:"+ts+";";
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(WEBHOOK_SECRET),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const actual=new Uint8Array(await crypto.subtle.sign("HMAC",key,
    new TextEncoder().encode(manifest)));
  const expected=hexToBytes(v1);
  if (actual.length!==expected.length) return false;
  let diff=0;
  for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];
  return diff===0;
}
function safeOrder(order: any) {
  return {
    orderId:order.id, numbers:order.numbers, totalCents:order.amount_cents,
    status:order.status, expiresAt:order.reservation_expires_at,
    // Pix apenas para o comprador com ID aleatório do pedido.
    pixCode:order.pix_payload, qrBase64:order.pix_image_base64
  };
}
Deno.serve(async (request) => {
  const url=new URL(request.url);
  const route=url.pathname.split("/astros-checkout")[1] || "";
  const siteOrigin=request.headers.get("origin") ?? "";
  const acceptedOrigin=siteOrigin===SITE_ORIGIN ? SITE_ORIGIN : "";
  const webhook=route==="/webhook";
  if (request.method==="OPTIONS" && acceptedOrigin) {
    return new Response(null,{status:204,headers:{
      "access-control-allow-origin":acceptedOrigin,
      "access-control-allow-methods":"GET,POST,OPTIONS",
      "access-control-allow-headers":"content-type",
      "access-control-max-age":"600", "vary":"Origin"
    }});
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !MP_TOKEN || !SITE_ORIGIN || !FUNCTION_URL)
    return fail("Integração ainda não configurada.",503,acceptedOrigin);
  if (!webhook && (!siteOrigin || siteOrigin!==SITE_ORIGIN))
    return fail("Origem não autorizada.",403,acceptedOrigin);
  try {
    if (webhook && request.method==="POST") {
      const paymentId=url.searchParams.get("data.id") || "";
      const type=url.searchParams.get("type") || "";
      if (type!=="payment" || !/^\d{1,25}$/.test(paymentId))
        return fail("Notificação inválida.",400);
      if (!(await validWebhook(request,paymentId)))
        return fail("Assinatura inválida.",401);
      await verifyAndSync(paymentId);
      return json({ok:true});
    }
    if (route==="/availability" && request.method==="GET") {
      await reconcileExpired();
      const {data,error}=await db.from("astros_tickets")
        .select("number,status").order("number");
      if (error) throw error;
      return json({tickets:data},200,acceptedOrigin);
    }
    if (route.startsWith("/order/") && request.method==="GET") {
      const id=route.slice("/order/".length);
      if(!isUuid(id))return fail("Pedido inválido.",400,acceptedOrigin);
      let order=await getOrder(id);
      if(!order)return fail("Pedido inexistente.",404,acceptedOrigin);
      if (order.payment_id && ["pending","reserved"].includes(order.status)) {
        await verifyAndSync(String(order.payment_id));
        order=await getOrder(id);
      }
      return json(safeOrder(order),200,acceptedOrigin);
    }
    if (route==="/checkout" && request.method==="POST") {
      if(Number(request.headers.get("content-length")||"0")>4096)
        return fail("Dados excessivos.",413,acceptedOrigin);
      const body=await request.json();
      const numbers=onlyNumbers(body.numbers);
      const email=String(body.email||"").trim().toLowerCase();
      const cpf=String(body.cpf||"").replace(/\D/g,"");
      if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !validCpfFormat(cpf)) {
        return fail("Informe e-mail e CPF válidos para gerar o Pix.",400,acceptedOrigin);
      }
      const {data:orderId,error:reserveError}=await db.rpc("astros_reserve",{
        p_numbers:numbers,p_email:email
      });
      if(reserveError) return fail(reserveError.message,409,acceptedOrigin);
      const paymentBody={
        transaction_amount:(numbers.length * PRICE_CENTS)/100,
        payment_method_id:"pix",
        description:"ASTROS - numeros "+numbers.map(n=>String(n).padStart(3,"0")).join(", "),
        external_reference:orderId,
        date_of_expiration:new Date(Date.now()+30*60*1000).toISOString(),
        notification_url:FUNCTION_URL.replace(/\/$/,"")+"/webhook",
        payer:{email,identification:{type:"CPF",number:cpf}}
      };
      let payment;
      try {
        payment=await mp("/v1/payments",{
          method:"POST",
          headers:{"content-type":"application/json",
            "X-Idempotency-Key":String(orderId)},
          body:JSON.stringify(paymentBody)
        });
      } catch (error) {
        // Se a requisição chegou ao provedor mas a resposta falhou, liberar
        // a reserva imediatamente pode causar venda duplicada.
        console.error("Falha na criação Pix do pedido",orderId,String(error));
        return fail("Não foi possível gerar o Pix. A reserva será conciliada; contate o suporte.",502,acceptedOrigin);
      }
      const txn=payment.point_of_interaction?.transaction_data ?? {};
      const paymentId=getPaymentId(payment.id);
      if (!/^\d{1,25}$/.test(paymentId) || !txn.qr_code)
        return fail("Pix criado sem dados de QR Code. Entre em contato com o suporte.",502,acceptedOrigin);
      const {error:saveError}=await db.rpc("astros_save_pix",{
        p_id:orderId,p_payment_id:paymentId,
        p_payload:String(txn.qr_code),p_qr_base64:String(txn.qr_code_base64||"")
      });
      if(saveError)throw saveError;
      const order=await getOrder(String(orderId));
      return json(safeOrder(order),201,acceptedOrigin);
    }
    return fail("Rota não encontrada.",404,acceptedOrigin);
  } catch(error) {
    console.error("Erro no checkout ASTROS:",String(error));
    return fail("Serviço temporariamente indisponível.",500,acceptedOrigin);
  }
});

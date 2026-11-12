// ASTROS: PagBank PIX por pedido + baixa transacional no Supabase.
// Publicar SOMENTE após testes sandbox e confirmação dos requisitos da campanha.
// Supabase secrets: PAGBANK_ACCESS_TOKEN, PAGBANK_ENV (sandbox|production),
// ALLOWED_SITE_ORIGIN, PUBLIC_FUNCTION_URL e SUPABASE_SERVICE_ROLE_KEY.
// Para autenticar webhooks atuais: PAGBANK_WEBHOOK_PUBLIC_KEY (X.509 base64).
// Webhooks antigos podem usar x-authenticity-token com o próprio PAGBANK_ACCESS_TOKEN.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
// Supabase supports the 2026 secret-key format and legacy service_role keys.
const SUPABASE_NEW_KEYS=Deno.env.get("SUPABASE_SECRET_KEYS")||"";
let primarySecret="";
try {
  if (SUPABASE_NEW_KEYS) primarySecret=String(JSON.parse(SUPABASE_NEW_KEYS)?.default||"");
} catch {
  console.error("ASTROS: SUPABASE_SECRET_KEYS is not valid JSON.");
}
const SERVICE_KEY=primarySecret||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PAGBANK_TOKEN=Deno.env.get("PAGBANK_ACCESS_TOKEN")||"";
const PAGBANK_ENV=Deno.env.get("PAGBANK_ENV")||"sandbox";
const PAYMENTS_ENABLED=Deno.env.get("ASTROS_PAYMENTS_ENABLED")==="true";
const SITE_ORIGIN=Deno.env.get("ALLOWED_SITE_ORIGIN")||"https://flackoclf44.github.io";
const FUNCTION_URL=(Deno.env.get("PUBLIC_FUNCTION_URL")||(SUPABASE_URL?SUPABASE_URL+"/functions/v1/astros-checkout":"")).replace(/\/$/,"");
const WEBHOOK_PUBLIC_KEY=Deno.env.get("PAGBANK_WEBHOOK_PUBLIC_KEY")||"";
const PAGBANK_BASE=PAGBANK_ENV==="production"
  ?"https://api.pagseguro.com":"https://sandbox.api.pagseguro.com";
const IS_CONFIGURED=Boolean(PAYMENTS_ENABLED&&SUPABASE_URL&&SERVICE_KEY&&PAGBANK_TOKEN
  &&SITE_ORIGIN&&FUNCTION_URL&&["production","sandbox"].includes(PAGBANK_ENV));
const db=createClient(SUPABASE_URL || "https://invalid.supabase.co",SERVICE_KEY||"invalid",{
  auth:{persistSession:false,autoRefreshToken:false}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pagOrder=/^ORDE_[A-Z0-9-]{24,40}$/i;
const toDigits=(v:unknown)=>String(v??"").replace(/\D/g,"");
const originHeaders=(origin="")=>({
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store","access-control-allow-origin":origin||"null",
  "vary":"Origin"
});
const json=(data:unknown,status=200,origin="")=>
  new Response(JSON.stringify(data),{status,headers:originHeaders(origin)});
const fail=(msg:string,status=400,origin="")=>json({error:msg},status,origin);

async function pagbank(path:string,opts:RequestInit={}) {
  const headers=new Headers(opts.headers);
  headers.set("Authorization","Bearer "+PAGBANK_TOKEN);
  headers.set("Accept","application/json");
  const response=await fetch(PAGBANK_BASE+path,{...opts,headers});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error("PAGBANK_HTTP_"+response.status);
  return body;
}
async function getOrder(id:string) {
  const {data,error}=await db.from("astros_orders")
    .select("id,numbers,amount_cents,status,payment_id,pix_payload,pix_image_base64,reservation_expires_at")
    .eq("id",id).maybeSingle();
  if(error)throw error;
  return data;
}
const result=(order:any,showPix=false)=>({
  orderId:order.id,numbers:order.numbers,totalCents:order.amount_cents,
  status:order.status,expiresAt:order.reservation_expires_at,
  ...(showPix?{pixCode:order.pix_payload,qrBase64:order.pix_image_base64}:{})
});
function parseNumbers(v:unknown) {
  if(!Array.isArray(v)||v.length<1||v.length>20)throw Error("Escolha de 1 a 20 números.");
  if(v.some(x=>typeof x!=="number"||!Number.isInteger(x)||x<1||x>150)
    || new Set(v).size!==v.length)throw Error("Números inválidos ou repetidos.");
  return [...v].sort((a,b)=>a-b);
}
function safeName(v:unknown){
  const name=String(v||"").trim().replace(/\s+/g," ");
  if(name.length<3||name.length>120||!name.includes(" "))throw Error("Informe nome e sobrenome.");
  return name;
}
function cpfValid(cpf:string) {
  if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
  const digit=(n:number)=>{const sum=[...cpf.slice(0,n)].reduce((s,c,i)=>s+Number(c)*(n+1-i),0);
    return ((sum*10)%11)%10;};
  return digit(9)===Number(cpf[9]) && digit(10)===Number(cpf[10]);
}
function extractCharge(response:any,ref:string,amount:number){
  if(!response||!Array.isArray(response.charges)||response.charges.length!==1)
    throw Error("Resposta PagBank sem cobrança única.");
  if(response.reference_id!==ref)throw Error("Referência da compra divergente.");
  const charge=response.charges[0];
  if(charge.reference_id!==ref||
     charge.payment_method?.type!=="PIX"||
     charge.amount?.currency!=="BRL"||
     Number(charge.amount?.value)!==amount)
    throw Error("Dados de pagamento do PagBank divergentes.");
  return charge;
}
async function reconcileOrder(providerId:string) {
  if(!pagOrder.test(providerId))throw Error("Pedido PagBank inválido.");
  const remote=await pagbank("/orders/"+encodeURIComponent(providerId));
  const ref=String(remote.reference_id||"");
  if(!uuid.test(ref))throw Error("Referência ASTROS inválida no PagBank.");
  const local=await getOrder(ref);
  if(!local||local.payment_id!==providerId)throw Error("Pedido não vinculado ao PagBank.");
  const charge=extractCharge(remote,ref,local.amount_cents);
  if(charge.status==="PAID"){
    const {data,error}=await db.rpc("astros_approve",{
      p_id:ref,p_payment_id:providerId
    });
    if(error)throw error;
    return data;
  }
  if(["CANCELED","CANCELLED","DECLINED"].includes(charge.status)){
    const {error}=await db.rpc("astros_release",{p_id:ref});
    if(error)throw error;
    return "expired";
  }
  return local.status;
}
async function reconcileExpired(){
  const {data,error}=await db.from("astros_orders")
    .select("id,payment_id,status")
    .in("status",["reserved","pending"])
    .lt("reservation_expires_at",new Date().toISOString())
    .not("payment_id","is",null).limit(4);
  if(error)throw error;
  for(const item of data||[]){
    try{await reconcileOrder(item.payment_id);}
    catch(e){console.error("ASTROS: falha de conciliação",item.id,String(e));}
  }
}
// Nunca aceitar QR Code ou URL de imagem de domínio que não seja do PagBank.
async function getQrPng(links:unknown){
  if(!Array.isArray(links))return "";
  const link=links.find(v=>v?.rel==="QRCODE.PNG"&&typeof v?.href==="string");
  if(!link)return "";
  const u=new URL(link.href);
  if(u.origin!==PAGBANK_BASE||!/^\/qrcode\/QRCO_[a-z0-9-]+\/png$/i.test(u.pathname))
    return "";
  const r=await fetch(u.toString(),{headers:{Authorization:"Bearer "+PAGBANK_TOKEN,Accept:"image/png"}});
  if(!r.ok||!r.headers.get("content-type")?.toLowerCase().includes("image/png"))return "";
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(!bytes.length||bytes.length>250_000)return "";
  let binary="";
  for(let n=0;n<bytes.length;n+=4096)binary+=String.fromCharCode(...bytes.slice(n,n+4096));
  return btoa(binary);
}
const hex=(bytes:Uint8Array)=>Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");
const decodeBase64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function derToRaw(input:Uint8Array){
  // X.509 ECDSA DER sequence [INTEGER r, INTEGER s] -> WebCrypto P1363 64 bytes.
  if(input.length===64)return input;
  if(input[0]!==0x30||input[1]!==input.length-2)throw Error("Assinatura ECDSA inválida.");
  let offset=2;
  const part=()=>{
    if(input[offset++]!==2)throw Error("Campo ECDSA inválido.");
    const length=input[offset++];
    if(!length||offset+length>input.length)throw Error("Comprimento ECDSA inválido.");
    const value=input.slice(offset,offset+length);offset+=length;
    const trimmed=value[0]===0?value.slice(1):value;
    if(trimmed.length>32||!trimmed.length)throw Error("Assinatura ECDSA fora do tamanho.");
    const result=new Uint8Array(32);
    result.set(trimmed,32-trimmed.length);
    return result;
  };
  const r=part(),s=part();
  if(offset!==input.length)throw Error("Dados adicionais na assinatura ECDSA.");
  const all=new Uint8Array(64);all.set(r,0);all.set(s,32);
  return all;
}
async function webhookValid(request:Request,raw:string) {
  const current=request.headers.get("x-payload-signature");
  if(current){
    if(!WEBHOOK_PUBLIC_KEY)return false;
    try{
      const key=await crypto.subtle.importKey(
        "spki",decodeBase64(WEBHOOK_PUBLIC_KEY.replace(/\s+/g,"")),
        {name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
      for(const item of current.split(",")){
        try{
          const signature=derToRaw(decodeBase64(item.trim()));
          if(await crypto.subtle.verify(
            {name:"ECDSA",hash:"SHA-256"},key,signature,new TextEncoder().encode(raw)))
            return true;
        }catch {continue;}
      }
    }catch(e){console.error("Chave de webhook inválida",String(e));}
    return false;
  }
  // Compatibilidade com webhooks PagBank do modelo anterior.
  const old=request.headers.get("x-authenticity-token");
  if(!old||!PAGBANK_TOKEN||!/^[0-9a-f]{64}$/i.test(old))return false;
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(PAGBANK_TOKEN+"-"+raw)));
  const expected=hex(hash);
  let diff=0;
  for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^old.toLowerCase().charCodeAt(i);
  return diff===0;
}
async function handleWebhook(request:Request){
  const raw=await request.text();
  if(raw.length>100_000)return fail("Notificação excede o limite.",413);
  if(!await webhookValid(request,raw))return fail("Assinatura de webhook inválida.",401);
  const event=JSON.parse(raw);
  // O evento SOMENTE indica qual pedido consultar; a aprovação sempre vem
  // do GET autenticado na API PagBank.
  let providerId=String(
    (String(event.id||"").startsWith("ORDE_")?event.id:null)
    ||event.charges?.[0]?.metadata?.ps_order_id
    ||event.metadata?.ps_order_id||"");
  if(!providerId&&uuid.test(event.reference_id||"")){
    const local=await getOrder(event.reference_id);
    providerId=String(local?.payment_id||"");
  }
  if(!pagOrder.test(providerId))return fail("Pedido de notificação inválido.",400);
  await reconcileOrder(providerId);
  return json({ok:true});
}
Deno.serve(async(request)=>{
  const u=new URL(request.url);
  const route=u.pathname.split("/astros-checkout")[1]||"";
  const origin=request.headers.get("origin")||"";
  const accepted=origin===SITE_ORIGIN?SITE_ORIGIN:"";
  const webhook=route==="/webhook";
  if(request.method==="OPTIONS"&&accepted)return new Response(null,{status:204,headers:{
    "access-control-allow-origin":accepted,
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type",
    "access-control-max-age":"600","vary":"Origin"}});
  if(route==="/health"&&request.method==="GET") return json({service:"ASTROS PagBank Pix",deployed:true,ready:IS_CONFIGURED,environment:PAGBANK_ENV},200,accepted);
  if(!IS_CONFIGURED)return fail("PIX automático ainda não ativado.",503,accepted);
  if(!webhook&&origin!==SITE_ORIGIN)return fail("Origem não autorizada.",403,accepted);
  try{
    if(webhook&&request.method==="POST")return await handleWebhook(request);
    if(route==="/availability"&&request.method==="GET"){
      await reconcileExpired();
      const {data,error}=await db.from("astros_tickets")
        .select("number,status").order("number");
      if(error)throw error;
      return json({tickets:data},200,accepted);
    }
    if(route.startsWith("/order/")&&request.method==="GET"){
      const id=route.slice("/order/".length);
      if(!uuid.test(id))return fail("Identificador de pedido inválido.",400,accepted);
      let local=await getOrder(id);
      if(!local)return fail("Pedido inexistente.",404,accepted);
      if(local.payment_id && ["reserved","pending"].includes(local.status)){
        await reconcileOrder(local.payment_id);
        local=await getOrder(id);
      }
      return json(result(local),200,accepted);
    }
    if(route==="/checkout"&&request.method==="POST"){
      if(Number(request.headers.get("content-length")||"0")>4096)
        return fail("Requisição grande demais.",413,accepted);
      const data=await request.json();
      const numbers=parseNumbers(data.numbers);
      const name=safeName(data.name);
      const email=String(data.email||"").trim().toLowerCase();
      const cpf=toDigits(data.cpf);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!cpfValid(cpf))
        return fail("Informe e-mail e CPF válidos.",400,accepted);
      const {data:internalId,error:reserveError}=await db.rpc("astros_reserve",{
        p_numbers:numbers,p_email:email
      });
      if(reserveError)return fail(reserveError.message,409,accepted);
      const total=numbers.length*250;
      const payload={
        reference_id:internalId,
        customer:{name,email,tax_id:cpf},
        items:[{
          reference_id:"ASTROS-ED00",
          name:"Numero da campanha ASTROS",quantity:numbers.length,unit_amount:250
        }],
        charges:[{
          reference_id:internalId,
          description:"ASTROS: "+numbers.map(n=>String(n).padStart(3,"0")).join(", "),
          amount:{value:total,currency:"BRL"},
          payment_method:{type:"PIX",pix:{
            expiration_date:new Date(Date.now()+30*60_000).toISOString()
          }}
        }],
        notification_urls:[FUNCTION_URL+"/webhook"]
      };
      let remote:any;
      try{
        remote=await pagbank("/orders",{
          method:"POST",headers:{"content-type":"application/json",
            "x-idempotency-key":String(internalId).replace(/-/g,"")},
          body:JSON.stringify(payload)
        });
      }catch(e){
        // Em caso de timeout a cobrança pode ter sido criada. Preservar a
        // reserva evita venda duplicada; conciliação administrativa necessária.
        console.error("Falha emissão Pix PagBank",internalId,String(e));
        return fail("Não foi possível confirmar a emissão. Consulte a ASTROS antes de tentar novamente.",502,accepted);
      }
      if(!pagOrder.test(remote.id||""))throw Error("PagBank não retornou ID de pedido.");
      const charge=extractCharge(remote,String(internalId),total);
      if(["DECLINED","CANCELED"].includes(charge.status)){
        const {error}=await db.rpc("astros_release",{p_id:internalId});
        if(error)throw error;
        return fail("O PagBank recusou esta cobrança.",422,accepted);
      }
      const pixText=String(charge.qr_code?.text||"");
      if(!pixText||pixText.length>2048)throw Error("PagBank não retornou o PIX Copia e Cola.");
      let qrPng="";
      try{qrPng=await getQrPng(charge.links);}catch(e){
        console.warn("Imagem QR indisponível; PIX Copia e Cola permanece válido.",String(e));
      }
      const {error:saveError}=await db.rpc("astros_save_pix",{
        p_id:internalId,p_payment_id:String(remote.id),
        p_payload:pixText,p_qr_base64:qrPng
      });
      if(saveError)throw saveError;
      if(charge.status==="PAID")await reconcileOrder(String(remote.id));
      return json(result(await getOrder(internalId),true),201,accepted);
    }
    return fail("Rota inexistente.",404,accepted);
  }catch(e){
    console.error("Falha no checkout PagBank ASTROS:",String(e));
    return fail("Serviço de pagamentos temporariamente indisponível.",500,accepted);
  }
});

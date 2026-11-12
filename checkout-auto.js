"use strict";
// ASTROS: ativo apenas quando checkout-config.js informar URL segura.
// O navegador NUNCA confirma um pagamento, apenas exibe o status do servidor.
(() => {
  const base=(window.ASTROS_CHECKOUT_API || "").trim().replace(/\/+$/,"");
  if(!base)return;
  if(!/^https:\/\/[a-z0-9.-]+\/functions\/v1\/astros-checkout$/i.test(base)) {
    console.error("ASTROS: URL do checkout automático inválida.");return;
  }
  const $=id=>document.getElementById(id);
  const price=c=>(c/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const fmt=n=>String(n).padStart(3,"0");
  const req=async(path,options={})=>{
    const r=await fetch(base+path,{...options,headers:{"content-type":"application/json",...options.headers},cache:"no-store"});
    let data;
    try{data=await r.json();}catch{throw Error("Resposta inválida do serviço PIX.");}
    if(!r.ok)throw Error(data.error||"Erro no serviço PIX.");
    return data;
  };
  let currentOrder=null;
  let checking=null;
  let loading=false;
  const p=(text,cls)=>{
    const e=document.createElement("p");
    e.textContent=text;if(cls)e.className=cls;return e;
  };
  const btn=(text,fn)=>{
    const e=document.createElement("button");
    e.type="button";e.className="btn btn-light modal-submit";
    e.textContent=text;e.addEventListener("click",fn);return e;
  };
  function close(){ $("modal").hidden=true; }
  function createModal(title){
    const overlay=$("modal");
    const panel=overlay.querySelector(".modal");
    panel.replaceChildren();
    const x=document.createElement("button");
    x.type="button";x.className="modal-close";x.textContent="✕";
    x.setAttribute("aria-label","Fechar pagamento");x.onclick=close;
    const small=document.createElement("span");
    small.className="overline";small.textContent="ASTROS / PAGAMENTO PIX";
    const h=document.createElement("h2");h.id="modalTitle";h.textContent=title;
    const body=document.createElement("div");body.id="astrosPaymentBody";
    panel.append(x,small,h,body);
    overlay.hidden=false;x.focus();
    return body;
  }
  async function updateAvailability(){
    if(loading)return;
    loading=true;
    try {
      const data=await req("/availability");
      if(!window.ASTROS_RAFFLE_UI?.setAvailability(data.tickets))
        throw Error("Dados de disponibilidade inválidos.");
    }catch(e){
      window.ASTROS_RAFFLE_UI?.setUnavailable();
      console.warn("ASTROS: erro de disponibilidade",String(e));
    }finally{loading=false;}
  }
  function showPayerForm(numbers){
    const area=createModal("FINALIZAR COM PIX");
    area.append(p("Números: "+numbers.map(fmt).join(" · ")));
    area.append(p("Total: "+price(numbers.length*250)));
    area.append(p("Informe os dados do pagador para gerar um PIX exclusivo e verificável.","autoPixHint"));
    const nameLabel=document.createElement("label");
    nameLabel.textContent="NOME COMPLETO";nameLabel.htmlFor="autoPayerName";
    const name=document.createElement("input");
    name.id="autoPayerName";name.type="text";name.autocomplete="name";name.maxLength=120;
    name.placeholder="Nome e sobrenome";
    const emailLabel=document.createElement("label");
    emailLabel.textContent="E-MAIL";emailLabel.htmlFor="autoPayerEmail";
    const email=document.createElement("input");
    email.id="autoPayerEmail";email.type="email";email.autocomplete="email";email.placeholder="voce@exemplo.com";
    const cpfLabel=document.createElement("label");
    cpfLabel.textContent="CPF DO PAGADOR";cpfLabel.htmlFor="autoPayerCpf";
    const cpf=document.createElement("input");
    cpf.id="autoPayerCpf";cpf.inputMode="numeric";cpf.placeholder="Somente números";cpf.maxLength=14;
    const error=p("","form-error");
    const pay=btn("GERAR PIX",async()=>{
      const fullname=name.value.trim().replace(/\s+/g," ");
      const entered=email.value.trim();
      const doc=cpf.value.replace(/\D/g,"");
      if(fullname.length<3||!fullname.includes(" ")||
         !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered)||doc.length!==11){
        error.textContent="Confira nome completo, e-mail e CPF.";return;
      }
      pay.disabled=true;pay.textContent="GERANDO PIX...";
      try{
        const order=await req("/checkout",{method:"POST",body:JSON.stringify({numbers,name:fullname,email:entered,cpf:doc})});
        currentOrder=order.orderId;
        showPix(order);
        startPolling();
        await updateAvailability();
      }catch(e){
        error.textContent=e.message||"Erro ao gerar o PIX.";
        pay.disabled=false;pay.textContent="GERAR PIX";
        await updateAvailability();
      }
    });
    area.append(nameLabel,name,emailLabel,email,cpfLabel,cpf,error,pay);
  }
  function showPix(order){
    const area=createModal("PAGUE COM O PIX");
    area.append(p("Números: "+order.numbers.map(fmt).join(" · ")));
    area.append(p("Total: "+price(order.totalCents)));
    if(order.qrBase64 && /^[A-Za-z0-9+/=\s]+$/.test(order.qrBase64)){
      const img=document.createElement("img");
      img.className="autoPixQr";img.alt="QR Code PIX único deste pedido";
      img.src="data:image/png;base64,"+order.qrBase64.replace(/\s+/g,"");
      area.append(img);
    }
    area.append(p("Este PIX é gerado exclusivamente para os números do pedido. Não use o QR Code antigo.","autoPixHint"));
    const label=document.createElement("label");
    label.htmlFor="autoPixCode";label.textContent="PIX COPIA E COLA";
    const code=document.createElement("textarea");
    code.id="autoPixCode";code.rows=3;code.readOnly=true;code.value=order.pixCode||"";
    const copy=btn("COPIAR PIX COPIA E COLA",async()=>{
      try{
        await navigator.clipboard.writeText(code.value);
        copy.textContent="COPIADO!";
        setTimeout(()=>{copy.textContent="COPIAR PIX COPIA E COLA";},2100);
      }catch{code.focus();code.select();copy.textContent="SELECIONE E COPIE";}
    });
    const status=p("AGUARDANDO PAGAMENTO — os números estão reservados.","autoPixStatus");
    status.id="autoPaymentStatus";
    area.append(label,code,copy,status);
    area.append(p("A compra só é confirmada quando o provedor aprovar o PIX.","autoPixHint"));
  }
  async function checkOrder(){
    if(!currentOrder)return;
    try{
      const order=await req("/order/"+encodeURIComponent(currentOrder));
      if(!["approved","expired","failed","review"].includes(order.status))return;
      if(checking){clearInterval(checking);checking=null;}
      await updateAvailability();
      const result=$("autoPaymentStatus");
      if(order.status==="approved"){
        window.ASTROS_RAFFLE_UI?.clearSelection();
        if(result)result.textContent="PIX APROVADO! Seus números já foram marcados como vendidos.";
      }else if(order.status==="review"){
        if(result)result.textContent="Pagamento recebido, mas a reserva exige análise da ASTROS.";
      }else if(result)result.textContent="O pagamento foi encerrado sem confirmação. Selecione novamente.";
    }catch(e){console.warn("ASTROS: aguardando atualização de pagamento",String(e));}
  }
  function startPolling(){
    if(checking)clearInterval(checking);
    checking=setInterval(checkOrder,8000);
    checkOrder();
  }
  window.ASTROS_AUTO_CHECKOUT={enabled:true,start(numbers){
    if(Array.isArray(numbers)&&numbers.length)showPayerForm(numbers);
  }};
  const style=document.createElement("style");
  style.textContent=[
    ".modal .autoPixQr{display:block;width:min(100%,300px);height:auto;margin:14px auto;background:#fff;border-radius:10px}",
    ".modal .autoPixHint{font-size:12px;line-height:1.7;color:#b4b4bf}",
    ".modal .autoPixStatus{font-size:13px;font-weight:900;color:#d7d7dd;margin-top:18px}",
    ".modal #autoPixCode{display:block;width:100%;margin:8px 0 12px;font:12px/1.5 monospace}",
    ".modal #astrosPaymentBody label{display:block;font-size:12px;font-weight:900;margin:15px 0 5px}",
    ".modal #astrosPaymentBody input{width:100%;margin:0 0 8px}"
  ].join("\n");
  document.head.appendChild(style);
  $("checkoutBtn").disabled=true;
  updateAvailability();
  setInterval(updateAvailability,20000);
})();

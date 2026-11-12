"use strict";
const $ = (id) => document.getElementById(id);
const PRICE_CENTS = 250;
const MAX_TICKETS = 150;
const SELECT_LIMIT = 20;
const WHATSAPP_NUMBER = '5514991911888';
const selected = new Set();
const pad = n => String(n).padStart(3, '0');
const BRL = cents => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(cents/100);
let focusBeforeModal = null;
function renderGrid() {
  const fragment = document.createDocumentFragment();
  for (let n=1; n<=MAX_TICKETS; n++) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'number'; btn.textContent=pad(n);
    btn.setAttribute('aria-pressed', String(selected.has(n)));
    btn.setAttribute('aria-label', `Número ${pad(n)}, ${selected.has(n)?'selecionado':'não selecionado'}`);
    btn.addEventListener('click', () => {
      if (selected.has(n)) selected.delete(n);
      else if (selected.size<SELECT_LIMIT) selected.add(n);
      else { $('numbersHelp').textContent='Nesta demonstração, selecione no máximo 20 números.'; return; }
      renderGrid(); renderSummary();
    });
    fragment.append(btn);
  }
  $('numberGrid').replaceChildren(fragment);
}
function renderSummary() {
  const nums = [...selected].sort((a,b)=>a-b);
  $('chosenCount').textContent = nums.length;
  $('orderTotal').textContent = BRL(nums.length*PRICE_CENTS);
  const container = $('chosenNumbers'); container.replaceChildren();
  if (!nums.length) { const span = document.createElement('span'); span.textContent='Selecione algum número ao lado.'; container.append(span); }
  else for (const n of nums) { const chip=document.createElement('span'); chip.className='chip'; chip.textContent=pad(n); container.append(chip); }
  $('checkoutBtn').disabled = !nums.length;
}

function configurePixPopup() {
  $('modalTitle').innerHTML = 'PAGUE COM O <em>PIX</em>';
  const imageArea = document.createElement('div');
  imageArea.className = 'astros-pix-image';
  const image = document.createElement('img');
  image.src = 'images/pix-astros.svg';
  image.alt = 'QR Code PIX da ASTROS para escanear no aplicativo bancário';
  image.width = 838;
  image.height = 843;
  imageArea.appendChild(image);
  const instruction = document.createElement('p');
  instruction.textContent = 'Escaneie o QR Code usando o aplicativo do seu banco. Após o pagamento, envie o comprovante pelo WhatsApp.';
  instruction.className = 'astros-pix-instruction';
  imageArea.appendChild(instruction);
  $('previewTotal').closest('p').after(imageArea);
  const oldCaption = [...$('modal').querySelectorAll('p')].find(p => p.textContent.trim() === 'ASTROS.');
  if(oldCaption) oldCaption.remove();
  const styles = document.createElement('style');
  styles.textContent = `
    .astros-pix-image { margin: 18px 0 20px; text-align: center; }
    .astros-pix-image img { display:block; width:min(100%,330px); height:auto; margin:auto; background:#fff; border-radius:12px; }
    .modal .astros-pix-instruction { margin:12px auto 0; max-width:380px; color:#b7b7c0; font-size:12px; line-height:1.6; }
    @media(max-width:540px) { .astros-pix-image {margin:14px 0 16px;} .astros-pix-image img{width:min(100%,300px);} }
  `;
  document.head.appendChild(styles);
}
function openWhatsappForSelectedNumbers() {
  const nums = [...selected].sort((a,b)=>a-b);
  if(!nums.length) return;
  const message = 'Olá, estou participando da Rifa da Astros, meus numeros são: ' + nums.map(pad).join(', ');
  window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message), '_blank', 'noopener,noreferrer');
}

function showPreview(){
  const nums=[...selected].sort((a,b)=>a-b);
  if (!nums.length) return;
  focusBeforeModal=document.activeElement;
  $('previewNumbers').textContent=nums.map(pad).join(' · ');
  $('previewTotal').textContent=BRL(nums.length*PRICE_CENTS);
  $('modal').hidden=false;
  $('modalClose').focus();
}
function closePreview() { $('modal').hidden=true; if(focusBeforeModal)focusBeforeModal.focus(); }
$('randomBtn').addEventListener('click',()=>{
  const remaining=Array.from({length:MAX_TICKETS},(_,i)=>i+1).filter(n=>!selected.has(n));
  if(!remaining.length||selected.size>=SELECT_LIMIT)return;
  const randomBytes=new Uint32Array(1);
  if (typeof crypto!=='undefined' && crypto.getRandomValues) crypto.getRandomValues(randomBytes);
  else randomBytes[0] = Math.floor(Math.random()*4294967296);
  selected.add(remaining[randomBytes[0]%remaining.length]);
  renderGrid(); renderSummary();
});
$('clearBtn').addEventListener('click',()=>{selected.clear();renderGrid();renderSummary();});
$('checkoutBtn').addEventListener('click',showPreview);
$('modalClose').addEventListener('click',closePreview);
$('previewClose').addEventListener('click',openWhatsappForSelectedNumbers);
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closePreview();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)closePreview();});
configurePixPopup();
renderGrid(); renderSummary();

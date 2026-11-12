"use strict";
const $ = (id) => document.getElementById(id);
const PRICE_CENTS = 250;
const MAX_TICKETS = 150;
const SELECT_LIMIT = 20;
const BLOCKED_NUMBERS = new Set([10, 24]);
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
    if (BLOCKED_NUMBERS.has(n)) {
      btn.disabled = true;
      btn.title = 'Número indisponível para compra';
    }
    btn.setAttribute('aria-pressed', String(selected.has(n)));
    btn.setAttribute('aria-label', `Número ${pad(n)}, ${BLOCKED_NUMBERS.has(n) ? 'indisponível para compra' : selected.has(n) ? 'selecionado' : 'não selecionado'}`);
    btn.addEventListener('click', () => {
      if (BLOCKED_NUMBERS.has(n)) return;
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
  const pixKeyArea = document.createElement('div');
  pixKeyArea.className = 'astros-pix-key';
  const pixLabel = document.createElement('label');
  pixLabel.textContent = 'CHAVE PIX (CNPJ)';
  pixLabel.htmlFor = 'astrosPixKeyInput';
  pixKeyArea.appendChild(pixLabel);
  const pixKeyRow = document.createElement('div');
  pixKeyRow.className = 'astros-pix-key-row';
  const pixInput = document.createElement('input');
  pixInput.id = 'astrosPixKeyInput';
  pixInput.type = 'text';
  pixInput.value = '50368231000120';
  pixInput.readOnly = true;
  pixInput.setAttribute('aria-label', 'Chave Pix CNPJ: 50368231000120');
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'astros-pix-copy';
  copyButton.textContent = 'COPIAR';
  copyButton.setAttribute('aria-label', 'Copiar chave Pix');
  copyButton.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(pixInput.value);
      } else {
        pixInput.select();
        if (!document.execCommand('copy')) throw new Error('Cópia indisponível');
        pixInput.setSelectionRange(0, 0);
      }
      copyButton.textContent = 'COPIADO!';
      setTimeout(() => { copyButton.textContent = 'COPIAR'; }, 2200);
    } catch (_) {
      pixInput.focus();
      pixInput.select();
      copyButton.textContent = 'SELECIONE E COPIE';
    }
  });
  pixKeyRow.append(pixInput, copyButton);
  pixKeyArea.appendChild(pixKeyRow);
  imageArea.appendChild(pixKeyArea);
  $('previewTotal').closest('p').after(imageArea);
  const oldCaption = [...$('modal').querySelectorAll('p')].find(p => p.textContent.trim() === 'ASTROS.');
  if(oldCaption) oldCaption.remove();
  const styles = document.createElement('style');
  styles.textContent = `
    .astros-pix-image { margin: 18px 0 20px; text-align: center; }
    .astros-pix-image img { display:block; width:min(100%,330px); height:auto; margin:auto; background:#fff; border-radius:12px; }
    .modal .astros-pix-instruction { margin:12px auto 0; max-width:380px; color:#b7b7c0; font-size:12px; line-height:1.6; }
    .astros-pix-key { margin: 17px auto 0; max-width: 380px; text-align: left; }
    .modal .astros-pix-key label { margin:0 0 7px; color:#d8d8df; font-size:11px; font-weight:900; letter-spacing:.08em; }
    .astros-pix-key-row { display:flex; gap:8px; }
    .modal .astros-pix-key-row input { min-width:0; flex:1; margin:0; padding:12px; font-weight:700; color:#fff; }
    .astros-pix-copy { border:0; padding:0 13px; background:#eee; color:#141418; font-weight:900; font-size:11px; cursor:pointer; }
    .astros-pix-copy:focus-visible { outline:2px solid #fff; outline-offset:3px; }
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
  const remaining=Array.from({length:MAX_TICKETS},(_,i)=>i+1).filter(n=>!selected.has(n) && !BLOCKED_NUMBERS.has(n));
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
$('statAvailable').textContent = MAX_TICKETS - BLOCKED_NUMBERS.size;
$('statAvailable').nextElementSibling.textContent = 'NÚMEROS NÃO BLOQUEADOS';
const unavailableLegend = document.querySelector('.number-key .key-selected')?.parentElement;
if (unavailableLegend) unavailableLegend.lastChild.textContent = ' Indisponível';
renderGrid(); renderSummary();

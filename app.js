"use strict";
const $ = (id) => document.getElementById(id);
const PRICE_CENTS = 250;
const MAX_TICKETS = 150;
const SELECT_LIMIT = 20;
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
$('previewClose').addEventListener('click',closePreview);
$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closePreview();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)closePreview();});
renderGrid(); renderSummary();

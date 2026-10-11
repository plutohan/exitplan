import {createDemoPortfolio,defaultConstraints,planExit,requiredMarginCents} from './engine.mjs';
import {importHyperliquid} from './adapters/hyperliquid.mjs';
import {importSolana} from './adapters/solana.mjs';
import {simulateSellSol} from './adapters/rehearsal.mjs';

const $ = (query, root=document) => root.querySelector(query);
const $$ = (query, root=document) => [...root.querySelectorAll(query)];
let portfolio=createDemoPortfolio(), imported=null, importSequence=0, sourceMode='scenario';
let constraints=defaultConstraints(), result, selectedId=null, revision=0, guideStep=0, proposal=null, requestSequence=0, rehearsal=null;
const fmt=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const money=(n,precise=false)=>'$'+new Intl.NumberFormat('en-US',{minimumFractionDigits:precise?2:0,maximumFractionDigits:2}).format(Number(n)||0);
const num=n=>fmt.format(Number(n)||0);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={
sliders:'<path d="M4 6h6m4 0h6M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
layers:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm9 3a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3"/>',
lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
'arrow-up':'<path d="M12 20V4m-6 6 6-6 6 6"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
check:'<path d="m5 12 4 4L19 6"/>',
warning:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
sparkle:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-1v4m-2-2h4"/>',
external:'<path d="M14 3h7v7M21 3l-11 11M10 5H4v15h15v-6"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
wallet:'<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m13 6h5v4h-5v-4Z"/>',
hedge:'<path d="M5 3v18M19 3v18M2 7h6M16 17h6M9 12h6"/>',
coins:'<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 2 3 3 6 3m-6-3v5c0 2 3 3 6 3"/><ellipse cx="16" cy="14" rx="5" ry="3"/><path d="M11 14v5c0 2 10 2 10 0v-5"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.info}</svg>`;
const shortTime=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'now':d.toISOString().slice(11,16)+' UTC';};
const evidenceLabel=()=>portfolio.evidence==='imported'?'IMPORTED · '+shortTime(imported?.hyperliquid?.observedAt):'SCENARIO';
function hydrateIcons(root=document){$$('[data-icon]',root).forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
hydrateIcons();

function planName(p){
 if(p.id==='no-action')return 'Keep current positions';
 if(p.family==='wallet')return 'Use wallet USDC';
 const actions=p.steps||[];
 const walletPrefix=p.walletUsed>0?'Wallet USDC + ':'';
 const hasLend=actions.some(s=>s.action.startsWith('Withdraw lending'));
 const hasHl=actions.some(s=>s.action.startsWith('Withdraw and transfer'));
 if(p.newDebt>0)return walletPrefix+(hasLend||hasHl?'Withdraw deposits + borrow more':'Borrow against SOL');
 if(p.solSold>0&&p.shortReduced>0)return walletPrefix+(hasLend||hasHl?'Withdraw deposits + trim spot and short':'Trim spot and short together');
 if(p.solSold>0)return walletPrefix+'Sell SOL only';
 if(hasLend&&hasHl)return walletPrefix+'Split withdrawal: Solana + HL';
 if(hasLend)return walletPrefix+'Withdraw Solana deposit USDC';
 if(hasHl)return walletPrefix+'Withdraw free HL collateral';
 return walletPrefix+'Cash route';
}
function stepName(s){return s.action.startsWith('Use USDC')?'Use wallet USDC':s.action.startsWith('Withdraw lending')?'Withdraw deposited USDC':s.action.startsWith('Sell SOL')?'Sell SOL spot':s.action.startsWith('Reduce SOL')?'Reduce SOL short by the same amount':s.action.startsWith('Borrow')?'Borrow against SOL (comparison)':'Withdraw HL collateral → Solana';}
function stepVenue(s){return s.venue.startsWith('Hyperliquid')?'Hyperliquid':'Solana';}
function planDescription(p){return p.steps.map(s=>`${stepName(s)} ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}`).join(' → ')||'Nothing to move';}
function rejectionText(p){
 const reasons=[];
 if(p.netCash<constraints.target)reasons.push(`${money(constraints.target-p.netCash)} short of the target`);
 if(constraints.preserveSolQuantity&&p.solSold>0)reasons.push('Violates keep-SOL-quantity');
 if(constraints.preserveHedge&&Math.abs(p.solSold-p.shortReduced)>0.0000005)reasons.push('Spot and short mismatch changes net SOL exposure');
 if(p.newDebt>constraints.maxNewDebt)reasons.push(`New debt ${money(p.newDebt)} exceeds the limit`);
 if(p.hlBufferAfter<constraints.minHlBuffer&&p.hlBufferAfter<initialHlBuffer())reasons.push('Below the minimum margin buffer');
 if(p.estimatedHours>constraints.deadlineHours)reasons.push('Assumed duration exceeds the planning window');
 return reasons.join(' · ')||'Exceeds a withdrawal or position limit';
}
function outcomeKey(p){return [Math.round(p.solSold*100),Math.round(p.newDebt),p.steps.some(s=>s.venue.startsWith('Hyperliquid')),p.steps.some(s=>s.action.startsWith('Withdraw lending'))].join(':');}
function displayedPlans(){
 const chosen=[];
 const add=p=>{if(p&&!chosen.some(x=>x.id===p.id))chosen.push(p);};
 const selected=result.plans.find(p=>p.id===selectedId);
 add(selected||result.best);
 if(!chosen.length){add([...result.plans].filter(p=>!p.solSold&&!p.newDebt).sort((a,b)=>b.netCash-a.netCash||a.fees-b.fees)[0]);}
 const different=result.feasible.find(p=>chosen.every(x=>outcomeKey(x)!==outcomeKey(p))&&p.steps.length>1);
 add(different);
 if(constraints.maxNewDebt>0)add(result.feasible.find(p=>p.newDebt>0));
 add(result.plans.find(p=>p.id==='paired-unwind'));
 if(chosen.length<4)add(result.plans.find(p=>p.id==='withdraw-hl'));
 if(chosen.length<4)add(result.plans.find(p=>p.id==='sell-sol'));
 return chosen.slice(0,4);
}
function relaxations(){
 const half=Math.max(0,Math.floor(constraints.minHlBuffer/2)), debtCap=Math.min(5000,Math.floor(portfolio.solana.borrow.capacity)), maxNoSale=Math.floor(result.maximumWithoutSelling);
 return [
  {key:'sell',label:'Allow selling SOL (keep net exposure)',patch:{preserveSolQuantity:false},when:constraints.preserveSolQuantity},
  {key:'hedge',label:'Allow net exposure to change',patch:{preserveHedge:false},when:constraints.preserveHedge},
  {key:'debt',label:`Allow new debt up to ${money(debtCap)}`,patch:{maxNewDebt:debtCap},when:debtCap>constraints.maxNewDebt},
  {key:'buffer',label:`Lower the margin floor to ${money(half)}`,patch:{minHlBuffer:half},when:constraints.minHlBuffer>0},
  {key:'target',label:`Lower the target to ${money(maxNoSale)}`,patch:{target:maxNoSale},when:maxNoSale>0&&maxNoSale<constraints.target}
 ].filter(r=>r.when);
}
function suggestionFor(key){const r=relaxations().find(x=>x.key===key);if(!r)return null;const check=planExit(portfolio,{...constraints,...r.patch});return check.best?{...r,best:check.best}:null;}
function renderSuggestions(){const items=relaxations().map(r=>suggestionFor(r.key)).filter(Boolean);if(!items.length)return '';return `<div class="suggestions" aria-label="What would make it work">${items.map(r=>`<button type="button" class="suggestion" data-suggestion="${esc(r.key)}">${esc(r.label)} → ${money(r.best.netCash)} route, fees ${money(r.best.fees,true)}</button>`).join('')}</div>`;}
function renderPlans(){
 $('#route-count').textContent=`Feasible ${result.feasible.length} / ${result.plans.length}`;
 const banner=$('#result-banner');
 banner.classList.toggle('empty',!result.best);
 if(result.errors.some(e=>/stale/i.test(e))){banner.innerHTML=`<span>${icon('warning')}</span><div><strong>Imported snapshot is older than 5 minutes</strong><p>Press Load positions to refresh before planning</p></div>`;}
 else if(result.errors.length){banner.innerHTML=`<span>${icon('warning')}</span><div><strong>Check your inputs</strong><p>Enter the cash target and margin buffer as numbers of 0 or more</p></div>`;}
 else if(result.best){banner.innerHTML=`<span>${icon('check')}</span><div><strong>There is a route for the ${money(constraints.target)} target</strong><p>Showing the evaluated candidate with the lowest upfront fees · not verified for execution</p></div>`;}
 else{banner.innerHTML=`<span>${icon('warning')}</span><div><strong>No route satisfies the current conditions</strong><p>Keeping SOL and short quantities with no new debt yields up to ${money(result.maximumWithoutSelling)}. Adjust the target or constraints and compare again.</p>${renderSuggestions()}</div>`;$$('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{const r=suggestionFor(b.dataset.suggestion);if(!r)return;constraints={...constraints,...r.patch};markCustom();recalculate();toast(`Applied: ${r.label}`);}));}
 $('#plans').innerHTML=displayedPlans().map(p=>`<div class="plan-card ${p.feasible?'':'rejected'} ${selectedId===p.id?'selected':''}" data-plan="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(planName(p))}, ${p.feasible?'feasible, select':'not feasible, see why'}" aria-pressed="${selectedId===p.id}"><div class="plan-header"><span class="radio-mark" aria-hidden="true">${p.feasible?'':'!'}</span><h3>${planName(p)}</h3><span class="evidence-badge">${evidenceLabel()}</span>${p.id===result.best?.id?'<span class="plan-badge">Lowest upfront cost</span>':p.feasible?'':'<span class="plan-badge rejected">Not feasible</span>'}<div class="plan-cash"><small>Net cash</small>${money(p.netCash)}</div></div><p class="plan-description">${esc(planDescription(p))}</p><div class="plan-metrics"><span>Fees <b>${money(p.fees,true)}</b></span><span>New debt <b>${money(p.newDebt)}</b></span><span>Steps <b>${p.steps.length}</b></span></div>${p.feasible?'':`<p class="rejection">${esc(rejectionText(p))}</p>`}</div>`).join('')+`<button id="all-plans" class="all-plans-button">See all ${result.plans.length} evaluated candidates and the math ${icon('arrow')}</button>`;
 $$('[data-plan]').forEach(el=>{const activate=()=>selectPlan(el.dataset.plan);el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});});
 $('#all-plans').addEventListener('click',()=>openEvidence(true));
}
function selectPlan(id){const p=result.plans.find(p=>p.id===id);if(!p)return;if(!p.feasible){openRejected(p);return;}selectedId=id;rehearsal=null;renderPlans();renderPositions();renderDecision();}
const ratio=(after,before)=>before>0?after/before:1;
const initialHlBuffer=()=>portfolio.hyperliquid.collateral-requiredMarginCents(portfolio.hyperliquid.shortSol,portfolio.hyperliquid.markPrice,portfolio.hyperliquid.conservativeMarginRate)/100;
function renderPositions(){
 const initialExposure=portfolio.solana.sol-portfolio.hyperliquid.shortSol;
 const p=result.plans.find(p=>p.id===selectedId&&p.feasible);
 const currentBuffer=portfolio.hyperliquid.collateral-portfolio.hyperliquid.shortSol*portfolio.hyperliquid.markPrice*portfolio.hyperliquid.conservativeMarginRate;
 const positionCards=[
  {name:'Solana · SOL spot',icon:'coins',before:portfolio.solana.sol,after:p?.solAfter,unit:'SOL',cash:false,caption:p?.solSold>0?`Sell ${num(p.solSold)} SOL`:'SOL held',bar:p?ratio(p.solAfter,portfolio.solana.sol):1},
  {name:'Hyperliquid · SOL short',icon:'hedge',before:portfolio.hyperliquid.shortSol,after:p?.shortAfter,unit:'SOL',cash:false,caption:p?.shortReduced>0?`Reduce short by ${num(p.shortReduced)} SOL`:(portfolio.evidence==='imported'&&Math.abs(initialExposure)>0.000001?`Net ${initialExposure<0?'short':'long'} ${num(Math.abs(initialExposure))} SOL overall`:'Short offsetting downside exposure'),bar:p?ratio(p.shortAfter,portfolio.hyperliquid.shortSol):1},
  {name:'HL · margin buffer',icon:'shield',before:currentBuffer,after:p?.hlBufferAfter,unit:'',cash:true,caption:`Your floor ${money(constraints.minHlBuffer)} · simple assumption`,bar:p?ratio(p.hlBufferAfter,currentBuffer):1},
  {name:'Solana · deposited USDC',icon:'wallet',before:portfolio.solana.lending.usdc,after:p?.lendingAfter,unit:'',cash:true,caption:'Deposited balance before withdrawal',bar:p?ratio(p.lendingAfter,portfolio.solana.lending.usdc):1}
 ];
 $('#position-cards').innerHTML=positionCards.map(c=>`<article class="position-card"><div class="position-label">${icon(c.icon)}${c.name}</div><div class="position-values"><span class="position-before">${c.cash?money(c.before):num(c.before)}</span><span class="position-arrow">→</span><span class="position-after">${p?(c.cash?money(c.after):num(c.after)):'—'}<small>${c.unit}</small></span></div><div class="position-bar"><span data-bar="${Math.round(Math.max(0,Math.min(100,c.bar*100)))}"></span></div><div class="position-caption">${c.caption}</div></article>`).join('');
 $$('[data-bar]').forEach(bar=>{bar.style.width=bar.dataset.bar+'%';});
 const delta=p?p.netSolExposure:null;
 $('#portfolio-caption').innerHTML=icon('info')+(p?`Net SOL exposure ${num(delta)} SOL after the selected route · ${Math.abs(delta-initialExposure)<.000001?'unchanged from the start':`changed from ${num(initialExposure)} SOL`}${Math.abs(delta)<.000001?' · spot and short balanced':''} · cash lands as USDC in a Solana wallet`:'Select a feasible route to see positions before and after');
}
function renderDecision(){const p=result.plans.find(p=>p.id===selectedId&&p.feasible);$('#rehearse').disabled=!p;$('#decision-content').innerHTML=p?`<div class="decision-label">${planName(p)}</div><div class="decision-summary"><strong>${money(p.netCash)}</strong><span>Net USDC after fees</span></div><p class="decision-detail">${p.steps.length} steps · estimated upfront fees ${money(p.fees,true)}${p.newDebt>0?`<br>New debt ${money(p.newDebt)} · estimated daily interest ${money(p.borrowDailyCarryEstimate,true)} shown separately<br>Assumes ${num(p.solPledgedAfter)} SOL pledged · borrowing is not executed`:''}<br>Walk through the order and risks in the rehearsal</p>`:'<div class="decision-label">Adjust the conditions</div><div class="decision-summary"><strong>—</strong><span>No selectable route</span></div><p class="decision-detail">Lower the target or change the keep-SOL and borrowing conditions</p>';}
function updateControls(){$('#target').value=constraints.target;$('#preserve-sol').checked=constraints.preserveSolQuantity;$('#preserve-hedge').checked=constraints.preserveHedge;$('#min-buffer').value=constraints.minHlBuffer;const debt=$('#max-debt');$$('option[data-custom]',debt).forEach(n=>n.remove());if(![...debt.options].some(o=>Number(o.value)===constraints.maxNewDebt)){const o=document.createElement('option');o.value=constraints.maxNewDebt;o.textContent=`Up to ${money(constraints.maxNewDebt)}`;o.dataset.custom='true';debt.append(o);}debt.value=constraints.maxNewDebt;$$('[data-target]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.target)===constraints.target));$('.deadline-note').innerHTML=icon('clock')+`Planning window ${num(constraints.deadlineHours)} h · assumptions recalculated instantly`;}
function recalculate({sync=true}={}){
 revision++;requestSequence++;proposal=null;rehearsal=null;
 if($('#detail-dialog').open)$('#detail-dialog').close();
 if($('#intent-feedback').textContent)$('#intent-feedback').textContent='Conditions changed; the previous proposal was cleared';
 $('#intent-submit').disabled=false;
 if(portfolio.evidence==='imported'&&imported)portfolio.snapshot.ageSeconds=Math.max(0,Math.floor((Date.now()-imported.at)/1000));
 result=planExit(portfolio,constraints);selectedId=result.best?.id||null;
 if(result.errors.some(e=>/stale/i.test(e)))setImportStatus('Imported snapshot is older than 5 minutes. Press Load positions to refresh.',true);
 if(sync)updateControls();renderPlans();renderPositions();renderDecision();
}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function markCustom(){ $('#guide-title').textContent='Comparing your adjusted conditions'; $('#guide-caption').textContent='Check the selected route and the positions before and after. Use the arrow to see the next synthetic scenario'; }
function changed(){markCustom();recalculate();}
$('#target').addEventListener('input',e=>{constraints.target=e.target.value.trim()===''?NaN:Number(e.target.value);markCustom();recalculate({sync:false});$$('[data-target]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.target)===constraints.target));});
$('#min-buffer').addEventListener('input',e=>{constraints.minHlBuffer=e.target.value.trim()===''?NaN:Number(e.target.value);markCustom();recalculate({sync:false});});
$('#preserve-sol').addEventListener('change',e=>{constraints.preserveSolQuantity=e.target.checked;changed();});
$('#preserve-hedge').addEventListener('change',e=>{constraints.preserveHedge=e.target.checked;changed();});
$('#max-debt').addEventListener('change',e=>{constraints.maxNewDebt=Number(e.target.value);changed();});
$$('[data-target]').forEach(button=>button.addEventListener('click',()=>{constraints.target=Number(button.dataset.target);changed();}));
$$('[data-scroll]').forEach(button=>button.addEventListener('click',()=>$('#'+button.dataset.scroll).scrollIntoView({behavior:'smooth',block:'start'})));

const guides=[
 {title:'First, pick a cash target',caption:'See what changes when you raise $2,000 while keeping the hedge',next:'Keep SOL instead',patch:{target:2000,preserveSolQuantity:false,preserveHedge:true,maxNewDebt:0}},
 {title:'Keep every SOL and raise $5,000?',caption:'Deposits plus free collateral are not enough. Open a rejected route to see why',next:'Trim both positions',patch:{target:5000,preserveSolQuantity:true,preserveHedge:true,maxNewDebt:0}},
 {title:'Trimming spot and short together opens a route',caption:'Only the keep-SOL rule was relaxed. Compare net SOL exposure and the margin buffer',next:'Start over',patch:{target:5000,preserveSolQuantity:false,preserveHedge:true,maxNewDebt:0}}
];
function renderGuide(){const g=guides[guideStep];$('#guide-count').textContent=`0${guideStep+1} / 03`;$('#guide-title').textContent=g.title;$('#guide-caption').textContent=g.caption;$('#guide-next').innerHTML=esc(g.next)+icon('arrow');$$('.guide-dots i').forEach((d,i)=>d.classList.toggle('current',i===guideStep));}
$('#guide-next').addEventListener('click',()=>{guideStep=(guideStep+1)%3;constraints={...defaultConstraints(),...guides[guideStep].patch};recalculate();renderGuide();toast(guideStep===1?'Compared a $5,000 target that keeps SOL':guideStep===2?'Allowed trimming SOL and the short together':'Back to the default scenario');});
$$('.reset-all').forEach(b=>b.addEventListener('click',()=>{constraints=defaultConstraints();guideStep=0;$('#intent').value='';$('#intent-feedback').innerHTML='';importSequence++;portfolio=createDemoPortfolio();imported=null;recalculate();renderGuide();setSource('scenario');toast('Synthetic portfolio reset');}));

function openDialog(title,body,eyebrow='SCENARIO DETAILS'){$('#dialog-title').textContent=title;$('#dialog-eyebrow').textContent=eyebrow;$('#dialog-body').innerHTML=body;const dialog=$('#detail-dialog');if(!dialog.open)dialog.showModal();}
$('#close-dialog').addEventListener('click',()=>{$('#detail-dialog').close();rehearsal=null;});
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){e.target.close();rehearsal=null;}}});
$('#detail-dialog').addEventListener('cancel',()=>{rehearsal=null;});
function openRejected(p){openDialog('Why this route was excluded',`<h3>${esc(planName(p))}</h3><p>${esc(rejectionText(p))}</p><div class="assumption-grid spaced"><div class="assumption-item"><span>Net cash available</span><b>${money(p.netCash)}</b></div><div class="assumption-item"><span>Current cash target</span><b>${money(constraints.target)}</b></div><div class="assumption-item"><span>New debt</span><b>${money(p.newDebt)}</b></div><div class="assumption-item"><span>Net SOL exposure after</span><b>${num(p.netSolExposure)} SOL</b></div></div><h3>Calculated steps</h3><ul>${p.steps.map(s=>`<li>${esc(stepName(s))}: ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}</li>`).join('')}</ul><div class="dialog-disclaimer">Excluded routes cannot be selected or rehearsed. All amounts are estimates based on the synthetic portfolio.</div>`,'CONSTRAINT CHECK');}
function openEvidence(all=false){
 const current=result.plans.find(p=>p.id===selectedId&&p.feasible);
 const isImported=portfolio.evidence==='imported';
 const intro=isImported?`<p>Balances and positions were read from public APIs at ${esc(shortTime(imported.hyperliquid.observedAt))}. Solana wallet ${esc(imported.solana.address)} · Hyperliquid ${esc(imported.hyperliquid.address)}. Nothing was signed or sent.</p><h3>Imported portfolio</h3><div class="assumption-grid"><div class="assumption-item"><span>SOL spot · Jupiter quote</span><b>${num(portfolio.solana.sol)} SOL · ${money(portfolio.solana.solPrice,true)}</b></div><div class="assumption-item"><span>Hyperliquid SOL short · mid</span><b>${num(portfolio.hyperliquid.shortSol)} SOL · ${money(portfolio.hyperliquid.markPrice,true)}</b></div><div class="assumption-item"><span>Kamino USDC supplied · USDC in wallet</span><b>${money(portfolio.solana.lending.usdc,true)} · ${money(portfolio.solana.wallet.usdc,true)}</b></div><div class="assumption-item"><span>HL equity after locked margin · 10% reserve</span><b>${money(portfolio.hyperliquid.collateral,true)} · ${money(requiredMarginCents(portfolio.hyperliquid.shortSol,portfolio.hyperliquid.markPrice,portfolio.hyperliquid.conservativeMarginRate)/100,true)}</b></div></div><h3>Sources and assumptions</h3><ul>${[...imported.solana.sources,...imported.solana.assumptions,...imported.hyperliquid.assumptions].map(x=>`<li>${esc(x)}</li>`).join('')}${imported.hyperliquid.reported.otherPositions.length?`<li>Other Hyperliquid positions (${esc(imported.hyperliquid.reported.otherPositions.map(p=>p.coin).join(', '))}) keep their margin locked in this model</li>`:''}</ul>`:`<p>Every balance, price, fee and duration on this screen is a reproducible synthetic input. No real account or on-chain state was read.</p><h3>Synthetic portfolio</h3><div class="assumption-grid"><div class="assumption-item"><span>SOL spot · reference price</span><b>100 SOL · $100</b></div><div class="assumption-item"><span>Hyperliquid SOL short</span><b>100 SOL · $100</b></div><div class="assumption-item"><span>Solana deposit</span><b>3,000 USDC</b></div><div class="assumption-item"><span>HL collateral · simple required margin</span><b>$4,000 · $1,000</b></div></div>`;
 const body=intro+`<h3>Calculation rules</h3><ul><li>Net cash = withdrawals + sales + new debt − fees paid from cash</li><li>The short's notional is not cash. Short-reduction fees are deducted from HL collateral separately.</li><li>HL buffer = remaining collateral − short notional × assumed 10% reserve. It is not a liquidation price or protocol health metric.</li><li>${isImported?`Keeping net exposure means selling the same SOL quantity that the short is reduced by. Starting net exposure: ${num(portfolio.solana.sol-portfolio.hyperliquid.shortSol)} SOL.`:'Keeping net exposure means selling the same SOL quantity that the short is reduced by, so the starting net SOL exposure is preserved. The starting ratio is 1:1.'}</li><li>Net USDC is assumed to arrive in a Solana wallet, not as fiat in a bank account.</li><li>A fixed set of combinations is evaluated and sorted by lowest upfront fees. This is not a global optimum or investment advice.</li></ul><h3>Estimated fees and borrowing</h3><p>Deposit withdrawal $0.25 · SOL sale ${(portfolio.fees.solSaleBps/100).toFixed(2)}% · short reduction 0.05% · HL transfer $1.00 · loan origination $0.50. New debt shows one day of interest at an assumed 8% APR; total interest is unknown without a repayment date. There is no real borrowing adapter.</p>${current?`<h3>Cash flow of the selected route</h3><div class="evidence-line"><b>Gross inflow ${money(current.grossProceeds,true)}</b> − fees from cash ${money(current.feesFromProceeds,true)} = net cash ${money(current.netCash,true)}</div><div class="evidence-line">Fees deducted from HL collateral ${money(current.feesFromCollateral,true)} · total upfront fees ${money(current.fees,true)}</div>`:''}${all?`<h3>All evaluated candidates · ${result.plans.length}</h3><p>Routes of the same kind are evaluated separately for each mix of deposits, collateral and sales.</p>${[...result.feasible,...result.plans.filter(p=>!p.feasible)].map(p=>`<div class="evidence-line"><b>${p.feasible?'Feasible':'Excluded'} · ${esc(planName(p))}</b><br>Net cash ${money(p.netCash)} · fees ${money(p.fees,true)} · SOL sold ${num(p.solSold)} · new debt ${money(p.newDebt)}${p.feasible?'':'<br>'+esc(rejectionText(p))}</div>`).join('')}`:''}<div class="dialog-disclaimer">Not supported: wallet connection, verification of live prices, liquidity, bridges or account modes, real borrowing, transaction signing or sending, and full modelling of price moves, funding, slippage or liquidation risk. ${isImported?'The rehearsal can simulate the Solana sell leg read-only; the other legs are listed, not simulated.':'The rehearsal is an on-screen walkthrough only.'}</div>`;
 openDialog('Where the numbers come from',body,isImported?'EVIDENCE · IMPORTED SNAPSHOT':'EVIDENCE · SYNTHETIC SCENARIO');
}
$('#open-evidence').addEventListener('click',()=>openEvidence());$('#open-assumptions').addEventListener('click',()=>openEvidence());
function notSimulatedReason(step){return step.action.startsWith('Use USDC')?'Nothing to simulate: USDC is already in the wallet':step.action.startsWith('Withdraw and transfer')?`Not simulated: a Hyperliquid withdrawal needs a signed exchange request · the exchange reported ${money(imported?.hyperliquid?.reported?.withdrawable??0,true)} withdrawable at load; anything beyond that is a model estimate`:step.action.startsWith('Reduce SOL')?'Not simulated: a Hyperliquid order needs a signed exchange request':step.action.startsWith('Borrow')?'Not simulated: borrowing is a comparison only':'Not simulated: the Kamino withdrawal transaction is not built in this version';}
function simulationBlock(step){if(!step.action.startsWith('Sell SOL'))return `<p class="simulation-note">${esc(notSimulatedReason(step))}</p>`;const sim=rehearsal.simulation;const text=!sim?'':sim.pending?'Simulating on Solana…':sim.error?`Simulation unavailable: ${sim.error}`:sim.result.ok?`Simulation succeeded · ${num(sim.result.unitsConsumed??0)} CU · quoted ${money(sim.result.quotedUsdc,true)} USDC · ${sim.result.logCount} log lines · nothing was sent`:`Simulation failed: ${sim.result.error}`;return `<div class="simulation"><button id="simulate-step" class="secondary-button" type="button" ${sim?.pending?'disabled':''}>Simulate on Solana (read-only)</button><p id="simulation-result" class="simulation-note ${sim&&!sim.pending&&(sim.error||!sim.result.ok)?'error':''}">${esc(text)}</p></div>`;}
async function runSimulation(){if(!rehearsal||!imported)return;const current=rehearsal, step=current.plan.steps[current.index];if(!step||!step.action.startsWith('Sell SOL'))return;current.simulation={pending:true};renderRehearsal();try{const result=await simulateSellSol({address:imported.solana.address,solAmount:step.amount});if(rehearsal!==current||current.version!==revision)return;current.simulation={result};}catch(error){if(rehearsal!==current||current.version!==revision)return;current.simulation={error:error?.message||'unknown error'};}renderRehearsal();}
function renderRehearsal(){if(!rehearsal)return;const {plan,index,version}=rehearsal;if(version!==revision){rehearsal=null;$('#detail-dialog').close();toast('Conditions changed; rehearsal closed');return;}const done=index>=plan.steps.length;openDialog(done?'Rehearsal complete':'Step by step: where the assets go',`<p>${esc(planName(plan))} · target net cash ${money(plan.netCash)}</p><div class="dialog-disclaimer rehearsal-disclaimer">${portfolio.evidence==='imported'?'Read-only rehearsal. Steps come from the imported snapshot; nothing is signed or sent and no balance changes.':'Synthetic rehearsal. It walks through the steps on screen and does not change any account, balance or position.'}</div>${plan.steps.map((s,i)=>`<div class="rehearsal-step ${i<index?'done':i===index?'current':''}"><span class="rehearsal-number">${i<index?'✓':i+1}</span><div><h3>${esc(stepName(s))} · ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}</h3><p>${stepVenue(s)} · ${i<index?'step reviewed':i===index?'current step':'next step'}${s.action.startsWith('Reduce')?' · the short notional is not counted as cash':''}</p>${portfolio.evidence==='imported'&&i===index?simulationBlock(s):''}</div></div>`).join('')}${done?`<div class="rehearsal-complete">${icon('check')}Expected net cash ${money(plan.netCash)} · all steps reviewed</div>`:''}<div class="rehearsal-actions"><button id="rehearsal-reset" class="secondary-button">${done?'Replay':'Cancel'}</button><button id="rehearsal-next" class="primary-button">${done?'Back to comparison':'Review this step'} ${icon('arrow')}</button></div>`,'REHEARSAL · NO TRANSACTIONS');$('#rehearsal-next').addEventListener('click',()=>{if(done){$('#detail-dialog').close();rehearsal=null;}else{rehearsal.index++;rehearsal.simulation=null;renderRehearsal();}});$('#simulate-step')?.addEventListener('click',runSimulation);$('#rehearsal-reset').addEventListener('click',()=>{if(done){rehearsal.index=0;renderRehearsal();}else{rehearsal=null;$('#detail-dialog').close();toast('Rehearsal cancelled. No assets were changed');}});}
$('#rehearse').addEventListener('click',()=>{const p=result.plans.find(p=>p.id===selectedId&&p.feasible);if(!p)return;rehearsal={plan:structuredClone(p),index:0,version:revision};renderRehearsal();});

const constraintLabels={target:'Cash target',maxNewDebt:'New debt limit',preserveHedge:'Keep net SOL exposure',preserveSolQuantity:'Keep SOL quantity',minHlBuffer:'Minimum HL margin buffer',deadlineHours:'Planning window'};
function constraintValue(k,v){return typeof v==='boolean'?(v?'on':'off'):k==='deadlineHours'?num(v)+' h':money(v);}
function setAiStatus(connected){$('#ai-status').textContent=connected?'AI connected':'AI offline';$('#ai-status').classList.toggle('connected',connected);}
async function checkAiStatus(){try{const response=await fetch('/api/status',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw new Error();const data=await response.json();setAiStatus(data.aiConfigured===true);if(data.aiConfigured!==true)$('#intent-feedback').innerHTML='<span class="intent-error">AI offline — adjust the conditions above directly</span>';}catch{setAiStatus(false);$('#intent-feedback').innerHTML='<span class="intent-error">AI offline — adjust the conditions above directly</span>';}}
$$('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('#intent').value=b.dataset.prompt;$('#intent').focus();}));
$('#intent-form').addEventListener('submit',async e=>{
 e.preventDefault();const text=$('#intent').value.trim();if(!text){$('#intent-feedback').textContent='Enter your cash goal and conditions first';return;}
 const sequence=++requestSequence, version=revision, base=structuredClone(constraints);proposal=null;$('#intent-submit').disabled=true;$('#intent-feedback').textContent='Interpreting your request. Review the changes before applying';
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch('/api/intent',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text,currentConstraints:base}),signal:controller.signal});
  if(sequence!==requestSequence||version!==revision)return;
  const data=await response.json().catch(()=>({}));
  if(sequence!==requestSequence||version!==revision)return;
  if(!response.ok){if(response.status===503){setAiStatus(false);throw new Error('AI offline — adjust the conditions above directly');}throw new Error(response.status===429?'Too many requests; try again in a moment':'AI could not interpret the request. Adjust the conditions above directly');}
  if(data.mode!=='ai')throw new Error('AI response could not be verified. Adjust the conditions above directly');
  setAiStatus(true);
  if(!data.constraints||typeof data.constraints!=='object'||Array.isArray(data.constraints))throw new Error('Proposal format could not be verified. Use the manual controls');
  const allowed=Object.keys(constraintLabels),badKeys=Object.keys(data.constraints).filter(k=>!allowed.includes(k));
  if(badKeys.length)throw new Error('The proposal included unsupported conditions and was not applied');
  const proposed={...base,...data.constraints};const validated=planExit(portfolio,proposed);
  if(validated.errors.length)throw new Error('A proposed condition is out of range. Restate your goal and conditions');
  const questions=Array.isArray(data.questions)?data.questions.filter(q=>typeof q==='string'):[];
  const changes=allowed.filter(k=>base[k]!==proposed[k]);
  proposal={constraints:proposed,version,sequence,questions};
  $('#intent-feedback').innerHTML=`<div class="proposal"><strong>${questions.length?'Needs confirmation first':'Apply these changes?'}</strong>${typeof data.explanation==='string'?`<p>${esc(data.explanation)}</p>`:''}${changes.length?`<ul>${changes.map(k=>`<li>${constraintLabels[k]}: ${esc(constraintValue(k,base[k]))} → ${esc(constraintValue(k,proposed[k]))}</li>`).join('')}</ul>`:'<p>The proposal matches the current conditions</p>'}${questions.length?`<ul>${questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><p>Send the request again with your answers to get a new proposal</p>`:`<div class="proposal-actions"><button id="apply-intent" ${changes.length?'':'disabled'}>Confirm and apply</button><button id="dismiss-intent">Cancel</button></div>`}</div>`;
  $('#apply-intent')?.addEventListener('click',()=>{if(!proposal||proposal.questions.length||proposal.version!==revision||proposal.sequence!==requestSequence){$('#intent-feedback').textContent='Conditions changed. Interpret again';return;}constraints=structuredClone(proposal.constraints);markCustom();recalculate();$('#intent-feedback').textContent='Applied the confirmed conditions and compared again';toast('Applied the confirmed AI proposal');});
  $('#dismiss-intent')?.addEventListener('click',()=>{proposal=null;$('#intent-feedback').textContent='Proposal dismissed';});
 }catch(error){if(sequence!==requestSequence||version!==revision)return;$('#intent-feedback').innerHTML=`<span class="intent-error">${esc(error.name==='AbortError'?'The response took too long. Adjust the conditions directly or try again':error.message)}</span>`;}
 finally{clearTimeout(timeout);if(sequence===requestSequence)$('#intent-submit').disabled=false;}
});
$('#refresh-market').addEventListener('click',async()=>{const button=$('#refresh-market');button.disabled=true;$('#market-reference-value').textContent='Fetching the public SOL perpetual mid from Hyperliquid';try{const response=await fetch('/api/market',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw new Error();const data=await response.json();if(data.evidence!=='live-market'||!Number.isFinite(data.solUsd)||data.solUsd<=0)throw new Error();const time=new Date(data.observedAt);const observed=Number.isNaN(time.getTime())?'time unknown':time.toLocaleString('en-GB',{timeZone:'UTC',hour12:false})+' UTC';$('#market-reference-value').textContent=`Public SOL perp mid ${money(data.solUsd,true)} · ${observed}. Not an execution price; the ${portfolio.evidence==='imported'?'imported snapshot':'synthetic scenario'} was not repriced`;}catch{$('#market-reference-value').textContent=`Public market price unavailable. Planning still assumes SOL ${money(portfolio.solana.solPrice,true)}`;}finally{button.disabled=false;}});
function setImportStatus(text,isError=false){$('#import-status').textContent=text;$('#import-status').classList.toggle('error',isError);}
function loadedStatus(){return `Loaded · Solana ${num(imported.solana.state.sol)} SOL · ${money(imported.solana.state.lending.usdc)} deposited · ${money(imported.solana.state.wallet.usdc,true)} in wallet · HL short ${num(imported.hyperliquid.state.shortSol)} SOL · net exposure ${num(imported.solana.state.sol-imported.hyperliquid.state.shortSol)} SOL · ${shortTime(imported.hyperliquid.observedAt)}`;}
function renderSource(){const isImported=portfolio.evidence==='imported';$('#source-badge').textContent=evidenceLabel();$('#sol-price').textContent='SOL '+money(portfolio.solana.solPrice,true);$('.demo-label').innerHTML=isImported?'<span></span>Imported positions · Read-only · No real transactions':'<span></span>Synthetic portfolio · No real transactions';$('#sidebar-source-note').innerHTML=isImported?'Positions read from public APIs.<br>Nothing is signed or sent.':'A synthetic portfolio.<br>No real account is connected.';$('#market-reference-title').textContent=isImported?`Planning uses the Jupiter quote SOL ${money(portfolio.solana.solPrice,true)}`:'Planning assumes SOL $100';$('.guide').toggleAttribute('hidden',isImported);$('#share-link').disabled=!imported;}
function setSource(mode){sourceMode=mode;$('#source-import').checked=mode==='import';$('#source-scenario').checked=mode==='scenario';$('#import-row').toggleAttribute('hidden',mode!=='import');if(mode==='scenario'){importSequence++;if(portfolio.evidence==='imported'){portfolio=createDemoPortfolio();imported=null;recalculate();toast('Back to the synthetic scenario');}}setImportStatus(mode==='import'?(imported?loadedStatus():'Enter a Solana wallet and a Hyperliquid address, then load. Read-only: nothing is signed or sent.'):'Synthetic portfolio: 100 SOL, 3,000 USDC deposited, 100 SOL short on Hyperliquid.');$('#load-positions').disabled=false;renderSource();}
function buildImportedPortfolio(solana,hyperliquid){const base=createDemoPortfolio();return {evidence:'imported',synthetic:false,snapshot:{complete:true,ageSeconds:0,maxAgeSeconds:300},solana:solana.state,hyperliquid:hyperliquid.state,fees:{...base.fees,solSaleBps:solana.quote.solSaleBps},timing:base.timing};}
async function loadPositions(){
 const solanaAddress=$('#solana-address').value.trim(), hlAddress=$('#hl-address').value.trim();
 const sequence=++importSequence, version=revision, button=$('#load-positions');
 button.disabled=true;setImportStatus('Loading positions from public APIs…');
 try{
  const [solana,hyperliquid]=await Promise.all([importSolana(solanaAddress),importHyperliquid(hlAddress)]);
  if(sequence!==importSequence)return;
  if($('#solana-address').value.trim()!==solanaAddress||$('#hl-address').value.trim()!==hlAddress){setImportStatus('Addresses changed while loading. Press Load positions again.',true);return;}
  if(version!==revision){setImportStatus('Load cancelled because the conditions changed while loading. Press Load positions again.',true);return;}
  const candidate=buildImportedPortfolio(solana,hyperliquid);
  const check=planExit(candidate,defaultConstraints());
  if(check.errors.length){setImportStatus(`Imported portfolio is not supported: ${check.errors[0]}`,true);return;}
  portfolio=candidate;imported={solana,hyperliquid,at:Date.now()};
  const bufferNow=initialHlBuffer();let floorNote='';
  if(bufferNow<constraints.minHlBuffer){constraints.minHlBuffer=Math.max(0,Math.floor(bufferNow/2));floorNote=` · margin floor set to ${money(constraints.minHlBuffer)} (half the current buffer of ${money(bufferNow)})`;}
  recalculate();renderSource();
  const emptyHl=hyperliquid.state.shortSol===0&&hyperliquid.reported.accountValue===0;
  setImportStatus(loadedStatus()+floorNote+(emptyHl?' · Hyperliquid account has no SOL position and no equity. Phantom Perps users: enter the 0x address from your Phantom wallet':''),emptyHl);toast('Positions loaded from public APIs');
 }catch(error){if(sequence!==importSequence)return;setImportStatus(version!==revision?'Load cancelled because the conditions changed while loading. Press Load positions again.':`Could not load positions: ${error?.message||'unknown error'}`,true);}
 finally{if(sequence===importSequence)button.disabled=false;}
}
$$('input[name="source"]').forEach(radio=>radio.addEventListener('change',e=>{if(e.target.checked)setSource(e.target.value);}));
$('#load-positions').addEventListener('click',loadPositions);
const EXAMPLE={solana:'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK',hyperliquid:'0x4bdf1130109e9c1bc921d8979ea66284d9c92f37'};
$('#load-example').addEventListener('click',()=>{setSource('import');$('#solana-address').value=EXAMPLE.solana;$('#hl-address').value=EXAMPLE.hyperliquid;loadPositions();});
function planLink(){return `${location.origin}/#sol=${encodeURIComponent(imported.solana.address)}&hl=${encodeURIComponent(imported.hyperliquid.address)}&target=${constraints.target}`;}
$('#share-link').addEventListener('click',async()=>{if(!imported)return;const link=planLink();let copied=false;try{await navigator.clipboard.writeText(link);copied=true;}catch{}toast(`${copied?'Link copied':'Plan link'}: ${link}`);});
function applyDeepLink(){let params;try{params=new URLSearchParams((location.hash||'').replace(/^#/,''));}catch{return;}const sol=params.get('sol')?.trim(), hl=params.get('hl')?.trim(), target=Number(params.get('target'));if(!sol||!hl)return;setSource('import');$('#solana-address').value=sol;$('#hl-address').value=hl;if(Number.isFinite(target)&&target>0){constraints.target=target;markCustom();recalculate();}loadPositions();}
recalculate();renderGuide();renderSource();checkAiStatus();applyDeepLink();

import {createDemoPortfolio,defaultConstraints,planExit} from './engine.mjs';

const $ = (query, root=document) => root.querySelector(query);
const $$ = (query, root=document) => [...root.querySelectorAll(query)];
const portfolio=createDemoPortfolio();
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
function hydrateIcons(root=document){$$('[data-icon]',root).forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
hydrateIcons();

function planName(p){
 if(p.id==='no-action')return '현재 상태 유지';
 const actions=p.steps||[];
 const hasLend=actions.some(s=>s.action.startsWith('Withdraw lending'));
 const hasHl=actions.some(s=>s.action.startsWith('Withdraw and transfer'));
 if(p.newDebt>0)return hasLend||hasHl?'예치금 회수 + 추가 대출':'SOL 담보 추가 대출';
 if(p.solSold>0&&p.shortReduced>0)return hasLend||hasHl?'예치금 회수 + 현물·숏 동시 축소':'현물·숏 함께 축소';
 if(p.solSold>0)return 'SOL만 매도';
 if(hasLend&&hasHl)return 'Solana + HL 나눠서 회수';
 if(hasLend)return 'Solana 예치 USDC 회수';
 if(hasHl)return 'HL 여유 담보 회수';
 return '현금 확보 경로';
}
function stepName(s){return s.action.startsWith('Withdraw lending')?'예치 USDC 인출':s.action.startsWith('Sell SOL')?'SOL 현물 매도':s.action.startsWith('Reduce SOL')?'SOL 숏 같은 수량 축소':s.action.startsWith('Borrow')?'SOL 담보 대출 비교':'HL 담보 인출 · Solana 이동';}
function stepVenue(s){return s.venue.startsWith('Hyperliquid')?'Hyperliquid':'Solana';}
function planDescription(p){return p.steps.map(s=>`${stepName(s)} ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}`).join(' → ')||'이동할 자산 없음';}
function rejectionText(p){
 const reasons=[];
 if(p.netCash<constraints.target)reasons.push(`목표보다 ${money(constraints.target-p.netCash)} 부족`);
 if(constraints.preserveSolQuantity&&p.solSold>0)reasons.push('SOL 수량 유지 조건에 맞지 않음');
 if(constraints.preserveHedge&&Math.abs(p.solSold-p.shortReduced)>0.0000005)reasons.push('현물과 숏 불균형으로 순 SOL 노출 변경');
 if(p.newDebt>constraints.maxNewDebt)reasons.push(`추가 대출 ${money(p.newDebt)}이 한도 초과`);
 if(p.hlBufferAfter<constraints.minHlBuffer)reasons.push('최소 마진 여유액 미달');
 if(p.estimatedHours>constraints.deadlineHours)reasons.push('계획 기간을 초과하는 가정');
 return reasons.join(' · ')||'시나리오 인출 또는 포지션 한도 초과';
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
function renderPlans(){
 $('#route-count').textContent=`조건 충족 ${result.feasible.length} / ${result.plans.length}`;
 const banner=$('#result-banner');
 banner.classList.toggle('empty',!result.best);
 if(result.errors.length){banner.innerHTML=`<span>${icon('warning')}</span><div><strong>입력값을 확인해 주세요</strong><p>현금 목표와 마진 여유액은 0 이상의 숫자로 입력해 주세요</p></div>`;}
 else if(result.best){banner.innerHTML=`<span>${icon('check')}</span><div><strong>${money(constraints.target)} 목표에 맞는 경로가 있어요</strong><p>초기 수수료가 가장 낮은 평가 후보를 표시해요 · 실제 실행 검증 전</p></div>`;}
 else{banner.innerHTML=`<span>${icon('warning')}</span><div><strong>현재 조건을 모두 만족하는 경로가 없어요</strong><p>SOL·숏 수량 유지, 신규 대출 없이 최대 ${money(result.maximumWithoutSelling)}. 목표나 제약을 조정해 다시 비교하세요.</p></div>`;}
 $('#plans').innerHTML=displayedPlans().map(p=>`<div class="plan-card ${p.feasible?'':'rejected'} ${selectedId===p.id?'selected':''}" data-plan="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(planName(p))}, ${p.feasible?'조건 충족, 선택하기':'조건 미충족, 이유 보기'}" aria-pressed="${selectedId===p.id}"><div class="plan-header"><span class="radio-mark" aria-hidden="true">${p.feasible?'':'!'}</span><h3>${planName(p)}</h3>${p.id===result.best?.id?'<span class="plan-badge">최소 초기비용</span>':p.feasible?'':'<span class="plan-badge rejected">조건 미충족</span>'}<div class="plan-cash"><small>순현금</small>${money(p.netCash)}</div></div><p class="plan-description">${esc(planDescription(p))}</p><div class="plan-metrics"><span>수수료 <b>${money(p.fees,true)}</b></span><span>신규 대출 <b>${money(p.newDebt)}</b></span><span>단계 <b>${p.steps.length}</b></span></div>${p.feasible?'':`<p class="rejection">${esc(rejectionText(p))}</p>`}</div>`).join('')+`<button id="all-plans" class="all-plans-button">${result.plans.length}개 평가 후보와 계산 근거 보기 ${icon('arrow')}</button>`;
 $$('[data-plan]').forEach(el=>{const activate=()=>selectPlan(el.dataset.plan);el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});});
 $('#all-plans').addEventListener('click',()=>openEvidence(true));
}
function selectPlan(id){const p=result.plans.find(p=>p.id===id);if(!p)return;if(!p.feasible){openRejected(p);return;}selectedId=id;rehearsal=null;renderPlans();renderPositions();renderDecision();}
function renderPositions(){
 const p=result.plans.find(p=>p.id===selectedId&&p.feasible);
 const currentBuffer=portfolio.hyperliquid.collateral-portfolio.hyperliquid.shortSol*portfolio.hyperliquid.markPrice*portfolio.hyperliquid.conservativeMarginRate;
 const positionCards=[
  {name:'Solana · SOL 현물',icon:'coins',before:portfolio.solana.sol,after:p?.solAfter,unit:'SOL',cash:false,caption:p?.solSold>0?`${num(p.solSold)} SOL 매도`:'SOL 보유 수량',bar:p?p.solAfter/portfolio.solana.sol:1},
  {name:'Hyperliquid · SOL 숏',icon:'hedge',before:portfolio.hyperliquid.shortSol,after:p?.shortAfter,unit:'SOL',cash:false,caption:p?.shortReduced>0?`${num(p.shortReduced)} SOL 숏 축소`:'하락 노출을 상쇄하는 숏',bar:p?p.shortAfter/portfolio.hyperliquid.shortSol:1},
  {name:'HL · 마진 여유액',icon:'shield',before:currentBuffer,after:p?.hlBufferAfter,unit:'',cash:true,caption:`설정한 하한 ${money(constraints.minHlBuffer)} · 단순 가정`,bar:p?p.hlBufferAfter/currentBuffer:1},
  {name:'Solana · 예치 USDC',icon:'wallet',before:portfolio.solana.lending.usdc,after:p?.lendingAfter,unit:'',cash:true,caption:'출금 전 예치 잔액 기준',bar:p?p.lendingAfter/portfolio.solana.lending.usdc:1}
 ];
 $('#position-cards').innerHTML=positionCards.map(c=>`<article class="position-card"><div class="position-label">${icon(c.icon)}${c.name}</div><div class="position-values"><span class="position-before">${c.cash?money(c.before):num(c.before)}</span><span class="position-arrow">→</span><span class="position-after">${p?(c.cash?money(c.after):num(c.after)):'—'}<small>${c.unit}</small></span></div><div class="position-bar"><span data-bar="${Math.round(Math.max(0,Math.min(100,c.bar*100)))}"></span></div><div class="position-caption">${c.caption}</div></article>`).join('');
 $$('[data-bar]').forEach(bar=>{bar.style.width=bar.dataset.bar+'%';});
 const delta=p?p.netSolExposure:null;
 $('#portfolio-caption').innerHTML=icon('info')+(p?`선택 경로 이후 순 SOL 노출 ${num(delta)} SOL · ${Math.abs(delta)<.000001?'현물과 숏의 수량 균형 유지':'가격 변동에 대한 노출이 달라져요'} · 현금 도착지는 Solana 지갑의 USDC 가정`:'조건을 만족하는 경로를 선택하면 전후 포지션이 표시돼요');
}
function renderDecision(){const p=result.plans.find(p=>p.id===selectedId&&p.feasible);$('#rehearse').disabled=!p;$('#decision-content').innerHTML=p?`<div class="decision-label">${planName(p)}</div><div class="decision-summary"><strong>${money(p.netCash)}</strong><span>수수료 반영 순 USDC</span></div><p class="decision-detail">${p.steps.length}개 단계 · 추정 초기 수수료 ${money(p.fees,true)}${p.newDebt>0?`<br>신규 대출 ${money(p.newDebt)} · 일일 이자 추정 ${money(p.borrowDailyCarryEstimate,true)} 별도<br>담보 제공 ${num(p.solPledgedAfter)} SOL 가정 · 실제 대출 미지원`:''}<br>거래 순서와 위험을 리허설에서 살펴보세요</p>`:'<div class="decision-label">조건 조정이 필요해요</div><div class="decision-summary"><strong>—</strong><span>선택 가능한 경로 없음</span></div><p class="decision-detail">목표를 낮추거나, SOL 수량 유지·추가 대출 조건을 직접 조정하세요</p>';}
function updateControls(){$('#target').value=constraints.target;$('#preserve-sol').checked=constraints.preserveSolQuantity;$('#preserve-hedge').checked=constraints.preserveHedge;$('#min-buffer').value=constraints.minHlBuffer;const debt=$('#max-debt');$$('option[data-custom]',debt).forEach(n=>n.remove());if(![...debt.options].some(o=>Number(o.value)===constraints.maxNewDebt)){const o=document.createElement('option');o.value=constraints.maxNewDebt;o.textContent=`최대 ${money(constraints.maxNewDebt)}`;o.dataset.custom='true';debt.append(o);}debt.value=constraints.maxNewDebt;$$('[data-target]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.target)===constraints.target));$('.deadline-note').innerHTML=icon('clock')+`계획 기간 ${num(constraints.deadlineHours)}시간 · 가정값 즉시 재계산`;}
function recalculate({sync=true}={}){
 revision++;requestSequence++;proposal=null;rehearsal=null;
 if($('#detail-dialog').open)$('#detail-dialog').close();
 if($('#intent-feedback').textContent)$('#intent-feedback').textContent='조건이 바뀌어 이전 제안을 초기화했어요';
 $('#intent-submit').disabled=false;
 result=planExit(portfolio,constraints);selectedId=result.best?.id||null;
 if(sync)updateControls();renderPlans();renderPositions();renderDecision();
}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function markCustom(){ $('#guide-title').textContent='직접 조정한 조건을 비교하고 있어요'; $('#guide-caption').textContent='선택 경로와 전후 포지션을 확인하세요. 오른쪽 화살표로 다음 가상 시나리오를 볼 수 있어요'; }
function changed(){markCustom();recalculate();}
$('#target').addEventListener('input',e=>{constraints.target=e.target.value.trim()===''?NaN:Number(e.target.value);markCustom();recalculate({sync:false});$$('[data-target]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.target)===constraints.target));});
$('#min-buffer').addEventListener('input',e=>{constraints.minHlBuffer=e.target.value.trim()===''?NaN:Number(e.target.value);markCustom();recalculate({sync:false});});
$('#preserve-sol').addEventListener('change',e=>{constraints.preserveSolQuantity=e.target.checked;changed();});
$('#preserve-hedge').addEventListener('change',e=>{constraints.preserveHedge=e.target.checked;changed();});
$('#max-debt').addEventListener('change',e=>{constraints.maxNewDebt=Number(e.target.value);changed();});
$$('[data-target]').forEach(button=>button.addEventListener('click',()=>{constraints.target=Number(button.dataset.target);changed();}));
$$('[data-scroll]').forEach(button=>button.addEventListener('click',()=>$('#'+button.dataset.scroll).scrollIntoView({behavior:'smooth',block:'start'})));

const guides=[
 {title:'먼저, 현금 목표를 정해볼까요?',caption:'$2,000을 확보하면서 헤지를 유지하면, 어떤 포지션이 달라지는지 확인하세요',next:'SOL 유지 조건 보기',patch:{target:2000,preserveSolQuantity:false,preserveHedge:true,maxNewDebt:0}},
 {title:'SOL은 그대로 두고, $5,000이 필요하다면?',caption:'회수 가능한 예치금과 여유 담보를 합쳐도 부족해요. 조건 미충족 이유를 눌러보세요',next:'두 포지션 함께 조정',patch:{target:5000,preserveSolQuantity:true,preserveHedge:true,maxNewDebt:0}},
 {title:'현물과 숏을 함께 줄이면 경로가 생겨요',caption:'SOL 수량 유지 조건만 풀었어요. 순 SOL 노출과 마진 여유액이 어떻게 달라지는지 비교하세요',next:'처음부터 비교',patch:{target:5000,preserveSolQuantity:false,preserveHedge:true,maxNewDebt:0}}
];
function renderGuide(){const g=guides[guideStep];$('#guide-count').textContent=`0${guideStep+1} / 03`;$('#guide-title').textContent=g.title;$('#guide-caption').textContent=g.caption;$('#guide-next').innerHTML=esc(g.next)+icon('arrow');$$('.guide-dots i').forEach((d,i)=>d.classList.toggle('current',i===guideStep));}
$('#guide-next').addEventListener('click',()=>{guideStep=(guideStep+1)%3;constraints={...defaultConstraints(),...guides[guideStep].patch};recalculate();renderGuide();toast(guideStep===1?'SOL을 유지하는 $5,000 조건으로 비교했어요':guideStep===2?'SOL과 숏의 동시 축소를 허용했어요':'기본 시나리오로 돌아왔어요');});
$$('.reset-all').forEach(b=>b.addEventListener('click',()=>{constraints=defaultConstraints();guideStep=0;$('#intent').value='';$('#intent-feedback').innerHTML='';recalculate();renderGuide();toast('가상 포트폴리오를 초기화했어요');}));

function openDialog(title,body,eyebrow='SCENARIO DETAILS'){$('#dialog-title').textContent=title;$('#dialog-eyebrow').textContent=eyebrow;$('#dialog-body').innerHTML=body;const dialog=$('#detail-dialog');if(!dialog.open)dialog.showModal();}
$('#close-dialog').addEventListener('click',()=>{$('#detail-dialog').close();rehearsal=null;});
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){e.target.close();rehearsal=null;}}});
$('#detail-dialog').addEventListener('cancel',()=>{rehearsal=null;});
function openRejected(p){openDialog('이 경로가 제외된 이유',`<h3>${esc(planName(p))}</h3><p>${esc(rejectionText(p))}</p><div class="assumption-grid spaced"><div class="assumption-item"><span>확보 가능한 순현금</span><b>${money(p.netCash)}</b></div><div class="assumption-item"><span>현재 현금 목표</span><b>${money(constraints.target)}</b></div><div class="assumption-item"><span>새로운 대출</span><b>${money(p.newDebt)}</b></div><div class="assumption-item"><span>실행 후 순 SOL 노출</span><b>${num(p.netSolExposure)} SOL</b></div></div><h3>계산된 단계</h3><ul>${p.steps.map(s=>`<li>${esc(stepName(s))}: ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}</li>`).join('')}</ul><div class="dialog-disclaimer">제외된 경로는 선택하거나 리허설할 수 없어요. 모든 금액은 가상 포트폴리오 기반 추정치예요.</div>`,'CONSTRAINT CHECK');}
function openEvidence(all=false){
 const current=result.plans.find(p=>p.id===selectedId&&p.feasible);
 const body=`<p>현재 화면의 모든 잔액, 가격, 수수료, 시간은 재현 가능한 가상 입력값이에요. 실계정이나 온체인 상태를 읽지 않았어요.</p><h3>가상 포트폴리오</h3><div class="assumption-grid"><div class="assumption-item"><span>SOL 현물 · 기준가</span><b>100 SOL · $100</b></div><div class="assumption-item"><span>Hyperliquid SOL 숏</span><b>100 SOL · $100</b></div><div class="assumption-item"><span>Solana 예치금</span><b>3,000 USDC</b></div><div class="assumption-item"><span>HL 담보 · 단순 필요 마진</span><b>$4,000 · $1,000</b></div></div><h3>계산 규칙</h3><ul><li>순현금 = 인출 + 매도 + 신규 대출 − 현금에서 차감되는 수수료</li><li>숏 포지션의 명목가치는 현금이 아니에요. 숏 축소 수수료는 HL 담보에서 별도로 차감해요.</li><li>HL 여유액 = 잔여 담보 − 숏 명목가치 × 가정 마진율 10%. 실제 청산가·프로토콜 건전성 지표가 아니에요.</li><li>이 데모의 헤지 유지 조건은 현물 매도량과 숏 축소량을 같게 해 시작 순 SOL 노출을 유지해요. 시작 비율은 1:1이에요.</li><li>순 USDC는 Solana 지갑에 도착한다고 가정해요. 은행 계좌로 입금되는 법정화폐가 아니에요.</li><li>정해진 조합을 평가한 후 초기 수수료가 낮은 순으로 정렬해요. 전역 최적해·투자 권고가 아니에요.</li></ul><h3>추정 수수료 및 대출</h3><p>예치금 인출 $0.25 · SOL 매도 0.30% · 숏 축소 0.05% · HL 이동 $1.00 · 대출 초기비용 $0.50. 신규 대출은 연 8% 가정의 하루 이자를 별도 표시하며, 상환 시점을 모르므로 총이자는 알 수 없어요. 또한, 실제 대출 어댑터는 없어요.</p>${current?`<h3>현재 선택 경로의 현금 흐름</h3><div class="evidence-line"><b>총 유입 ${money(current.grossProceeds,true)}</b> − 현금 수수료 ${money(current.feesFromProceeds,true)} = 순현금 ${money(current.netCash,true)}</div><div class="evidence-line">HL 담보 별도 차감 수수료 ${money(current.feesFromCollateral,true)} · 전체 초기 수수료 ${money(current.fees,true)}</div>`:''}${all?`<h3>평가 후보 전체 · ${result.plans.length}개</h3><p>같은 종류의 경로도 예치금·담보·매도 비중에 따라 별도로 평가해요.</p>${[...result.feasible,...result.plans.filter(p=>!p.feasible)].map(p=>`<div class="evidence-line"><b>${p.feasible?'조건 충족':'제외'} · ${esc(planName(p))}</b><br>순현금 ${money(p.netCash)} · 수수료 ${money(p.fees,true)} · SOL 매도 ${num(p.solSold)} · 신규 대출 ${money(p.newDebt)}${p.feasible?'':'<br>'+esc(rejectionText(p))}</div>`).join('')}`:''}<div class="dialog-disclaimer">지원하지 않는 범위: 실제 지갑 연결, 실시간 시세·유동성·브리지·계정 모드 검증, 실제 대출, 거래 생성·서명·전송, 가격 변동·펀딩·슬리피지·청산 위험의 완전한 모델링. 리허설은 화면 시뮬레이션만 진행해요.</div>`;
 openDialog('숫자의 출처와 계산 가정',body,'EVIDENCE · SYNTHETIC SCENARIO');
}
$('#open-evidence').addEventListener('click',()=>openEvidence());$('#open-assumptions').addEventListener('click',()=>openEvidence());
function renderRehearsal(){if(!rehearsal)return;const {plan,index,version}=rehearsal;if(version!==revision){rehearsal=null;$('#detail-dialog').close();toast('조건이 바뀌어 리허설을 종료했어요');return;}const done=index>=plan.steps.length;openDialog(done?'리허설을 마쳤어요':'한 단계씩, 자산의 흐름 확인',`<p>${esc(planName(plan))} · 목표 순현금 ${money(plan.netCash)}</p><div class="dialog-disclaimer rehearsal-disclaimer">가상 리허설입니다. 화면의 단계를 확인할 뿐, 계정·잔액·포지션을 변경하지 않아요.</div>${plan.steps.map((s,i)=>`<div class="rehearsal-step ${i<index?'done':i===index?'current':''}"><span class="rehearsal-number">${i<index?'✓':i+1}</span><div><h3>${esc(stepName(s))} · ${s.unit==='USDC'?money(s.amount):num(s.amount)+' SOL'}</h3><p>${stepVenue(s)} · ${i<index?'가상 단계 확인 완료':i===index?'현재 확인할 단계':'다음 가상 단계'}${s.action.startsWith('Reduce')?' · 숏의 명목가치는 현금 유입으로 계산하지 않아요':''}</p></div></div>`).join('')}${done?`<div class="rehearsal-complete">${icon('check')}예상 순현금 ${money(plan.netCash)} · 전체 단계 확인 완료</div>`:''}<div class="rehearsal-actions"><button id="rehearsal-reset" class="secondary-button">${done?'다시 보기':'취소'}</button><button id="rehearsal-next" class="primary-button">${done?'비교 화면으로':'이 단계 확인하기'} ${icon('arrow')}</button></div>`,'REHEARSAL · NO TRANSACTIONS');$('#rehearsal-next').addEventListener('click',()=>{if(done){$('#detail-dialog').close();rehearsal=null;}else{rehearsal.index++;renderRehearsal();}});$('#rehearsal-reset').addEventListener('click',()=>{if(done){rehearsal.index=0;renderRehearsal();}else{rehearsal=null;$('#detail-dialog').close();toast('리허설을 취소했어요. 실제 자산은 변경되지 않았어요');}});}
$('#rehearse').addEventListener('click',()=>{const p=result.plans.find(p=>p.id===selectedId&&p.feasible);if(!p)return;rehearsal={plan:structuredClone(p),index:0,version:revision};renderRehearsal();});

const constraintLabels={target:'현금 목표',maxNewDebt:'추가 대출 한도',preserveHedge:'헤지 유지',preserveSolQuantity:'SOL 수량 유지',minHlBuffer:'최소 HL 마진 여유액',deadlineHours:'계획 기간'};
function constraintValue(k,v){return typeof v==='boolean'?(v?'유지':'해제'):k==='deadlineHours'?num(v)+'시간':money(v);}
function setAiStatus(connected){$('#ai-status').textContent=connected?'AI 연결됨':'AI 미연결';$('#ai-status').classList.toggle('connected',connected);}
async function checkAiStatus(){try{const response=await fetch('/api/status',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw new Error();const data=await response.json();setAiStatus(data.aiConfigured===true);if(data.aiConfigured!==true)$('#intent-feedback').innerHTML='<span class="intent-error">AI 미연결 — 위 조건으로 직접 비교할 수 있어요</span>';}catch{setAiStatus(false);$('#intent-feedback').innerHTML='<span class="intent-error">AI 미연결 — 위 조건으로 직접 비교할 수 있어요</span>';}}
$$('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('#intent').value=b.dataset.prompt;$('#intent').focus();}));
$('#intent-form').addEventListener('submit',async e=>{
 e.preventDefault();const text=$('#intent').value.trim();if(!text){$('#intent-feedback').textContent='원하는 목표와 조건을 먼저 입력해 주세요';return;}
 const sequence=++requestSequence, version=revision, base=structuredClone(constraints);proposal=null;$('#intent-submit').disabled=true;$('#intent-feedback').textContent='조건을 해석하고 있어요. 적용 전 변경 내용을 확인해 주세요';
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch('/api/intent',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({text,currentConstraints:base}),signal:controller.signal});
  if(sequence!==requestSequence||version!==revision)return;
  const data=await response.json().catch(()=>({}));
  if(sequence!==requestSequence||version!==revision)return;
  if(!response.ok){if(response.status===503){setAiStatus(false);throw new Error('AI 미연결 — 위 조건으로 직접 비교할 수 있어요');}throw new Error(response.status===429?'요청이 많아 잠시 후 다시 시도해 주세요':'AI 조건 해석에 실패했어요. 위 조건을 직접 조정할 수 있어요');}
  if(data.mode!=='ai')throw new Error('AI 응답을 확인할 수 없어요. 위 조건을 직접 조정해 주세요');
  setAiStatus(true);
  if(!data.constraints||typeof data.constraints!=='object'||Array.isArray(data.constraints))throw new Error('조건 제안 형식을 확인할 수 없어요. 직접 비교를 이용해 주세요');
  const allowed=Object.keys(constraintLabels),badKeys=Object.keys(data.constraints).filter(k=>!allowed.includes(k));
  if(badKeys.length)throw new Error('지원하지 않는 조건이 포함돼 제안을 적용하지 않았어요');
  const proposed={...base,...data.constraints};const validated=planExit(portfolio,proposed);
  if(validated.errors.length)throw new Error('입력 범위를 벗어난 조건이 있어요. 목표와 조건을 다시 알려주세요');
  const questions=Array.isArray(data.questions)?data.questions.filter(q=>typeof q==='string'):[];
  const changes=allowed.filter(k=>base[k]!==proposed[k]);
  proposal={constraints:proposed,version,sequence,questions};
  $('#intent-feedback').innerHTML=`<div class="proposal"><strong>${questions.length?'먼저 확인이 필요해요':'이렇게 변경할까요?'}</strong>${typeof data.explanation==='string'?`<p>${esc(data.explanation)}</p>`:''}${changes.length?`<ul>${changes.map(k=>`<li>${constraintLabels[k]}: ${esc(constraintValue(k,base[k]))} → ${esc(constraintValue(k,proposed[k]))}</li>`).join('')}</ul>`:'<p>현재 조건과 같은 제안이에요</p>'}${questions.length?`<ul>${questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><p>답변을 포함해 다시 요청하면 새 제안을 확인할 수 있어요</p>`:`<div class="proposal-actions"><button id="apply-intent" ${changes.length?'':'disabled'}>확인 후 적용</button><button id="dismiss-intent">취소</button></div>`}</div>`;
  $('#apply-intent')?.addEventListener('click',()=>{if(!proposal||proposal.questions.length||proposal.version!==revision||proposal.sequence!==requestSequence){$('#intent-feedback').textContent='조건이 변경됐어요. 다시 해석해 주세요';return;}constraints=structuredClone(proposal.constraints);markCustom();recalculate();$('#intent-feedback').textContent='확인한 조건을 적용해 다시 비교했어요';toast('확인한 AI 제안을 적용했어요');});
  $('#dismiss-intent')?.addEventListener('click',()=>{proposal=null;$('#intent-feedback').textContent='제안을 취소했어요';});
 }catch(error){if(sequence!==requestSequence||version!==revision)return;$('#intent-feedback').innerHTML=`<span class="intent-error">${esc(error.name==='AbortError'?'응답이 늦어 요청을 종료했어요. 직접 조건을 조정하거나 다시 시도해 주세요':error.message)}</span>`;}
 finally{clearTimeout(timeout);if(sequence===requestSequence)$('#intent-submit').disabled=false;}
});
$('#refresh-market').addEventListener('click',async()=>{const button=$('#refresh-market');button.disabled=true;$('#market-reference-value').textContent='Hyperliquid의 공개 SOL 무기한 선물 중간값을 조회하고 있어요';try{const response=await fetch('/api/market',{credentials:'same-origin',headers:{Accept:'application/json'}});if(!response.ok)throw new Error();const data=await response.json();if(data.evidence!=='live-market'||!Number.isFinite(data.solUsd)||data.solUsd<=0)throw new Error();const time=new Date(data.observedAt);const observed=Number.isNaN(time.getTime())?'조회 시점 미확인':time.toLocaleString('ko-KR',{timeZone:'UTC',hour12:false})+' UTC';$('#market-reference-value').textContent=`공개 SOL 무기한 선물 중간값 ${money(data.solUsd,true)} · ${observed}. 체결가가 아니며 가상 계산에는 반영하지 않았어요`;}catch{$('#market-reference-value').textContent='공개 시장값을 불러오지 못했어요. 가상 계산은 SOL $100 가정으로 유지돼요';}finally{button.disabled=false;}});
$('#sol-price').textContent='SOL '+money(portfolio.solana.solPrice,true);
recalculate();renderGuide();checkAiStatus();

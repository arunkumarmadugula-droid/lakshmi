/* Lakshmi — shared business logic (formatting, storage, analytics, AI calls). Plain ES module. */

export const CATS = ["Groceries","Rent","Mortgage","Utilities","Dining","Fuel","Household","Health","Insurance","Subscriptions","Shopping","Transport","Entertainment","Education","Personal","Travel","Recreation","Kids","India","Other"];
export const CAT_ICO = {Groceries:"🥬",Rent:"🏠",Mortgage:"🏦",Utilities:"💡",Dining:"🍽️",Fuel:"⛽",Household:"🧺",Health:"🩺",Insurance:"🛡️",Subscriptions:"🔁",Shopping:"🛍️",Transport:"🚌",Entertainment:"🎬",Education:"📚",Personal:"🌿",Travel:"🧳",Recreation:"🎯",Kids:"🧸",India:"🇮🇳",Other:"◇","Card payment":"💳"};
export const FREQS = [["weekly","Weekly"],["biweekly","Bi-weekly"],["semimonthly","Semi-monthly"],["monthly","Monthly"],["quarterly","Quarterly"],["annual","Annual"]];
export const SRCS = [["bank","Bank account"],["card","Credit card"],["cash","Cash"],["other","Other"]];
/* common named items per category — quick-tap presets when itemizing a budget */
export const ITEM_PRESETS = {
  Subscriptions: ["Netflix","Prime Video","Spotify","Disney+","YouTube Premium","iCloud+","ChatGPT Plus","Gym membership"],
  Fuel: ["Car wash","Oil change"],
  Utilities: ["Internet","Phone plan","Electricity","Water","Gas heating"],
  Insurance: ["Auto insurance","Home insurance","Health insurance","Life insurance"],
  Household: ["Cleaning service","Lawn care"],
  Health: ["Gym membership","Therapy"],
  Personal: ["Haircut","Skincare"],
  Entertainment: ["Spotify","Disney+","Apple TV+"],
  Kids: ["Daycare","School fees","Toys","Diapers","Kids clothing","Extracurricular"],
};
/* AI prompt for reading a credit card statement photo */
export const CARD_SCAN_PROMPT = `Read this credit card statement. Reply ONLY minified JSON:
{"cardName":"","totalDue":0,"minPayment":0,"statementDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD"}
statementDate = statement generation/closing date. dueDate = payment due date. Leave a field blank/0 if unclear.`;
/* normalize an item name for cross-store price matching */
export const normItemName = n => (n||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
/* items bought at 2+ different stores — cheapest vs priciest, sorted by potential savings */
export function itemPriceComparisons(data, limit=5){
  const byItem = {};
  data.expenses.forEach(e => {
    if (!e.items || !e.items.length || !e.store) return;
    e.items.forEach(it => {
      const norm = normItemName(it.name);
      if (!norm || norm.length<3) return;
      const q = Math.max(1, +it.qty||1);
      const price = (+it.lineTotal||0)/q; if (price<=0) return;
      byItem[norm] = byItem[norm] || { label: it.name, stores:{} };
      const st = byItem[norm].stores[e.store] = byItem[norm].stores[e.store] || { store:e.store, min:Infinity, max:0, count:0 };
      st.min = Math.min(st.min, price); st.max = Math.max(st.max, price); st.count++;
    });
  });
  return Object.values(byItem).filter(x => Object.keys(x.stores).length>=2).map(x => {
    const stores = Object.values(x.stores).sort((a,b)=>a.min-b.min);
    const cheapest = stores[0], priciest = stores[stores.length-1];
    return { label:x.label, cheapest, priciest, savings: priciest.min-cheapest.min, storeCount: stores.length };
  }).filter(r => r.savings > 0.05).sort((a,b)=>b.savings-a.savings).slice(0, limit);
}

export const fmt = (n, d=2) => (isFinite(+n)?+n:0).toLocaleString("en-CA",{style:"currency",currency:"CAD",minimumFractionDigits:d,maximumFractionDigits:d});
export const fmt0 = n => fmt(n,0);
export const pad = n => String(n).padStart(2,"0");
export const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
export const thisMonth = () => todayISO().slice(0,7);
export const ym = d => (d||"").slice(0,7);
export const dim = mk => { const [y,m]=mk.split("-").map(Number); return new Date(y,m,0).getDate(); };
export const addDays = (iso,n) => { const d=new Date(iso+"T12:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
export const addMonths = (mk,n) => { const [y,m]=mk.split("-").map(Number); const d=new Date(y,m-1+n,1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
export const monthLabel = mk => new Date(mk+"-02T12:00:00").toLocaleDateString("en-CA",{month:"long",year:"numeric"});
export const shortDate = iso => new Date(iso+"T12:00:00").toLocaleDateString("en-CA",{month:"short",day:"numeric"});
export const lastMonths = n => { let out=[],mk=thisMonth(); for(let i=n-1;i>=0;i--) out.push(addMonths(mk,-i)); return out; };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-"+Math.random().toString(36).slice(2)+Date.now());
export const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export const haptic = ms => { try{ navigator.vibrate && navigator.vibrate(ms||8); }catch(e){} };

/* ───────── storage ───────── */
export const KEY = "lakshmi-v2", OLD = ["lakshmi-v1","finledger-v2","finledger-v1"];
export const emptyData = { v:2, expenses:[], fuel:[], budgets:{}, recurring:[], cards:[], settlements:[], receivables:[], incomes:[],
  settings:{ theme:"light", inrRate:62, indiaMonthlyINR:0, savingsGoal:1000, cashOnHand:0, pin:"", payslip:null } };
export function migrateV1(d){
  const s = d.settings||{};
  const incomes = (s.incomes||[]).map(i => ({ id:i.id||uid(), name:i.name||"Salary", type:"recurring",
    net:+i.amount||0, freq:i.freq||"biweekly", nextPay:"", overrides:{} }));
  if (!incomes.length && +s.salary>0) incomes.push({ id:uid(), name:"Primary salary", type:"recurring",
    net:Math.round((+s.salary)/26), freq:"biweekly", nextPay:"", overrides:{} });
  const recurring = (d.recurring||[]).map(r => ({ id:r.id||uid(), name:r.store||r.name||"Fixed expense",
    amount:+r.total||+r.amount||0, category:r.category||"Other", freq:"monthly", start:thisMonth()+"-01",
    paySource:"bank", cardId:"", reminderDays:3, overrides:{} }));
  return { ...emptyData, expenses:d.expenses||[], fuel:d.fuel||[], budgets:d.budgets||{}, recurring, incomes,
    settings:{ ...emptyData.settings, inrRate:+s.inrRate||62, indiaMonthlyINR:+s.indiaMonthlyINR||0,
      savingsGoal:+s.savingsGoal||1000, pin:s.pin||"" } };
}
export function loadData(){
  try{ const raw=localStorage.getItem(KEY); if(raw){ const d=JSON.parse(raw);
    return { ...emptyData, ...d, settings:{...emptyData.settings, ...d.settings} }; } }catch(e){}
  for (const k of OLD){ try{ const raw=localStorage.getItem(k); if(raw) return migrateV1(JSON.parse(raw)); }catch(e){} }
  return JSON.parse(JSON.stringify(emptyData));
}
export const saveData = d => { try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){ console.error(e); } };

/* ───────── AI: user's own key, on-device only ───────── */
export const AI_KEY = "lakshmi-ai", USE_KEY = "lakshmi-ai-usage";
export const getAI = () => { try{ return JSON.parse(localStorage.getItem(AI_KEY))||{}; }catch(e){ return {}; } };
export const setAI = c => localStorage.setItem(AI_KEY, JSON.stringify(c));
export const PRICE = { openai:{i:0.15,o:0.60}, anthropic:{i:1.0,o:5.0} };
export function meter(provider, inTok, outTok){
  try{ const u=JSON.parse(localStorage.getItem(USE_KEY)||"{}"); const mk=thisMonth();
    const m=u[mk]||{calls:0,cost:0}; const p=PRICE[provider]||PRICE.openai;
    m.calls++; m.cost += (inTok*p.i + outTok*p.o)/1e6; u[mk]=m;
    localStorage.setItem(USE_KEY, JSON.stringify(u)); }catch(e){}
}
export const usage = () => { try{ return (JSON.parse(localStorage.getItem(USE_KEY)||"{}")[thisMonth()])||{calls:0,cost:0}; }catch(e){ return {calls:0,cost:0}; } };
export function shrink(dataUrl, maxSide=1024, q=0.72){
  return new Promise(res => { const img=new Image();
    img.onload=()=>{ const r=Math.min(1, maxSide/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*r); c.height=Math.round(img.height*r);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      res(c.toDataURL("image/jpeg",q)); };
    img.onerror=()=>res(dataUrl); img.src=dataUrl; });
}
export async function askAI(content, maxTokens=700){
  const { provider="openai", key="" } = getAI();
  if(!key) throw new Error("Add your AI key first — Settings → AI");
  const est = c => Math.ceil(c.reduce((a,b)=> a + (b.type==="image"?1100:(b.text||"").length/4), 0));
  let out="";
  if (provider==="openai"){
    const res = await fetch("https://api.openai.com/v1/chat/completions",{ method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${key}` },
      body:JSON.stringify({ model:"gpt-4o-mini", max_tokens:maxTokens,
        messages:[{ role:"user", content:content.map(b => b.type==="image"
          ? { type:"image_url", image_url:{ url:`data:${b.media};base64,${b.data}` } }
          : { type:"text", text:b.text }) }] }) });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message||"OpenAI error");
    out = d.choices?.[0]?.message?.content||"";
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages",{ method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":key,
        "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
      body:JSON.stringify({ model:"claude-haiku-4-5", max_tokens:maxTokens,
        messages:[{ role:"user", content:content.map(b => b.type==="image"
          ? { type:"image", source:{ type:"base64", media_type:b.media, data:b.data } }
          : { type:"text", text:b.text }) }] }) });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message||"AI error");
    out = (d.content||[]).map(x=>x.text||"").join("");
  }
  meter(provider, est(content), Math.ceil(out.length/4));
  return out;
}
export const parseJSON = t => { const m=t.match(/\{[\s\S]*\}|\[[\s\S]*\]/); return JSON.parse(m?m[0]:t); };
export const SCAN_PROMPT = `Read this receipt. Reply ONLY minified JSON:
{"kind":"fuel"|"expense","store":"","date":"YYYY-MM-DD","category":"<one of: ${CATS.join("|")}>","subtotal":0,"tax":0,"total":0,"litres":0,"fuelType":"","items":[{"name":"","qty":1,"lineTotal":0}]}
kind=fuel only for gas-station fuel. Max 12 items; merge tiny ones. If unsure of date use "".`;
export const PAYSLIP_PROMPT = `Read this payslip. Reply ONLY minified JSON:
{"gross":0,"fedTax":0,"provTax":0,"cpp":0,"ei":0,"pension":0,"otherDeductions":0,"net":0,"payFreq":"weekly|biweekly|semimonthly|monthly","employer":""}
Amounts are for this single pay period. Combine taxes if not split.`;

/* ───────── local analytics engine (zero AI tokens) ───────── */
export const isSettled = e => e.kind === "settlement";
/* cash-basis: card purchases leave cash only when the bill is settled; card expenses with no linked card count as cash */
export const isCashOutflow = e => isSettled(e) || e.paySource !== "card" || !e.cardId;
export const cashOutM = (data, mk) => data.expenses.filter(e => ym(e.date)===mk && isCashOutflow(e)).reduce((a,e)=>a+(+e.total||0),0);
export const monthExp = (data, mk) => data.expenses.filter(e => ym(e.date)===mk && !isSettled(e));
export const catSpend = (data, mk) => { const o={}; monthExp(data,mk).forEach(e => { o[e.category]=(o[e.category]||0)+(+e.total||0); }); return o; };
export const totSpend = (data, mk) => monthExp(data,mk).reduce((a,e)=>a+(+e.total||0),0);

export function occurrences(rec, mk){
  const out=[], start=rec.start||mk+"-01", sd=new Date(start+"T12:00:00");
  const push = iso => { if (ym(iso)===mk) out.push(iso); };
  if (rec.freq==="monthly"){ push(`${mk}-${pad(Math.min(sd.getDate(), dim(mk)))}`); }
  else if (rec.freq==="semimonthly"){ push(`${mk}-01`); push(`${mk}-15`); }
  else if (rec.freq==="quarterly" || rec.freq==="annual"){
    const step = rec.freq==="quarterly"?3:12;
    const diff = (parseInt(mk)*12+parseInt(mk.slice(5))) - (sd.getFullYear()*12+sd.getMonth()+1);
    if (diff>=0 && diff%step===0) push(`${mk}-${pad(Math.min(sd.getDate(), dim(mk)))}`);
  } else {
    const step = rec.freq==="weekly"?7:14, first=new Date(mk+"-01T12:00:00");
    let d=new Date(sd); const ms=step*864e5;
    if (d<first) d=new Date(d.getTime()+Math.ceil((first-d)/ms)*ms);
    while (ym(d.toISOString().slice(0,10))===mk){ push(d.toISOString().slice(0,10)); d=new Date(d.getTime()+ms); }
  }
  return out;
}
export const recAmount = (rec, mk) => { const o=rec.overrides?.[mk]; return o&&o.amount!=null ? +o.amount : +rec.amount||0; };
export const recStatus = (rec, mk, iso) => {
  const o=rec.overrides?.[mk]||{}; if (o.status) return o.status;
  return iso < todayISO() ? "missed" : "upcoming";
};
export function monthItems(data, mk){
  const items=[];
  data.recurring.forEach(r => occurrences(r,mk).forEach(iso => {
    const o=r.overrides?.[mk]||{};
    items.push({ type:"rec", id:r.id, name:r.name, category:r.category, ico:CAT_ICO[r.category]||"◇",
      date:o.snooze||iso, amount:recAmount(r,mk), status:recStatus(r,mk,o.snooze||iso),
      paySource:r.paySource, cardId:r.cardId, reminderDays:r.reminderDays??3 });
  }));
  data.cards.forEach(c => {
    const iso=`${mk}-${pad(Math.min(+c.dueDay||21, dim(mk)))}`;
    const bill=(c.bills||{})[mk]; const st=(c.paidMonths||{})[mk]?"paid":(iso<todayISO()?"missed":"upcoming");
    items.push({ type:"card", id:c.id, name:`${c.name} bill`, category:"Card payment", ico:"💳",
      date:iso, amount:bill!=null?+bill:+c.currentBill||0, minPay:+c.minPayment||0, status:st, reminderDays:c.reminderDays??3 });
  });
  const ind=(+data.settings.indiaMonthlyINR||0)/(+data.settings.inrRate||1);
  if (ind>0) items.push({ type:"india", id:"india", name:"India transfer", category:"India", ico:"🇮🇳",
    date:`${mk}-05`, amount:ind, status:"upcoming", reminderDays:3 });
  return items.sort((a,b)=>a.date<b.date?-1:1);
}
export function incomeEvents(data, mk){
  const out=[];
  data.incomes.forEach(s => {
    if (s.type==="one"){ if (ym(s.date)===mk) out.push({ id:s.id, k:s.id+s.date, name:s.name, date:s.date, amount:+s.net||0, one:true }); return; }
    if (!s.nextPay) return;
    const step = s.freq==="weekly"?7 : s.freq==="biweekly"?14 : 0;
    let dates=[];
    if (step){ let d=s.nextPay;
      while (ym(d)>mk) d=addDays(d,-step);
      while (ym(d)<mk) d=addDays(d,step);
      while (ym(d)===mk){ dates.push(d); d=addDays(d,step); } }
    else if (s.freq==="semimonthly") dates=[`${mk}-15`,`${mk}-${dim(mk)===31?"31":pad(dim(mk))}`];
    else dates=[`${mk}-${pad(Math.min(new Date((s.nextPay||mk+"-28")+"T12:00:00").getDate(), dim(mk)))}`];
    dates.forEach(d => { const o=(s.overrides||{})[d]||{};
      if (o.skip) return;
      out.push({ id:s.id, k:s.id+d, name:s.name, date:o.moveTo||d, amount:o.amount!=null?+o.amount:+s.net||0 }); });
  });
  return out.sort((a,b)=>a.date<b.date?-1:1);
}
export const monthIncome = (data, mk) => incomeEvents(data,mk).reduce((a,e)=>a+e.amount,0);
/* the balance checkpoint auto-grows on a CASH basis: anchor + (income - cash outflows) of each month
   since it was set. Card purchases don't reduce cash here — their settlement (bill payment) does,
   which fixes the old double-count of card spend. Flows on/before the anchor date are already
   inside the typed balance, so they're skipped. */
export function rollingBalanceBase(data, mk){
  const anchor = +data.settings.cashOnHand||0;
  const aISO = data.settings.cashOnHandDate || todayISO();
  const aMk = ym(aISO);
  if (mk <= aMk) return anchor;
  let bal = anchor, m = aMk;
  while (m < mk){
    const after = d => m > aMk || d > aISO;
    const inc = incomeEvents(data,m).filter(e => after(e.date)).reduce((a,e)=>a+e.amount,0);
    const out = data.expenses.filter(e => ym(e.date)===m && isCashOutflow(e) && after(e.date)).reduce((a,e)=>a+(+e.total||0),0);
    bal += inc - out; m = addMonths(m,1);
  }
  return bal;
}
export function projection(data, mk){
  const days=dim(mk), today=todayISO(), start=rollingBalanceBase(data,mk);
  const aISO = data.settings.cashOnHandDate || "";
  const anchorInMonth = ym(aISO)===mk ? aISO : "";
  const inflow={}, schedOut={}, actualOut={};
  incomeEvents(data,mk).forEach(e => inflow[e.date]=(inflow[e.date]||0)+e.amount);
  monthItems(data,mk).forEach(it => {
    if (it.status==="skipped"||it.status==="paid") return;
    if (it.type==="rec" && it.paySource==="card") return;  /* exits cash via the card bill instead */
    if (it.status==="missed") return;                      /* unpaid = cash hasn't left; alerts nag */
    schedOut[it.date]=(schedOut[it.date]||0)+it.amount;
  });
  data.expenses.forEach(e => { if (ym(e.date)===mk && isCashOutflow(e)) actualOut[e.date]=(actualOut[e.date]||0)+(+e.total||0); });
  const spent=catSpend(data,mk); const fixedCats=new Set(data.recurring.map(r=>r.category));
  let varBudget=0; Object.entries(data.budgets).forEach(([c,b])=>{ if(!fixedCats.has(c)&&c!=="Rent") varBudget+=Math.max(0,(+b||0)-(spent[c]||0)); });
  /* only the cash-paid share of future variable spending should drain projected cash */
  const nonCard = monthExp(data,mk).filter(e=>e.paySource!=="card").reduce((a,e)=>a+(+e.total||0),0);
  const allSp = totSpend(data,mk);
  const cashRatio = allSp>40 ? clamp(nonCard/allSp,0,1) : 1;
  const dayN=Math.min(+today.slice(8,10), days), leftDays=Math.max(1,days-dayN);
  const pace=(varBudget/leftDays)*cashRatio;
  let bal=start, pts=[];
  for(let d=1; d<=days; d++){
    const iso=`${mk}-${pad(d)}`;
    if (anchorInMonth && iso<=anchorInMonth){ pts.push({ d, iso, bal:Math.round(bal), future:false }); continue; }
    if (iso<=today) bal += (inflow[iso]||0) - (actualOut[iso]||0);
    else bal += (inflow[iso]||0) - (schedOut[iso]||0) - pace;
    pts.push({ d, iso, bal:Math.round(bal), future:iso>today });
  }
  return pts;
}
export function budgetView(data, mk){
  const spent=catSpend(data,mk), days=dim(mk);
  const dayN = mk===thisMonth() ? Math.max(1,+todayISO().slice(8,10)) : days;
  return Object.entries(data.budgets).filter(([,b])=>+b>0).map(([cat,b])=>{
    const a=spent[cat]||0, fc = mk===thisMonth() && dayN>=3 ? (a/dayN)*days : a;
    return { cat, budget:+b, actual:a, remaining:+b-a, forecast:Math.round(fc),
      state: a>+b?"bad" : fc>+b*1.02?"warn" : "ok" };
  }).sort((x,y)=>y.actual-x.actual);
}
export function fuelStats(data){
  const f=[...data.fuel].sort((a,b)=>a.date<b.date?-1:1);
  const legs=[]; let lastFull=null;
  f.forEach(x=>{ if(!x.fullTank||!+x.odometer) return;
    if(lastFull&&+x.odometer>+lastFull.odometer){
      const km=+x.odometer-+lastFull.odometer, L=+x.litres||0;
      if(km>0&&L>0) legs.push({date:x.date, km, L, per:100*L/km,
        vendor: lastFull.vendor||"Unknown",
        ppl: +lastFull.litres>0 ? (+lastFull.cost||0)/(+lastFull.litres) : 0 }); }
    lastFull=x; });
  const byM={}; f.forEach(x=>{ const mk=ym(x.date); byM[mk]=byM[mk]||{cost:0,L:0,fills:0}; byM[mk].cost+=+x.cost||0; byM[mk].L+=+x.litres||0; byM[mk].fills++; });
  const kmByM={}; legs.forEach(l=>{ kmByM[ym(l.date)]=(kmByM[ym(l.date)]||0)+l.km; });
  const mileByM={}; legs.forEach(l=>{ const mk=ym(l.date); (mileByM[mk]=mileByM[mk]||[]).push(l.per); });
  const mAvg={}; Object.entries(mileByM).forEach(([mk,a])=>mAvg[mk]=a.reduce((x,y)=>x+y,0)/a.length);
  const ms=Object.entries(mAvg); let best=null,worst=null;
  ms.forEach(([mk,v])=>{ if(!best||v<best[1])best=[mk,v]; if(!worst||v>worst[1])worst=[mk,v]; });
  const vend={}; f.forEach(x=>{ const v=x.vendor||"Unknown"; vend[v]=vend[v]||{n:0,cost:0}; vend[v].n++; vend[v].cost+=+x.cost||0; });
  const totL=f.reduce((a,x)=>a+(+x.litres||0),0), totC=f.reduce((a,x)=>a+(+x.cost||0),0);
  /* which station's fuel actually moves the car cheapest: avg L/100km on that fuel x its $/L */
  const vp={}; legs.forEach(l=>{ if(!l.ppl) return; const v=l.vendor; vp[v]=vp[v]||{n:0,per:0,ppl:0};
    vp[v].n++; vp[v].per+=l.per; vp[v].ppl+=l.ppl; });
  const vendRank = Object.entries(vp).filter(([,x])=>x.n>=2)
    .map(([vendor,x]) => { const perAvg=x.per/x.n, ppl=x.ppl/x.n;
      return { vendor, n:x.n, perAvg, ppl, costPer100: perAvg*ppl }; })
    .sort((a,b)=>a.costPer100-b.costPer100);
  return { legs, byM, kmByM, mAvg, best, worst, vend, vendRank,
    avgFill: f.length?totC/f.length:0, avgL: totL?totC/totL:0 };
}
export const recvOut = r => Math.max(0, (+r.amount||0) - (r.repaid||[]).reduce((a,x)=>a+(+x.amount||0),0));
/* card-specific transaction history + category mix, for its own insight dashboard */
export const cardTransactions = (data, cardId) => data.expenses.filter(e => e.paySource==="card" && e.cardId===cardId && !isSettled(e)).sort((a,b)=>a.date<b.date?1:-1);
export function cardCategoryBreakdown(data, cardId, mk){
  const o={}; cardTransactions(data,cardId).filter(e=>ym(e.date)===mk).forEach(e=>{ o[e.category]=(o[e.category]||0)+(+e.total||0); });
  return o;
}
export function health(data, mk){
  const bv=budgetView(data,mk), inc=monthIncome(data,mk), sp=totSpend(data,mk);
  const over=bv.filter(b=>b.state==="bad").length, warn=bv.filter(b=>b.state==="warn").length;
  const sBudget = bv.length ? clamp(1-(over+0.5*warn)/bv.length,0,1) : 0.7;
  const sSave = inc>0 ? clamp((inc-sp)/inc/0.3,0,1) : 0.4;
  const pts=projection(data,mk); const minBal=Math.min(...pts.map(p=>p.bal));
  const sCash = minBal>=0 ? 1 : clamp(1+minBal/(inc||2000),0,1);
  const hist=lastMonths(4).slice(0,3).map(m=>totSpend(data,m)).filter(x=>x>0);
  const avg3=hist.length?hist.reduce((a,b)=>a+b,0)/hist.length:0;
  const sMom = avg3>0 ? clamp(1.5-sp/avg3,0,1) : 0.7;
  return Math.round(100*(0.35*sBudget+0.25*sSave+0.25*sCash+0.15*sMom));
}
export function alerts(data, mk){
  const out=[], today=todayISO();
  monthItems(data,mk).forEach(it=>{
    if(it.status==="paid"||it.status==="skipped") return;
    const dd=Math.round((new Date(it.date)-new Date(today))/864e5);
    if(it.status==="missed") out.push({t:"bad", m:`${it.name} (${fmt0(it.amount)}) was due ${shortDate(it.date)} — mark paid or skip`});
    else if(dd<0) out.push({t:"warn", m:`${it.name} was due ${shortDate(it.date)} — ${fmt0(it.amount)}`});
    else if(dd<=(it.reminderDays??3)) out.push({t:"warn", m:`${it.name} due ${dd===0?"today":dd===1?"tomorrow":"in "+dd+" days"} — ${fmt0(it.amount)}`});
  });
  budgetView(data,mk).forEach(b=>{
    if(b.state==="bad") out.push({t:"bad", m:`${b.cat} over budget by ${fmt0(b.actual-b.budget)}`});
    else if(b.state==="warn") out.push({t:"warn", m:`${b.cat} projected to exceed budget by ${fmt0(b.forecast-b.budget)}`});
  });
  const pts=projection(data,mk), neg=pts.find(p=>p.future&&p.bal<0);
  if(neg) out.push({t:"bad", m:`Projected cash dips below zero around ${shortDate(neg.iso)} — review upcoming payments`});
  const owed=data.receivables.reduce((a,r)=>a+recvOut(r),0);
  if(owed>0) out.push({t:"warn", m:`Friends owe you ${fmt0(owed)}`});
  data.cards.forEach(c=>{ const prev=(c.bills||{})[addMonths(mk,-1)], cur=(c.bills||{})[mk]??+c.currentBill;
    if(prev>0&&cur>prev*1.25) out.push({t:"warn", m:`${c.name} bill up ${Math.round(100*(cur-prev)/prev)}% vs last month`}); });
  if (data.expenses.length>10){ const t=lastExportTs();
    if (!t || Date.now()-t > 30*864e5) out.push({t:"warn", m:"No backup file exported in 30+ days — Settings has a one-tap JSON export"});
  }
  return out.slice(0,8);
}


/* ───────── PIN hashing (never store the PIN itself) ───────── */
export async function hashPin(pin){
  const enc = new TextEncoder().encode("lakshmi::"+pin);
  if (typeof crypto!=="undefined" && crypto.subtle){
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
  }
  let h=5381; for (const c of enc) h=((h*33)^c)>>>0;  /* non-crypto fallback for non-HTTPS contexts */
  return "x-"+h.toString(16);
}

/* ───────── on-device backup snapshots + restore ───────── */
export const BAK_PREFIX="lakshmi-bak-", BAK_KEEP=5, EXPORT_TS_KEY="lakshmi-last-export";
export function listBackups(){
  const out=[];
  try{ for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
    if (k && k.indexOf(BAK_PREFIX)===0){ const ts=+k.slice(BAK_PREFIX.length)||0; const raw=localStorage.getItem(k)||"";
      out.push({ key:k, ts,
        label: new Date(ts).toLocaleString("en-CA",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}),
        sizeLabel: Math.max(1,Math.round(raw.length/1024))+" KB" }); } } }catch(e){}
  return out.sort((a,b)=>b.ts-a.ts);
}
export function backupNow(data){
  const ts=Date.now(), raw=JSON.stringify(data);
  try{ localStorage.setItem(BAK_PREFIX+ts, raw); }
  catch(e){ const baks=listBackups();                       /* quota: drop oldest, retry once */
    if (baks.length){ localStorage.removeItem(baks[baks.length-1].key); localStorage.setItem(BAK_PREFIX+ts, raw); }
    else throw e; }
  listBackups().slice(BAK_KEEP).forEach(b => { try{ localStorage.removeItem(b.key); }catch(e){} });
  return ts;
}
export function autoBackup(data){
  try{ const baks=listBackups();
    if (!baks.length || Date.now()-baks[0].ts > 20*3600e3) backupNow(data); }catch(e){}
}
export function restoreBackup(key){
  try{ const raw=localStorage.getItem(key); if(!raw) return null;
    const d=JSON.parse(raw); if(!d || !d.expenses) return null;
    return { ...emptyData, ...d, settings:{...emptyData.settings, ...d.settings} }; }catch(e){ return null; }
}
export const noteExport = () => { try{ localStorage.setItem(EXPORT_TS_KEY, String(Date.now())); }catch(e){} };
export const lastExportTs = () => { try{ return +(localStorage.getItem(EXPORT_TS_KEY)||0); }catch(e){ return 0; } };
export const lastExportLabel = () => { const t=lastExportTs();
  if(!t) return "No backup file exported yet — keep one off this device.";
  const d=Math.floor((Date.now()-t)/864e5);
  return d===0 ? "Last file export: today" : "Last file export: "+d+" day"+(d===1?"":"s")+" ago"; };

/* ───────── dashboard series + insight engine (all local, zero AI tokens) ───────── */
export const incomeVsSpendSeries = (data, n=6) =>
  lastMonths(n).map(m => ({ m:m.slice(5), inc:Math.round(monthIncome(data,m)), spend:Math.round(totSpend(data,m)) }));

export function allMonthKeys(data){
  const s=new Set([thisMonth()]);
  data.expenses.forEach(e => { const m=ym(e.date); if(m) s.add(m); });
  data.fuel.forEach(x => { const m=ym(x.date); if(m) s.add(m); });
  incomeEventsSafe(data).forEach(m => s.add(m));
  return Array.from(s).filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
}
function incomeEventsSafe(data){
  const out=[]; try{ data.incomes.forEach(i => { if(i.type==="one"&&i.date) out.push(ym(i.date)); }); }catch(e){}
  return out;
}
export function allTimeStats(data){
  const months = allMonthKeys(data).filter(m => totSpend(data,m)>0 || monthIncome(data,m)>0);
  const spend = months.reduce((a,m)=>a+totSpend(data,m),0);
  const inc = months.reduce((a,m)=>a+monthIncome(data,m),0);
  return { months: months.length, spend, inc, saved: inc-spend,
    avgSpend: months.length ? spend/months.length : 0 };
}

export function insights(data, mk){
  const out=[];
  const inc=monthIncome(data,mk), sp=totSpend(data,mk), kept=inc-sp;
  if (inc>0){
    const rate=kept/inc;
    if (rate<0) out.push({ico:"🔻",tone:"bad",msg:"Spending is "+fmt0(-kept)+" above income this month — open the Ledger and find what can move."});
    else if (rate>=0.2) out.push({ico:"🌱",tone:"good",msg:"You're keeping "+Math.round(100*rate)+"% of income ("+fmt0(kept)+") this month."});
    else out.push({ico:"🎯",tone:"warn",msg:"Savings rate is "+Math.round(100*rate)+"% so far — every "+fmt0(100)+" trimmed lifts it "+(Math.round(10000/inc*10)/10)+" pts."});
  }
  const cur=catSpend(data,mk), hist={};
  lastMonths(4).forEach(m => { if(m===mk) return; Object.entries(catSpend(data,m)).forEach(([c,v]) => hist[c]=(hist[c]||0)+v); });
  let gCat=null, gAmt=0;
  Object.entries(cur).forEach(([c,v]) => { const avg=(hist[c]||0)/3;
    if (avg>20 && v>avg*1.3 && v-avg>gAmt){ gCat=c; gAmt=v-avg; } });
  if (gCat) out.push({ico:CAT_ICO[gCat]||"📈",tone:"warn",msg:gCat+" is running "+fmt0(gAmt)+" above your 3-month average — tap it below to see why."});
  const subs=data.recurring.filter(r=>r.category==="Subscriptions");
  const subMo=subs.reduce((a,r)=>a+(r.freq==="monthly"?+r.amount:r.freq==="annual"?(+r.amount)/12:r.freq==="weekly"?(+r.amount)*4.33:r.freq==="biweekly"?(+r.amount)*2.17:+r.amount||0),0);
  if (subMo>15) out.push({ico:"🔁",tone:"info",msg:subs.length+" subscription"+(subs.length>1?"s":"")+" = "+fmt0(subMo)+"/mo — that's "+fmt0(subMo*12)+" a year. Worth a cull?"});
  const cmp=itemPriceComparisons(data,1);
  if (cmp.length && cmp[0].savings>=0.5) out.push({ico:"🛒",tone:"good",msg:"Buy "+cmp[0].label+" at "+cmp[0].cheapest.store+" instead of "+cmp[0].priciest.store+" — save "+fmt(cmp[0].savings)+" each time."});
  const fs=fuelStats(data);
  if ((fs.vendRank||[]).length>=2){ const b=fs.vendRank[0], w=fs.vendRank[fs.vendRank.length-1];
    out.push({ico:"⛽",tone:"good",msg:"Your car runs cheapest on "+b.vendor+" fuel — "+fmt(b.costPer100)+"/100 km vs "+fmt(w.costPer100)+" at "+w.vendor+"."}); }
  if (mk===thisMonth()){
    const dayN=Math.max(1,+todayISO().slice(8,10));
    if (dayN>=7){ const days=new Set(monthExp(data,mk).map(e=>e.date)).size;
      const nsd=Math.max(0,dayN-days);
      if (nsd>0) out.push({ico:"🕊️",tone:"info",msg:nsd+" no-spend day"+(nsd===1?"":"s")+" out of "+dayN+" so far — each one banks about "+fmt0(sp/Math.max(1,days))+"."}); }
    const fixedCats=new Set(data.recurring.map(r=>r.category));
    let varLeft=0; Object.entries(data.budgets).forEach(([c,b]) => { if(!fixedCats.has(c)&&c!=="Rent") varLeft+=Math.max(0,(+b||0)-(cur[c]||0)); });
    const left=Math.max(1, dim(mk)-dayN+1);
    if (varLeft>0) out.push({ico:"💡",tone:"info",msg:"Safe to spend about "+fmt0(varLeft/left)+"/day on variable categories for the rest of the month."});
  }
  return out.slice(0,6);
}

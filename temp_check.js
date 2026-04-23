
(function(){
'use strict';
var MPT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
var Toast={
  container:null,
  init:function(){
    var c=document.createElement('div');c.className='toast-container';c.id='toast-c';
    document.body.appendChild(c);this.container=c;
    var s=document.createElement('div');s.className='save-indicator';s.id='save-ind';
    s.innerHTML='<span class="dot"></span><span id="save-txt">Salvo</span>';
    document.body.appendChild(s);
  },
  show:function(msg,type,dur){
    type=type||'info';dur=dur||3000;
    var t=document.createElement('div');t.className='toast '+type;t.textContent=msg;
    this.container.appendChild(t);
    setTimeout(function(){if(t.className.indexOf('out')===-1){t.className+=' out';setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},300)}},dur);
  },
  saving:function(){var e=document.getElementById('save-ind');var t=document.getElementById('save-txt');if(e){e.classList.add('saving');e.classList.remove('unsaved')}if(t)t.textContent='Salvando...'},
  saved:function(){var e=document.getElementById('save-ind');var t=document.getElementById('save-txt');if(e){e.classList.remove('saving');e.classList.remove('unsaved')}if(t)t.textContent='Salvo'},
  unsaved:function(){var e=document.getElementById('save-ind');if(e)e.classList.add('unsaved')},
  html:function(html,type,dur){
    type=type||'info';dur=dur||3000;
    var t=document.createElement('div');t.className='toast '+type;t.innerHTML=html;
    this.container.appendChild(t);
    setTimeout(function(){if(t.className.indexOf('out')===-1){t.className+=' out';setTimeout(function(){if(t.parentNode){t.parentNode.removeChild(t)}},300)}},dur);
  }
};

/* ======================== MODAL DIALOGS (alert/confirm/prompt) ============= */
function safeText(text){
  var d=document.createElement('div');d.appendChild(document.createTextNode(text));return d.innerHTML;
}

var Modal={
  confirm:function(msg,title){
    title=title||'Confirmar';
    var ov=document.createElement('div');ov.className='modal-backdrop';
    ov.tabIndex=-1;
    var txt=safeText(msg),ttl=safeText(title);
    var h='<h3>'+ttl+'</h3><p style="color:var(--fg);font-size:0.9em;line-height:1.6">'+txt+'</p>';
    h+='<div class="modal-actions"><button class="btn btn-outline" data-r="0">Nao</button><button class="btn btn-primary" data-r="1">Sim</button></div>';
    var bx=document.createElement('div');bx.className='modal';bx.innerHTML=h;
    ov.appendChild(bx);document.body.appendChild(ov);
    return new Promise(function(resolve){
      function close(r){document.body.removeChild(ov);resolve(r)}
      ov.addEventListener('click',function(e){if(e.target===ov)close(false)});
      bx.querySelectorAll('[data-r]').forEach(function(b){b.addEventListener('click',function(){close(this.getAttribute('data-r')==='1')})});
      document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){close(false);document.removeEventListener('keydown',esc)}});
    });
  },
  prompt:function(msg,def,title){
    title=title||'Entrada';def=def||'';
    var ov=document.createElement('div');ov.className='modal-backdrop';ov.tabIndex=-1;
    var txt=safeText(msg),ttl=safeText(title);
    var h='<h3>'+ttl+'</h3><p style="color:var(--fg-muted);font-size:0.82em;margin-bottom:8px">'+txt+'</p>';
    h+='<input type="text" id="modal-input" value="'+safeText(def)+'" style="width:100%;padding:8px 12px">';
    h+='<div class="modal-actions"><button class="btn btn-outline" data-a="cancel">Cancelar</button><button class="btn btn-primary" data-a="confirm">Confirmar</button></div>';
    var bx=document.createElement('div');bx.className='modal';bx.style.minWidth='400px';bx.innerHTML=h;
    ov.appendChild(bx);document.body.appendChild(ov);
    return new Promise(function(resolve){
      var inp=document.getElementById('modal-input');if(inp){inp.focus();inp.select()}
      function close(v){if(document.body.contains(ov))document.body.removeChild(ov);resolve(v)}
      bx.querySelector('[data-a="cancel"]').addEventListener('click',function(){close(null)});
      bx.querySelector('[data-a="confirm"]').addEventListener('click',function(){var i=document.getElementById('modal-input');close(i?i.value:null)});
      ov.addEventListener('click',function(e){if(e.target===ov)close(null)});
      if(inp)inp.addEventListener('keydown',function(e){if(e.key==='Enter'){var i=document.getElementById('modal-input');close(i?i.value:null)}if(e.key==='Escape')close(null)});
      document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){close(null);document.removeEventListener('keydown',esc)}});
    });
  }
};

var SK='sorveteria_v4';
var saveT=null;

var Storage={
  load:function(){try{var r=localStorage.getItem(SK);if(!r){var o=localStorage.getItem('sorveteria_v3');if(o){try{var d=JSON.parse(o);d.version=4;return d}catch(e){}}return null}var d=JSON.parse(r);return(d&&d.version>=3)?d:null}catch(e){return null}},
  save:function(s){try{localStorage.setItem(SK,JSON.stringify(s))}catch(e){Toast.show('Erro ao salvar: storage cheio','error',4000)}},
  deb:function(){clearTimeout(saveT);Toast.saving();saveT=setTimeout(function(){Storage.save(State.data);Toast.saved()},400)},
  exportAll:function(){var b=new Blob([JSON.stringify(State.data,null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='power_planner_'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);Toast.show('Backup exportado com sucesso','success',4000)},
  importAll:function(ev){var f=ev.target.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(e){try{var d=JSON.parse(e.target.result);if(!d||d.version<3){Toast.show('Versao incompativel (esperada v3+)','error');return}State.set(d);App.Tabs.switch('dashboard');Toast.show('Dados importados com sucesso!','success',4000)}catch(er){Toast.show('Erro ao importar: '+er.message,'error')}};rd.readAsText(f);ev.target.value=''},
  clearAll:function(){Modal.confirm('Apagar TODOS os dados? Esta acao e irreversivel.','Limpar Dados').then(function(ok){if(!ok)return;if(confirm('Tem certeza absoluta? Todos os cenarios, produtos e configuracoes serao perdidos.')){localStorage.removeItem(SK);State.init();App.Tabs.switch('dashboard');Toast.show('Dados apagados. Recarregando padrao...','warning',4000)}})}
};

var State={
  data:null,
  defaults:function(){
    var now=new Date(),cf=[];
    for(var i=0;i<12;i++){var m=new Date(now.getFullYear(),now.getMonth()+i,1);cf.push({mi:i,label:MPT[m.getMonth()]+'/'+m.getFullYear().toString().slice(-2),entradaOperacional:0,entradaNaoOper:0,saidaCMV:0,saidaFixos:0,saidaNaoOper:0})}
    return{version:4,
      products:[
        {id:'p1_choc',n:'POTE 1L Choc.Trufado',c:8,p:25,q:6},{id:'p1_mor',n:'POTE 1L Morango Trufado',c:8,p:25,q:5},
        {id:'p15_choc',n:'POTE 1,5L Chocolate',c:14,p:40,q:3},{id:'p15_pist',n:'POTE 1,5L Pistache',c:16,p:45,q:2},
        {id:'p1_leit',n:'POTE 1L Leite Ninho',c:7,p:22,q:4},{id:'p15_snk',n:'POTE 1,5L Snickers',c:15,p:42,q:3},
        {id:'pl_choc',n:'PICOLE LEITE Chocolate cx40',c:38,p:120,q:5},{id:'pl_mor',n:'PICOLE LEITE Morango cx40',c:35,p:110,q:4},
        {id:'mor',n:'MORENINHA un',c:2.5,p:6,q:40},
        {id:'s3_choc',n:'SORVETE 300ml Choc.Trufado',c:7,p:22,q:5},{id:'s3_mor',n:'SORVETE 300ml Morango',c:7,p:22,q:4},
        {id:'sun_choc',n:'SUNDAE Chocolate',c:3.5,p:10,q:10},{id:'sun_mor',n:'SUNDAE Morango',c:3.5,p:10,q:10},
        {id:'ala',n:'ALASKINHO un',c:2.5,p:6,q:40},{id:'a1_nat',n:'ACAI 1L Natural',c:6,p:18,q:5},
        {id:'a3_nat',n:'ACAI 300ml Natural',c:3.5,p:10,q:8},{id:'a3_nut',n:'ACAI 300ml c/Nutella',c:5,p:15,q:6}
      ],
      winterProducts:[
        {id:'aq3',n:'ACAI Quente 300ml',c:3.5,p:12,q:8},{id:'aq5',n:'ACAI Quente 500ml',c:5.5,p:18,q:4},
        {id:'chq3',n:'Chocolate Quente 300ml',c:2.5,p:10,q:6},{id:'chqesp',n:'Chocolate Quente Especial',c:5,p:18,q:2},
        {id:'fondue',n:'Fondue Individual',c:8,p:25,q:1},{id:'vinhoq',n:'Vinho Quente',c:4,p:15,q:2}
      ],
      fixedCosts:[
        {id:'alug',n:'Aluguel',v:0},{id:'ener',n:'Energia',v:0},{id:'agua',n:'Agua',v:0},{id:'net',n:'Internet/Telefone',v:0},
        {id:'cont',n:'Contador',v:0},{id:'comb',n:'Combustivel',v:0},{id:'prol',n:'Pro-labore',v:0},{id:'imp',n:'Impostos',v:0}
      ],
      activeScenario:null,scenarios:{},
      cashFlow:{months:cf},
      inventory:[],
      kpis:[
        {id:'kpi1',name:'Faturamento Mensal',target:50000,unit:'R$',period:'mensal',value:0,autoCalc:true},
        {id:'kpi2',name:'Margem Liquida',target:20,unit:'%',period:'mensal',value:0,autoCalc:true},
        {id:'kpi3',name:'Ticket Medio',target:30,unit:'R$',period:'mensal',value:0,autoCalc:false},
        {id:'kpi4',name:'Perda de Estoque',target:100,unit:'R$',period:'mensal',value:0,autoCalc:true},
        {id:'kpi5',name:'Giro de Estoque',target:2,unit:'unid',period:'mensal',value:0,autoCalc:true}
      ],
      tasks:[],
      settings:{taxRate:0.04,seasonalFactor:1.0,assumptions:{monthlySeasonals:[0.65,0.55,0.6,0.7,0.85,0.95,1.0,1.05,1.1,1.15,1.1,1.0]}}
    };
  },
  init:function(){
    var s=Storage.load();this.data=s||this.defaults();
    if(!this.data.inventory||this.data.inventory.length===0){var sl=this;this.data.products.forEach(function(p){sl.data.inventory.push({id:'inv_'+p.id,name:p.n,qty:p.q,minQty:5,unitPrice:p.c,expiry:''})});this.data.winterProducts.forEach(function(p){sl.data.inventory.push({id:'inv_'+p.id,name:p.n,qty:p.q,minQty:5,unitPrice:p.c,expiry:''})})}
    var d=this.defaults();
    if(!this.data.cashFlow||!this.data.cashFlow.months||this.data.cashFlow.months.length<12)this.data.cashFlow=d.cashFlow;
    if(!this.data.scenarios)this.data.scenarios={};
    if(!this.data.tasks)this.data.tasks=[];
    if(!this.data.kpis)this.data.kpis=d.kpis;
    if(!this.data.settings)this.data.settings=d.settings;
    if(!this.data.settings.assumptions)this.data.settings.assumptions={};
    if(!this.data.settings.assumptions.monthlySeasonals)this.data.settings.assumptions.monthlySeasonals=d.settings.assumptions.monthlySeasonals;
    if(typeof this.data.settings.taxRate!=='number')this.data.settings.taxRate=0.04;
    if(typeof this.data.settings.seasonalFactor!=='number')this.data.settings.seasonalFactor=1.0;
  },
  get:function(){return this.data},
  set:function(d){this.data=d;Storage.save(d);this.rebuild()},
  markDirty:function(){Storage.deb();Toast.unsaved()},
  uid:function(){return'id_'+Date.now()+'_'+Math.floor(Math.random()*1000)},
  rebuild:function(){['Dashboard','DRE','CashFlow','Inventory','Scenario','KPI','ActionPlan','Assumptions'].forEach(function(n){if(App[n]&&App[n].render)App[n].render()})}
};

var Tabs={
  cur:'dashboard',
  tabOrder:['dashboard','dre','fluxo','estoque','premissas','cenarios','plano'],
  switch:function(id){
    this.cur=id;
    var els=document.querySelectorAll('.nav-item');for(var i=0;i<els.length;i++){var t=els[i].getAttribute('data-tab');els[i].classList.toggle('active',t===id)}
    var pgs=document.querySelectorAll('.tab-page');for(var i=0;i<pgs.length;i++){pgs[i].classList.toggle('active',pgs[i].id==='page-'+id)}
    var map={dashboard:'Dashboard',dre:'DRE',fluxo:'CashFlow',estoque:'Inventory',premissas:'Assumptions',cenarios:'Scenario',plano:'KPI'};
    if(map[id]&&App[map[id]]&&App[map[id]].render)App[map[id]].render();
    if(id==='plano'&&App.ActionPlan&&App.ActionPlan.render)App.ActionPlan.render();
  },
  label:function(mi){var now=new Date(),m=new Date(now.getFullYear(),now.getMonth()+(mi||0),1);return MPT[m.getMonth()]+'/'+m.getFullYear().toString().slice(-2)},
  byIndex:function(n){var idx=parseInt(n,10);if(idx>=1&&idx<=this.tabOrder.length)return this.tabOrder[idx-1];return null}
};

var Chart={
  fmt:function(v){return(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})},
  fmtM:function(v){return'R$ '+this.fmt(v)},
  fmtK:function(v){if(Math.abs(v)>=1e3)return'R$ '+(v/1e3).toFixed(1).replace('.',',')+'k';return'R$ '+v.toFixed(0)},
  clear:function(cid){var c=document.getElementById(cid);if(!c)return null;c.width=Math.max(c.parentElement.clientWidth-10,400);c.height=parseInt(c.getAttribute('height'))||200;var ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);return ctx},

  /* Enhanced bar chart with hover-tooltips */
  barChart:function(labels,datasets,cid){
    var cvs=document.getElementById(cid);if(!cvs||!labels.length)return;
    var ctx=cvs.getContext('2d');
    var W=cvs.width,H=cvs.height,pL=60,pR=20,pT=30,pB=50,cW=W-pL-pR,cH=H-pT-pB;
    ctx.clearRect(0,0,W,H);
    var mx=0;for(var d=0;d<datasets.length;d++)for(var i=0;i<datasets[d].values.length;i++)if(datasets[d].values[i]>mx)mx=datasets[d].values[i];
    if(mx===0)mx=100;mx*=1.15;
    ctx.strokeStyle='#21262d';ctx.lineWidth=0.5;ctx.fillStyle='#8b949e';ctx.font='9px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
    for(var i=0;i<=5;i++){var y=pT+cH-(i/5)*cH,v=mx*i/5;ctx.fillText(this.fmtK(v),pL-4,y);ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(W-pR,y);ctx.stroke()}
    var gW=cW/labels.length,bW=Math.max(Math.min(Math.floor(gW*0.6/datasets.length),28),4),tB=bW*datasets.length;
    for(var d=0;d<datasets.length;d++)for(var i=0;i<datasets[d].values.length;i++){var val=datasets[d].values[i];if(val<0)continue;var barH=val/mx*cH;var x=pL+i*gW+(gW-tB)/2+d*bW+1;ctx.fillStyle=datasets[d].color;ctx.fillRect(x,pT+cH-barH,bW-2,barH);ctx.fillStyle='rgba(255,255,255,0.12)';ctx.fillRect(x,pT+cH-barH,bW-2,Math.min(2,barH/2))}
    ctx.fillStyle='#c9d1d9';ctx.font='9px Arial';ctx.textAlign='center';ctx.textBaseline='top';
    for(var i=0;i<labels.length;i++)ctx.fillText(labels[i],pL+i*gW+gW/2,H-pB+6);
    var lx=pL;ctx.textAlign='left';ctx.fillStyle='#8b949e';
    for(var d=0;d<datasets.length;d++){ctx.fillStyle=datasets[d].color;ctx.fillRect(lx,6,8,8);ctx.fillStyle='#8b949e';ctx.fillText(datasets[d].label,lx+12,10);lx+=ctx.measureText(datasets[d].label).length*6.5+30}
    /* hover tooltip */
    this._bindBarTooltip(cvs,pL,cW,datasets,labels,gW,mx,cH);
  },
  _bindBarTooltip:function(cvs,pL,cW,datasets,labels,gW,mx,cH){
    var box=cvs.parentElement;
    var existing=box.querySelector('.chart-tooltip');if(existing)existing.remove();
    cvs.onmousemove=function(e){
      var rect=cvs.getBoundingClientRect();
      var mx2=Math.max(0,e.clientX-rect.left), my=e.clientY-rect.top;
      var idx=Math.floor((mx2-pL)/gW);
      if(idx<0||idx>=labels.length){var t2=box.querySelector('.chart-tooltip');if(t2)t2.remove();return}
      var t=box.querySelector('.chart-tooltip');if(!t){t=document.createElement('div');t.className='chart-tooltip';box.appendChild(t)}
      var s='<strong>'+labels[idx]+'</strong>\n';
      for(var d=0;d<datasets.length;d++){var v=datasets[d].values[idx];s+='<span style="color:'+datasets[d].color+'">'+datasets[d].label+': R$ '+(v||0).toFixed(2)+'</span>\n'}
      t.innerHTML=s;
      var ox=e.clientX-box.getBoundingClientRect().left+12;
      var oy=my-10;
      if(ox+180>box.clientWidth)ox=e.clientX-box.getBoundingClientRect().left-180;
      t.style.left=ox+'px';t.style.top=oy+'px';
    };
    cvs.onmouseleave=function(){var t=box.querySelector('.chart-tooltip');if(t)t.remove()};
  },

  lineChart:function(labels,values,cid){
    var ctx=this.clear(cid);if(!ctx||!values.length)return;
    var c=document.getElementById(cid),W=c.width,H=c.height,pL=60,pR=20,pT=30,pB=50,cW=W-pL-pR,cH=H-pT-pB;
    var mn=Math.min.apply(null,values),mx=Math.max.apply(null,values);
    if(mn===mx){mn-=100;mx+=100}var rng=mx-mn;if(rng<100)rng=100;mn-=rng*0.1;mx+=rng*0.1;rng=mx-mn;
    ctx.strokeStyle='#21262d';ctx.lineWidth=0.5;ctx.fillStyle='#8b949e';ctx.font='10px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
    for(var i=0;i<=5;i++){var y=pT+cH-(i/5)*cH;ctx.fillText(this.fmtK(mn+rng*i/5),pL-4,y);ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(W-pR,y);ctx.stroke()}
    if(mn<0&&mx>0){var zY=pT+cH-((0-mn)/rng*cH);ctx.strokeStyle='#484f58';ctx.lineWidth=1;ctx.setLineDash([5,3]);ctx.beginPath();ctx.moveTo(pL,zY);ctx.lineTo(W-pR,zY);ctx.stroke();ctx.setLineDash([])}
    var n=values.length-1;
    var gx=function(i){return pL+(n>0?i/n*cW:cW/2)};
    var gy=function(v){return pT+cH-((v-mn)/rng*cH)};
    var zBL=Math.max(pT,gy(0));
    ctx.fillStyle='rgba(88,166,255,0.08)';ctx.beginPath();
    for(var i=0;i<values.length;i++){if(i===0)ctx.moveTo(gx(i),gy(values[i]));else ctx.lineTo(gx(i),gy(values[i]))}
    ctx.lineTo(gx(n),zBL);ctx.lineTo(gx(0),zBL);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#58a6ff';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();
    for(var i=0;i<values.length;i++){if(i===0)ctx.moveTo(gx(i),gy(values[i]));else ctx.lineTo(gx(i),gy(values[i]))}
    ctx.stroke();
    ctx.font='9px Arial';ctx.textAlign='center';ctx.textBaseline='top';
    for(var i=0;i<values.length;i++){ctx.fillStyle=values[i]<0?'#f85149':'#58a6ff';ctx.beginPath();ctx.arc(gx(i),gy(values[i]),4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#8b949e';ctx.fillText(labels[i],gx(i),H-pB+6)}
    this._bindLineTooltip(c,labels,values,pL,cW,pT,mn,rng,cH,H,pB);
  },
  _bindLineTooltip:function(c,labels,values,pL,cW,pT,mn,rng,cH,H,pB){
    var box=c.parentElement;var existing=box.querySelector('.chart-tooltip');if(existing)existing.remove();
    var n=values.length-1;
    c.onmousemove=function(e){
      var rect=c.getBoundingClientRect(),mx4=e.clientX-rect.left;
      var idx=Math.round(((mx4-pL)/cW)*n);if(idx<0||idx>n)return;
      var tt=box.querySelector('.chart-tooltip');if(!tt){tt=document.createElement('div');tt.className='chart-tooltip';box.appendChild(tt)}
      tt.innerHTML='<strong>'+labels[idx]+'</strong>\nSaldo: <span style="color:'+(values[idx]<0?'#f85149':'#58a6ff')+'">R$ '+values[idx].toFixed(2)+'</span>';
      tt.style.left=(e.clientX-box.getBoundingClientRect().left+12)+'px';tt.style.top=(e.clientY-box.getBoundingClientRect().top-10)+'px';
    };
    c.onmouseleave=function(){var tt=box.querySelector('.chart-tooltip');if(tt)tt.remove()};
  },

  miniBar:function(szs,cid){
    var ctx=this.clear(cid);if(!ctx)return;
    var c=document.getElementById(cid),W=c.width,H=c.height,pL=30,pR=10,pT=10,pB=20,cW=W-pL-pR,cH=H-pT-pB;
    var mx=1.2;var gW=cW/szs.length,bW=Math.max(gW*0.6,6);
    ctx.textAlign='center';ctx.textBaseline='top';ctx.font='8px Arial';
    for(var i=0;i<szs.length;i++){var barH=szs[i]/mx*cH;var x=pL+i*gW+(gW-bW)/2;ctx.fillStyle=szs[i]>=1?'rgba(63,185,80,0.7)':szs[i]>=0.8?'rgba(210,153,34,0.7)':'rgba(248,81,73,0.7)';ctx.fillRect(x,pT+cH-barH,bW,barH);ctx.fillStyle='#8b949e';ctx.fillText(MPT[i],pL+i*gW+gW/2,H-pB+2)}
  },
  scenarioCompChart:function(labels,scNames,allVals,cid){
    var ctx=this.clear(cid);if(!ctx)return;
    var c=document.getElementById(cid),W=c.width,H=c.height;
    var pL=70,pR=20,pT=40,pB=50,cW=W-pL-pR,cH=H-pT-pB;
    var mx=0;for(var g=0;g<allVals.length;g++)for(var l=0;l<allVals.length;l++){if(allVals[g]&&allVals[g][l]&&allVals[g][l]>mx)mx=allVals[g][l]}
    if(mx===0)mx=100;mx*=1.2;
    ctx.strokeStyle='#21262d';ctx.lineWidth=0.5;ctx.fillStyle='#8b949e';ctx.font='9px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
    for(var i=0;i<=5;i++){var y=pT+cH-(i/5)*cH;ctx.fillText(this.fmtK(mx*i/5),pL-4,y);ctx.beginPath();ctx.moveTo(pL,y);ctx.lineTo(W-pR,y);ctx.stroke()}
    var colors=['#58a6ff','#3fb950','#f85149','#a371f7','#d29922','#00d4ff'];
    var nG=Math.min(allVals.length,3);var gW=cW/labels.length;
    var bW=Math.max(Math.min(Math.floor(gW*0.6/nG),28),5);var tB=bW*nG;
    ctx.textAlign='center';ctx.textBaseline='top';
    for(var g=0;g<nG;g++){var vals=allVals[g]||[];for(var l=0;l<labels.length;l++){var val=vals[l]||0;if(val<0)continue;var barH=val/mx*cH;var x=pL+l*gW+(gW-tB)/2+g*bW+1;ctx.fillStyle=colors[g%colors.length];ctx.fillRect(x,pT+cH-barH,bW-2,barH)}}
    ctx.fillStyle='#8b949e';ctx.font='9px Arial';ctx.textAlign='center';
    for(var l=0;l<labels.length;l++)ctx.fillText(labels[l],pL+l*gW+gW/2,H-pB+6);
    var lx=pL+4;ctx.textAlign='left';
    for(var g=0;g<nG;g++){ctx.fillStyle=colors[g%colors.length];ctx.fillRect(lx,6,8,8);ctx.fillStyle='#8b949e';ctx.fillText(scNames[g]||('Cenario '+(g+1)),lx+12,10);lx+=140}
  }
};

var Monthly={
  getSeasonals:function(s){return(s.settings&&s.settings.assumptions&&s.settings.assumptions.monthlySeasonals)||[0.65,0.55,0.6,0.7,0.85,0.95,1.0,1.05,1.1,1.15,1.1,1.0]},
  getFactor:function(s,mi){var now=new Date(),szs=this.getSeasonals(s);return szs[(now.getMonth()+mi)%12]*(s.settings.seasonalFactor||1.0)},
  calcMonth:function(s,mi,taxRate){
    var sz=this.getFactor(s,mi),allP=s.products.concat(s.winterProducts);
    var rev=0,cmvT=0,det=[];
    allP.forEach(function(pr){
      var q=parseFloat(pr.q||0)*sz;rev+=q*pr.p;
      var cost=pr.c;s.inventory.forEach(function(it){if(it.id==='inv_'+pr.id)cost=it.unitPrice});
      cmvT+=q*cost;det.push({name:pr.n,q:Math.round(q*10)/10,c:cost});
    });
    var invVal=0;s.inventory.forEach(function(it){invVal+=(it.qty||0)*(it.unitPrice||0)});
    var tr=taxRate!=null?taxRate:(s.settings.taxRate||0.04),imp=rev*tr,fix=0;
    s.fixedCosts.forEach(function(f){fix+=(f.v||0)});
    return{mi:mi,label:Tabs.label(mi),sz:sz,rev:+rev.toFixed(2),imp:+imp.toFixed(2),liq:+(rev-imp).toFixed(2),cmv:+cmvT.toFixed(2),luc:+(rev-cmvT).toFixed(2),fix:+fix.toFixed(2),inv:+invVal.toFixed(2),det:det};
  },
  calcCF:function(s){
    var ms=s.cashFlow.months||[],r=[],ac=0;
    for(var i=0;i<ms.length;i++){
      var m=ms[i],eo=m._customOper?m.entradaOperacional:null,sc=m._customOper?m.saidaCMV:null,sf=m._customOper?m.saidaFixos:null;
      var eno=m.entradaNaoOper||0,sno=m.saidaNaoOper||0;
      if(!m._customOper){var d=this.calcMonth(s,i,s.settings.taxRate||0.04);eo=d.rev;sc=d.cmv;sf=d.fix;m.entradaOperacional=d.rev;m.saidaCMV=d.cmv;m.saidaFixos=d.fix}
      var ent=(eo||0)+eno,sai=(sc||0)+(sf||0)+sno,saldo=ent-sai;ac+=saldo;
      r.push({mi:i,label:m.label,eo:+(eo||0).toFixed(2),eno:+eno.toFixed(2),sc:+(sc||0).toFixed(2),sf:+(sf||0).toFixed(2),sno:+sno.toFixed(2),ent:+ent.toFixed(2),sai:+sai.toFixed(2),saldo:+saldo.toFixed(2),acum:+ac.toFixed(2)});
    }
    State.markDirty();return r;
  }
};

var Dashboard={
  render:function(){var s=State.get();this.cards(s);this.chart(s);this.alerts(s);this.kpiSum(s)},
  cards:function(s){
    var c=Monthly.calcMonth(s,0,s.settings.taxRate||0.04),liq=c.luc-c.fix,mg=c.rev>0?(liq/c.rev*100).toFixed(1):'0.0';
    var cls=liq>=0?'positive':'negative';
    document.getElementById('dash-kpis').innerHTML=this.mc('Receita Bruta Mensal',Chart.fmtM(c.rev),'Custo total: '+Chart.fmtM(c.cmv+c.fix))+this.mc('Lucro Liquido',Chart.fmtM(liq),mg+' margem',cls)+this.mc('Margem Liquida',mg+'%','Meta: 20%',parseFloat(mg)>=20?'positive':'negative')+this.mc('Valor Estoque',Chart.fmtM(c.inv),s.activeScenario?' '+s.activeScenario:'');
    var el=document.getElementById('dash-active-scen');if(el)el.textContent=s.activeScenario||'Sem cenario ativo';
  },
  mc:function(label,value,delta,cls){return'<div class="metric-card"><div class="mc-label">'+label+'<\/div><div class="mc-value '+(cls||'')+'">'+value+'<\/div><div class="mc-delta">'+delta+'<\/div><\/div>'},
  chart:function(s){
    var lb=[],rc=[],cs=[],lc=[];for(var i=0;i<12;i++){var c=Monthly.calcMonth(s,i,s.settings.taxRate||0.04);lb.push(c.label);rc.push(c.rev);cs.push(c.cmv+c.fix);lc.push(c.luc-c.fix)}
    Chart.barChart(lb,[{label:'Receita',color:'rgba(88,166,255,0.7)',values:rc},{label:'Custos',color:'rgba(210,153,34,0.7)',values:cs},{label:'Lucro',color:'rgba(63,185,80,0.7)',values:lc}],'dash-chart');
  },
  alerts:function(s){
    var today=new Date();today.setHours(0,0,0,0);var h='',cnt=0;
    s.inventory.forEach(function(it){
      if(it.minQty>0&&it.qty<=it.minQty){
        cnt++;h+='<div class="alert-item"><span class="alert-dot red"><\/span><span class="at">Estoque baixo: <strong>'+it.name+'<\/strong> ('+it.qty+' un)<\/span><\/div>';
      }
      if(it.expiry){
        var d=Math.ceil((new Date(it.expiry)-today)/864e5);
        if(d<=0){cnt++;h+='<div class="alert-item"><span class="alert-dot red"><\/span><span class="at">VENCIDO: <strong>'+it.name+'<\/strong><\/span><\/div>';}
        else if(d<=7){cnt++;h+='<div class="alert-item"><span class="alert-dot yellow"><\/span><span class="at">Vence em '+d+'d: <strong>'+it.name+'<\/strong><\/span><\/div>';}
      }
    });
    if(!cnt)h='<div style="color:var(--fg-muted);padding:8px">Nenhum alerta.<\/div>';
    document.getElementById('dash-alerts').innerHTML=h;
    var bg=document.getElementById('badge-stock');if(bg){bg.textContent=cnt;if(cnt>0)bg.classList.remove('hidden');else bg.classList.add('hidden')}
  },
  kpiSum:function(s){
    KPI.autoCalc(s);var g=0,y=0,r=0;
    s.kpis.forEach(function(k){var p=k.target>0?Math.min(100,k.value/k.target*100):0;if(p>=80)g++;else if(p>=50)y++;else r++});
    var t2=s.tasks.length,d=s.tasks.filter(function(x){return x.status==='concluido'}).length,p2=t2>0?(d/t2*100).toFixed(0):0;
    var h='<div style="display:flex;gap:8px;margin-bottom:10px"><span class="badge badge-green">'+g+' OK<\/span><span class="badge badge-blue" style="background:var(--yellow-bg);color:var(--yellow)">'+y+' Parcial<\/span><span class="badge badge-red">'+r+' Critico<\/span><\/div>';
    h+='<div style="font-size:0.82em;color:var(--fg-muted)">Tarefas: '+d+'/'+t2+' ('+p2+'%)<\/div>';
    h+='<div class="pbar mt-8"><div class="pbar-fill '+(parseFloat(p2)>=80?'green':parseFloat(p2)>=50?'yellow':'red')+'" style="width:'+p2+'%">'+p2+'%<\/div><\/div>';
    document.getElementById('dash-kpi-summary').innerHTML=h;
  }
};

var DRE={
  render:function(){
    var s=State.get(),tr=s.settings.taxRate||0.04;
    var el=document.getElementById('dre-tax');if(el&&el.value!==(tr*100).toFixed(1)){el.value=(tr*100).toFixed(1)}
    var sel=document.getElementById('dre-month-select');if(!sel)return;
    var h='';for(var i=0;i<12;i++)h+='<option value="'+i+'">'+Tabs.label(i)+' (x'+Monthly.getFactor(s,i).toFixed(2)+')<\/option>';
    var cur=sel.value;sel.innerHTML=h;if(cur&&parseInt(cur,10)<12)sel.value=cur;
    this.renderMV();this.renderChart();
  },
  renderMV:function(){
    var s=State.get(),mi=parseInt(document.getElementById('dre-month-select').value||'0',10);
    var tr=s.settings.taxRate||0.04,c=Monthly.calcMonth(s,mi,tr);
    var nao=0;if(s.cashFlow&&s.cashFlow.months&&s.cashFlow.months[mi]){var cf2=s.cashFlow.months[mi];nao=(cf2.entradaNaoOper||0)-(cf2.saidaNaoOper||0)}
    var resOp=c.luc-c.fix+nao,resLiq=resOp-c.imp;
    var mB=c.rev>0?(c.luc/c.rev*100).toFixed(1):'0.0',mL=c.rev>0?(resLiq/c.rev*100).toFixed(1):'0.0';
    var pc=function(v){return v>=0?'positive':'negative'};
    var fm=function(v){return Chart.fmtM(v)};
    var h='<table><tbody>';
    h+='<tr><td>(+) Receita Bruta<\/td><td class="right">'+fm(c.rev)+'<\/td><\/tr>';
    h+='<tr><td>(-) Impostos ('+(tr*100).toFixed(1)+'%)<\/td><td class="right negative">-'+fm(c.imp)+'<\/td><\/tr>';
    h+='<tr style="font-weight:700"><td>(=) Receita Liquida<\/td><td class="right">'+fm(c.liq)+'<\/td><\/tr>';
    h+='<tr><td>(-) CMV<\/td><td class="right negative">-'+fm(c.cmv)+'<\/td><\/tr>';
    h+='<tr style="font-weight:700"><td>(=) Lucro Bruto ('+mB+'%)<\/td><td class="right '+pc(c.luc)+'">'+fm(c.luc)+'<\/td><\/tr>';
    h+='<tr><td>(-) Custos Fixos<\/td><td class="right negative">-'+fm(c.fix)+'<\/td><\/tr>';
    h+='<tr><td>(+/-) Receitas/Desp. N.Op.<\/td><td class="right" colspan="1"><input type="number" value="'+nao.toFixed(2)+'" step="10" style="width:90px" onchange="App.DRE.setNao('+mi+',this.value)"><\/td><\/tr>';
    h+='<tr style="font-weight:700"><td>(=) Resultado Operacional<\/td><td class="right '+pc(resOp)+'">'+fm(resOp)+'<\/td><\/tr>';
    h+='<tr style="font-weight:700"><td>(=) Lucro/Prejuizo Liquido ('+mL+'%)<\/td><td class="right '+pc(resLiq)+'">'+fm(resLiq)+'<\/td><\/tr>';
    h+='<\/tbody><\/table>';
    h+='<div class="mt-8" style="font-size:0.82em;color:var(--fg-muted)">Estoque: '+fm(c.inv)+' | Sazonal: x'+c.sz.toFixed(2)+'<\/div>';
    document.getElementById('dre-table-wrap').innerHTML=h;
    this.syncCF(s);
  },
  setNao:function(mi,v){var s=State.get();var val=parseFloat(v);if(isNaN(val))val=0;var m=s.cashFlow.months[mi];if(!m)return;if(val>=0){m.entradaNaoOper=val;m.saidaNaoOper=0}else{m.entradaNaoOper=0;m.saidaNaoOper=Math.abs(val)};State.markDirty();this.renderMV();if(App.CashFlow.render)App.CashFlow.render()},
  renderChart:function(){
    var s=State.get(),tr=s.settings.taxRate||0.04,lb=[],rc=[],cv=[],fx=[],lc=[];
    for(var i=0;i<12;i++){var c=Monthly.calcMonth(s,i,tr);lb.push(c.label);rc.push(c.rev);cv.push(c.cmv);fx.push(c.fix);lc.push(c.luc-c.fix)}
    Chart.barChart(lb,[{label:'Receita',color:'rgba(88,166,255,0.7)',values:rc},{label:'CMV',color:'rgba(210,153,34,0.7)',values:cv},{label:'Fixos',color:'rgba(139,148,158,0.7)',values:fx},{label:'Lucro',color:'rgba(63,185,80,0.7)',values:lc}],'dre-chart');
  },
  syncCF:function(s){if(!s.cashFlow||!s.cashFlow.months)return;for(var i=0;i<Math.min(s.cashFlow.months.length,12);i++){var m=s.cashFlow.months[i],d=Monthly.calcMonth(s,i,s.settings.taxRate||0.04);if(!m._customOper){m.entradaOperacional=d.rev;m.saidaCMV=d.cmv;m.saidaFixos=d.fix}}},
  exportConsolidado:function(){
    var s=State.get(),tr=s.settings.taxRate||0.04,t='DRE CONSOLIDADO ANUAL\nGerado: '+new Date().toLocaleString('pt-BR')+'\n\n';
    for(var i=0;i<12;i++){var c=Monthly.calcMonth(s,i,tr),li=c.luc-c.fix-c.imp;t+='--- '+c.label+' ---\nReceita: '+Chart.fmtM(c.rev)+'\nImpostos: -'+Chart.fmtM(c.imp)+'\nCMV: -'+Chart.fmtM(c.cmv)+'\nFixos: -'+Chart.fmtM(c.fix)+'\nResultado: '+Chart.fmtM(li)+'\n\n'}
    var b=new Blob([t],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='DRE_'+new Date().toISOString().slice(0,7)+'.txt';a.click();
    Toast.show('DRE exportado com sucesso','success',3000);
  }
};

var CashFlow={
  render:function(){
    if(!document.getElementById('page-fluxo').classList.contains('active'))return;
    var s=State.get();DRE.syncCF(s);this.table();this.chart();this.summary();
  },
  table:function(){
    var cf=Monthly.calcCF(State.get()),h='';
    cf.forEach(function(c){var neg=c.saldo<0;h+='<tr style="cursor:pointer"'+(neg?' class="negative"':'')+' onclick="App.CashFlow.detail('+c.mi+')"><td><strong>'+c.label+'<\/strong><\/td><td class="right">'+Chart.fmtM(c.ent)+'<\/td><td class="right">'+Chart.fmtM(c.sai)+'<\/td><td class="right"><strong>'+Chart.fmtM(c.saldo)+'<\/strong><\/td><td class="right '+(c.acum<0?'negative':'positive')+'"><strong>'+Chart.fmtM(c.acum)+'<\/strong><\/td><\/tr>'});
    document.getElementById('fc-tbody').innerHTML=h;
  },
  detail:function(idx){
    var m=State.get().cashFlow.months[idx];if(!m)return;
    var h='<div class="panel mt-8"><h3>Detalhe: '+m.label+'<\/h3><div class="dual"><div>';
    h+='<label style="display:block;margin:6px 0">Entradas Operacionais:<br><input type="number" value="'+(m.entradaOperacional||0)+'" step="50" onchange="App.CashFlow.mc('+idx+',\'entradaOperacional\',this.value)"><\/label>';
    h+='<label style="display:block;margin:6px 0">Entradas N.Op.:<br><input type="number" value="'+(m.entradaNaoOper||0)+'" step="50" onchange="App.CashFlow.mc('+idx+',\'entradaNaoOper\',this.value)"><\/label><\/div><div>';
    h+='<label style="display:block;margin:6px 0">CMV:<br><input type="number" value="'+(m.saidaCMV||0)+'" step="50" onchange="App.CashFlow.mc('+idx+',\'saidaCMV\',this.value)"><\/label>';
    h+='<label style="display:block;margin:6px 0">Fixos:<br><input type="number" value="'+(m.saidaFixos||0)+'" step="50" onchange="App.CashFlow.mc('+idx+',\'saidaFixos\',this.value)"><\/label>';
    h+='<label style="display:block;margin:6px 0">Saidas N.Op.:<br><input type="number" value="'+(m.saidaNaoOper||0)+'" step="50" onchange="App.CashFlow.mc('+idx+',\'saidaNaoOper\',this.value)"><\/label><\/div><\/div>';
    h+='<div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="App.CashFlow.resetMonth('+idx+')">&#8634; Resetar para automatico<\/button><\/div><\/div>';
    document.getElementById('fc-detail').innerHTML=h;
  },
  mc:function(id,f,v){var s=State.get();var val=parseFloat(v);if(isNaN(val))val=0;s.cashFlow.months[id][f]=val;s.cashFlow.months[id]._customOper=true;State.markDirty();this.render()},
  resetMonth:function(idx){var s=State.get();var m=s.cashFlow.months[idx];if(!m)return;delete m._customOper;State.markDirty();this.render();Toast.show('Mes '+m.label+' resetado para automatico','info',2000)},
  chart:function(){
    var s=State.get(),lb=[],vals=[],ac=0;
    for(var i=0;i<s.cashFlow.months.length;i++){lb.push(s.cashFlow.months[i].label);ac+=(s.cashFlow.months[i].entradaOperacional||0)+(s.cashFlow.months[i].entradaNaoOper||0)-(s.cashFlow.months[i].saidaCMV||0)-(s.cashFlow.months[i].saidaFixos||0)-(s.cashFlow.months[i].saidaNaoOper||0);vals.push(+ac.toFixed(2))}
    Chart.lineChart(lb,vals,'fc-chart');
  },
  summary:function(){
    var s=State.get(),tE=0,tS=0;
    for(var i=0;i<s.cashFlow.months.length;i++){tE+=(s.cashFlow.months[i].entradaOperacional||0)+(s.cashFlow.months[i].entradaNaoOper||0);tS+=(s.cashFlow.months[i].saidaCMV||0)+(s.cashFlow.months[i].saidaFixos||0)+(s.cashFlow.months[i].saidaNaoOper||0)}
    var f=tE-tS,cm=s.cashFlow.months.length>0?tS/s.cashFlow.months.length:0,sv=cm>0?Math.floor(f/cm):'inf';
    document.getElementById('fc-summary').innerHTML=Dashboard.mc('Total Entradas',Chart.fmtM(tE),'12 meses')+Dashboard.mc('Total Saidas',Chart.fmtM(tS),'')+Dashboard.mc('Saldo Final',Chart.fmtM(f),f>=0?'positive':'negative')+Dashboard.mc('Meses Sobrevivencia',''+sv,'Custo medio: '+Chart.fmtM(cm),'');
  }
};

var Inventory={
  render:function(){
    var s=State.get(),tb=document.getElementById('inv-tbody');if(!tb)return;
    var today=new Date();today.setHours(0,0,0,0);var h='',tV=0;
    s.inventory.forEach(function(it){
      var ttl=it.qty*(it.unitPrice||0);tV+=ttl;
      var lo=it.minQty>0&&it.qty<=it.minQty,dy=it.expiry?Math.ceil((new Date(it.expiry)-today)/864e5):null;
      var bg=lo?'background:var(--red-bg)':(dy!==null&&dy<=7?(dy<=0?'background:var(--red-bg)':'background:var(--yellow-bg)'):'');
      h+='<tr style="'+bg+'"><td>'+it.name+'<\/td><td class="right">'+it.qty+'<\/td><td class="right">'+it.minQty+'<\/td><td class="right">'+Chart.fmtM(it.unitPrice||0)+'<\/td><td class="right"><strong>'+Chart.fmtM(ttl)+'<\/strong><\/td><td>'+(it.expiry||'-')+'<\/td>';
      h+='<td><button class="btn btn-success btn-sm" onclick="App.Inventory.entry(\''+it.id+'\')">+<\/button> <button class="btn btn-danger btn-sm" onclick="App.Inventory.exit(\''+it.id+'\')">&#8722;<\/button> <button class="btn btn-outline btn-sm" onclick="App.Inventory.del(\''+it.id+'\')">&#215;<\/button><\/td><\/tr>';
    });
    tb.innerHTML=h;
    var el=document.getElementById('inv-total');if(el)el.textContent='Valor Total: '+Chart.fmtM(tV);
    this.alerts(s);
  },
  alerts:function(s){
    var today=new Date();today.setHours(0,0,0,0);var h='',cnt=0;
    s.inventory.forEach(function(it){
      if(it.minQty>0&&it.qty<=it.minQty){
        cnt++;h+='<div class="alert-item"><span class="alert-dot red"><\/span><span class="at">Estoque baixo: <strong>'+it.name+'<\/strong><\/span><\/div>';
      }
      if(it.expiry){
        var d=Math.ceil((new Date(it.expiry)-today)/864e5);
        if(d<=0){cnt++;h+='<div class="alert-item"><span class="alert-dot red"><\/span><span class="at">VENCIDO: <strong>'+it.name+'<\/strong><\/span><\/div>';}
        else if(d<=7){cnt++;h+='<div class="alert-item"><span class="alert-dot yellow"><\/span><span class="at">Vence em '+d+'d: <strong>'+it.name+'<\/strong><\/span><\/div>';}
      }
    });
    if(!cnt)h='<div style="color:var(--fg-muted);padding:8px">Nenhum alerta.<\/div>';
    document.getElementById('inv-alerts').innerHTML=h;
  },
  showAdd:function(){
    var h='<h3>Novo Produto<\/h3><div class="flex" style="flex-wrap:wrap;gap:8px">';
    h+='<input type="text" id="inv-f-name" placeholder="Nome" style="flex:1;min-width:150px">';
    h+='<input type="number" id="inv-f-qty" value="0" min="0" style="width:70px" title="Quantidade">';
    h+='<input type="number" id="inv-f-min" value="5" min="0" style="width:60px" title="Estoque minimo">';
    h+='<input type="number" id="inv-f-price" value="0" step="0.10" min="0" style="width:80px" title="Preco unitario">';
    h+='<input type="date" id="inv-f-exp" title="Data de validade">';
    h+='<button class="btn btn-success btn-sm" onclick="App.Inventory.saveItem()">Salvar<\/button> <button class="btn btn-outline btn-sm" onclick="App.Inventory.hide()">Cancelar<\/button><\/div>';
    document.getElementById('inv-form').innerHTML=h;document.getElementById('inv-form').classList.remove('hidden');
    var inp=document.getElementById('inv-f-name');if(inp)inp.focus();
  },
  saveItem:function(){
    var nm=document.getElementById('inv-f-name').value.trim();
    if(!nm){Toast.show('Informe o nome do produto','warning');return}
    var qv=parseFloat(document.getElementById('inv-f-qty').value);if(isNaN(qv))qv=0;
    var mv=parseFloat(document.getElementById('inv-f-min').value);if(isNaN(mv))mv=0;
    var pv=parseFloat(document.getElementById('inv-f-price').value);if(isNaN(pv))pv=0;
    var s=State.get();s.inventory.push({id:State.uid(),name:nm,qty:qv,minQty:mv,unitPrice:pv,expiry:document.getElementById('inv-f-exp').value||''});
    State.markDirty();this.hide();this.render();Toast.show('Produto "'+nm+'" adicionado','success',2000);
  },
  hide:function(){document.getElementById('inv-form').classList.add('hidden')},
  entry:function(id){this._moveDialog(id,'Entrada','+')},
  exit:function(id){this._moveDialog(id,'Saida','-')},
  _moveDialog:function(id,type,mode){
    var s=State.get(),it=null;
    s.inventory.forEach(function(i){if(i.id===id)it=i});if(!it)return;
    var h='<h3>'+type+': '+it.name+'<\/h3><div class="flex" style="gap:8px;align-items:center">';
    h+='<input type="number" id="stock-move-val" value="1" min="0.1" step="0.1" style="width:100px" autofocus>';
    h+='<button class="btn '+(mode==='+'?'btn-success':'btn-danger')+' btn-sm" onclick="App.Inventory.applyMove(\''+id+'\',\''+mode+'\')">Aplicar<\/button>';
    h+='<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'stock-move\').remove()">Cancelar<\/button><\/div>';
    var card=document.createElement('div');card.className='form-card';card.id='stock-move';
    card.innerHTML=h;
    var wrap=document.getElementById('inv-form');
    wrap.innerHTML='';wrap.appendChild(card);wrap.classList.remove('hidden');
    var inp=document.getElementById('stock-move-val');if(inp){inp.focus();inp.select()}
  },
  applyMove:function(id,mode){
    var v=parseFloat(document.getElementById('stock-move-val').value);
    if(isNaN(v)||v<=0){Toast.show('Quantidade invalida','warning');return}
    var s=State.get();
    s.inventory.forEach(function(it){if(it.id===id){if(mode==='+')it.qty+=v;else it.qty=Math.max(0,it.qty-v)}});
    State.markDirty();document.getElementById('stock-move').remove();
    this.render();Toast.show((mode==='+'?'Entrada':'Saida')+' de '+v+' unidades aplicada','success',2000);
  },
  del:function(id){
    var s=State.get(),it=null;s.inventory.forEach(function(i){if(i.id===id)it=i});
    var nm=it?it.name:'este item';
    Modal.confirm('Remover "'+nm+'" do estoque?').then(function(ok){
      if(!ok)return;s.inventory=s.inventory.filter(function(i){return i.id!==id});State.markDirty();App.Inventory.render();Toast.show('Item removido','info',2000);
    });
  },
  showBulk:function(){
    var s=State.get(),h='<h3>Entrada em Lote<\/h3><div class="flex" style="flex-wrap:wrap;gap:8px">';
    h+='<select id="inv-bs" style="flex:1;min-width:150px"><option value="">Selecione<\/option>';
    s.inventory.forEach(function(it){h+='<option value="'+it.id+'">'+it.name+'<\/option>'});
    h+='<option value="__new">+ Novo<\/option>';
    h+='<\/select>';
    h+='<input type="number" id="inv-bq" value="0" min="0" style="width:70px" title="Quantidade">';
    h+='<input type="number" id="inv-bp" value="0" step="0.10" min="0" style="width:80px" title="Preco (0 = manter atual)">';
    h+='<input type="date" id="inv-be" title="Data de validade">';
    h+='<button class="btn btn-success btn-sm" onclick="App.Inventory.applyBulk()">Aplicar<\/button> <button class="btn btn-outline btn-sm" onclick="App.Inventory.hide()">Cancelar<\/button><\/div>';
    document.getElementById('inv-form').innerHTML=h;document.getElementById('inv-form').classList.remove('hidden');
  },
  applyBulk:function(){
    var id=document.getElementById('inv-bs').value;
    var qty=parseFloat(document.getElementById('inv-bq').value);if(isNaN(qty))qty=0;
    var price=parseFloat(document.getElementById('inv-bp').value);if(isNaN(price))price=0;
    var exp=document.getElementById('inv-be').value||'';
    if(!id||qty<=0){Toast.show('Selecione o produto e informe quantidade','warning');return}
    var s=State.get();
    if(id==='__new'){
      Modal.prompt('Nome do novo produto:').then(function(nm){
        if(!nm)return;s.inventory.push({id:State.uid(),name:nm,qty:qty,minQty:5,unitPrice:price,expiry:exp});State.markDirty();App.Inventory.hide();App.Inventory.render();Toast.show('"'+nm+'" adicionado (x'+qty+')','success',2000);
      });
    }else{
      var added=false;
      s.inventory.forEach(function(it){if(it.id===id){it.qty+=qty;if(price>0)it.unitPrice=price;if(exp)it.expiry=exp;added=true}});
      State.markDirty();this.hide();this.render();if(added)Toast.show('Estoque atualizado (+x'+qty+')','success',2000);
    }
  }
};

var Assumptions={
  render:function(){var s=State.get();this.seas(s);this.fc(s)},
  seas:function(s){
    var szs=Monthly.getSeasonals(s),now=new Date(),cm=now.getMonth(),tb=document.getElementById('prem-seas-tbody');if(!tb)return;var h='';
    for(var i=0;i<12;i++){var mi=(cm+i)%12,lbl=Tabs.label(i),ic=i===0;h+='<tr'+(ic?' style="font-weight:700;color:var(--accent)"':'')+'><td>'+lbl+(ic?' <span style="font-size:0.75em;color:var(--accent)">(atual)<\/span>':'')+'<\/td>';h+='<td class="right"><input type="number" value="'+szs[mi]+'" step="0.05" min="0.1" max="2.0" style="width:70px" onchange="App.Assumptions.us('+i+',this.value)"><\/td>';h+='<td class="right">'+(szs[mi]*(s.settings.seasonalFactor||1.0)).toFixed(2)+'<\/td><\/tr>'}
    tb.innerHTML=h;
  },
  fc:function(s){var tb=document.getElementById('prem-fc-tbody');if(!tb)return;var h='',tot=0;s.fixedCosts.forEach(function(fc){var v=parseFloat(fc.v||0);tot+=v;h+='<tr><td>'+fc.n+'<\/td><td class="right"><input type="number" value="'+v+'" step="50" min="0" style="width:100px" onchange="App.Assumptions.uf(\''+fc.id+'\',this.value)"><\/td><\/tr>'});tb.innerHTML=h;document.getElementById('prem-fc-total').textContent=Chart.fmtM(tot)},
  us:function(i,v){var s=State.get(),now=new Date(),idx=(now.getMonth()+i)%12,val=parseFloat(v);if(isNaN(val)||val<0.1)val=0.1;if(val>2)val=2;if(!s.settings.assumptions)s.settings.assumptions={};if(!s.settings.assumptions.monthlySeasonals)s.settings.assumptions.monthlySeasonals=[0.65,0.55,0.6,0.7,0.85,0.95,1.0,1.05,1.1,1.15,1.1,1.0];s.settings.assumptions.monthlySeasonals[idx]=val;State.markDirty();this.render();if(App.DRE.render)App.DRE.render();if(App.Dashboard.render)App.Dashboard.render()},
  uf:function(id,v){var s=State.get();var val=parseFloat(v);if(isNaN(val))val=0;s.fixedCosts.forEach(function(fc){if(fc.id===id)fc.v=val});State.markDirty();this.fc(s);if(App.DRE.render)App.DRE.render();if(App.CashFlow.render)App.CashFlow.render();if(App.Dashboard.render)App.Dashboard.render();KPI.autoCalc(s);KPI.render()},
  resetDefaults:function(){Modal.confirm('Restaurar todos os valores padrao?').then(function(ok){if(!ok)return;var s=State.get();s.settings.assumptions.monthlySeasonals=[0.65,0.55,0.6,0.7,0.85,0.95,1.0,1.05,1.1,1.15,1.1,1.0];s.fixedCosts.forEach(function(fc){fc.v=0});State.markDirty();App.Assumptions.render();if(App.DRE.render)App.DRE.render();if(App.Dashboard.render)App.Dashboard.render();if(App.CashFlow.render)App.CashFlow.render();KPI.autoCalc(s);KPI.render();Toast.show('Valores padrao restaurados','info',2000)})}
};

var Scenario={
  render:function(){
    var s=State.get(),sz=s.settings.seasonalFactor||1.0;
    var el=document.getElementById('sz-display');if(el)el.textContent=sz.toFixed(2);
    var si=document.getElementById('sim-sz');if(si)si.value=sz;
    var wv=document.getElementById('winter-select');if(wv)wv.value=sz;
    this.simTable(s);
    this.grid(s);
    Chart.miniBar(Monthly.getSeasonals(s),'sz-chart');
    this.compSelects(s);
    var nb=document.getElementById('badge-scen');if(nb)nb.textContent=Object.keys(s.scenarios||{}).length;
    this._wireSim();
  },
  _wireSim:function(){
    var szIn=document.getElementById('sim-sz');
    if(szIn&&!szIn._bound){szIn._bound=true;var self=this;szIn.oninput=function(){var s=State.get();var v=parseFloat(this.value);if(isNaN(v))v=1.0;s.settings.seasonalFactor=v;var d2=document.getElementById('sz-display');if(d2)d2.textContent=v.toFixed(2);State.markDirty();if(App.DRE.render)App.DRE.render();if(App.Dashboard.render)App.Dashboard.render();KPI.autoCalc(s);KPI.render();Chart.miniBar(Monthly.getSeasonals(s),'sz-chart')}}
    var wSe=document.getElementById('winter-select');
    if(wSe&&!wSe._bound){wSe._bound=true;wSe.onchange=function(){var s=State.get();s.settings.seasonalFactor=parseFloat(this.value);var d2=document.getElementById('sz-display');if(d2)d2.textContent=s.settings.seasonalFactor.toFixed(2);var si=document.getElementById('sim-sz');if(si)si.value=s.settings.seasonalFactor;State.markDirty();if(App.DRE.render)App.DRE.render();if(App.Dashboard.render)App.Dashboard.render();KPI.autoCalc(s);KPI.render();Chart.miniBar(Monthly.getSeasonals(s),'sz-chart')}}
  },
  simTable:function(s){
    var allP=s.products.concat(s.winterProducts),g={};allP.forEach(function(p){var c=p.id.split('_')[0].toUpperCase();if(!g[c])g[c]=[];g[c].push(p)});
    var keys=Object.keys(g),h='<table>';
    keys.forEach(function(cat,gi){
      var vis=gi===0;
      h+='<tr class="cat-header" onclick="App.Scenario.togCat(this)"><td><strong>'+cat+'<\/strong> ('+g[cat].length+' itens) <span class="cat-arrow">'+(vis?'&#9660;':'&#9654;')+'<\/span><\/td><\/tr>';
      h+='<tbody'+(vis?'':' style="display:none"')+'>';
      g[cat].forEach(function(pr){
        var invC=null;for(var k=0;k<s.inventory.length;k++){if(s.inventory[k].id==='inv_'+pr.id){invC=s.inventory[k];break}}
        var iq=invC?invC.qty:0,ic=invC?invC.unitPrice:pr.c;
        h+='<tr><td>'+pr.n+'<\/td><td class="right">'+Chart.fmtM(ic)+'<\/td><td class="right">'+iq+'<\/td>';
        h+='<td class="right"><input type="number" value="'+pr.q+'" step="0.1" min="0" style="width:60px" onchange="App.Scenario.upd(\''+pr.id+'\',\'q\',this.value)"><\/td>';
        h+='<td class="right"><input type="number" value="'+pr.p+'" step="0.5" min="0" style="width:60px" onchange="App.Scenario.upd(\''+pr.id+'\',\'p\',this.value)"><\/td><\/tr>';
      });
      h+='<\/tbody>';
    });
    h+='<\/table>';document.getElementById('scen-grid').innerHTML=h;
  },
  togCat:function(row){var nb=row.nextSibling;if(!nb)return;var vis=nb.style.display!=='none';nb.style.display=vis?'none':'';var ar=row.querySelector('.cat-arrow');if(ar)ar.innerHTML=vis?'&#9654;':'&#9660;'},
  upd:function(id,f,v){var s=State.get();var val=parseFloat(v);if(isNaN(val))val=0;s.products.forEach(function(p){if(p.id===id)p[f]=val});s.winterProducts.forEach(function(p){if(p.id===id)p[f]=val});State.markDirty()},
  grid:function(s){
    var sc=s.scenarios||{},keys=Object.keys(sc),h='';
    if(!keys.length){h='<div style="color:var(--fg-muted);grid-column:1/-1;text-align:center;padding:40px">Nenhum cenario salvo. Use a simulacao rapida ou crie templates.<\/div>'}
    keys.forEach(function(name){
      var sc2=sc[name],tag=sc2.tag||'custom';
      var cls=s.activeScenario===name?'scen-card '+tag+' active-scen':'scen-card '+tag;
      var rev=0,cmv=0;(sc2.products||[]).forEach(function(p){rev+=p.q*p.p;cmv+=p.q*p.c});(sc2.winterProducts||[]).forEach(function(p){rev+=p.q*p.p;cmv+=p.q*p.c});
      var fix=0;(sc2.fixedCosts||[]).forEach(function(f){fix+=(f.v||0)});var liq=rev-cmv-fix;
      h+='<div class="'+cls+'"><div class="sc-actions">';
      h+='<button class="btn-act" onclick="App.Scenario.activate(\''+name+'\')">Ativar<\/button>';
      h+='<button class="btn-act" onclick="App.Scenario.load(\''+name+'\')" style="font-size:0.68em">Carregar<\/button>';
      h+='<button class="btn-act" onclick="App.Scenario.remove(\''+name+'\')" style="font-size:0.68em;color:var(--red);border-color:var(--red)">Excluir<\/button>';
      h+='<\/div><div class="sc-tag">'+tag+'<\/div>';
      h+='<div class="sc-name">'+name+'<\/div>';
      h+='<div class="sc-metrics">Receita: <strong style="color:var(--fg)">'+Chart.fmtM(rev)+'<\/strong><br>';
      h+='CMV: '+Chart.fmtM(cmv)+' | Fixos: '+Chart.fmtM(fix)+'<br>';
      h+='Lucro Est.: <strong style="color:'+(liq>=0?'var(--green)':'var(--red)')+'">'+Chart.fmtM(liq)+'<\/strong><br>';
      h+='Sazonalidade: <strong>'+sc2.seasonal.toFixed(2)+'<\/strong><\/div>';
      h+='<div class="sc-date">'+(sc2.date||'')+'<\/div><\/div>\n';
    });
    document.getElementById('scen-grid').innerHTML=h;
  },
  save:function(){var n=document.getElementById('scen-name').value.trim();if(!n){Toast.show('Nome do cenario e obrigatorio','warning');return}var s=State.get();var tag=document.getElementById('scen-tag').value;if(s.scenarios[n]){Toast.show('Cenario ja existe. Exclua antes de sobrescrever.','warning');return}s.scenarios[n]={tag:tag,seasonal:s.settings.seasonalFactor||1.0,date:new Date().toLocaleString('pt-BR'),products:JSON.parse(JSON.stringify(s.products)),winterProducts:JSON.parse(JSON.stringify(s.winterProducts)),inventory:JSON.parse(JSON.stringify(s.inventory)),fixedCosts:JSON.parse(JSON.stringify(s.fixedCosts))};State.markDirty();document.getElementById('scen-name').value='';this.render();Toast.html('Cenario "<strong>'+n+'</strong>" salvo com sucesso!','success',3000)},
  load:function(name){var s=State.get();var sc=s.scenarios[name];if(!sc){Toast.show('Cenario nao encontrado','error');return}s.products=JSON.parse(JSON.stringify(sc.products));if(sc.winterProducts)s.winterProducts=JSON.parse(JSON.stringify(sc.winterProducts));if(sc.inventory)s.inventory=JSON.parse(JSON.stringify(sc.inventory));if(sc.fixedCosts)s.fixedCosts=JSON.parse(JSON.stringify(sc.fixedCosts));s.settings.seasonalFactor=sc.seasonal||1.0;State.markDirty();this.render();Toast.html('Cenario "<strong>'+name+'</strong>" carregado','success',2000)},
  activate:function(name){var s=State.get();if(!s.scenarios[name]){Toast.show('Cenario nao encontrado','error');return}s.products=JSON.parse(JSON.stringify(s.scenarios[name].products));if(s.scenarios[name].winterProducts)s.winterProducts=JSON.parse(JSON.stringify(s.scenarios[name].winterProducts));if(s.scenarios[name].inventory)s.inventory=JSON.parse(JSON.stringify(s.scenarios[name].inventory));if(s.scenarios[name].fixedCosts)s.fixedCosts=JSON.parse(JSON.stringify(s.scenarios[name].fixedCosts));s.settings.seasonalFactor=s.scenarios[name].seasonal||1.0;s.activeScenario=name;s.cashFlow.months.forEach(function(m){m._customOper=false});State.markDirty();this.render();State.rebuild();Toast.html('Cenario "<strong>'+name+'</strong>" ativado!','success',3000)},
  remove:function(name){var s=State.get();if(!name||!s.scenarios[name]){Toast.show('Nenhum cenario selecionado','warning');return}Modal.confirm('Excluir "'+name+'"?').then(function(ok){if(!ok)return;delete s.scenarios[name];if(s.activeScenario===name)s.activeScenario=null;State.markDirty();App.Scenario.render();Toast.show('Cenario excluido','info',2000)})},
  createTemplates:function(){
    var s=State.get();
    var tpls=[{name:'Cenario Otimista',tag:'otimista',qM:1.2,pM:1.05,sz:1.2},{name:'Cenario Realista',tag:'realista',qM:1,pM:1,sz:1},{name:'Cenario Pessimista',tag:'pessimista',qM:0.8,pM:0.95,sz:0.7}];
    var created=0;
    tpls.forEach(function(t){
      if(s.scenarios[t.name])return;created++;
      var prods=s.products.map(function(p){return{id:p.id,n:p.n,c:p.c,p:+(p.p*t.pM).toFixed(2),q:+(p.q*t.qM).toFixed(1)}});
      var wP=s.winterProducts.map(function(p){return{id:p.id,n:p.n,c:p.c,p:+(p.p*t.pM).toFixed(2),q:+(p.q*t.qM).toFixed(1)}});
      var inv=s.inventory.map(function(it){var ni={id:it.id,name:it.name,qty:it.qty,minQty:it.minQty,unitPrice:it.unitPrice,expiry:it.expiry};for(var k=0;k<prods.length;k++){if('inv_'+prods[k].id===it.id){ni.qty=prods[k].q;ni.unitPrice=prods[k].c;break}}for(var k=0;k<wP.length;k++){if('inv_'+wP[k].id===it.id){ni.qty=wP[k].q;break}}return ni});
      s.scenarios[t.name]={tag:t.tag,seasonal:t.sz,date:new Date().toLocaleString('pt-BR'),products:prods,winterProducts:wP,inventory:inv,fixedCosts:JSON.parse(JSON.stringify(s.fixedCosts))};
    });
    State.markDirty();this.render();
    if(created===0){Toast.show('Todos os templates ja existem','info',2000)}else{Toast.show(created+' cenario(s) template criado(s)','success',3000)}
  },
  compare:function(){
    var c1=document.getElementById('scen-c1').value,c2=document.getElementById('scen-c2').value,c3=document.getElementById('scen-c3').value;
    var names=[c1,c2,c3].filter(function(n){return n});
    if(names.length<2){Toast.show('Selecione pelo menos 2 cenarios','warning');return}
    var s=State.get(),sc=s.scenarios;
    var metrics=[
      {label:'Sazonalidade',fn:function(x){return(x.seasonal||0).toFixed(2)}},
      {label:'Produtos',fn:function(x){return(x.products||[]).length+(x.winterProducts?x.winterProducts.length:0)}},
      {label:'Receita Est.',fn:function(x){var r=0;(x.products||[]).forEach(function(v){r+=v.q*v.p});(x.winterProducts||[]).forEach(function(v){r+=v.q*v.p});return Chart.fmtM(r)}},
      {label:'CMV Est.',fn:function(x){var r=0;(x.products||[]).forEach(function(v){r+=v.q*v.c});(x.winterProducts||[]).forEach(function(v){r+=v.q*v.c});return Chart.fmtM(r)}},
      {label:'Custos Fixos',fn:function(x){var r=0;(x.fixedCosts||[]).forEach(function(v){r+=(v.v||0)});return Chart.fmtM(r)}},
      {label:'Lucro Bruto Est.',fn:function(x){var r=0,cm=0;(x.products||[]).forEach(function(v){r+=v.q*v.p;cm+=v.q*v.c});(x.winterProducts||[]).forEach(function(v){r+=v.q*v.p;cm+=v.q*v.c});return Chart.fmtM(r-cm)}},
      {label:'Valor Estoque',fn:function(x){var r=0;(x.inventory||[]).forEach(function(v){r+=v.qty*v.unitPrice});return Chart.fmtM(r)}}
    ];
    var h='<div class="flex" style="gap:16px;margin-top:12px;flex-wrap:wrap">';
    names.forEach(function(n){
      var x=sc[n];if(!x)return;
      h+='<div class="compare-col" style="flex:1;min-width:230px"><h4>'+n+'<\/h4>';
      metrics.forEach(function(m){h+='<div class="compare-row"><span class="cr-label">'+m.label+'<\/span><span class="cr-value">'+m.fn(x)+'<\/span><\/div>'});
      h+='<\/div>';
    });
    h+='<\/div>';
    h+='<div class="chart-box mt-12"><div class="chart-container"><canvas id="scen-comp-chart" height="200"><\/canvas><\/div><\/div>';
    document.getElementById('scen-compare-result').innerHTML=h;
    var labels=['Receita','CMV','Fixos','Lucro Bruto'];
    var vals=[];
    names.forEach(function(n){var x=sc[n];if(!x)return;var r=0,cm=0,fx=0;(x.products||[]).forEach(function(v){r+=v.q*v.p;cm+=v.q*v.c});(x.winterProducts||[]).forEach(function(v){r+=v.q*v.p;cm+=v.q*v.c});(x.fixedCosts||[]).forEach(function(v){fx+=(v.v||0)});vals.push([r,cm,fx,r-cm])});
    Chart.scenarioCompChart(labels,names,vals,'scen-comp-chart');
  },
  compSelects:function(s){var h='<option value="">selecione<\/option>';Object.keys(s.scenarios||{}).forEach(function(n){h+='<option value="'+n+'">'+n+'<\/option>'});document.querySelectorAll('.scen-comp-sel').forEach(function(sel){sel.innerHTML=h})}
};

var KPI={
  render:function(){var s=State.get();this.autoCalc(s);var h='';
    s.kpis.forEach(function(k){var pct=k.target>0?Math.min(100,k.value/k.target*100):0;var sC=pct>=80?'green':pct>=50?'yellow':'red';var sT=pct>=80?'OK':pct>=50?'Parcial':'Critico';var pc2=pct>=80?'positive':pct>=50?'':'negative';
    h+='<tr><td><strong>'+k.name+'<\/strong><br><small style="color:var(--fg-muted)">'+k.period+' - '+k.unit+'<\/small><\/td>';
    h+='<td class="right">'+k.target.toLocaleString('pt-BR')+' '+k.unit+'<\/td>';
    h+='<td class="right">'+(k.autoCalc?k.value.toLocaleString('pt-BR',{maximumFractionDigits:2})+' '+k.unit:'<input type="number" value="'+k.value+'" step="0.1" style="width:90px" onchange="App.KPI.uv(\''+k.id+'\',this.value)">')+'<\/td>';
    h+='<td style="min-width:130px"><div class="pbar"><div class="pbar-fill '+sC+'" style="width:'+pct.toFixed(0)+'%">'+pct.toFixed(0)+'%<\/div><\/div><\/td>';
    h+='<td class="'+pc2+'">'+sT+'<\/td>';
    h+='<td><button class="btn btn-warning btn-sm" onclick="App.KPI.edit(\''+k.id+'\')">Edit<\/button> <button class="btn btn-danger btn-sm" onclick="App.KPI.del(\''+k.id+'\')">&#215;<\/button><\/td><\/tr>'});
    document.getElementById('kpi-tbody').innerHTML=h},
  autoCalc:function(s){var d=Monthly.calcMonth(s,0,s.settings.taxRate||0.04);s.kpis.forEach(function(k){if(!k.autoCalc)return;if(k.name==='Faturamento Mensal')k.value=d.rev;else if(k.name==='Margem Liquida'){var l=d.luc-d.fix;k.value=d.rev>0?+((l/d.rev*100).toFixed(2)):0}else if(k.name==='Ticket Medio'){var tq=0;s.products.forEach(function(p){tq+=p.q});s.winterProducts.forEach(function(p){tq+=p.q});k.value=tq>0?+((d.rev/tq).toFixed(2)):0}else if(k.name==='Perda de Estoque'){var td=new Date();td.setHours(0,0,0,0);var ls=0;s.inventory.forEach(function(it){if(it.expiry&&new Date(it.expiry)<=td)ls+=(it.qty*(it.unitPrice||0))});k.value=+ls.toFixed(2)}else if(k.name==='Giro de Estoque'){var tq2=0,iv=0;s.products.forEach(function(p){tq2+=p.q});s.winterProducts.forEach(function(p){tq2+=p.q});s.inventory.forEach(function(it){iv+=it.qty});k.value=iv>0?+((tq2/iv).toFixed(2)):0}})},
  showAdd:function(){var h='<h3>Novo KPI<\/h3><div class="flex" style="flex-wrap:wrap;gap:8px"><input type="text" id="kpi-fn" placeholder="Nome" style="flex:1;min-width:150px"><input type="number" id="kpi-ft" value="100" min="0" placeholder="Meta" style="width:80px"><select id="kpi-fu"><option>R$<\/option><option>%<\/option><option>unid<\/option><\/select><select id="kpi-fp"><option value="mensal">Mensal<\/option><option value="trimestral">Trimestral<\/option><option value="anual">Anual<\/option><\/select><button class="btn btn-success btn-sm" onclick="App.KPI.save()">Salvar<\/button> <button class="btn btn-outline btn-sm" onclick="App.KPI.hide()">Cancelar<\/button><\/div>';document.getElementById('kpi-form').innerHTML=h;document.getElementById('kpi-form').classList.remove('hidden');var inp=document.getElementById('kpi-fn');if(inp)inp.focus()},
  save:function(){var s=State.get();var n=document.getElementById('kpi-fn').value.trim();if(!n){Toast.show('Nome do KPI e obrigatorio','warning');return}s.kpis.push({id:State.uid(),name:n,target:parseFloat(document.getElementById('kpi-ft').value)||100,unit:document.getElementById('kpi-fu').value,period:document.getElementById('kpi-fp').value,value:0,autoCalc:false});State.markDirty();this.hide();this.render();Toast.show('KPI "'+n+'" adicionado','success',2000)},
  hide:function(){document.getElementById('kpi-form').classList.add('hidden')},
  edit:function(id){var s=State.get(),k=null;for(var i=0;i<s.kpis.length;i++){if(s.kpis[i].id===id){k=s.kpis[i];break}}if(!k)return;var h='<h3>Editar KPI<\/h3><div class="flex" style="flex-wrap:wrap;gap:8px"><input type="text" id="kpi-en" value="'+k.name+'" style="flex:1;min-width:150px"><input type="number" id="kpi-et" value="'+k.target+'" style="width:80px"><select id="kpi-eu"><option'+('R$'===k.unit?' selected':'')+'>R$<\/option><option'+('%'===k.unit?' selected':'')+'>%<\/option><option'+('unid'===k.unit?' selected':'')+'>unid<\/option><\/select><select id="kpi-ep"><option value="mensal"'+('mensal'===k.period?' selected':'')+'>Mensal<\/option><option value="trimestral"'+('trimestral'===k.period?' selected':'')+'>Trimestral<\/option><option value="anual"'+('anual'===k.period?' selected':'')+'>Anual<\/option><\/select><button class="btn btn-success btn-sm" onclick="App.KPI.se(\''+id+'\')">Salvar<\/button> <button class="btn btn-outline btn-sm" onclick="App.KPI.hide()">Cancelar<\/button><\/div>';document.getElementById('kpi-form').innerHTML=h;document.getElementById('kpi-form').classList.remove('hidden')},
  se:function(id){var s=State.get();var n=document.getElementById('kpi-en').value.trim();if(!n){Toast.show('Nome obrigatorio','warning');return}s.kpis.forEach(function(k){if(k.id===id){k.name=n;k.target=parseFloat(document.getElementById('kpi-et').value)||k.target;k.unit=document.getElementById('kpi-eu').value;k.period=document.getElementById('kpi-ep').value}});State.markDirty();this.hide();this.render()},
  uv:function(id,v){var s=State.get();s.kpis.forEach(function(k){if(k.id===id){var val=parseFloat(v);k.value=isNaN(val)?0:val}});State.markDirty();this.render()},
  del:function(id){var s=State.get();s.kpis=s.kpis.filter(function(k){return k.id!==id});State.markDirty();this.render();Toast.show('KPI removido','info',2000)}
};

var ActionPlan={
  render:function(){this.summary();var s=State.get(),f=document.getElementById('task-filter-status'),fl=f?f.value:'';var td=new Date();td.setHours(0,0,0,0);var tasks=fl?s.tasks.filter(function(t){return t.status===fl}):s.tasks;
    var h='<table><thead><tr><th>Titulo<\/th><th>Responsavel<\/th><th>Prazo<\/th><th>KPI<\/th><th>Status<\/th><th><\/th><\/tr><\/thead><tbody>';
    tasks.forEach(function(t){var ov=t.deadline&&new Date(t.deadline)<td&&t.status!=='concluido';
    h+='<tr'+(ov?' style="background:var(--red-bg)"':'')+'><td><strong>'+t.title+'<\/strong><br><small style="color:var(--fg-muted)">'+(t.desc||'').substring(0,80)+'<\/small><\/td>';
    h+='<td>'+(t.owner||'-')+'<\/td><td>'+(t.deadline||'-')+'<\/td>';
    var kn='';s.kpis.forEach(function(k){if(k.id===t.kpiId)kn=k.name});
    h+='<td>'+(kn||'-')+'<\/td><td><select onchange="App.ActionPlan.upd(\''+t.id+'\',\'status\',this.value)" style="font-size:0.82em"><option value="novo"'+('novo'===t.status?' selected':'')+'>Novo<\/option><option value="em_progresso"'+('em_progresso'===t.status?' selected':'')+'>Em Progresso<\/option><option value="concluido"'+('concluido'===t.status?' selected':'')+'>Concluido<\/option><\/select><\/td>';
    h+='<td><button class="btn btn-danger btn-sm" onclick="App.ActionPlan.del(\''+t.id+'\')">&#215;<\/button><\/td><\/tr>'});
    h+='<\/tbody><\/table>';document.getElementById('task-list').innerHTML=h},
  summary:function(){var s=State.get(),t=s.tasks.length,d=s.tasks.filter(function(x){return x.status==='concluido'}).length;var td=new Date();td.setHours(0,0,0,0);var ov=s.tasks.filter(function(x){return x.deadline&&new Date(x.deadline)<td&&x.status!=='concluido'}).length;var p=t>0?(d/t*100).toFixed(0):0;
    document.getElementById('task-summary').innerHTML=Dashboard.mc('Total Tarefas',''+t,'')+Dashboard.mc('Concluidas',d+'/'+t+' ('+p+'%)','')+Dashboard.mc('Atrasadas',''+ov,ov>0?'atencao!':'')},
  showAdd:function(){var s=State.get(),h='<h3>Nova Tarefa<\/h3><div class="flex" style="flex-wrap:wrap;gap:8px;margin-bottom:8px"><input type="text" id="tsk-t" placeholder="Titulo" style="flex:1;min-width:200px"><input type="text" id="tsk-o" placeholder="Responsavel" style="width:140px"><input type="date" id="tsk-d"><select id="tsk-k"><option value="">Nenhum KPI<\/option>';s.kpis.forEach(function(k){h+='<option value="'+k.id+'">'+k.name+'<\/option>'});
    h+='<\/select><\/div><textarea id="tsk-de" placeholder="Descricao" style="width:100%;min-height:50px;margin-bottom:8px"><\/textarea><button class="btn btn-success btn-sm" onclick="App.ActionPlan.save()">Salvar<\/button> <button class="btn btn-outline btn-sm" onclick="App.ActionPlan.hide()">Cancelar<\/button>';document.getElementById('task-form').innerHTML=h;document.getElementById('task-form').classList.remove('hidden');var inp=document.getElementById('tsk-t');if(inp)inp.focus()},
  save:function(){var t=document.getElementById('tsk-t').value.trim();if(!t){Toast.show('Titulo obrigatorio','warning');return}var s=State.get();s.tasks.push({id:State.uid(),title:t,desc:document.getElementById('tsk-de').value.trim(),owner:document.getElementById('tsk-o').value.trim(),deadline:document.getElementById('tsk-d').value||'',kpiId:document.getElementById('tsk-k').value||'',status:'novo'});State.markDirty();this.hide();this.render();Toast.show('Tarefa "'+t+'" adicionada','success',2000)},
  hide:function(){document.getElementById('task-form').classList.add('hidden')},
  upd:function(id,f,v){var s=State.get();s.tasks.forEach(function(t){if(t.id===id)t[f]=v});State.markDirty();this.render()},
  del:function(id){var s=State.get();s.tasks=s.tasks.filter(function(t){return t.id!==id});State.markDirty();this.render();Toast.show('Tarefa removida','info',2000)}
};

window.App={
  Storage:Storage,State:State,Tabs:Tabs,
  Dashboard:Dashboard,DRE:DRE,CashFlow:CashFlow,
  Inventory:Inventory,Assumptions:Assumptions,
  Scenario:Scenario,KPI:KPI,ActionPlan:ActionPlan,Chart:Chart
};

/* ======================== INIT ======================== */
Toast.init();
State.init();
Tabs.switch('dashboard');
document.addEventListener('input',function(){State.markDirty()});
document.addEventListener('change',function(){State.markDirty()});
document.getElementById('dre-tax').addEventListener('change',function(){var s=State.get();var v=parseFloat(this.value);if(isNaN(v))v=0;s.settings.taxRate=Math.max(0,Math.min(30,v))/100;State.markDirty();if(App.DRE.render)App.DRE.render()});

/* Keyboard shortcuts */
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();Storage.save(State.data);Toast.show('Dados salvos!','success',2000);return}
  if(e.ctrlKey){var t=Tabs.byIndex(e.key);if(t){e.preventDefault();Tabs.switch(t)}}
});

document.addEventListener('click',function(e){
  var nav=e.target.closest('.nav-item');
  if(nav){var tab=nav.getAttribute('data-tab');if(tab)Tabs.switch(tab)}
});

})();

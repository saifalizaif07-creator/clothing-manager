const vm=require('vm'),fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..')+'/'; const out=require('os').tmpdir()+'/';
const ctx=vm.createContext({console,Blob,TextEncoder,crypto,Uint8Array,Uint32Array,DataView,ArrayBuffer,URL,setTimeout});
for(const f of ['billing.js','database.js','invoice.js','reports.js','backup.js']) vm.runInContext(fs.readFileSync(dir+f,'utf8'),ctx,{filename:f});
const run=(c)=>vm.runInContext(c,ctx);
let fail=0; const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++; console.log((ok?'PASS ':'FAIL ')+n+(ok?'':' got '+JSON.stringify(a)+' expected '+JSON.stringify(b)));};
// spec examples
run(`var cot={id:'c',name:'Cotton',costPaise:22000,sellPaise:30000}, jea={id:'j',name:'Jeans',costPaise:35000,sellPaise:45000};
var i1=Billing.makeItem(cot,Billing.parseKg('2.500'),30000), i2=Billing.makeItem(jea,Billing.parseKg('1.250'),45000);
var c=Billing.compute([i1,i2],0,0);`);
eq('cotton revenue 750',run('i1.revenuePaise'),75000); eq('cotton cost 550',run('i1.costTotalPaise'),55000); eq('cotton profit 200',run('i1.revenuePaise-i1.costTotalPaise'),20000);
eq('jeans revenue 562.50',run('i2.revenuePaise'),56250); eq('jeans cost 437.50',run('i2.costTotalPaise'),43750); eq('jeans profit 125',run('i2.revenuePaise-i2.costTotalPaise'),12500);
eq('combined weight 3.750',run('Billing.fmtKg(c.totalGrams)'),'3.750'); eq('combined revenue 1312.50',run('Billing.fmtMoney(c.subtotal,{full:true})'),'₹1,312.50');
eq('combined cost 987.50',run('Billing.fmtMoney(c.cost,{full:true})'),'₹987.50'); eq('combined profit 325',run('c.profit'),32500);
// grams <-> kg
eq('750 g = 0.750 kg',run("Billing.fmtKg(Billing.gramsFromInput('750','g'))"),'0.750'); eq('0.250 kg = 250 g',run("Billing.gramsFromInput('0.250','kg')"),250);
eq('10.000 kg',run("Billing.gramsFromInput('10','kg')"),10000); eq('negative rejected',run("Billing.parseKg('-1')"),null===0?0:NaN);
eq('neg weight NaN',run("isNaN(Billing.parseKg('-1'))"),true); eq('4 decimals rejected',run("isNaN(Billing.parseKg('1.2345'))"),true); eq('grams decimal rejected',run("isNaN(Billing.parseGrams('12.5'))"),true);
eq('bad price rejected',run("isNaN(Billing.parseMoney('abc'))&&isNaN(Billing.parseMoney('-5'))"),true);
// discount
eq('flat discount',run("Billing.compute([i1,i2],5000,0).total"),126250); eq('discount profit',run("Billing.compute([i1,i2],5000,0).profit"),27500);
eq('10% discount',run("Billing.discountFromInput('pct','10',131250).paise"),13125); eq('12.5% discount',run("Billing.discountFromInput('pct','12.5',131250).paise"),16406);
eq('discount > subtotal rejected',run("!!Billing.discountFromInput('amt','2000',131250).error"),true);
eq('extra charges',run("Billing.compute([i1],0,2000).total"),77000);
eq('rounding 0.333kg*₹99.99',run("Billing.itemTotal(333,9999)"),3330);
eq('INR grouping',run("Billing.fmtMoney(123456789)"),'₹12,34,567.89'); eq('merge same line',run("Billing.addItem([i1],Billing.makeItem(cot,500,30000)).length+':'+Billing.addItem([i1],Billing.makeItem(cot,500,30000))[0].grams"),'1:3000');
// validation
run(`var draft={id:'x',items:[i1,i2],discount:0,extra:0,payment:'Cash'}; Object.assign(draft,Billing.compute([i1,i2],0,0));`);
eq('valid sale',run('Billing.validateSale(draft)'),[]); eq('tampered total rejected',run('draft.total+=1; Billing.validateSale(draft).length>0'),true);
// invoice html / pdf
run(`var sale=Object.assign({id:'s1',invoiceNo:'INV-00001',createdAt:new Date().toISOString(),customerName:'Ravi',customerPhone:'9876543210',customerAddress:'',items:[i1,i2],discount:0,extra:0,payment:'UPI',type:'sale',status:'completed'},Billing.compute([i1,i2],0,0)); var set={shopName:'Test Shop',shopAddress:'1 Main St',shopPhone:'999'};`);
eq('invoice html has total',run("Invoice.html(sale,set).includes('₹1,312.50')"),true);
const pdf=run("Invoice.pdfDoc(sale,set).build()"); fs.writeFileSync(out+'inv.pdf',Buffer.from(pdf)); console.log('pdf bytes',pdf.length);
// reports
run(`var sales=[sale, Object.assign({},sale,{id:'s2',invoiceNo:'INV-00002',status:'cancelled'}), Object.assign({},sale,{id:'r',type:'reversal',status:'reversal',invoiceNo:'INV-00002-R'})].map(s=>Object.assign(s,{dateKey:Util.dateKey()}));
var rep=Reports.build('monthly',sales,{});`);
eq('report counts only completed',run('rep.summary[3].v'),1); eq('report sales',run('rep.summary[0].v'),131250); eq('report profit',run('rep.summary[1].v'),32500);
(async()=>{ const b=await run('Reports.pdf(rep,set)').arrayBuffer(); fs.writeFileSync(out+'rep.pdf',Buffer.from(b));
 const x=await run('Reports.xlsx(rep,set)').arrayBuffer(); fs.writeFileSync(out+'rep.xlsx',Buffer.from(x));
 const y=await run('Backup.salesXlsx(sales,set,true,[{name:"Ravi",phone:"1"}],[cot,jea])').arrayBuffer(); fs.writeFileSync(out+'all.xlsx',Buffer.from(y));
 console.log(fail?'FAILURES: '+fail:'ALL UNIT TESTS PASSED');})();

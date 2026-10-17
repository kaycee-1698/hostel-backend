const test=require('node:test');const assert=require('node:assert/strict');
const {validateRates,validAmount}=require('../services/rateValidation');
test('daily rates accept zero and cents, reject invalid money and dates',()=>{
 const row={room_id:1,date:'2026-10-17',rate:600.25};
 assert.equal(validateRates([row,{...row,room_id:2,rate:0}]),null);
 for(const rate of [-1,NaN,Infinity,1.234,'600',1000001])assert.ok(validateRates([{...row,rate}]));
 assert.ok(validateRates([{...row,date:'2026-02-30'}]));assert.ok(validateRates([row,row]));assert.ok(validateRates([]));assert.equal(validAmount(0.29),true);
});
test('null explicitly restores a rate; missing price is invalid',()=>{
 assert.equal(validateRates([{room_id:1,date:'2026-10-17',rate:null}]),null);
 assert.ok(validateRates([{room_id:1,date:'2026-10-17'}]));
});
test('quotes include every occupied night and guest, excluding checkout',()=>{
 const vm=require('node:vm');const fs=require('node:fs');const scope={module:{exports:{}},require:()=>({supabase:{}})};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../services/rateService.js','utf8'),scope);
 const {calculateQuote,validRange}=scope.module.exports;
 assert.equal(calculateQuote({'1':600,'2':700,'1:2026-10-31':800,'1:2026-11-02':9999},'2026-10-31','2026-11-02',{'1':2,'2':1}),4200);
 assert.equal(calculateQuote({'1':0.29},'2026-10-17','2026-10-20',{'1':3}),2.61);
 assert.throws(()=>calculateQuote({},'2026-10-17','2026-10-18',{'1':1}));
 assert.equal(validRange('2026-02-30','2026-03-01'),false);
});
test('rate reads filter by requested dates before pagination',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');const calls=[];
 const db={from(table){this.table=table;return this;},select(){return this;},gte(col,value){calls.push(['gte',col,value]);return this;},lte(col,value){calls.push(['lte',col,value]);return this;},order(){return this;},range(){return Promise.resolve({data:[{room_id:1,stay_date:'2026-10-17',rate:800}]});},then(resolve){resolve({data:[{room_id:1,base_rate:600}]});}};
 const scope={module:{exports:{}},require:()=>({supabase:db})};vm.runInNewContext(fs.readFileSync(__dirname+'/../services/rateService.js','utf8'),scope);
 const result=await scope.module.exports.loadRates('2026-10-17','2026-10-18');
 assert.equal(result['1:2026-10-17'],800);assert.equal(result['1'],600);
 assert.deepEqual(calls,[['gte','stay_date','2026-10-17'],['lte','stay_date','2026-10-18']]);
});

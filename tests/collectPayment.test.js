const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={module:{exports:{}},require:()=>({supabase:{}})};
vm.runInNewContext(fs.readFileSync(__dirname+'/../services/collectPaymentService.js','utf8'),scope);
const {collectPayment}=scope.module.exports;
const request_id='11111111-1111-4111-8111-111111111111';
test('collection validates input before making any database writes',async()=>{
 for(const amount of [-1,0,NaN,Infinity,1.001,1000001,'10'])await assert.rejects(collectPayment(1,{amount,request_id}),e=>e.status===400);
 await assert.rejects(collectPayment(0,{amount:10,request_id}),e=>e.status===400);
 await assert.rejects(collectPayment(1,{amount:10,request_id:'invalid'}),e=>e.status===400);
});
test('collection uses one atomic idempotent RPC and preserves fractional amounts',async()=>{
 let sent;const result=await collectPayment('5',{amount:10.25,request_id},{rpc:async(name,args)=>{sent={name,args};return {data:{booking_id:5,pending_amount:90}};}});
 assert.equal(sent.name,'collect_booking_payment');assert.equal(sent.args.p_amount,10.25);assert.equal(sent.args.p_request_id,request_id);assert.equal(result.pending_amount,90);
});
test('business rejections are distinguishable from uncertain network results',async()=>{
 await assert.rejects(collectPayment(5,{amount:10,request_id},{rpc:async()=>({error:{code:'P0001',message:'Balance changed'}})}),e=>e.status===409&&e.message==='Balance changed');
 await assert.rejects(collectPayment(5,{amount:10,request_id},{rpc:async()=>({error:{code:'42501',message:'private database detail'}})}),e=>e.status===503&&!e.message.includes('private'));
});

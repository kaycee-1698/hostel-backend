const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={module:{exports:{}},require:()=>({supabase:{}})};
vm.runInNewContext(fs.readFileSync(__dirname+'/../services/activityLogService.js','utf8'),scope);
const {getActivityLogs,parseFilters}=scope.module.exports;
function fake(){const calls=[];const query={};for(const method of ['select','gte','lt','eq','ilike','order'])query[method]=(...args)=>{calls.push([method,...args]);return query;};query.range=(...args)=>{calls.push(['range',...args]);return Promise.resolve({data:[],count:0});};return {calls,from:()=>query};}
test('activity logs default to today and reject invalid filters',()=>{
 assert.equal(parseFilters({}).period,'today');
 for(const query of [{period:'custom',start:'2026-02-30',end:'2026-03-01'},{period:'custom',start:'2026-10-20',end:'2026-10-01'},{action:'drop'},{entity:'secret'},{page:-1},{search:['x']}])assert.throws(()=>parseFilters(query),error=>error.status===400);
});
test('activity logs use inclusive India dates, stable pagination and literal search',async()=>{
 const db=fake();await getActivityLogs({period:'custom',start:'2026-10-01',end:'2026-10-31',page:'2',action:'rate_change',entity:'rate',search:'50%'},db);
 assert.ok(db.calls.some(c=>JSON.stringify(c)===JSON.stringify(['gte','occurred_at','2026-10-01T00:00:00+05:30'])));
 assert.ok(db.calls.some(c=>JSON.stringify(c)===JSON.stringify(['lt','occurred_at','2026-11-01T00:00:00+05:30'])));
 assert.ok(db.calls.some(c=>c[0]==='ilike'&&c[2]==='%50\\%%'));
 assert.deepEqual(db.calls.at(-1),['range',50,99]);
});
test('all dates removes the date restriction without changing retention',async()=>{
 const db=fake();await getActivityLogs({period:'all'},db);assert.equal(db.calls.some(c=>c[0]==='gte'||c[0]==='lt'),false);
});

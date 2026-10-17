const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={module:{exports:{}},require:()=>({supabase:{}})};vm.runInNewContext(fs.readFileSync(__dirname+'/../services/dashboardService.js','utf8'),scope);
const {summarize}=scope.module.exports;
test('dashboard counts actual beds, exclusive checkout, cross-month sales and payment changes',()=>{
 const data=summarize({today:'2026-10-17',rooms:[{room_id:1,room_name:'Dorm',base_rate:600}],beds:[{bed_id:1,room_id:1},{bed_id:2,room_id:1}],assignments:[{bed_id:1,check_in:'2026-10-17',check_out:'2026-10-19'},{bed_id:1,check_in:'2026-10-17',check_out:'2026-10-19'}],bookings:[{booking_id:1,booking_name:'Arrival',number_of_adults:1,check_in:'2026-10-17',check_out:'2026-10-19',base_amount:1200,pending_amount:100,booking_rooms:[{room_id:1}]},{booking_id:2,booking_name:'Across months',number_of_adults:1,check_in:'2026-09-29',check_out:'2026-10-02',base_amount:900,pending_amount:-20},{booking_id:3,booking_name:'Departure',number_of_adults:1,check_in:'2026-10-16',check_out:'2026-10-17',base_amount:600,pending_amount:0}],rates:[{room_id:1,rate:800}],events:[{amount:1000},{amount:-100}],undatedCount:2});
 assert.equal(data.total,2);assert.equal(data.available,1);assert.equal(data.occupancy,50);assert.equal(data.rooms[0].rate,800);assert.equal(data.arrivals.length,1);assert.equal(data.departures.length,1);assert.equal(data.week[2].free,2);assert.equal(data.monthly.sales,2100);assert.equal(data.monthly.received,900);assert.equal(data.monthly.outstanding,100);assert.equal(data.monthly.undatedCount,2);
});
test('empty hostel returns genuine zeros without division errors',()=>{
 const data=summarize({today:'2026-10-17',rooms:[],beds:[],assignments:[],bookings:[],rates:[],events:[],undatedCount:0});assert.equal(data.occupancy,0);assert.equal(data.monthly.sales,0);assert.equal(data.arrivals.length,0);assert.equal(data.week.length,7);
});

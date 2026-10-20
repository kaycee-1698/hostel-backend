const {supabase}=require('../utils/supabase');
const actions=['create','update','delete','assign','reassign','unassign','rate_change'];
const entities=['booking','room','bed','bed_assignment','room_assignment','rate','guest','payment','document','extra_item','extra_sale','invoice'];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function invalid(message){const error=new Error(message);error.status=400;throw error;}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function parseFilters(query){
 const period=query.period??'today';
 if(!['today','custom','all'].includes(period))invalid('Choose a valid date filter.');
 const start=period==='today'?today():query.start,end=period==='today'?start:query.end;
 if(period!=='all'&&(!validDate(start)||!validDate(end)||start>end||end>'9999-12-30'))invalid('Choose a valid start and end date.');
 const action=query.action||'',entity=query.entity||'',search=query.search??'';
 if(action&&!actions.includes(action))invalid('Choose a valid action.');
 if(entity&&!entities.includes(entity))invalid('Choose a valid category.');
 if(typeof search!=='string'||search.length>100)invalid('Search must be at most 100 characters.');
 const page=Number(query.page??1);
 if(!Number.isSafeInteger(page)||page<1||page>1000000)invalid('Choose a valid page.');
 return {period,start,end,action,entity,search:search.trim(),page};
}
async function getActivityLogs(query,client=supabase){
 const f=parseFilters(query);
 let request=client.from('activity_logs').select('*',{count:'exact'});
 if(f.period!=='all'){
  const next=new Date(Date.parse(f.end)+86400000).toISOString().slice(0,10);
  request=request.gte('occurred_at',f.start+'T00:00:00+05:30').lt('occurred_at',next+'T00:00:00+05:30');
 }
 if(f.action)request=request.eq('action',f.action);
 if(f.entity)request=request.eq('entity_type',f.entity);
 if(f.search)request=request.ilike('summary',`%${f.search.replace(/[\\%_]/g,'\\$&')}%`);
 const {data,error,count}=await request.order('occurred_at',{ascending:false}).order('log_id',{ascending:false}).range((f.page-1)*50,f.page*50-1);
 if(error)throw error;
 return {logs:data,total:count,page:f.page,pageSize:50};
}
module.exports={getActivityLogs,parseFilters};

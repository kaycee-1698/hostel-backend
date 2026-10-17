const router=require('express').Router();
const {getActivityLogs}=require('../services/activityLogService');
router.get('/activity-logs',async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{res.json(await getActivityLogs(req.query));}
 catch(error){
  if(error.status===400)return res.status(400).json({error:error.message});
  console.error('Activity log read failed:',error);
  const missing=['42P01','PGRST205'].includes(error.code);
  res.status(missing?503:500).json({error:missing?'Activity logging is not set up yet. Please apply migration 011 in Supabase.':'Could not load activity logs. Please try again.'});
 }
});
module.exports=router;

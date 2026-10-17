const router=require('express').Router();
const {getDashboard}=require('../services/dashboardService');
router.get('/dashboard',async(req,res)=>{
 try{res.set('Cache-Control','no-store').json(await getDashboard());}
 catch(error){console.error('Dashboard load failed:',error);res.status(500).json({error:'Could not load the dashboard. Check migration 010 is installed, then retry.'});}
});
module.exports=router;

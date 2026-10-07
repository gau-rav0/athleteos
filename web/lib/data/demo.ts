import type {Fact,Inventory} from "./schema";
import {addDays,localDay,midnight} from "@/lib/analytics/time";
import {buildDataset} from "@/lib/analytics/engine";
// Entirely invented measurements. Never used as a fallback for live data.
export function demoDataset(days=28,timezone="Asia/Kolkata",mode="normal",now=new Date()) {
  const facts:Fact[]=[],today=localDay(now,timezone);
  const add=(kind:string,index:number,value:number|null,extra:Partial<Fact>={})=>{const day=addDays(today,index-364),start=new Date(midnight(day,timezone)+8*3600000).toISOString();facts.push({id:`synthetic-${kind}-${index}`,kind,provider:"health_connect",origin:"live",source:"synthetic.example",channel:`synthetic-${kind}`,rank:100,start,end:null,received:now.toISOString(),value,samples:1,min:null,max:null,sessions:[],hourly:[],supported:true,bodyFat:null,...extra});};
  for(let i=0;i<365;i++){const day=addDays(today,i-364),wake=midnight(day,timezone)+7*3600000,sleep=400+Math.sin(i*0.61)*38+Math.cos(i*0.23)*22;
    add("steps",i,Math.round(8500+Math.sin(i*0.61)*2400+Math.sin(i*0.17)*900),{start:new Date(midnight(day,timezone)).toISOString(),end:new Date(midnight(addDays(day,1),timezone)).toISOString(),rank:300});
    add("sleep",i,null,{provider:"samsung_health",rank:200,start:new Date(wake-sleep*60000).toISOString(),end:new Date(wake).toISOString(),sessions:[{start:new Date(wake-sleep*60000).toISOString(),end:new Date(wake).toISOString(),minutes:sleep,stages:{light:sleep*.53,deep:sleep*.21,rem:sleep*.26},durationBasis:"vendor_duration",category:"sleep"}]});
    add("heart_rate",i,64+Math.sin(i*0.23)*3,{samples:140,hourly:[{start:new Date(wake-3*3600000).toISOString(),end:new Date(wake-2*3600000).toISOString(),mean:54+Math.sin(i*0.23)*2,count:60}]});
    add("hrv_rmssd",i,48+Math.sin(i*0.31)*7);add("energy_score",i,78+Math.sin(i*0.23)*7,{provider:"samsung_health",rank:200});add("skin_temperature",i,33.2+Math.sin(i*.4)*.2,{provider:"samsung_health"});add("blood_oxygen",i,97.5+Math.sin(i*.6)*.7,{provider:"samsung_health"});add("respiratory_rate",i,14.1+Math.sin(i*.5)*.4,{provider:"samsung_health",origin:"historical"});
    if(i%2===0){add("weight",i,77-i*.004+Math.sin(i*.2)*.22);add("body_fat",i,17-i*.003+Math.sin(i*.2)*.08);}
    if(i%7!==0&&i%7!==4){const minutes=35+(i%4)*12,start=midnight(day,timezone)+17*3600000;add("exercise",i,null,{provider:"samsung_health",rank:200,start:new Date(start).toISOString(),end:new Date(start+minutes*60000).toISOString(),sessions:[{start:new Date(start).toISOString(),end:new Date(start+minutes*60000).toISOString(),minutes,stages:{},durationBasis:"vendor_duration",category:["RUNNING","STRENGTH_TRAINING","CYCLING","STRETCHING"][i%4]}]});}
  }
  const selected=mode==="empty"?[]:mode==="sparse"?facts.filter(f=>f.kind==="steps"||f.kind==="weight"):facts;
  const inventory:Inventory={inventory:[...new Set(selected.map(f=>f.kind))].map(kind=>({provider:selected.find(f=>f.kind===kind)!.provider,record_type:kind,records:selected.filter(f=>f.kind===kind).length,observed_days:selected.filter(f=>f.kind===kind).length,first_at:selected[0]?.start||null,last_at:now.toISOString(),received_at:now.toISOString(),historical_records:kind==="respiratory_rate"?365:0})),sync:{status:mode==="partial"?"PARTIAL_FAILURE":"SUCCESS",finished:now.toISOString(),failures:mode==="partial"?1:0,sources:{"health_connect:steps":"SUCCESS","samsung_health:sleep":"SUCCESS"}}};
  return buildDataset(selected,inventory,{days,timezone,now,partial:mode==="partial"});
}

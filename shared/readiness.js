export function waterGallons(item) {
  const qty=Math.max(0,Number(item.quantity)||0);
  if(Number(item.gallonsPerUnit)>0)return qty*Number(item.gallonsPerUnit);
  const unit=String(item.unit||'').trim().toLowerCase();
  const factors={gal:1,gallon:1,gallons:1,'us gallons':1,l:1/3.785411784,liter:1/3.785411784,liters:1/3.785411784,litre:1/3.785411784,litres:1/3.785411784,ml:1/3785.411784,'fl oz':1/128};
  return Object.hasOwn(factors,unit)?qty*factors[unit]:0;
}
export function isExpired(date,now=new Date()) {
  if(!date)return false;
  const local=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return date<local;
}
// Recurring items replenish every recurringDays from purchaseDate; 0/unset means it doesn't recur.
export function nextRecurringDate(item) {
  if(!item.recurringDays||!item.purchaseDate)return null;
  const [y,m,d]=item.purchaseDate.split('-').map(Number);
  if(!y||!m||!d)return null;
  const next=new Date(y,m-1,d+Number(item.recurringDays));
  return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
}
export function isRecurringDue(item,now=new Date()) {
  const next=nextRecurringDate(item);
  if(!next)return false;
  const local=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return next<=local;
}
// A household opts into per-member readiness by giving at least one member an explicit calorie or
// water figure, or by adding a pet. Until then the flat householdSize x per-person defaults are
// used exactly as before, so a household that has only ever recorded names and roles sees no
// change to its numbers. Once opted in, a person with no override still counts at the configured
// per-person default; a pet with no figures counts for nothing, because the app has no honest
// basis for guessing what a given animal consumes.
export function householdNeeds(plan,settings) {
  const members=plan?.family??[];
  const optedIn=members.some(member=>member.kind==='pet'||member.caloriesPerDay!==''||member.waterGallonsPerDay!=='');
  if(!optedIn) {
    return {
      mode:'household',people:settings.householdSize,pets:0,
      dailyCalorieNeed:settings.householdSize*settings.caloriesPerPersonPerDay,
      dailyWaterNeed:settings.householdSize*settings.waterGallonsPerPersonPerDay,
    };
  }
  let dailyCalorieNeed=0,dailyWaterNeed=0,people=0,pets=0;
  for(const member of members) {
    const isPet=member.kind==='pet';
    if(isPet)pets++;else people++;
    const calorieDefault=isPet?0:settings.caloriesPerPersonPerDay;
    const waterDefault=isPet?0:settings.waterGallonsPerPersonPerDay;
    dailyCalorieNeed+=member.caloriesPerDay===''?calorieDefault:Number(member.caloriesPerDay);
    dailyWaterNeed+=member.waterGallonsPerDay===''?waterDefault:Number(member.waterGallonsPerDay);
  }
  return {mode:'members',people,pets,dailyCalorieNeed,dailyWaterNeed};
}

const nameBuckets=['Water','Pasta','Rice','Beans','Energy Bars'];
export function computeReadiness({inventory=[],appliances=[],plan=null},settings) {
  const needs=householdNeeds(plan,settings);
  const {dailyCalorieNeed,dailyWaterNeed}=needs;
  let waterQty=0,totalCals=0,fuelHours=0,storedPowerKwh=0,lowStock=0,expired=0,totalValue=0;
  const fuelByType={};
  const buckets=Object.fromEntries(nameBuckets.map(name=>[name,0]));

  inventory.forEach(item=>{
    const qty=Number(item.quantity)||0;
    const cals=Number(item.caloriesPerUnit)||0;
    const hours=Number(item.hoursPerUnit)||0;
    const kwh=Number(item.capacityPerUnit)||0;
    const price=Number(item.price)||0;
    const notExpired=!isExpired(item.expiryDate);

    if(item.category==='Water'&&notExpired)waterQty+=waterGallons(item);
    if(item.category==='Food'&&notExpired)totalCals+=qty*cals;
    if(item.category==='Fuel') {
      const contribution=qty*hours;
      fuelHours+=contribution;
      const type=item.fuelType||'Other';
      fuelByType[type]=(fuelByType[type]||0)+contribution;
    }
    if(item.category==='Power')storedPowerKwh+=qty*kwh;

    totalValue+=qty*price;
    if(qty<(item.target||1)*0.25)lowStock++;
    if(isExpired(item.expiryDate))expired++;

    const nameLower=item.name?.toLowerCase()||'';
    for(const key in buckets) {
      if(notExpired&&nameLower.includes(key.toLowerCase())) {
        buckets[key]+=(key==='Water'&&item.category==='Water'?waterGallons(item):item.category==='Food'?qty*cals:0);
      }
    }
  });

  const waterDays=dailyWaterNeed>0?waterQty/dailyWaterNeed:0;
  const foodDays=dailyCalorieNeed>0?totalCals/dailyCalorieNeed:0;

  const coreStatus=Object.keys(buckets).map(name=>{
    const val=buckets[name];
    const dailyNeed=name==='Water'?dailyWaterNeed:dailyCalorieNeed;
    const days=dailyNeed>0?val/dailyNeed:0;
    return {name,found:val>0,days,percentage:Math.min(Math.round((days/settings.survivalGoalDays)*100),100)};
  });

  const dailyLoadKwh=appliances.reduce((acc,curr)=>{
    if(curr.active===false)return acc;
    return acc+(((Number(curr.watts)||0)*(Number(curr.hours)||0))/1000);
  },0);

  // Usable runtime power after battery depth-of-discharge limits and inverter conversion loss.
  const usablePowerKwh=storedPowerKwh*settings.batteryUsableFraction*settings.inverterEfficiency;
  const powerDays=dailyLoadKwh>0?usablePowerKwh/dailyLoadKwh:0;

  return {
    waterDays,foodDays,totalFuelHours:fuelHours,fuelByType,
    totalPowerKwh:usablePowerKwh,rawPowerKwh:storedPowerKwh,totalCalories:totalCals,totalValue,
    lowStock,expired,coreStatus,dailyLoadKwh,powerDays,
    dailyCalorieNeed,dailyWaterNeed,
    needsMode:needs.mode,people:needs.people,pets:needs.pets,
  };
}

// Deterministic replacement for the old AI "gap analysis": the shortfall against each readiness
// goal, in days for water/food (whose goal is survivalGoalDays) and in the pillar's own unit for
// heat/power (whose goals are heatGoalHours/powerGoalKwh), plus a suggested shopping quantity so
// a shortfall can be queued onto the shopping list with one tap. Never negative; met=true once a
// goal is reached or exceeded.
export function computeReadinessGaps(stats,settings) {
  const waterShortfallDays=Math.max(0,settings.survivalGoalDays-stats.waterDays);
  const foodShortfallDays=Math.max(0,settings.survivalGoalDays-stats.foodDays);
  const heatShortfallHours=Math.max(0,settings.heatGoalHours-stats.totalFuelHours);
  const powerShortfallKwh=Math.max(0,settings.powerGoalKwh-stats.totalPowerKwh);
  // Usable power is derated by battery depth-of-discharge and inverter loss (see computeReadiness
  // above); invert that to say how much raw stored capacity would close the usable shortfall.
  const dischargeFactor=settings.batteryUsableFraction*settings.inverterEfficiency;

  return [
    {
      key:'water',label:'Water',met:waterShortfallDays<=0,
      shortfallDays:waterShortfallDays,
      suggestedQuantity:Math.ceil(waterShortfallDays*stats.dailyWaterNeed),
      suggestedUnit:'gal',
    },
    {
      key:'food',label:'Food',met:foodShortfallDays<=0,
      shortfallDays:foodShortfallDays,
      suggestedCalories:Math.ceil(foodShortfallDays*stats.dailyCalorieNeed),
    },
    {
      key:'heat',label:'Heat',met:heatShortfallHours<=0,
      shortfallHours:heatShortfallHours,
    },
    {
      key:'power',label:'Power',met:powerShortfallKwh<=0,
      shortfallKwh:powerShortfallKwh,
      suggestedRawKwh:dischargeFactor>0?Math.ceil(powerShortfallKwh/dischargeFactor):0,
    },
  ];
}

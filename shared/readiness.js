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
const nameBuckets=['Water','Pasta','Rice','Beans','Energy Bars'];
export function computeReadiness({inventory=[],appliances=[]},settings) {
  const dailyCalorieNeed=settings.householdSize*settings.caloriesPerPersonPerDay;
  const dailyWaterNeed=settings.householdSize*settings.waterGallonsPerPersonPerDay;
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
  };
}

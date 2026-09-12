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

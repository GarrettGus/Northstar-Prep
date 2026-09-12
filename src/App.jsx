import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Shield, Package, Map, Link as LinkIcon, AlertTriangle, CheckCircle, Plus, Trash2, Home, 
  Droplets, Thermometer, Wind, Phone, Navigation, RefreshCw, Settings, Link2, ChevronRight, 
  ClipboardList, Sparkles, Zap, BookOpen, X, Flame, Edit2, Save, History, Utensils, 
  Database, UploadCloud, Battery, AlertOctagon, Smartphone, FileJson, Download, Upload,
  Plug, DollarSign, ShoppingCart, Store, ArrowRight, Image as ImageIcon, Layers,
  Siren, SearchCheck, Power, Tag, Calendar, ArrowUpDown
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { 
  getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDocs, writeBatch 
} from 'firebase/firestore';

// --- Configuration ---
let auth, db, configurationError;
try {
  const config = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}');
  if (!config.apiKey || !config.projectId || !config.appId) throw new Error('Configure VITE_FIREBASE_CONFIG to connect your Firebase project.');
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) { configurationError = error.message; }

// --- Constants ---
const SYSTEM_ID = import.meta.env.VITE_HUB_ID || 'northstar-household';
const HOUSEHOLD_SIZE = 4; 
const CALORIES_PER_PERSON_DAY = 2000;
const WATER_PER_PERSON_DAY = 1; 
const TOTAL_DAILY_CALORIE_NEED = HOUSEHOLD_SIZE * CALORIES_PER_PERSON_DAY; 
const TOTAL_DAILY_WATER_NEED = HOUSEHOLD_SIZE * WATER_PER_PERSON_DAY; 
const SURVIVAL_GOAL_DAYS = 14; 
const HEAT_GOAL_HOURS = 36;
const POWER_GOAL_KWH = 20;

// AI remains unavailable until an authenticated server endpoint is configured.
async function callGemini() {
  throw new Error('AI is not configured.');
}
async function callImagen() {
  alert('AI icons are not configured yet.');
  return null;
}
async function smartSuggestItem() {
  alert('AI suggestions are not configured yet. Please enter the item manually.');
  return null;
}
const smartSuggestAppliance = smartSuggestItem;
const resizeBase64 = async (value) => `data:image/png;base64,${value}`;

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventory, setInventory] = useState([]);
  const [shoppingList, setShoppingList] = useState([]); 
  const [appliances, setAppliances] = useState([]); 
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [hubId, setHubId] = useState(() => {
    try {
      const saved = localStorage.getItem('northstar_hub_id');
      return saved || SYSTEM_ID;
    } catch { return SYSTEM_ID; }
  });

  const [showSyncModal, setShowSyncModal] = useState(false);
  const [aiContent, setAiContent] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [globalError, setGlobalError] = useState(configurationError || null);

  // --- Auth & Init ---
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    const init = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { setGlobalError(`Authentication failed: ${e.message}`); setLoading(false); }
    };
    init();
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => { try { if (hubId) localStorage.setItem('northstar_hub_id', hubId); } catch {} }, [hubId]);

  // --- Data Sync ---
  useEffect(() => {
    if (!user) return;
    setInventory([]); setShoppingList([]); setAppliances([]); setPlan(null);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(hubId)) { setGlobalError('Use a hub ID with letters, numbers, underscores or hyphens.'); setLoading(false); return; }
    setLoading(true);
    setIsSyncing(true);
    const syncError = (error) => { setGlobalError(`Sync failed: ${error.message}`); setLoading(false); setIsSyncing(false); };
    
    const invRef = collection(db, 'artifacts', hubId, 'public', 'data', 'inventory');
    const shopRef = collection(db, 'artifacts', hubId, 'public', 'data', 'shopping_list');
    const appRef = collection(db, 'artifacts', hubId, 'public', 'data', 'appliances');
    const planRef = doc(db, 'artifacts', hubId, 'public', 'data', 'plan', 'current');

    const unsubInv = onSnapshot(invRef, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setInventory(data);
      setLoading(false);
      setIsSyncing(false);
      setGlobalError(null);
    }, (err) => {
      console.error(err);
      setGlobalError(`Access Denied to "${hubId}". Try switching IDs.`);
      setIsSyncing(false);
      setLoading(false);
    });

    const unsubShop = onSnapshot(shopRef, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setShoppingList(data);
    }, syncError);

    const unsubApp = onSnapshot(appRef, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setAppliances(data);
    }, syncError);

    const unsubPlan = onSnapshot(planRef, (snap) => {
      if (snap.exists()) setPlan(snap.data());
      else setPlan(null);
    }, syncError);

    return () => { unsubInv(); unsubShop(); unsubApp(); unsubPlan(); };
  }, [user, hubId]);

  // --- File Backup System ---
  const downloadBackup = () => {
    const backupData = { inventory, shoppingList, appliances, plan };
    const data = JSON.stringify(backupData, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `northstar_full_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 5_000_000) { alert("Backup must be smaller than 5 MB."); return; }
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target.result);
        const items = Array.isArray(json) ? json : (json.inventory || []);
        const shop = json.shoppingList || [];
        const apps = json.appliances || [];
        
        if (![items, shop, apps].every(Array.isArray)) throw new Error('Backup collections must be arrays.');
        if (items.length + shop.length + apps.length + (json.plan ? 1 : 0) > 450) throw new Error('Import supports at most 450 records at once.');
        for (const item of [...items, ...shop, ...apps]) {
          if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Each record needs a name.');
          if (item.id && !/^[a-zA-Z0-9_-]{1,150}$/.test(item.id)) throw new Error('Invalid record ID.');
        }
        setIsSyncing(true);
        const batch = writeBatch(db);
        const invTarget = collection(db, 'artifacts', hubId, 'public', 'data', 'inventory');
        const shopTarget = collection(db, 'artifacts', hubId, 'public', 'data', 'shopping_list');
        const appTarget = collection(db, 'artifacts', hubId, 'public', 'data', 'appliances');
        
        items.forEach(item => { const { id, ...data } = item; batch.set(id ? doc(invTarget, id) : doc(invTarget), data); });
        shop.forEach(item => { const { id, ...data } = item; batch.set(id ? doc(shopTarget, id) : doc(shopTarget), data); });
        apps.forEach(item => { const { id, ...data } = item; batch.set(id ? doc(appTarget, id) : doc(appTarget), data); });
        
        if (json.plan) batch.set(doc(db, 'artifacts', hubId, 'public', 'data', 'plan', 'current'), json.plan);
        await batch.commit();
        alert(`Imported ${items.length} supplies, ${shop.length} shopping items, and ${apps.length} appliances!`);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      setIsSyncing(false);
    };
    reader.readAsText(file);
  };

  // --- Logic Helpers ---
  const stats = useMemo(() => {
    let waterQty = 0, totalCals = 0, fuelHours = 0, powerKwh = 0, lowStock = 0, expired = 0, totalValue = 0;
    const buckets = { Water: 0, Pasta: 0, Rice: 0, Beans: 0, 'Energy Bars': 0 }; 

    inventory.forEach(item => {
      const qty = Number(item.quantity) || 0;
      const cals = Number(item.caloriesPerUnit) || 0;
      const hours = Number(item.hoursPerUnit) || 0;
      const kwh = Number(item.capacityPerUnit) || 0;
      const price = Number(item.price) || 0;
      
      if (item.category === 'Water') waterQty += qty;
      if (item.category === 'Food') totalCals += (qty * cals);
      if (item.category === 'Fuel') fuelHours += (qty * hours);
      if (item.category === 'Power') powerKwh += (qty * kwh);

      totalValue += (qty * price);

      if (qty < (item.target || 1) * 0.25) lowStock++;
      if (item.expiryDate && new Date(item.expiryDate) < new Date()) expired++;

      const nameLower = item.name?.toLowerCase() || '';
      for (const key in buckets) {
        if (nameLower.includes(key.toLowerCase())) buckets[key] += (key === 'Water' ? qty : (qty * cals));
      }
    });

    const waterDays = waterQty / TOTAL_DAILY_WATER_NEED;
    const foodDays = totalCals / TOTAL_DAILY_CALORIE_NEED;

    const coreStatus = Object.keys(buckets).map(name => {
      const val = buckets[name];
      const dailyNeed = name === 'Water' ? TOTAL_DAILY_WATER_NEED : TOTAL_DAILY_CALORIE_NEED;
      const days = val / dailyNeed;
      return { name, found: val > 0, days, percentage: Math.min(Math.round((days / SURVIVAL_GOAL_DAYS) * 100), 100) };
    });

    const dailyLoadKwh = appliances.reduce((acc, curr) => {
        if (curr.active === false) return acc;
        return acc + (((Number(curr.watts) || 0) * (Number(curr.hours) || 0)) / 1000);
    }, 0);

    const powerDays = dailyLoadKwh > 0 ? (powerKwh / dailyLoadKwh) : 0;

    return { 
        waterDays, foodDays, totalFuelHours: fuelHours, 
        totalPowerKwh: powerKwh, totalCalories: totalCals, totalValue,
        lowStock, expired, coreStatus,
        dailyLoadKwh, powerDays 
    };
  }, [inventory, appliances]);

  const generateMealPlan = async () => {
    setIsAiLoading(true);
    const inventoryText = inventory.map(i => `${i.name}: ${i.quantity} ${i.unit}`).join(', ');
    const prompt = `Based on this survival inventory: ${inventoryText}, create a 3-day meal plan for a family of 4 (Adults Garrett and Abby, kids Brynn and Rory) in a power outage. Daily calorie target 8,000. Provide concise daily summaries.`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "AI Survival Meal Plan ✨", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: "Could not generate plan." });
    }
    setIsAiLoading(false);
  };

  const analyzeInventory = async () => {
    setIsAiLoading(true);
    const inventoryText = inventory.map(i => `${i.name}: ${i.quantity} ${i.unit} (${i.category})`).join(', ');
    const prompt = `Analyze this survival inventory list for a family of 4 in St. Anthony, MN (Winter climate): ${inventoryText}. Identify 3 critical gaps or missing categories to reach 14 days self-sufficiency. Be specific and concise.`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "AI Gap Analysis ✨", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: "Analysis failed." });
    }
    setIsAiLoading(false);
  };

  const generateDrill = async () => {
    setIsAiLoading(true);
    const familyNames = plan?.family?.map(f => f.name).join(', ') || "the family";
    const shelter = plan?.shelterSpot || "basement";
    const prompt = `Create a realistic 10-minute emergency drill scenario for a family in suburban Minnesota (Winter). Family: ${familyNames}. Safe spot: ${shelter}. Scenario: Severe blizzard with power loss or tornado siren. Give 3 immediate action steps for Garrett and Abby to practice with Brynn (4) and Rory (3).`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "🚨 AI Emergency Drill", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: "Drill generation failed." });
    }
    setIsAiLoading(false);
  };

  const handleAdd = async (coll, item) => {
    try { await addDoc(collection(db, 'artifacts', hubId, 'public', 'data', coll), item); return true; } 
    catch (e) { alert("Failed to add. Check ID permissions."); return false; }
  };
  const handleUpdate = async (coll, id, item) => updateDoc(doc(db, 'artifacts', hubId, 'public', 'data', coll, id), item);
  const handleDelete = async (coll, id) => deleteDoc(doc(db, 'artifacts', hubId, 'public', 'data', coll, id));
  
  const handleBuyItem = async (item) => {
    try {
      const { id, ...data } = item;
      const batch = writeBatch(db);
      batch.set(doc(db, 'artifacts', hubId, 'public', 'data', 'inventory', id), data);
      batch.delete(doc(db, 'artifacts', hubId, 'public', 'data', 'shopping_list', id));
      await batch.commit();
    } catch (e) {
      alert("Failed to move item to inventory.");
    }
  };

  if (loading && !inventory.length && !globalError) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none">
      {globalError && <div role="alert" className="bg-red-100 text-red-900 p-4">{globalError}</div>}
      <Header hubId={hubId} isSyncing={isSyncing} onSyncClick={() => setShowSyncModal(true)} error={globalError} onDownload={downloadBackup} />
      
      {inventory.length === 0 && !loading && (
        <div className="mx-4 mt-4 animate-in slide-in-from-top-4 duration-500">
          <div className="bg-white border-2 border-orange-100 rounded-[2rem] p-6 shadow-xl text-center">
            <div className="bg-orange-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-orange-600"><Database size={32} /></div>
            <h2 className="text-xl font-black text-slate-900 mb-2">Dashboard Empty?</h2>
            <p className="text-sm text-slate-500 mb-6">Recover your data from a previous session:</p>
            <div className="grid gap-3">
              <button onClick={() => setHubId('SX-630')} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Link2 size={16}/> Connect to "SX-630"</button>
              <button onClick={() => setHubId(SYSTEM_ID)} className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 border border-blue-100"><Shield size={16}/> Connect to "Garrett & Abby"</button>
              <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 border border-emerald-100 cursor-pointer">
                <Upload size={16}/> Upload Backup File
                <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-xl mx-auto w-full p-4 pb-28">
        {activeTab === 'dashboard' && <Dashboard stats={stats} onGeneratePlan={generateMealPlan} onAnalyzeGaps={analyzeInventory} isAiLoading={isAiLoading} />}
        {activeTab === 'inventory' && (
          <InventoryManager 
            title="Supply Hub"
            items={inventory} 
            stats={stats} 
            onAdd={(i) => handleAdd('inventory', i)} 
            onUpdate={(id, i) => handleUpdate('inventory', id, i)} 
            onDelete={(id) => handleDelete('inventory', id)} 
            onSmartSuggest={(txt) => smartSuggestItem(txt, setIsAiLoading)} 
            isAiLoading={isAiLoading} 
          />
        )}
        {activeTab === 'shopping' && (
          <InventoryManager 
            title="Shopping List"
            items={shoppingList} 
            stats={stats} 
            isShoppingMode={true}
            onAdd={(i) => handleAdd('shopping_list', i)} 
            onUpdate={(id, i) => handleUpdate('shopping_list', id, i)} 
            onDelete={(id) => handleDelete('shopping_list', id)} 
            onBuy={handleBuyItem}
            onSmartSuggest={(txt) => smartSuggestItem(txt, setIsAiLoading)} 
            isAiLoading={isAiLoading} 
          />
        )}
        {activeTab === 'power' && (
          <ApplianceManager 
            appliances={appliances} 
            stats={stats}
            onAdd={(i) => handleAdd('appliances', i)}
            onUpdate={(id, i) => handleUpdate('appliances', id, i)}
            onDelete={(id) => handleDelete('appliances', id)}
            onSmartSuggest={(txt) => smartSuggestAppliance(txt, setIsAiLoading)}
            isAiLoading={isAiLoading}
          />
        )}
        {activeTab === 'plan' && <EmergencyPlan plan={plan} onUpdate={(d) => setDoc(doc(db, 'artifacts', hubId, 'public', 'data', 'plan', 'current'), d, { merge: true })} onRunDrill={generateDrill} isAiLoading={isAiLoading} />}
      </main>

      <NavBar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {showSyncModal && <SyncModal currentId={hubId} onSetId={setHubId} onClose={() => setShowSyncModal(false)} onImport={handleFileUpload} systemId={SYSTEM_ID} />}
      {aiContent && <AiModal content={aiContent} onClose={() => setAiContent(null)} />}
    </div>
  );
}

// --- Dashboard ---
function Dashboard({ stats, onGeneratePlan, onAnalyzeGaps, isAiLoading }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-2 gap-4">
        <StatusCard icon={<Droplets size={24}/>} color="blue" value={stats.waterDays.toFixed(1)} label="Water Days" />
        <StatusCard icon={<Utensils size={24}/>} color="emerald" value={stats.foodDays.toFixed(1)} label="Food Days" />
        <StatusCard icon={<Flame size={24}/>} color="amber" value={stats.totalFuelHours.toFixed(0)} label="Heat Hours" />
        <StatusCard icon={<Zap size={24}/>} color="violet" value={stats.powerDays.toFixed(1)} label="Power Days" />
      </div>

      <div className="bg-slate-900 text-white p-7 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-xl font-black mb-1">Readiness Score</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Saint Anthony Hub</p>
          <div className="mt-6 space-y-4">
            <ProgressBar label="Food (14 Days)" percent={(stats.foodDays / SURVIVAL_GOAL_DAYS) * 100} color="bg-emerald-500" />
            <ProgressBar label="Water (14 Days)" percent={(stats.waterDays / SURVIVAL_GOAL_DAYS) * 100} color="bg-blue-500" />
            <ProgressBar label={`Heat (${HEAT_GOAL_HOURS}h)`} percent={(stats.totalFuelHours / HEAT_GOAL_HOURS) * 100} color="bg-amber-500" />
            <ProgressBar label={`Power (Duration: ${stats.powerDays.toFixed(1)} Days)`} percent={(stats.powerDays / 2) * 100} color="bg-violet-500" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onGeneratePlan} disabled={isAiLoading} className="bg-emerald-50 text-emerald-700 py-4 rounded-[2rem] flex flex-col items-center justify-center gap-1 font-black text-[10px] uppercase tracking-widest border border-emerald-100 shadow-sm active:scale-95 transition-all disabled:opacity-50">
          {isAiLoading ? <RefreshCw className="animate-spin" size={20}/> : <Sparkles size={20}/>}
          Meal Plan
        </button>
        <button onClick={onAnalyzeGaps} disabled={isAiLoading} className="bg-blue-50 text-blue-700 py-4 rounded-[2rem] flex flex-col items-center justify-center gap-1 font-black text-[10px] uppercase tracking-widest border border-blue-100 shadow-sm active:scale-95 transition-all disabled:opacity-50">
          {isAiLoading ? <RefreshCw className="animate-spin" size={20}/> : <SearchCheck size={20}/>}
          Analyze Gaps
        </button>
      </div>
    </div>
  );
}

// --- Appliance Manager ---
function ApplianceManager({ appliances, stats, onAdd, onUpdate, onDelete, onSmartSuggest, isAiLoading }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [smartText, setSmartText] = useState('');
  const [form, setForm] = useState({ name: '', watts: '', hours: '', active: true });

  const reset = () => { setForm({ name: '', watts: '', hours: '', active: true }); setEditingId(null); setShowAdd(false); };
  
  const submit = async (e) => {
    e.preventDefault();
    const data = { ...form, watts: Number(form.watts), hours: Number(form.hours) };
    if (editingId) await onUpdate(editingId, data);
    else if (!await onAdd({ ...data, active: true })) return;
    reset();
  };

  const handleEdit = (item) => { setForm(item); setEditingId(item.id); setShowAdd(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const runSmart = async () => { const res = await onSmartSuggest(smartText); if (res) { setForm(prev => ({...prev, ...res})); setSmartText(''); } };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-black text-slate-800">Power Load</h2>
        <button onClick={() => showAdd ? reset() : setShowAdd(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-black active:scale-95 transition-all shadow-lg">
          {showAdd ? 'Cancel' : <><Plus size={18}/> Add Device</>}
        </button>
      </div>

      <div className="bg-violet-50 border border-violet-100 rounded-[2.5rem] p-6 shadow-sm flex flex-col items-center text-center">
         <div className="p-3 bg-violet-100 text-violet-600 rounded-full mb-2"><Zap size={24}/></div>
         <div className="text-3xl font-black text-slate-900">{stats.dailyLoadKwh.toFixed(2)} <span className="text-base font-bold text-slate-400">kWh/day</span></div>
         <div className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-4">Active Daily Demand</div>
         
         <div className="w-full bg-white p-4 rounded-2xl border border-violet-100 flex justify-between items-center">
            <div className="text-left">
               <div className="text-[10px] font-black uppercase text-slate-400">Stored Power</div>
               <div className="text-lg font-black text-slate-800">{stats.totalPowerKwh.toFixed(1)} kWh</div>
            </div>
            <div className="text-right">
               <div className="text-[10px] font-black uppercase text-slate-400">Est. Runtime</div>
               <div className="text-lg font-black text-emerald-600">{stats.powerDays.toFixed(1)} Days</div>
            </div>
         </div>
      </div>

      {showAdd && (
        <div className="space-y-4 mb-6 animate-in slide-in-from-top-4 duration-300">
          {!editingId && (
            <div className="bg-indigo-50 p-4 rounded-[2rem] border border-indigo-100 flex gap-2">
              <input className="flex-1 bg-white border border-indigo-100 rounded-xl px-4 py-2 text-sm outline-none" placeholder="e.g. 'Standard Fridge' or 'CPAP'" value={smartText} onChange={e => setSmartText(e.target.value)} />
              <button onClick={runSmart} disabled={isAiLoading} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg active:scale-95 disabled:opacity-50">
                {isAiLoading ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16}/>}
              </button>
            </div>
          )}
          <form onSubmit={submit} className="bg-white border-2 border-violet-100 rounded-[2.5rem] p-7 shadow-2xl space-y-4">
             <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-black uppercase text-violet-600 tracking-widest">{editingId ? 'Edit Device' : 'New Appliance'}</h3>
                {editingId && <button type="button" onClick={() => onDelete(editingId)} className="text-red-500 flex items-center gap-1 text-[10px] font-black uppercase"><Trash2 size={12}/> Delete</button>}
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><Label>Device Name</Label><Input val={form.name} set={v => setForm({...form, name: v})} placeholder="e.g. Fridge" /></div>
                <div><Label>Watts (Running)</Label><Input val={form.watts} set={v => setForm({...form, watts: v})} type="number" placeholder="150" /></div>
                <div><Label>Hours/Day</Label><Input val={form.hours} set={v => setForm({...form, hours: v})} type="number" placeholder="24" /></div>
             </div>
             <button type="submit" className="w-full bg-violet-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:bg-violet-700 transition-colors mt-2">
               {editingId ? 'Update Device' : 'Add to Load'}
             </button>
          </form>
        </div>
      )}

      <div className="mt-4 space-y-3 px-1">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Devices (Tap Power to Toggle)</h3>
        {appliances.map(app => (
          <div key={app.id} className={`border p-5 rounded-[2.25rem] flex justify-between items-center group shadow-sm transition-all ${app.active !== false ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
             <div className="flex items-center gap-4">
                <button 
                  onClick={(e) => { e.stopPropagation(); onUpdate(app.id, { active: app.active === false ? true : false }); }}
                  className={`p-3.5 rounded-2xl transition-all active:scale-90 shadow-sm ${app.active !== false ? 'bg-violet-500 text-white shadow-violet-200' : 'bg-slate-200 text-slate-400'}`}
                >
                  <Power size={20} />
                </button>
                <div onClick={() => handleEdit(app)} className="cursor-pointer">
                   <h4 className="font-black text-slate-800 leading-tight">{app.name}</h4>
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    {app.watts}W • {app.hours} hrs/day • {((app.watts * app.hours)/1000).toFixed(2)} kWh
                   </p>
                </div>
             </div>
             <button onClick={() => handleEdit(app)} className="text-slate-200 hover:text-violet-400 transition-colors p-2">
               <ChevronRight size={18} />
             </button>
          </div>
        ))}
        {appliances.length === 0 && !showAdd && (
           <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">No appliances tracked</div>
        )}
      </div>
    </div>
  );
}

// --- Inventory Manager (Reused for Shop) ---
function InventoryManager({ title, items, stats, onAdd, onUpdate, onDelete, onBuy, onSmartSuggest, isAiLoading, isShoppingMode }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [smartText, setSmartText] = useState('');
  const [isImgLoading, setIsImgLoading] = useState(false);
  const [sortBy, setSortBy] = useState(''); // 'expiry', 'calories', 'date'
  
  const [form, setForm] = useState({ 
    name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', purchaseDate: '', expiryDate: ''
  });

  const reset = () => { 
    setForm({ name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', purchaseDate: '', expiryDate: '' }); 
    setEditingItem(null); 
    setShowAdd(false); 
  };
  
  const submit = async (e) => {
    e.preventDefault();
    const payload = { 
      ...form, 
      quantity: Number(form.quantity), 
      caloriesPerUnit: Number(form.caloriesPerUnit), 
      hoursPerUnit: Number(form.hoursPerUnit),
      capacityPerUnit: Number(form.capacityPerUnit),
      price: Number(form.price)
    };
    if (editingItem) await onUpdate(editingItem.id, payload);
    else if (!await onAdd(payload)) return;
    reset();
  };

  const handleEdit = (item) => { setForm(item); setEditingItem(item); setShowAdd(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const runSmart = async () => { const res = await onSmartSuggest(smartText); if (res) { setForm(prev => ({...prev, ...res})); setSmartText(''); } };
  
  const handleGenerateImage = async () => {
    if (!form.name) return;
    setIsImgLoading(true);
    const base64 = await callImagen(form.name);
    if (base64) {
       const resized = await resizeBase64(base64);
       setForm(prev => ({ ...prev, image: resized }));
    }
    setIsImgLoading(false);
  };

  const totalShopCost = useMemo(() => items.reduce((acc, i) => acc + (Number(i.price||0) * Number(i.quantity||0)), 0), [items]);

  const sortedItems = useMemo(() => {
    let sorted = [...items];
    if (sortBy === 'expiry') {
      sorted.sort((a, b) => new Date(a.expiryDate || '2099-01-01') - new Date(b.expiryDate || '2099-01-01'));
    } else if (sortBy === 'calories') {
      sorted.sort((a, b) => (Number(b.quantity||0) * Number(b.caloriesPerUnit||0)) - (Number(a.quantity||0) * Number(a.caloriesPerUnit||0)));
    } else if (sortBy === 'date') {
      sorted.sort((a, b) => new Date(b.purchaseDate || '1970-01-01') - new Date(a.purchaseDate || '1970-01-01'));
    }
    return sorted;
  }, [items, sortBy]);

  const groupedItems = useMemo(() => {
    const groups = Object.create(null);
    const source = sortedItems;
    
    if (isShoppingMode) {
      source.forEach(item => { const s = item.store || 'Uncategorized'; if (!groups[s]) groups[s] = []; groups[s].push(item); });
    } else {
      source.forEach(item => { const c = item.category || 'Uncategorized'; if (!groups[c]) groups[c] = []; groups[c].push(item); });
    }
    return groups;
  }, [sortedItems, isShoppingMode]);

  const waterPct = Math.min(Math.round((stats.waterDays / SURVIVAL_GOAL_DAYS) * 100), 100);
  const foodPct = Math.min(Math.round((stats.foodDays / SURVIVAL_GOAL_DAYS) * 100), 100);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-black text-slate-800">{title}</h2>
        <div className="flex gap-2">
          <button onClick={() => setSortBy(prev => prev === 'expiry' ? '' : 'expiry')} className={`p-2 rounded-full ${sortBy === 'expiry' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
            <Calendar size={18}/>
          </button>
          <button onClick={() => showAdd ? reset() : setShowAdd(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-black active:scale-95 transition-all shadow-lg">
            {showAdd ? 'Cancel' : <><Plus size={18}/> Add Item</>}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="space-y-4 mb-6 animate-in slide-in-from-top-4 duration-300">
          {!editingItem && (
            <div className="bg-indigo-50 p-4 rounded-[2rem] border border-indigo-100 flex gap-2">
              <input className="flex-1 bg-white border border-indigo-100 rounded-xl px-4 py-2 text-sm outline-none" placeholder="e.g. '5lbs of rice at Costco'" value={smartText} onChange={e => setSmartText(e.target.value)} />
              <button onClick={runSmart} disabled={isAiLoading} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg active:scale-95 disabled:opacity-50">
                {isAiLoading ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16}/>}
              </button>
            </div>
          )}
          <form onSubmit={submit} className="bg-white border-2 border-blue-100 rounded-[2.5rem] p-6 shadow-2xl space-y-4">
            <div className="flex justify-between mb-2">
              <h3 className="text-xs font-black uppercase text-blue-600">{editingItem ? 'Edit Item' : 'New Supply'}</h3>
              {editingItem && <button type="button" onClick={() => onDelete(editingItem.id)} className="text-red-500 text-[10px] font-black uppercase flex items-center gap-1"><Trash2 size={12}/> Delete</button>}
            </div>
            
            <div className="flex justify-center mb-4">
               <div className="relative w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center border-2 border-slate-100 overflow-hidden">
                 {form.image ? <img src={form.image} alt="icon" className="w-full h-full object-cover"/> : <span className="text-3xl">{form.emoji || '📦'}</span>}
               </div>
            </div>
            <button type="button" onClick={handleGenerateImage} disabled={isImgLoading} className="w-full py-2 bg-slate-50 text-slate-500 text-xs font-bold rounded-xl mb-4 flex items-center justify-center gap-2 hover:bg-slate-100">
               {isImgLoading ? <RefreshCw size={12} className="animate-spin"/> : <ImageIcon size={12}/>} Generate AI Icon
            </button>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><Label>Name</Label><Input val={form.name} set={v => setForm({...form, name: v})} /></div>
              <div><Label>Quantity</Label><Input val={form.quantity} set={v => setForm({...form, quantity: v})} type="number" /></div>
              <div><Label>Unit</Label><Input val={form.unit} set={v => setForm({...form, unit: v})} /></div>
              
              <div><Label>Purchase Date</Label><Input val={form.purchaseDate} set={v => setForm({...form, purchaseDate: v})} type="date" /></div>
              <div><Label>Expiry Date</Label><Input val={form.expiryDate} set={v => setForm({...form, expiryDate: v})} type="date" /></div>

              <div><Label>Price ($/Unit)</Label><Input val={form.price} set={v => setForm({...form, price: v})} type="number" placeholder="0.00" /></div>
              <div><Label>Category</Label><Select val={form.category} set={v => setForm({...form, category: v})} opts={["Food", "Water", "Medical", "Gear", "Fuel", "Power"]} /></div>
              
              {isShoppingMode && <div className="col-span-2"><Label>Store</Label><Input val={form.store} set={v => setForm({...form, store: v})} placeholder="e.g. Costco" /></div>}

              {form.category === 'Food' && (
                <>
                  <div><Label>Cals/Unit</Label><Input val={form.caloriesPerUnit} set={v => setForm({...form, caloriesPerUnit: v})} type="number" /></div>
                  <div><Label>Macro Tag</Label><Select val={form.macroTag} set={v => setForm({...form, macroTag: v})} opts={["", "Carbs", "Protein", "Fat", "Balanced"]} /></div>
                </>
              )}
              {form.category === 'Fuel' && <div className="col-span-2"><Label>Hours/Unit (Heat)</Label><Input val={form.hoursPerUnit} set={v => setForm({...form, hoursPerUnit: v})} type="number" /></div>}
              {form.category === 'Power' && <div className="col-span-2"><Label>Capacity (kWh)</Label><Input val={form.capacityPerUnit} set={v => setForm({...form, capacityPerUnit: v})} type="number" placeholder="e.g. 1.5"/></div>}
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:bg-blue-700 transition-colors mt-2">
              {editingItem ? 'Save Changes' : 'Add to Hub'}
            </button>
          </form>
        </div>
      )}

      {!isShoppingMode && (
        <div className="grid grid-cols-2 gap-4 px-1">
          <SummaryCard icon={<Droplets size={16}/>} color="blue" label="Water" value={stats.waterDays} unit="Days" pct={waterPct} />
          <SummaryCard icon={<Utensils size={16}/>} color="emerald" label="Total Food" value={stats.foodDays} unit="Days" pct={foodPct} />
          <SummaryCard icon={<Flame size={16}/>} color="amber" label="Total Heat" value={stats.totalFuelHours} unit="Hours" pct={(stats.totalFuelHours / HEAT_GOAL_HOURS) * 100} />
          <SummaryCard icon={<Zap size={16}/>} color="violet" label="Backup Power" value={stats.totalPowerKwh} unit="kWh" pct={(stats.totalPowerKwh / POWER_GOAL_KWH) * 100} />
          <div className="col-span-2 bg-slate-900 rounded-[2.5rem] p-5 shadow-lg flex justify-between items-center text-white">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-slate-800 rounded-full"><DollarSign size={20}/></div>
               <div>
                 <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Investment</div>
                 <div className="text-2xl font-black">${stats.totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
               </div>
            </div>
          </div>
        </div>
      )}

      {isShoppingMode && (
         <div className="bg-emerald-50 border border-emerald-100 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between mb-6">
           <div>
              <div className="text-[10px] font-black uppercase text-emerald-600 tracking-widest">Estimated Cost</div>
              <div className="text-2xl font-black text-slate-800">${totalShopCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
           </div>
           <div className="p-3 bg-emerald-100 text-emerald-600 rounded-full"><ShoppingCart size={24}/></div>
         </div>
      )}

      <div className="mt-8 space-y-3 px-1">
        {groupedItems && Object.keys(groupedItems).length > 0 ? (
           Object.entries(groupedItems).map(([groupName, groupItems]) => (
             <div key={groupName} className="mb-6">
               <div className="flex justify-between items-center mb-3 pl-2 pr-2">
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   {isShoppingMode ? <Store size={12} /> : (getCategoryIcon(groupName)?.icon || <Layers size={12} />)} 
                   {groupName}
                 </h4>
                 {!isShoppingMode && groupName === 'Food' && (
                   <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                     {groupItems.reduce((acc, i) => acc + (Number(i.quantity||0) * Number(i.caloriesPerUnit||0)), 0).toLocaleString()} kcal
                   </span>
                 )}
                 <div className="flex gap-2">
                   <button onClick={() => setSortBy('expiry')} className={`text-[8px] font-bold px-2 py-0.5 rounded-md ${sortBy === 'expiry' ? 'bg-orange-100 text-orange-600' : 'text-slate-300'}`}>Exp</button>
                   <button onClick={() => setSortBy('calories')} className={`text-[8px] font-bold px-2 py-0.5 rounded-md ${sortBy === 'calories' ? 'bg-emerald-100 text-emerald-600' : 'text-slate-300'}`}>Cal</button>
                 </div>
               </div>
               <div className="space-y-3">
                 {groupItems.map(item => <InventoryItem key={item.id} item={item} onClick={() => handleEdit(item)} onBuy={onBuy} />)}
               </div>
             </div>
           ))
        ) : (
           <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">List Empty</div>
        )}
      </div>
    </div>
  );
}

// --- Emergency Plan ---
function EmergencyPlan({ plan, onUpdate, onRunDrill, isAiLoading }) {
  const [isEditing, setIsEditing] = useState(false);
  const [spot, setSpot] = useState(plan?.shelterSpot || '');
  useEffect(() => { if (!isEditing) setSpot(plan?.shelterSpot || ''); }, [plan, isEditing]);
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-black text-slate-800">Family Hub</h2>
        <button onClick={async () => { try { if(isEditing) await onUpdate({...plan, shelterSpot: spot}); setIsEditing(!isEditing); } catch { alert("Could not save plan. Please retry."); } }} className="text-[10px] font-black px-6 py-2.5 rounded-full bg-blue-50 text-blue-600 uppercase tracking-widest">
          {isEditing ? "Save" : "Edit"}
        </button>
      </div>

      <button onClick={onRunDrill} disabled={isAiLoading} className="w-full bg-indigo-50 text-indigo-700 py-4 rounded-[2.5rem] flex items-center justify-center gap-2 font-black text-xs uppercase tracking-widest border border-indigo-100 active:scale-95 transition-all">
        {isAiLoading ? <RefreshCw className="animate-spin" size={16}/> : <Siren size={16}/>}
        Run Emergency Simulation
      </button>

      <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Household Tracking</h3>
        <div className="space-y-5">
          {plan?.family?.map((m, i) => (
            <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-4 last:border-0 last:pb-0">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center font-black text-xl">{m.name[0]}</div>
                  <div><div className="font-black text-slate-800">{m.name}</div><div className="text-[10px] text-slate-400 font-bold uppercase">{m.role} • {m.dob}</div></div>
               </div>
               {m.role === 'Child' && <div className="bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase px-3 py-1 rounded-full">Priority</div>}
            </div>
          ))}
        </div>
      </section>
      <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Storm Point</h3>
        {isEditing ? (
          <textarea className="w-full bg-slate-50 border-2 rounded-2xl p-5 text-sm font-bold min-h-[100px] outline-none" value={spot} onChange={e => setSpot(e.target.value)} />
        ) : (
          <div className="p-5 bg-orange-50 rounded-3xl border border-orange-100 font-black text-slate-700 italic text-sm">"{plan?.shelterSpot}"</div>
        )}
      </section>

      {/* Survival Sync Links Moved Here */}
      <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm mt-6">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Survival Sync</h3>
        <div className="grid gap-3">
          {[
            { title: "MnDOT 511 Roads", url: "https://511mn.org", icon: <Navigation size={20}/>, color: "bg-blue-50 text-blue-600" },
            { title: "NWS Twin Cities", url: "https://www.weather.gov/mpx/", icon: <Wind size={20}/>, color: "bg-orange-50 text-orange-600" },
            { title: "Xcel Outage Map", url: "https://www.outagemap-xcelenergy.com", icon: <AlertTriangle size={20}/>, color: "bg-red-50 text-red-600" }
          ].map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-5 p-4 rounded-2xl hover:bg-slate-50 transition-colors group">
              <div className={`p-3 rounded-xl ${link.color}`}>{link.icon}</div>
              <div className="flex-1">
                <div className="font-black text-sm text-slate-800">{link.title}</div>
                <div className="text-[9px] text-slate-400 font-mono uppercase">{link.url.replace('https://', '')}</div>
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500"/>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Helper Components ---
const Label = ({ children }) => <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">{children}</label>;
const Input = ({ val, set, type="text", placeholder }) => <input type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold outline-none focus:bg-white focus:border-blue-400 border border-transparent transition-all" value={val ?? ""} onChange={e => set(e.target.value)} placeholder={placeholder} />;
const Select = ({ val, set, opts }) => <select className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold outline-none border border-transparent" value={val ?? ""} onChange={e => set(e.target.value)}>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>;

function SummaryCard({ icon, color, label, value, unit, pct }) {
  const colors = { blue: 'bg-blue-50 text-blue-600 bg-blue-500', emerald: 'bg-emerald-50 text-emerald-600 bg-emerald-500', amber: 'bg-amber-50 text-amber-600 bg-amber-500', violet: 'bg-violet-50 text-violet-600 bg-violet-500' };
  const [bg, text, bar] = colors[color].split(' ');
  return (
    <div className="bg-white border border-slate-200 rounded-[2.5rem] p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
         <div className={`p-1.5 rounded-lg ${bg} ${text}`}>{icon}</div>
         <span className="text-[10px] font-black uppercase tracking-widest text-slate-800">{label}</span>
      </div>
      <div className="text-xl font-black text-slate-800 leading-none">{value.toFixed(1)} <span className="text-[9px] font-bold text-slate-300 ml-0.5 uppercase tracking-tighter">{unit}</span></div>
      <div className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
         <div className={`h-full transition-all duration-700 ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function InventoryItem({ item, onClick, onBuy }) {
  const { icon, style } = getCategoryIcon(item.category);
  const price = item.price ? Number(item.price) : 0;
  const totalVal = price * (Number(item.quantity) || 0);

  const getTagColor = (tag) => {
    switch(tag) {
      case 'Carbs': return 'bg-orange-100 text-orange-600';
      case 'Protein': return 'bg-rose-100 text-rose-600';
      case 'Fat': return 'bg-yellow-100 text-yellow-600';
      case 'Balanced': return 'bg-emerald-100 text-emerald-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const isExpiringSoon = item.expiryDate && new Date(item.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isExpired = item.expiryDate && new Date(item.expiryDate) < new Date();

  return (
    <div onClick={onClick} className={`bg-white border border-slate-200 p-5 rounded-[2.25rem] flex justify-between items-center group shadow-sm active:scale-95 transition-all cursor-pointer ${isExpired ? 'border-red-300 bg-red-50' : ''}`}>
       <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden ${style}`}>
            {item.image ? (
               <img src={item.image} alt="icon" className="w-full h-full object-cover"/>
            ) : (
               item.emoji ? <span className="text-2xl">{item.emoji}</span> : icon
            )}
          </div>
          <div>
             <div className="flex items-center gap-2">
               <h4 className="font-black text-slate-800 leading-tight">{item.name}</h4>
               {item.macroTag && (
                 <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-md ${getTagColor(item.macroTag)}`}>
                   {item.macroTag}
                 </span>
               )}
             </div>
             <div className="flex gap-2 mt-1">
               {isExpiringSoon && <span className="text-[8px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={8}/> {isExpired ? 'EXPIRED' : 'Expiring Soon'}</span>}
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {item.quantity} {item.unit}
               </p>
             </div>
             {price > 0 && (
               <p className="text-[9px] font-black text-emerald-600 mt-1">
                 ${price.toFixed(2)}/ea • Total: ${totalVal.toFixed(2)}
               </p>
             )}
          </div>
       </div>
       <div className="flex items-center gap-2">
         {onBuy && (
           <button 
             onClick={(e) => { e.stopPropagation(); onBuy(item); }}
             className="p-2 bg-slate-100 text-slate-400 hover:bg-emerald-100 hover:text-emerald-600 rounded-full transition-colors"
             title="Buy & Move to Inventory"
           >
             <CheckCircle size={20} />
           </button>
         )}
         {!onBuy && <ChevronRight size={18} className="text-slate-200 group-hover:text-blue-400 transition-colors" />}
       </div>
    </div>
  );
}

function StatusCard({ icon, color, value, label }) {
  const colors = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600' };
  return (
    <div className="bg-white border border-slate-200 p-6 rounded-[2.5rem] shadow-sm text-center flex flex-col items-center">
      <div className={`p-3 rounded-full mb-3 ${colors[color]}`}>{icon}</div>
      <div className="text-3xl font-black text-slate-900">{value}</div>
      <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{label}</div>
    </div>
  );
}

const ProgressBar = ({ label, percent, color }) => (
  <div>
    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest mb-1 text-white">
      <span>{label}</span>
      <span>{Math.round(percent)}%</span>
    </div>
    <div className="h-3 w-full bg-white/10 rounded-full overflow-hidden border border-white/5">
      <div className={`h-full transition-all duration-1000 ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  </div>
);

function LoadingScreen() {
  return (
    <div className="h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6 text-center">
      <RefreshCw className="animate-spin text-blue-500 mb-4" size={40} />
      <p className="text-xs font-black uppercase tracking-widest opacity-50">Connecting Secure Hub...</p>
    </div>
  );
}

function Header({ hubId, isSyncing, onSyncClick, error, onDownload }) {
  return (
    <header className="bg-slate-900 text-white p-4 sticky top-0 z-50 shadow-xl border-b border-white/5">
      <div className="max-w-xl mx-auto flex justify-between items-center text-white">
        <div className="flex items-center gap-2">
          <Shield className="text-blue-400 w-7 h-7" />
          <h1 className="text-lg font-black tracking-tight text-white">NorthStar Prep</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onDownload} className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white"><Download size={16}/></button>
          <button onClick={onSyncClick} className="flex flex-col items-end">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${error ? 'bg-red-500/20 text-red-300' : isSyncing ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'}`}>
              {error ? <AlertOctagon size={10}/> : isSyncing ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle size={10} />}
              ID: {hubId.slice(-6).toUpperCase()}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1.5 p-3 min-w-0 flex-1 transition-all rounded-3xl ${active ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:bg-slate-50'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform text-slate-400 ${active ? 'text-blue-600' : ''}`}>{icon}</div>
      <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
    </button>
  );
}

function NavBar({ activeTab, setActiveTab }) {
  return (
    <nav className="fixed bottom-6 left-4 right-4 max-w-xl mx-auto bg-white/90 backdrop-blur-md border border-slate-200 p-2.5 rounded-[2rem] shadow-2xl flex justify-around items-center z-50">
      <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Home size={22}/>} label="Status" />
      <NavButton active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} icon={<Package size={22}/>} label="Supplies" />
      <NavButton active={activeTab === 'shopping'} onClick={() => setActiveTab('shopping')} icon={<ShoppingCart size={22}/>} label="Shop" />
      <NavButton active={activeTab === 'power'} onClick={() => setActiveTab('power')} icon={<Zap size={22}/>} label="Power" />
      <NavButton active={activeTab === 'plan'} onClick={() => setActiveTab('plan')} icon={<Map size={22}/>} label="Family" />
    </nav>
  );
}

function getCategoryIcon(cat) {
  switch(cat) {
    case 'Food': return { icon: <Package size={22}/>, style: 'bg-emerald-50 text-emerald-600' };
    case 'Water': return { icon: <Droplets size={22}/>, style: 'bg-blue-50 text-blue-600' };
    case 'Medical': return { icon: <Shield size={22}/>, style: 'bg-red-50 text-red-600' };
    case 'Fuel': return { icon: <Flame size={22}/>, style: 'bg-amber-50 text-amber-600' };
    case 'Power': return { icon: <Zap size={22}/>, style: 'bg-violet-50 text-violet-600' };
    default: return { icon: <Package size={22}/>, style: 'bg-emerald-50 text-emerald-600' };
  }
}

// --- Modals ---
function SyncModal({ currentId, onSetId, onClose, onImport, systemId }) {
  const [val, setVal] = useState('');
  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl">
        <div className="flex justify-center mb-4 text-blue-600"><Database size={40} /></div>
        <h3 className="text-xl font-black text-center mb-2">Connection Settings</h3>
        <p className="text-center text-xs text-slate-400 mb-6 px-4">Current ID: <span className="font-mono bg-slate-100 px-1 rounded">{currentId}</span></p>
        
        <div className="space-y-3 mb-6">
          <button onClick={() => { onSetId(systemId); onClose(); }} className="w-full py-3 rounded-xl font-bold text-xs bg-green-100 text-green-700 flex justify-center gap-2 border-2 border-green-200">
            <CheckCircle size={14}/> Use Default Hub ID
          </button>
          <div className="flex gap-2">
            <input className="flex-1 border-2 border-slate-100 rounded-xl p-3 text-xs font-mono text-center" placeholder="Paste Custom ID..." value={val ?? ""} onChange={(e) => setVal(e.target.value)} />
            <button onClick={() => { if(val) { onSetId(val); onClose(); } }} className="bg-blue-600 text-white px-4 rounded-xl font-bold text-xs">Set</button>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-black uppercase text-slate-400 text-center mb-3 flex justify-center gap-2"><History size={12}/> Recovery</h4>
          <div className="grid gap-2">
            <button onClick={() => { onSetId('SX-630'); onClose(); }} className="text-xs font-bold py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">Load "SX-630"</button>
            <button onClick={() => { onSetId('northstar-garrett-abby'); onClose(); }} className="text-xs font-bold py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-100">Load "Garrett & Abby"</button>
            <label className="text-xs font-bold py-3 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl hover:bg-emerald-100 flex items-center justify-center gap-2 cursor-pointer">
              <Upload size={14}/> Upload Backup File
              <input type="file" accept=".json" className="hidden" onChange={(e) => { onImport(e); onClose(); }} />
            </label>
          </div>
        </div>
        <button onClick={onClose} className="mt-4 w-full text-slate-400 font-bold text-xs uppercase">Close</button>
      </div>
    </div>
  );
}

function AiModal({ content, onClose }) {
  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-black text-slate-900">{content.title}</h3>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400"><X size={16}/></button>
        </div>
        <div className="overflow-y-auto text-sm text-slate-600 leading-relaxed whitespace-pre-wrap flex-1">{content.text}</div>
        <button onClick={onClose} className="mt-6 w-full bg-slate-900 text-white py-4 rounded-2xl font-black">Close</button>
      </div>
    </div>
  );
}

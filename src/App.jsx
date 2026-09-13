import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield, Package, Map, Link as LinkIcon, AlertTriangle, CheckCircle, Plus, Trash2, Home,
  Droplets, Thermometer, Wind, Phone, Navigation, RefreshCw, Settings, Link2, ChevronRight,
  ClipboardList, Sparkles, Zap, BookOpen, X, Flame, Edit2, Save, History, Utensils,
  Database, UploadCloud, Battery, AlertOctagon, Smartphone, FileJson, Download, Upload,
  Plug, DollarSign, ShoppingCart, Store, ArrowRight, Image as ImageIcon, Layers,
  Siren, SearchCheck, Power, Tag, Calendar, ArrowUpDown
} from 'lucide-react';
import { request } from './api.js';
import { computeReadiness, isExpired } from '../shared/readiness.js';
import { applyAction, normalizeBackup, settingsSchema, fuelTypes } from '../shared/schema.js';
import { enqueueAction, loadCachedState, loadQueuedActions, saveCachedState, saveQueuedActions } from './offline.js';

// --- Constants ---
const SYSTEM_ID = 'Household';
const progressPercent = (value, goal) => goal > 0 ? (value / goal) * 100 : 0;

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
  const [user, setUser] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventory, setInventory] = useState([]);
  const [shoppingList, setShoppingList] = useState([]);
  const [appliances, setAppliances] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [aiContent, setAiContent] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [globalError, setGlobalError] = useState(null);
  const [settings, setSettings] = useState(() => settingsSchema.parse({}));
  const [pendingImport, setPendingImport] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingSync, setPendingSync] = useState(() => loadQueuedActions().length);
  const revision = useRef(-1);
  const busy = useRef(false);
  const epoch = useRef(0);
  const hubId = SYSTEM_ID;
  const accept = ({data,version}, synced = true) => {
    if (version < revision.current) return;
    revision.current = version;
    setInventory(data.inventory); setShoppingList(data.shoppingList);
    setAppliances(data.appliances); setPlan(data.plan); setSettings(settingsSchema.parse(data.settings ?? {}));
    saveCachedState({data,version});
    if (synced) setLastSyncedAt(Date.now());
  };
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  }, []);
  useEffect(() => {
    request('session').then(value => { setUser(value.authenticated); setConfigured(value.configured); })
      .catch(error=>setGlobalError(error.message)).finally(()=>setAuthReady(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running || busy.current) return;
      running = true;
      try { const state = await request('hub'); if (!cancelled) {accept(state); setPendingSync(loadQueuedActions().length); setGlobalError(null);} }
      catch(error) {
        if (!cancelled && !error.status) {
          const cached = loadCachedState();
          if (cached) { accept(cached, false); setLastSyncedAt(cached.savedAt ?? null); setGlobalError('Offline mode: showing the last saved copy. Changes will sync when you reconnect.'); }
          else setGlobalError('Offline and no saved copy is available. Download a backup after reconnecting.');
        } else if (!cancelled) { setGlobalError(error.message); if(error.status===401) setUser(false); }
      }
      finally {running=false;if(!cancelled) setLoading(false);}
    };
    refresh();
    const timer = setInterval(refresh,15000);
    window.addEventListener('focus',refresh);
    return () => {cancelled=true;clearInterval(timer);window.removeEventListener('focus',refresh);};
  }, [user, online]);
  useEffect(() => {
    if (!user || !online || busy.current || !loadQueuedActions().length) return;
    let cancelled = false;
    const flush = async () => {
      const queue = loadQueuedActions();
      busy.current = true; setIsSyncing(true);
      try {
        while (queue.length && !cancelled) {
          const result = await request('hub', queue[0]);
          accept(result); queue.shift(); saveQueuedActions(queue); setPendingSync(queue.length);
        }
        if (!cancelled && !queue.length) setGlobalError(null);
      } catch (error) {
        if (!cancelled) setGlobalError(error.status === 409 ? 'Queued changes conflict with another device. Refresh and review before retrying.' : 'Could not sync queued changes yet. We will retry when you reconnect.');
      } finally { busy.current = false; setIsSyncing(false); }
    };
    flush();
    return () => { cancelled = true; };
  }, [user, online]);
  const queueOffline = action => {
    try {
      const next = applyAction({inventory, shoppingList, appliances, plan, settings}, action);
      const count = enqueueAction(action);
      accept({data:next,version:revision.current}, false);
      setPendingSync(count); setGlobalError('Offline: saved on this device and queued for sync.');
      return true;
    } catch (error) { setGlobalError(error.message); return false; }
  };
  const mutate = async action => {
    if (!online) return queueOffline(action);
    if (busy.current) return false;
    busy.current=true; setIsSyncing(true);
    const started = epoch.current;
    try { const result=await request('hub',action); if(started===epoch.current){accept(result);setPendingSync(loadQueuedActions().length);setGlobalError(null);} return true; }
    catch(error) {
      if(started===epoch.current && !error.status) return queueOffline(action);
      if(started===epoch.current){setGlobalError(error.message);if(error.status===401)setUser(false);} return false;
    }
    finally {busy.current=false;setIsSyncing(false);}
  };
  const logout = async () => {
    try {await request('session',{},'DELETE');epoch.current++;setUser(false);setInventory([]);setShoppingList([]);setAppliances([]);setPlan(null);setSettings(settingsSchema.parse({}));setPendingImport(null);revision.current=-1;setLoading(true);setShowSyncModal(false);}
    catch(error){setGlobalError(error.message);}
  };
  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify({inventory,shoppingList,appliances,plan,settings},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=url;link.download=`northstar-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const handleFileUpload = async event => {
    const file=event.target.files[0];event.target.value='';if(!file)return;
    try {
      if(file.size>2_000_000)throw new Error('Backup must be smaller than 2 MB.');
      const backup=normalizeBackup(JSON.parse(await file.text()),()=>crypto.randomUUID());
      setPendingImport(backup);
      setGlobalError(null);
    } catch(error){setGlobalError(`Import failed: ${error.message}`);}
  };
  const confirmImport = async () => {
    if (!pendingImport) return false;
    if (!await mutate({type:'import',backup:pendingImport})) return false;
    setPendingImport(null);
    setShowSyncModal(false);
    alert('Backup imported. Existing records were merged by ID.');
    return true;
  };

  // --- Logic Helpers ---
  const stats = useMemo(() => computeReadiness({ inventory, appliances }, settings), [inventory, appliances, settings]);
  const handleUpdateSettings = (next) => mutate({ type: 'settings', settings: next });

  const generateMealPlan = async () => {
    setIsAiLoading(true);
    const inventoryText = inventory.map(i => `${i.name}: ${i.quantity} ${i.unit}`).join(', ');
    const prompt = `Based on this survival inventory: ${inventoryText}, create a 3-day meal plan for a family of 4 in a power outage. Daily calorie target 8,000. Provide concise daily summaries.`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "AI Survival Meal Plan ✨", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: e.message });
    }
    setIsAiLoading(false);
  };

  const analyzeInventory = async () => {
    setIsAiLoading(true);
    const inventoryText = inventory.map(i => `${i.name}: ${i.quantity} ${i.unit} (${i.category})`).join(', ');
    const prompt = `Analyze this survival inventory list for a family of 4 in a winter climate: ${inventoryText}. Identify 3 critical gaps or missing categories to reach 14 days self-sufficiency. Be specific and concise.`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "AI Gap Analysis ✨", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: e.message });
    }
    setIsAiLoading(false);
  };

  const generateDrill = async () => {
    setIsAiLoading(true);
    const familyNames = plan?.family?.map(f => f.name).join(', ') || "the family";
    const shelter = plan?.shelterSpot || "basement";
    const prompt = `Create a realistic 10-minute emergency drill scenario for a family in suburban Minnesota (Winter). Family: ${familyNames}. Safe spot: ${shelter}. Scenario: Severe blizzard with power loss or tornado siren. Give 3 immediate action steps for the household to practice.`;
    try {
      const result = await callGemini(prompt);
      setAiContent({ title: "🚨 AI Emergency Drill", text: result });
    } catch (e) {
      setAiContent({ title: "Error", text: e.message });
    }
    setIsAiLoading(false);
  };

  const handleAdd = (collection,item) => mutate({type:'add',collection,id:crypto.randomUUID(),item});
  const handleUpdate = (collection,id,item) => mutate({type:'update',collection,id,item});
  const handleDelete = (collection,id) => mutate({type:'delete',collection,id});
  const handleBulkDelete = (collection, ids) => mutate({type:'bulk_delete',collection,ids});
  const handleBuyItem = item => mutate({type:'buy',id:item.id});

  if (!authReady) return <LoadingScreen />;
  if (!user) return <Login configured={configured} error={globalError} onLogin={() => {epoch.current++;revision.current=-1;setLoading(true);setUser(true);setGlobalError(null);}} />;
  if (loading && !inventory.length && !globalError) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none">
      {globalError && <div role="alert" aria-live="assertive" className="bg-red-100 text-red-900 p-4">{globalError}</div>}
      <Header hubId={hubId} isSyncing={isSyncing} online={online} pendingSync={pendingSync} lastSyncedAt={lastSyncedAt} onSyncClick={() => setShowSyncModal(true)} error={globalError} onDownload={downloadBackup} />

      {inventory.length === 0 && !loading && <div className="max-w-xl mx-auto p-5 text-center text-sm text-slate-600">Add supplies to get started, or import a JSON backup in Household settings.</div>}
      <main className="flex-1 max-w-xl mx-auto w-full p-4 pb-28">
        {activeTab === 'dashboard' && <Dashboard stats={stats} settings={settings} onGeneratePlan={generateMealPlan} onAnalyzeGaps={analyzeInventory} isAiLoading={isAiLoading} />}
        {activeTab === 'inventory' && (
          <InventoryManager
            title="Supply Hub"
            items={inventory}
            stats={stats}
            settings={settings}
            onAdd={(i) => handleAdd('inventory', i)}
            onUpdate={(id, i) => handleUpdate('inventory', id, i)}
            onDelete={(id) => handleDelete('inventory', id)}
            onBulkDelete={(ids) => handleBulkDelete('inventory', ids)}
            onSmartSuggest={(txt) => smartSuggestItem(txt, setIsAiLoading)}
            isAiLoading={isAiLoading}
          />
        )}
        {activeTab === 'shopping' && (
          <InventoryManager
            title="Shopping List"
            items={shoppingList}
            stats={stats}
            settings={settings}
            isShoppingMode={true}
            onAdd={(i) => handleAdd('shopping_list', i)}
            onUpdate={(id, i) => handleUpdate('shopping_list', id, i)}
            onDelete={(id) => handleDelete('shopping_list', id)}
            onBulkDelete={(ids) => handleBulkDelete('shopping_list', ids)}
            onBuy={handleBuyItem}
            onSmartSuggest={(txt) => smartSuggestItem(txt, setIsAiLoading)}
            isAiLoading={isAiLoading}
          />
        )}
        {activeTab === 'power' && (
          <ApplianceManager
            appliances={appliances}
            stats={stats}
            settings={settings}
            onAdd={(i) => handleAdd('appliances', i)}
            onUpdate={(id, i) => handleUpdate('appliances', id, i)}
            onDelete={(id) => handleDelete('appliances', id)}
            onSmartSuggest={(txt) => smartSuggestAppliance(txt, setIsAiLoading)}
            isAiLoading={isAiLoading}
          />
        )}
        {activeTab === 'plan' && <EmergencyPlan plan={plan} onUpdate={(plan) => mutate({type:'plan',plan})} onRunDrill={generateDrill} isAiLoading={isAiLoading} />}
      </main>

      <NavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {showSyncModal && <SyncModal onClose={() => { setPendingImport(null); setShowSyncModal(false); }} onImport={handleFileUpload} pendingImport={pendingImport} onConfirmImport={confirmImport} onCancelImport={() => setPendingImport(null)} onLogout={logout} settings={settings} onUpdateSettings={handleUpdateSettings} />}
      {aiContent && <AiModal content={aiContent} onClose={() => setAiContent(null)} />}
    </div>
  );
}

// --- Dashboard ---
function Dashboard({ stats, settings, onGeneratePlan, onAnalyzeGaps, isAiLoading }) {
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
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Household Readiness</p>
          <div className="mt-6 space-y-4">
            <ProgressBar label={`Food (${settings.survivalGoalDays} Days)`} percent={progressPercent(stats.foodDays, settings.survivalGoalDays)} color="bg-emerald-500" />
            <ProgressBar label={`Water (${settings.survivalGoalDays} Days)`} percent={progressPercent(stats.waterDays, settings.survivalGoalDays)} color="bg-blue-500" />
            <ProgressBar label={`Heat (${settings.heatGoalHours}h)`} percent={progressPercent(stats.totalFuelHours, settings.heatGoalHours)} color="bg-amber-500" />
            <ProgressBar label={`Power (Goal: ${settings.powerGoalKwh} kWh)`} percent={progressPercent(stats.totalPowerKwh, settings.powerGoalKwh)} color="bg-violet-500" />
          </div>
          <p className="mt-5 text-[10px] leading-relaxed text-slate-500">
            Assumes {settings.householdSize} {settings.householdSize === 1 ? 'person' : 'people'} needing {settings.caloriesPerPersonPerDay.toLocaleString()} kcal
            and {settings.waterGallonsPerPersonPerDay} gal water per person/day ({stats.dailyCalorieNeed.toLocaleString()} kcal
            and {stats.dailyWaterNeed.toLocaleString()} gal/day for the household). Stored power counts {Math.round(settings.batteryUsableFraction * 100)}%
            usable capacity after a {Math.round(settings.inverterEfficiency * 100)}% efficient inverter conversion.
            Edit these in Household settings.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
          <button aria-label="Generate meal plan" onClick={onGeneratePlan} disabled={isAiLoading} className="bg-emerald-50 text-emerald-700 py-4 rounded-[2rem] flex flex-col items-center justify-center gap-1 font-black text-[10px] uppercase tracking-widest border border-emerald-100 shadow-sm active:scale-95 transition-all disabled:opacity-50">
          {isAiLoading ? <RefreshCw className="animate-spin" size={20}/> : <Sparkles size={20}/>}
          Meal Plan
        </button>
        <button aria-label="Analyze inventory gaps" onClick={onAnalyzeGaps} disabled={isAiLoading} className="bg-blue-50 text-blue-700 py-4 rounded-[2rem] flex flex-col items-center justify-center gap-1 font-black text-[10px] uppercase tracking-widest border border-blue-100 shadow-sm active:scale-95 transition-all disabled:opacity-50">
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
    if (editingId) { if (!await onUpdate(editingId, data)) return; }
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
                {editingId && <button type="button" onClick={async () => { if (await onDelete(editingId)) reset(); }} className="text-red-500 flex items-center gap-1 text-[10px] font-black uppercase"><Trash2 size={12}/> Delete</button>}
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
                <button aria-label={`Turn ${app.name} ${app.active !== false ? 'off' : 'on'}`} title={`Turn ${app.name} ${app.active !== false ? 'off' : 'on'}`}
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
             <button aria-label={`Edit ${app.name}`} onClick={() => handleEdit(app)} className="text-slate-200 hover:text-violet-400 transition-colors p-2">
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
function InventoryManager({ title, items, stats, settings, onAdd, onUpdate, onDelete, onBulkDelete, onBuy, onSmartSuggest, isAiLoading, isShoppingMode }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [smartText, setSmartText] = useState('');
  const [isImgLoading, setIsImgLoading] = useState(false);
  const [sortBy, setSortBy] = useState(''); // 'expiry', 'calories', 'date'
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [formError, setFormError] = useState(null);

  const [form, setForm] = useState({
    name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', gallonsPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', fuelType: '', purchaseDate: '', expiryDate: ''
  });

  const reset = () => {
    setForm({ name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', gallonsPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', fuelType: '', purchaseDate: '', expiryDate: '' });
    setEditingItem(null);
    setShowAdd(false);
    setFormError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const normalizedName = String(form.name || '').trim().toLowerCase();
    const duplicate = items.some(item => item.id !== editingItem?.id && item.category === form.category && String(item.name || '').trim().toLowerCase() === normalizedName);
    if (duplicate) {
      setFormError('An item with this name and category already exists. Edit the existing item or choose a different name.');
      return;
    }
    const payload = {
      ...form,
      quantity: Number(form.quantity),
      caloriesPerUnit: Number(form.caloriesPerUnit),
      hoursPerUnit: Number(form.hoursPerUnit),
      capacityPerUnit: Number(form.capacityPerUnit),
      gallonsPerUnit: Number(form.gallonsPerUnit || 0),
      price: Number(form.price)
    };
    if (editingItem) { if (!await onUpdate(editingItem.id, payload)) return; }
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

  useEffect(() => {
    setSelectedIds(previous => new Set([...previous].filter(id => items.some(item => item.id === id))));
  }, [items]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(item => {
      if (needle && ![item.name, item.category, item.store, item.unit].some(value => String(value || '').toLowerCase().includes(needle))) return false;
      if (statusFilter === 'expired' && !isExpired(item.expiryDate)) return false;
      if (statusFilter === 'expiring' && (isExpired(item.expiryDate) || !item.expiryDate || new Date(item.expiryDate) > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))) return false;
      if (statusFilter === 'low' && Number(item.quantity || 0) >= Number(item.target || 1) * 0.25) return false;
      return true;
    });
  }, [items, query, statusFilter]);

  const sortedItems = useMemo(() => {
    let sorted = [...filteredItems];
    if (sortBy === 'expiry') {
      sorted.sort((a, b) => new Date(a.expiryDate || '2099-01-01') - new Date(b.expiryDate || '2099-01-01'));
    } else if (sortBy === 'calories') {
      sorted.sort((a, b) => (Number(b.quantity||0) * Number(b.caloriesPerUnit||0)) - (Number(a.quantity||0) * Number(a.caloriesPerUnit||0)));
    } else if (sortBy === 'date') {
      sorted.sort((a, b) => new Date(b.purchaseDate || '1970-01-01') - new Date(a.purchaseDate || '1970-01-01'));
    }
    return sorted;
  }, [filteredItems, sortBy]);

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

  const waterPct = settings.survivalGoalDays ? Math.min(Math.round((stats.waterDays / settings.survivalGoalDays) * 100), 100) : 0;
  const foodPct = settings.survivalGoalDays ? Math.min(Math.round((stats.foodDays / settings.survivalGoalDays) * 100), 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-black text-slate-800">{title}</h2>
        <div className="flex gap-2">
          <button aria-label="Sort by expiry date" title="Sort by expiry date" onClick={() => setSortBy(prev => prev === 'expiry' ? '' : 'expiry')} className={`p-2 rounded-full ${sortBy === 'expiry' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
            <Calendar aria-hidden="true" size={18}/>
          </button>
          <button aria-label={showAdd ? 'Cancel adding item' : 'Add item'} onClick={() => showAdd ? reset() : setShowAdd(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 text-sm font-black active:scale-95 transition-all shadow-lg">
            {showAdd ? 'Cancel' : <><Plus size={18}/> Add Item</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input aria-label={`Search ${title.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, category or store" className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-blue-400" />
        <select aria-label="Filter items" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="bg-white border border-slate-200 rounded-2xl px-3 text-xs font-bold">
          <option value="all">All</option><option value="low">Low stock</option><option value="expiring">Expiring</option><option value="expired">Expired</option>
        </select>
      </div>
      {selectedIds.size > 0 && <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-sm"><span className="font-bold text-blue-800">{selectedIds.size} selected</span><button aria-label="Delete selected items" onClick={async () => { if (await onBulkDelete([...selectedIds])) setSelectedIds(new Set()); }} className="text-red-600 font-black">Delete selected</button></div>}

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
              {editingItem && <button type="button" onClick={async () => { if (await onDelete(editingItem.id)) reset(); }} className="text-red-500 text-[10px] font-black uppercase flex items-center gap-1"><Trash2 size={12}/> Delete</button>}
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
              {form.category === 'Water' && <div className="col-span-2"><Label>Gallons per unit (for bottles or cases)</Label><Input val={form.gallonsPerUnit} set={v => setForm({...form, gallonsPerUnit:v})} type="number" placeholder="e.g. 0.132 for a 500 mL bottle" /><p className="text-xs text-slate-500 mt-2">Leave zero when your unit is gallons, liters, mL or fl oz. Other units need this value to count toward readiness.</p></div>}
              {form.category === 'Fuel' && (
                <>
                  <div><Label>Fuel Type</Label><Select val={form.fuelType} set={v => setForm({...form, fuelType: v})} opts={fuelTypes} /></div>
                  <div><Label>Hours/Unit (Heat)</Label><Input val={form.hoursPerUnit} set={v => setForm({...form, hoursPerUnit: v})} type="number" /></div>
                </>
              )}
              {form.category === 'Power' && <div className="col-span-2"><Label>Capacity (kWh)</Label><Input val={form.capacityPerUnit} set={v => setForm({...form, capacityPerUnit: v})} type="number" placeholder="e.g. 1.5"/></div>}
            </div>
            {formError && <p role="alert" className="text-xs font-bold text-red-600">{formError}</p>}
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
          <SummaryCard icon={<Flame size={16}/>} color="amber" label="Total Heat" value={stats.totalFuelHours} unit="Hours" pct={progressPercent(stats.totalFuelHours, settings.heatGoalHours)} />
          <SummaryCard icon={<Zap size={16}/>} color="violet" label="Backup Power" value={stats.totalPowerKwh} unit="kWh" pct={progressPercent(stats.totalPowerKwh, settings.powerGoalKwh)} />
          {Object.keys(stats.fuelByType).length > 0 && (
            <div className="col-span-2 bg-amber-50 border border-amber-100 rounded-[2rem] p-4 text-[11px] font-bold text-amber-700 flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(stats.fuelByType).map(([type, hours]) => (
                <span key={type}>{type || 'Unspecified'}: {hours.toFixed(0)}h</span>
              ))}
            </div>
          )}
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
                 {groupItems.map(item => <InventoryItem key={item.id} item={item} selected={selectedIds.has(item.id)} onSelect={checked => setSelectedIds(previous => { const next = new Set(previous); if (checked) next.add(item.id); else next.delete(item.id); return next; })} onClick={() => handleEdit(item)} onBuy={onBuy} />)}
               </div>
             </div>
           ))
        ) : (
           <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">{items.length ? 'No matching items' : 'List Empty'}</div>
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
        <button onClick={async () => { try { if(isEditing && !await onUpdate({...plan, shelterSpot: spot})) return; setIsEditing(!isEditing); } catch { alert("Could not save plan. Please retry."); } }} className="text-[10px] font-black px-6 py-2.5 rounded-full bg-blue-50 text-blue-600 uppercase tracking-widest">
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

function InventoryItem({ item, onClick, onBuy, selected, onSelect }) {
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
  const expired = isExpired(item.expiryDate);

  return (
    <div role="button" tabIndex="0" aria-label={`Edit ${item.name}`} onClick={onClick} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }} className={`bg-white border border-slate-200 p-5 rounded-[2.25rem] flex justify-between items-center group shadow-sm active:scale-95 transition-all cursor-pointer ${expired ? 'border-red-300 bg-red-50' : ''}`}>
       <div className="flex items-center gap-3 min-w-0">
          {onSelect && <input aria-label={`Select ${item.name}`} type="checkbox" checked={selected} onChange={event => { event.stopPropagation(); onSelect(event.target.checked); }} onClick={event => event.stopPropagation()} className="h-4 w-4 accent-blue-600" />}
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden ${style}`}>
            {item.image ? (
               <img src={item.image} alt="" className="w-full h-full object-cover"/>
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
               {isExpiringSoon && <span className="text-[8px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={8}/> {expired ? 'EXPIRED' : 'Expiring Soon'}</span>}
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
           <button aria-label={`Move ${item.name} to inventory`}
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
    <div role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(Math.min(percent, 100))} className="h-3 w-full bg-white/10 rounded-full overflow-hidden border border-white/5">
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

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Not synced yet';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'Saved just now';
  if (seconds < 60) return `Saved ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Saved ${minutes}m ago`;
}

function Header({ hubId, isSyncing, online, pendingSync, lastSyncedAt, onSyncClick, error, onDownload }) {
  return (
    <header className="bg-slate-900 text-white p-4 sticky top-0 z-50 shadow-xl border-b border-white/5">
      <div className="max-w-xl mx-auto flex justify-between items-center text-white">
        <div className="flex items-center gap-2">
          <Shield className="text-blue-400 w-7 h-7" />
          <h1 className="text-lg font-black tracking-tight text-white">NorthStar Prep</h1>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Download household backup" title="Download household backup" onClick={onDownload} className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white"><Download aria-hidden="true" size={16}/></button>
          <button aria-label="Open household settings" onClick={onSyncClick} className="flex flex-col items-end">
            <div aria-live="polite" className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${error ? 'bg-red-500/20 text-red-300' : isSyncing ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'}`}>
              {error ? <AlertOctagon size={10}/> : isSyncing ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle size={10} />}
              {online ? (pendingSync ? `${pendingSync} queued` : formatRelativeTime(lastSyncedAt)) : 'Offline'}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button aria-current={active ? 'page' : undefined} aria-label={label} onClick={onClick} className={`flex flex-col items-center gap-1.5 p-3 min-w-0 flex-1 transition-all rounded-3xl ${active ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:bg-slate-50'}`}>
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
function useDialogFocus(dialogRef, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previous = document.activeElement;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...dialog.querySelectorAll(focusableSelector)];
    (focusable()[0] || dialog).focus();
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [dialogRef]);
}

function SettingsForm({ settings, onSave }) {
  const [form, setForm] = useState({
    householdSize: settings.householdSize,
    caloriesPerPersonPerDay: settings.caloriesPerPersonPerDay,
    waterGallonsPerPersonPerDay: settings.waterGallonsPerPersonPerDay,
    survivalGoalDays: settings.survivalGoalDays,
    heatGoalHours: settings.heatGoalHours,
    powerGoalKwh: settings.powerGoalKwh,
    batteryUsableFraction: Math.round(settings.batteryUsableFraction * 100),
    inverterEfficiency: Math.round(settings.inverterEfficiency * 100),
  });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSaved(false);
    try {
      const parsed = settingsSchema.parse({
        ...form,
        batteryUsableFraction: Number(form.batteryUsableFraction) / 100,
        inverterEfficiency: Number(form.inverterEfficiency) / 100,
      });
      if (await onSave(parsed)) setSaved(true); else setError('Save failed. Please retry.');
    } catch { setError('Please check the values above.'); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-5">
      <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">Readiness assumptions</h3>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Household size</Label><Input val={form.householdSize} set={v => setForm({...form, householdSize: v})} type="number" /></div>
        <div><Label>Goal (days)</Label><Input val={form.survivalGoalDays} set={v => setForm({...form, survivalGoalDays: v})} type="number" /></div>
        <div><Label>Calories/person/day</Label><Input val={form.caloriesPerPersonPerDay} set={v => setForm({...form, caloriesPerPersonPerDay: v})} type="number" /></div>
        <div><Label>Water gal/person/day</Label><Input val={form.waterGallonsPerPersonPerDay} set={v => setForm({...form, waterGallonsPerPersonPerDay: v})} type="number" /></div>
        <div><Label>Heat goal (hours)</Label><Input val={form.heatGoalHours} set={v => setForm({...form, heatGoalHours: v})} type="number" /></div>
        <div><Label>Power goal (kWh)</Label><Input val={form.powerGoalKwh} set={v => setForm({...form, powerGoalKwh: v})} type="number" /></div>
        <div><Label>Battery usable %</Label><Input val={form.batteryUsableFraction} set={v => setForm({...form, batteryUsableFraction: v})} type="number" /></div>
        <div><Label>Inverter efficiency %</Label><Input val={form.inverterEfficiency} set={v => setForm({...form, inverterEfficiency: v})} type="number" /></div>
      </div>
      <p className="text-xs text-slate-500">Battery usable % and inverter efficiency % account for depth-of-discharge limits and DC-to-AC conversion loss when estimating runtime from stored power.</p>
      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {saved && <p className="text-xs font-bold text-emerald-600">Saved.</p>}
      <button type="submit" className="w-full rounded-xl p-3 bg-blue-600 text-white font-bold text-sm">Save assumptions</button>
    </form>
  );
}
function SyncModal({onClose,onImport,pendingImport,onConfirmImport,onCancelImport,onLogout,settings,onUpdateSettings}) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-6">
    <section ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="settings-title" className="bg-white w-full max-w-sm rounded-3xl p-8 space-y-5 max-h-[85vh] overflow-y-auto">
      <h2 id="settings-title" className="text-xl font-black">Household settings</h2>
      <p className="text-sm text-slate-600">Your household syncs across signed-in devices. Import a backup to merge supplies, shopping, appliances and your family plan.</p>
      <label className="block text-sm font-bold">Import JSON backup<input type="file" accept=".json,application/json" onChange={onImport} className="block mt-2 w-full text-xs" /></label>
      {pendingImport && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm">
        <p className="font-black text-amber-900">Backup ready to review</p>
        <p className="text-amber-800">{pendingImport.inventory.length} inventory items, {pendingImport.shoppingList.length} shopping items, {pendingImport.appliances.length} appliances and {pendingImport.plan ? 'a family plan' : 'no family plan'} will be merged by ID.</p>
        {pendingImport.settings && <p className="text-amber-800">Readiness assumptions are included.</p>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onConfirmImport} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white">Merge backup</button><button type="button" onClick={onCancelImport} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-800">Cancel</button></div>
      </div>}
      <SettingsForm settings={settings} onSave={onUpdateSettings} />
      <button onClick={onLogout} className="w-full rounded-xl p-3 bg-slate-100">Sign out</button>
      <button onClick={onClose} className="w-full rounded-xl p-3 bg-slate-900 text-white">Close</button>
    </section>
  </div>;
}
function Login({configured,error,onLogin}) {
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState(null);
  const [pending,setPending]=useState(false);
  const submit=async event=>{event.preventDefault();setPending(true);setMessage(null);try{await request('session',{password});setPassword('');onLogin();}catch(error){setMessage(error.message);}finally{setPending(false);}};
  return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-sm space-y-6">
      <Shield className="text-blue-400" size={40}/><h1 className="text-3xl font-black">NorthStar Prep</h1>
      <p className="text-slate-300">Sign in to your household supplies and emergency plan.</p>
      {!configured && <p role="alert" className="text-amber-200">Setup required: connect the database and configure household login in Vercel.</p>}
      {(message||error) && <p role="alert" className="text-red-300">{message||error}</p>}
      <label className="block">Household password<input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl bg-white p-4 text-slate-900"/></label>
      <button disabled={pending||!configured} className="w-full rounded-xl bg-blue-600 p-4 font-bold disabled:opacity-50">{pending?'Signing in…':'Sign in'}</button>
    </form>
  </main>;
}

function AiModal({ content, onClose }) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
      <div ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title" className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center mb-6">
          <h3 id="ai-modal-title" className="text-xl font-black text-slate-900">{content.title}</h3>
          <button aria-label="Close AI result" onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400"><X aria-hidden="true" size={16}/></button>
        </div>
        <div className="overflow-y-auto text-sm text-slate-600 leading-relaxed whitespace-pre-wrap flex-1">{content.text}</div>
        <button onClick={onClose} className="mt-6 w-full bg-slate-900 text-white py-4 rounded-2xl font-black">Close</button>
      </div>
    </div>
  );
}

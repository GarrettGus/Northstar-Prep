import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield, Package, Map, Link as LinkIcon, AlertTriangle, CheckCircle, Plus, Trash2, Home,
  Droplets, Thermometer, Wind, Phone, Navigation, RefreshCw, Settings, Link2, ChevronRight,
  ClipboardList, Zap, BookOpen, X, Flame, Edit2, Save, History, Utensils,
  Database, UploadCloud, Battery, AlertOctagon, Smartphone, FileJson, Download, Upload,
  Plug, DollarSign, ShoppingCart, Store, ArrowRight, Layers,
  Siren, SearchCheck, Power, Tag, Calendar, ArrowUpDown
} from 'lucide-react';
import { request } from './api.js';
import { computeReadiness, computeReadinessGaps, isExpired, isRecurringDue, expirationQueue } from '../shared/readiness.js';
import { applyAction, normalizeBackup, settingsSchema, fuelTypes, categories, reminderCategories } from '../shared/schema.js';
import { effectiveReminderDueDate, isReminderOverdue, todayLocal, addDaysISO } from '../shared/reminders.js';
import { checklistCatalog } from '../shared/checklists.js';
import { enqueueAction, loadCachedState, loadQueuedActions, saveCachedState, saveQueuedActions } from './offline.js';

// --- Constants ---
const SYSTEM_ID = 'Household';
const progressPercent = (value, goal) => goal > 0 ? (value / goal) * 100 : 0;

// The emergency drill remains unavailable until an authenticated server endpoint is configured.
// Meal planning, gap analysis and item/appliance suggestions no longer need one: gap analysis is
// computed deterministically (see computeReadinessGaps), and the others were removed rather than
// left as dead buttons.
async function callGemini() {
  throw new Error('AI is not configured.');
}

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventory, setInventory] = useState([]);
  const [shoppingList, setShoppingList] = useState([]);
  const [appliances, setAppliances] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [checklistChecks, setChecklistChecks] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBinder, setShowBinder] = useState(false);
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
    setAppliances(data.appliances); setReminders(data.reminders ?? []); setChecklistChecks(data.checklistChecks ?? []);
    setPlan(data.plan); setSettings(settingsSchema.parse(data.settings ?? {}));
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
    request('session').then(value => { setUser(value.authenticated ? value.user : null); setConfigured(value.configured); })
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
        } else if (!cancelled) { setGlobalError(error.message); if(error.status===401) setUser(null); }
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
      const next = applyAction({inventory, shoppingList, appliances, reminders, checklistChecks, plan, settings}, action);
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
      if(started===epoch.current){setGlobalError(error.message);if(error.status===401)setUser(null);} return false;
    }
    finally {busy.current=false;setIsSyncing(false);}
  };
  const logout = async () => {
    try {await request('session',{},'DELETE');epoch.current++;setUser(null);setInventory([]);setShoppingList([]);setAppliances([]);setReminders([]);setChecklistChecks([]);setPlan(null);setSettings(settingsSchema.parse({}));setPendingImport(null);revision.current=-1;setLoading(true);setShowSyncModal(false);}
    catch(error){setGlobalError(error.message);}
  };
  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify({inventory,shoppingList,appliances,reminders,checklistChecks,plan,settings},null,2)],{type:'application/json'});
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
  const restoreFromBackup = async (id) => {
    try {
      const result = await request('backup', {type:'restore', id});
      setPendingImport(result.backup);
      setGlobalError(null);
    } catch (error) { setGlobalError(`Restore failed: ${error.message}`); }
  };

  // --- Logic Helpers ---
  const stats = useMemo(() => computeReadiness({ inventory, appliances, plan }, settings), [inventory, appliances, plan, settings]);
  const gaps = useMemo(() => computeReadinessGaps(stats, settings), [stats, settings]);
  const overdueReminders = useMemo(() => reminders.filter(r => isReminderOverdue(r)), [reminders]);
  const handleUpdateSettings = (next) => mutate({ type: 'settings', settings: next });

  // Queues a generic supply representing a readiness shortfall onto the shopping list; the
  // household edits it afterward (specific product, price, store) like any other item.
  const handleAddGapShortfall = (gap) => {
    if (gap.key === 'water') return handleAdd('shopping_list', { name: 'Drinking water (readiness shortfall)', category: 'Water', quantity: gap.suggestedQuantity, unit: 'gal', gallonsPerUnit: 1 });
    if (gap.key === 'food') return handleAdd('shopping_list', { name: 'Emergency food (readiness shortfall)', category: 'Food', quantity: 1, unit: 'servings', caloriesPerUnit: gap.suggestedCalories });
    if (gap.key === 'power') return handleAdd('shopping_list', { name: 'Backup power storage (readiness shortfall)', category: 'Power', quantity: 1, unit: 'units', capacityPerUnit: gap.suggestedRawKwh });
    return Promise.resolve(false);
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
  const handleBulkUpdate = (collection, ids, changes) => mutate({type:'bulk_update',collection,ids,...changes});
  const handleBuyItem = item => mutate({type:'buy',id:item.id});
  const handleRestockRecurring = async (dueItems) => {
    for (const item of dueItems) {
      const {id, purchaseDate, expiryDate, quantity, target, ...rest} = item;
      if (!await handleAdd('shopping_list', {...rest, quantity: target || quantity || 1, purchaseDate: '', expiryDate: ''})) return false;
    }
    return true;
  };
  const handleCompleteReminder = (reminder) => handleUpdate('reminders', reminder.id, {...reminder, lastCompletedDate: todayLocal(), snoozedUntil: ''});
  const handleSnoozeReminder = (reminder, days) => handleUpdate('reminders', reminder.id, {...reminder, snoozedUntil: addDaysISO(todayLocal(), days)});
  const handleToggleChecklistItem = (season, itemId, checked) => {
    const id = `${season}__${itemId}`;
    return checked ? mutate({type:'add', collection:'checklist', id, item:{completedAt: todayLocal()}}) : mutate({type:'delete', collection:'checklist', id});
  };

  const handleAuthenticated = (profile) => {
    epoch.current++;revision.current=-1;setLoading(true);setUser(profile);setGlobalError(null);
    window.history.replaceState(null,'',window.location.pathname);
  };

  if (!authReady) return <LoadingScreen />;
  if (!user) {
    const inviteToken = new URLSearchParams(window.location.search).get('invite');
    if (inviteToken) return <AcceptInvite token={inviteToken} onJoined={handleAuthenticated} />;
    return <Login configured={configured} error={globalError} onLogin={handleAuthenticated} />;
  }
  if (loading && !inventory.length && !globalError) return <LoadingScreen />;
  if (showBinder) return <EmergencyBinder plan={plan} inventory={inventory} stats={stats} settings={settings} checklistChecks={checklistChecks} onClose={() => setShowBinder(false)} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans select-none">
      {globalError && <div role="alert" aria-live="assertive" className="bg-red-100 text-red-900 p-4">{globalError}</div>}
      <Header hubId={hubId} isSyncing={isSyncing} online={online} pendingSync={pendingSync} lastSyncedAt={lastSyncedAt} onSyncClick={() => setShowSyncModal(true)} error={globalError} onDownload={downloadBackup} />

      {inventory.length === 0 && !loading && <div className="max-w-xl mx-auto p-5 text-center text-sm text-slate-600">Add supplies to get started, or import a JSON backup in Household settings.</div>}
      <main className="flex-1 max-w-xl mx-auto w-full p-4 pb-28">
        {activeTab === 'dashboard' && <Dashboard stats={stats} settings={settings} gaps={gaps} onAddGapShortfall={handleAddGapShortfall} overdueReminders={overdueReminders} onViewReminders={() => setActiveTab('plan')} onViewRotation={() => setActiveTab('inventory')} />}
        {activeTab === 'inventory' && (
          <InventoryManager
            title="Supply Hub"
            items={inventory}
            shoppingList={shoppingList}
            stats={stats}
            settings={settings}
            onAdd={(i) => handleAdd('inventory', i)}
            onUpdate={(id, i) => handleUpdate('inventory', id, i)}
            onDelete={(id) => handleDelete('inventory', id)}
            onBulkDelete={(ids) => handleBulkDelete('inventory', ids)}
            onBulkUpdate={(ids, changes) => handleBulkUpdate('inventory', ids, changes)}
            onRestock={handleRestockRecurring}
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
            onBulkUpdate={(ids, changes) => handleBulkUpdate('shopping_list', ids, changes)}
            onBuy={handleBuyItem}
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
          />
        )}
        {activeTab === 'plan' && (
          <EmergencyPlan
            plan={plan} onUpdate={(plan) => mutate({type:'plan',plan})} onRunDrill={generateDrill} isAiLoading={isAiLoading}
            onOpenBinder={() => setShowBinder(true)}
            reminders={reminders} checklistChecks={checklistChecks}
            onAddReminder={(i) => handleAdd('reminders', i)}
            onUpdateReminder={(id, i) => handleUpdate('reminders', id, i)}
            onDeleteReminder={(id) => handleDelete('reminders', id)}
            onCompleteReminder={handleCompleteReminder}
            onSnoozeReminder={handleSnoozeReminder}
            onToggleChecklistItem={handleToggleChecklistItem}
          />
        )}
      </main>

      <NavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {showSyncModal && <SyncModal onClose={() => { setPendingImport(null); setShowSyncModal(false); }} onImport={handleFileUpload} pendingImport={pendingImport} onConfirmImport={confirmImport} onCancelImport={() => setPendingImport(null)} onRestoreBackup={restoreFromBackup} onLogout={logout} settings={settings} onUpdateSettings={handleUpdateSettings} currentUserId={user.id} onOpenBinder={() => { setShowSyncModal(false); setShowBinder(true); }} />}
      {aiContent && <AiModal content={aiContent} onClose={() => setAiContent(null)} />}
    </div>
  );
}

// --- Dashboard ---
function Dashboard({ stats, settings, gaps = [], onAddGapShortfall, overdueReminders = [], onViewReminders, onViewRotation }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {overdueReminders.length > 0 && (
        <button onClick={onViewReminders} className="w-full flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-left active:scale-95 transition-all">
          <span className="flex items-center gap-2 font-bold text-red-800"><AlertOctagon size={16}/> {overdueReminders.length} overdue maintenance {overdueReminders.length > 1 ? 'reminders' : 'reminder'}</span>
          <ChevronRight size={16} className="text-red-400"/>
        </button>
      )}
      {(stats.expiringSoon > 0 || stats.expired > 0) && (
        <button onClick={onViewRotation} className="w-full flex items-center justify-between gap-3 bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 text-sm text-left active:scale-95 transition-all">
          <span className="flex items-center gap-2 font-bold text-orange-800">
            <Calendar size={16}/>
            {stats.expiringSoon > 0 && <>{stats.expiringSoon} item{stats.expiringSoon === 1 ? '' : 's'} expiring within 90 days</>}
            {stats.expiringSoon > 0 && stats.expired > 0 && <> · </>}
            {stats.expired > 0 && <>{stats.expired} already expired</>}
          </span>
          <ChevronRight size={16} className="text-orange-400"/>
        </button>
      )}
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
          <p className="mt-5 text-[10px] leading-relaxed text-slate-400">
            {stats.needsMode === 'members' ? (
              <>
                Adds up each household member's own needs: {stats.people} {stats.people === 1 ? 'person' : 'people'}
                {stats.pets > 0 && <> and {stats.pets} {stats.pets === 1 ? 'pet' : 'pets'}</>} in the Family Hub
                ({stats.dailyCalorieNeed.toLocaleString()} kcal and {stats.dailyWaterNeed.toLocaleString()} gal/day for the household).
                Members left blank count at {settings.caloriesPerPersonPerDay.toLocaleString()} kcal and {settings.waterGallonsPerPersonPerDay} gal;
                a pet counts for nothing until you enter its figures. Edit members in the Family Hub.
              </>
            ) : (
              <>
                Assumes {settings.householdSize} {settings.householdSize === 1 ? 'person' : 'people'} needing {settings.caloriesPerPersonPerDay.toLocaleString()} kcal
                and {settings.waterGallonsPerPersonPerDay} gal water per person/day ({stats.dailyCalorieNeed.toLocaleString()} kcal
                and {stats.dailyWaterNeed.toLocaleString()} gal/day for the household). Give a member their own figures in the Family Hub
                to count everyone individually instead.
              </>
            )} Stored power counts {Math.round(settings.batteryUsableFraction * 100)}%
            usable capacity after a {Math.round(settings.inverterEfficiency * 100)}% efficient inverter conversion.
            Edit these in Household settings.
          </p>
        </div>
      </div>

      <ReadinessGaps gaps={gaps} onAddShortfall={onAddGapShortfall} />
    </div>
  );
}

// Deterministic gap analysis: what each readiness goal is short by, and a one-tap way to queue
// a generic replacement item for it onto the shopping list. Replaces the old AI "Analyze Gaps".
function ReadinessGaps({ gaps, onAddShortfall }) {
  const [addingKey, setAddingKey] = useState(null);
  const shortfalls = gaps.filter(gap => !gap.met);
  const addableKeys = new Set(['water', 'food', 'power']);

  const describe = (gap) => {
    if (gap.key === 'water') return `${gap.shortfallDays.toFixed(1)} days short of goal — about ${gap.suggestedQuantity.toLocaleString()} more gallons needed.`;
    if (gap.key === 'food') return `${gap.shortfallDays.toFixed(1)} days short of goal — about ${gap.suggestedCalories.toLocaleString()} more kcal needed.`;
    if (gap.key === 'heat') return `${gap.shortfallHours.toFixed(0)} more heat hours needed to reach the goal.`;
    if (gap.key === 'power') return `${gap.shortfallKwh.toFixed(1)} more usable kWh needed (about ${gap.suggestedRawKwh.toLocaleString()} kWh of stored capacity).`;
    return '';
  };

  const addShortfall = async (gap) => {
    setAddingKey(gap.key);
    await onAddShortfall(gap);
    setAddingKey(null);
  };

  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2"><SearchCheck size={14}/> Readiness Gaps</h3>
      {shortfalls.length === 0 ? (
        <p className="text-sm font-bold text-emerald-600">Every readiness goal is currently met.</p>
      ) : (
        <div className="space-y-3">
          {shortfalls.map(gap => (
            <div key={gap.key} className="flex items-start justify-between gap-3 bg-slate-50 rounded-2xl p-4">
              <div>
                <div className="font-black text-slate-800 text-sm">{gap.label}</div>
                <div className="text-xs text-slate-600 font-bold">{describe(gap)}</div>
              </div>
              {addableKeys.has(gap.key) && (
                <button
                  aria-label={`Add ${gap.label.toLowerCase()} shortfall to shopping list`}
                  onClick={() => addShortfall(gap)}
                  disabled={addingKey === gap.key}
                  className="shrink-0 text-[10px] font-black px-3 py-2.5 rounded-full bg-blue-600 text-white uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                >
                  {addingKey === gap.key ? <RefreshCw className="animate-spin" size={14}/> : 'Add to list'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Appliance Manager ---
function ApplianceManager({ appliances, stats, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
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
         <div className="text-3xl font-black text-slate-900">{stats.dailyLoadKwh.toFixed(2)} <span className="text-base font-bold text-slate-600">kWh/day</span></div>
         <div className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-4">Active Daily Demand</div>

         <div className="w-full bg-white p-4 rounded-2xl border border-violet-100 flex justify-between items-center">
            <div className="text-left">
               <div className="text-[10px] font-black uppercase text-slate-600">Stored Power</div>
               <div className="text-lg font-black text-slate-800">{stats.totalPowerKwh.toFixed(1)} kWh</div>
            </div>
            <div className="text-right">
               <div className="text-[10px] font-black uppercase text-slate-600">Est. Runtime</div>
               <div className="text-lg font-black text-emerald-600">{stats.powerDays.toFixed(1)} Days</div>
            </div>
         </div>
      </div>

      {showAdd && (
        <div className="space-y-4 mb-6 animate-in slide-in-from-top-4 duration-300">
          <form onSubmit={submit} className="bg-white border-2 border-violet-100 rounded-[2.5rem] p-7 shadow-2xl space-y-4">
             <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-black uppercase text-violet-600 tracking-widest">{editingId ? 'Edit Device' : 'New Appliance'}</h3>
                {editingId && <button type="button" onClick={async () => { if (await onDelete(editingId)) reset(); }} className="text-red-600 flex items-center gap-1 text-[10px] font-black uppercase"><Trash2 size={12}/> Delete</button>}
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
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] px-1">Devices (Tap Power to Toggle)</h3>
        {appliances.map(app => (
          <div key={app.id} className={`border p-5 rounded-[2.25rem] flex justify-between items-center group shadow-sm transition-all ${app.active !== false ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
             <div className="flex items-center gap-4">
                <button aria-label={`Turn ${app.name} ${app.active !== false ? 'off' : 'on'}`} title={`Turn ${app.name} ${app.active !== false ? 'off' : 'on'}`}
                  onClick={(e) => { e.stopPropagation(); onUpdate(app.id, { active: app.active === false ? true : false }); }}
                  className={`p-3.5 rounded-2xl transition-all active:scale-90 shadow-sm ${app.active !== false ? 'bg-violet-500 text-white shadow-violet-200' : 'bg-slate-200 text-slate-500'}`}
                >
                  <Power size={20} />
                </button>
                <div onClick={() => handleEdit(app)} className="cursor-pointer">
                   <h4 className="font-black text-slate-800 leading-tight">{app.name}</h4>
                   <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">
                    {app.watts}W • {app.hours} hrs/day • {((app.watts * app.hours)/1000).toFixed(2)} kWh
                   </p>
                </div>
             </div>
             <button aria-label={`Edit ${app.name}`} onClick={() => handleEdit(app)} className="text-slate-500 hover:text-violet-600 transition-colors p-2">
               <ChevronRight size={18} />
             </button>
          </div>
        ))}
        {appliances.length === 0 && !showAdd && (
           <div className="text-center py-10 text-slate-600 text-xs font-bold uppercase tracking-widest">No appliances tracked</div>
        )}
      </div>
    </div>
  );
}

// --- Inventory Manager (Reused for Shop) ---
function InventoryManager({ title, items, shoppingList = [], stats, settings, onAdd, onUpdate, onDelete, onBulkDelete, onBulkUpdate, onRestock, onBuy, isShoppingMode }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [sortBy, setSortBy] = useState(''); // 'expiry', 'calories', 'date'
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [formError, setFormError] = useState(null);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkQuantityMode, setBulkQuantityMode] = useState('set');
  const [bulkQuantityValue, setBulkQuantityValue] = useState('');

  const [form, setForm] = useState({
    name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', gallonsPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', fuelType: '', purchaseDate: '', expiryDate: '', barcode: '', recurringDays: ''
  });

  const reset = () => {
    setForm({ name: '', quantity: '', unit: 'units', category: 'Food', caloriesPerUnit: '', hoursPerUnit: '', capacityPerUnit: '', gallonsPerUnit: '', price: '', store: '', emoji: '', image: '', macroTag: '', fuelType: '', purchaseDate: '', expiryDate: '', barcode: '', recurringDays: '' });
    setEditingItem(null);
    setShowAdd(false);
    setFormError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const normalizedName = String(form.name || '').trim().toLowerCase();
    const normalizedBarcode = String(form.barcode || '').trim();
    const duplicate = items.some(item => item.id !== editingItem?.id && (
      (item.category === form.category && String(item.name || '').trim().toLowerCase() === normalizedName) ||
      (normalizedBarcode && item.barcode === normalizedBarcode)
    ));
    if (duplicate) {
      setFormError('An item with this name and category, or this barcode, already exists. Edit the existing item or choose a different one.');
      return;
    }
    const payload = {
      ...form,
      quantity: Number(form.quantity),
      caloriesPerUnit: Number(form.caloriesPerUnit),
      hoursPerUnit: Number(form.hoursPerUnit),
      capacityPerUnit: Number(form.capacityPerUnit),
      gallonsPerUnit: Number(form.gallonsPerUnit || 0),
      price: Number(form.price),
      barcode: normalizedBarcode,
      recurringDays: Number(form.recurringDays || 0),
    };
    if (editingItem) { if (!await onUpdate(editingItem.id, payload)) return; }
    else if (!await onAdd(payload)) return;
    reset();
  };

  const applyBulkCategory = async () => {
    if (!bulkCategory) return;
    if (await onBulkUpdate([...selectedIds], {category: bulkCategory})) setBulkCategory('');
  };
  const applyBulkQuantity = async () => {
    const value = Number(bulkQuantityValue);
    if (!Number.isFinite(value)) return;
    if (await onBulkUpdate([...selectedIds], {quantity: {mode: bulkQuantityMode, value}})) setBulkQuantityValue('');
  };

  const handleEdit = (item) => { setForm(item); setEditingItem(item); setShowAdd(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const totalShopCost = useMemo(() => items.reduce((acc, i) => acc + (Number(i.price||0) * Number(i.quantity||0)), 0), [items]);

  // Supplies that have not lapsed yet but will within 90 days, soonest first. Items already on
  // the shopping list are left out so "replace" does not queue a second copy of the same thing.
  const rotationQueue = useMemo(() => {
    if (isShoppingMode) return [];
    return expirationQueue(items).filter(row => !shoppingList.some(existing =>
      existing.category === row.item.category && String(existing.name || '').trim().toLowerCase() === String(row.item.name || '').trim().toLowerCase()));
  }, [items, shoppingList, isShoppingMode]);

  const dueRecurringItems = useMemo(() => {
    if (isShoppingMode) return [];
    return items.filter(item => isRecurringDue(item) && !shoppingList.some(row => row.category === item.category && String(row.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase()));
  }, [items, shoppingList, isShoppingMode]);

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
          <button aria-label="Sort by expiry date" title="Sort by expiry date" onClick={() => setSortBy(prev => prev === 'expiry' ? '' : 'expiry')} className={`p-2 rounded-full ${sortBy === 'expiry' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
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
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-blue-800">{selectedIds.size} selected</span>
            <button aria-label="Delete selected items" onClick={async () => { if (await onBulkDelete([...selectedIds])) setSelectedIds(new Set()); }} className="text-red-700 font-black">Delete selected</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Set category for selected items" value={bulkCategory} onChange={e => setBulkCategory(e.target.value)} className="bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs font-bold">
              <option value="">Set category…</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button aria-label="Apply category to selected items" onClick={applyBulkCategory} disabled={!bulkCategory} className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-black disabled:opacity-40">Apply</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Bulk quantity mode" value={bulkQuantityMode} onChange={e => setBulkQuantityMode(e.target.value)} className="bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs font-bold">
              <option value="set">Set quantity to</option>
              <option value="delta">Adjust quantity by</option>
            </select>
            <input aria-label="Bulk quantity value" type="number" step="any" value={bulkQuantityValue} onChange={e => setBulkQuantityValue(e.target.value)} placeholder="0" className="w-20 bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs font-bold" />
            <button aria-label="Apply quantity change to selected items" onClick={applyBulkQuantity} disabled={bulkQuantityValue === ''} className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-black disabled:opacity-40">Apply</button>
          </div>
        </div>
      )}

      {dueRecurringItems.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-sm">
          <span className="font-bold text-amber-800">{dueRecurringItems.length} item{dueRecurringItems.length > 1 ? 's' : ''} due for restock</span>
          <button aria-label="Add due recurring items to shopping list" onClick={async () => { if (await onRestock(dueRecurringItems)) alert('Added due items to your shopping list.'); }} className="text-amber-700 font-black">Add to shopping list</button>
        </div>
      )}

      {rotationQueue.length > 0 && (
        <section aria-labelledby="rotation-queue-heading" className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 mb-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="rotation-queue-heading" className="text-[10px] font-black uppercase tracking-widest text-orange-800 flex items-center gap-2"><Calendar size={12}/> Rotation queue — use these first</h3>
            <button aria-label="Add every item in the rotation queue to the shopping list" onClick={async () => { if (await onRestock(rotationQueue.map(row => row.item))) alert('Queued replacements onto your shopping list.'); }} className="text-orange-700 font-black text-[10px] uppercase">Replace all</button>
          </div>
          <ul className="space-y-2">
            {rotationQueue.map(({ item, daysRemaining, window: windowDays }) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-slate-700 truncate">
                  {item.name}
                  <span className="ml-2 text-[9px] font-black uppercase bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded">
                    {daysRemaining === 0 ? 'Today' : `${daysRemaining}d`} · ≤{windowDays}d
                  </span>
                </span>
                <button aria-label={`Queue a replacement for ${item.name}`} onClick={async () => { if (await onRestock([item])) alert(`Queued a replacement for ${item.name}.`); }} className="text-orange-700 font-black text-[10px] uppercase shrink-0">Replace</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showAdd && (
        <div className="space-y-4 mb-6 animate-in slide-in-from-top-4 duration-300">
          <form onSubmit={submit} className="bg-white border-2 border-blue-100 rounded-[2.5rem] p-6 shadow-2xl space-y-4">
            <div className="flex justify-between mb-2">
              <h3 className="text-xs font-black uppercase text-blue-600">{editingItem ? 'Edit Item' : 'New Supply'}</h3>
              {editingItem && <button type="button" onClick={async () => { if (await onDelete(editingItem.id)) reset(); }} className="text-red-600 text-[10px] font-black uppercase flex items-center gap-1"><Trash2 size={12}/> Delete</button>}
            </div>

            <div className="flex justify-center mb-4">
               <div className="relative w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center border-2 border-slate-100 overflow-hidden">
                 {form.image ? <img src={form.image} alt="icon" className="w-full h-full object-cover"/> : <span className="text-3xl">{form.emoji || '📦'}</span>}
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><Label>Name</Label><Input val={form.name} set={v => setForm({...form, name: v})} /></div>
              <div><Label>Quantity</Label><Input val={form.quantity} set={v => setForm({...form, quantity: v})} type="number" /></div>
              <div><Label>Unit</Label><Input val={form.unit} set={v => setForm({...form, unit: v})} /></div>

              <div><Label>Purchase Date</Label><Input val={form.purchaseDate} set={v => setForm({...form, purchaseDate: v})} type="date" /></div>
              <div><Label>Expiry Date</Label><Input val={form.expiryDate} set={v => setForm({...form, expiryDate: v})} type="date" /></div>

              <div><Label>Price ($/Unit)</Label><Input val={form.price} set={v => setForm({...form, price: v})} type="number" placeholder="0.00" /></div>
              <div><Label>Category</Label><Select val={form.category} set={v => setForm({...form, category: v})} opts={categories} /></div>

              {isShoppingMode && <div className="col-span-2"><Label>Store</Label><Input val={form.store} set={v => setForm({...form, store: v})} placeholder="e.g. Costco" /></div>}

              <div className="col-span-2">
                <Label>Barcode (optional)</Label>
                <div className="flex gap-2">
                  <div className="flex-1"><Input val={form.barcode} set={v => setForm({...form, barcode: v})} placeholder="Scan or type a barcode" /></div>
                  <BarcodeScanButton onDetected={code => setForm(prev => ({...prev, barcode: code}))} />
                </div>
              </div>
              <div className="col-span-2">
                <Label>Restock every N days (0 = never)</Label>
                <Input val={form.recurringDays} set={v => setForm({...form, recurringDays: v})} type="number" placeholder="e.g. 30" />
              </div>

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
              <div className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">Estimated Cost</div>
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
                 <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                   {isShoppingMode ? <Store size={12} /> : (getCategoryIcon(groupName)?.icon || <Layers size={12} />)}
                   {groupName}
                 </h4>
                 {!isShoppingMode && groupName === 'Food' && (
                   <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                     {groupItems.reduce((acc, i) => acc + (Number(i.quantity||0) * Number(i.caloriesPerUnit||0)), 0).toLocaleString()} kcal
                   </span>
                 )}
                 <div className="flex gap-2">
                   <button onClick={() => setSortBy('expiry')} className={`text-[8px] font-bold px-2 py-0.5 rounded-md ${sortBy === 'expiry' ? 'bg-orange-100 text-orange-800' : 'text-slate-600'}`}>Exp</button>
                   <button onClick={() => setSortBy('calories')} className={`text-[8px] font-bold px-2 py-0.5 rounded-md ${sortBy === 'calories' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-600'}`}>Cal</button>
                 </div>
               </div>
               <div className="space-y-3">
                 {groupItems.map(item => <InventoryItem key={item.id} item={item} selected={selectedIds.has(item.id)} onSelect={checked => setSelectedIds(previous => { const next = new Set(previous); if (checked) next.add(item.id); else next.delete(item.id); return next; })} onClick={() => handleEdit(item)} onBuy={onBuy} />)}
               </div>
             </div>
           ))
        ) : (
           <div className="text-center py-10 text-slate-600 text-xs font-bold uppercase tracking-widest">{items.length ? 'No matching items' : 'List Empty'}</div>
        )}
      </div>
    </div>
  );
}

// --- Emergency Plan ---
function FamilyMembersSection({ family, isEditing, onChange }) {
  const updateMember = (i, patch) => onChange(family.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  const removeMember = (i) => onChange(family.filter((_, idx) => idx !== i));
  const addMember = (kind) => onChange([...family, { name: '', role: kind === 'pet' ? 'Pet' : '', dob: '', kind, caloriesPerDay: '', waterGallonsPerDay: '' }]);
  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Household Tracking</h3>
        {isEditing && (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => addMember('person')} className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Add person</button>
            <button type="button" onClick={() => addMember('pet')} className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Add pet</button>
          </div>
        )}
      </div>
      {family.length === 0 && !isEditing && <p className="text-xs text-slate-500 font-bold">No household members added yet.</p>}
      <div className="space-y-4">
        {family.map((m, i) => isEditing ? (
          <div key={i} className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-slate-500">{m.kind === 'pet' ? 'Pet' : 'Person'} {i + 1}</span>
              <button type="button" aria-label={`Remove ${m.name || 'member'}`} onClick={() => removeMember(i)} className="text-red-600 p-1"><Trash2 size={14}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input val={m.name} set={v => updateMember(i, { name: v })} /></div>
              <div><Label>Role</Label><Input val={m.role} set={v => updateMember(i, { role: v })} placeholder={m.kind === 'pet' ? 'Dog, Cat…' : 'Adult, Child…'} /></div>
              <div className="col-span-2"><Label>{m.kind === 'pet' ? 'Date of birth (optional)' : 'Date of birth'}</Label><Input val={m.dob} set={v => updateMember(i, { dob: v })} type="date" /></div>
              <div><Label>Calories per day</Label><Input val={m.caloriesPerDay ?? ''} set={v => updateMember(i, { caloriesPerDay: v })} type="number" placeholder={m.kind === 'pet' ? 'e.g. 700' : 'Household default'} /></div>
              <div><Label>Water gal per day</Label><Input val={m.waterGallonsPerDay ?? ''} set={v => updateMember(i, { waterGallonsPerDay: v })} type="number" placeholder={m.kind === 'pet' ? 'e.g. 0.25' : 'Household default'} /></div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {m.kind === 'pet'
                ? 'Enter what this animal actually eats and drinks — a pet with blank figures counts for nothing in readiness.'
                : 'Leave blank to count this person at the household defaults from Household settings.'}
            </p>
          </div>
        ) : (
          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-4 last:border-0 last:pb-0">
             <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center font-black text-xl">{m.name[0]}</div>
                <div><div className="font-black text-slate-800">{m.name}</div><div className="text-[10px] text-slate-600 font-bold uppercase">{[m.role, m.dob, m.kind === 'pet' ? 'Pet' : ''].filter(Boolean).join(' • ')}</div></div>
             </div>
             {m.role === 'Child' && <div className="bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase px-3 py-1 rounded-full">Priority</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

function MeetingPointsSection({ primary, secondary, isEditing, onPrimaryChange, onSecondaryChange }) {
  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">Meeting Points</h3>
      {isEditing ? (
        <div className="grid grid-cols-1 gap-4">
          <div><Label>Primary</Label><Input val={primary} set={onPrimaryChange} placeholder="e.g. End of the driveway" /></div>
          <div><Label>Secondary (out of neighborhood)</Label><Input val={secondary} set={onSecondaryChange} placeholder="e.g. Community center on Main St" /></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-4 bg-slate-50 rounded-2xl">
            <div className="text-[10px] font-black uppercase text-slate-500">Primary</div>
            <div className="font-black text-slate-800 text-sm">{primary || 'Not set'}</div>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl">
            <div className="text-[10px] font-black uppercase text-slate-500">Secondary</div>
            <div className="font-black text-slate-800 text-sm">{secondary || 'Not set'}</div>
          </div>
        </div>
      )}
    </section>
  );
}

function ContactsSection({ contacts, isEditing, onChange }) {
  const updateContact = (i, patch) => onChange(contacts.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const removeContact = (i) => onChange(contacts.filter((_, idx) => idx !== i));
  const addContact = () => onChange([...contacts, { name: '', phone: '', type: '' }]);
  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Emergency Contacts</h3>
        {isEditing && <button type="button" onClick={addContact} className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1"><Plus size={12}/> Add contact</button>}
      </div>
      {contacts.length === 0 && !isEditing && <p className="text-xs text-slate-500 font-bold">No emergency contacts added yet.</p>}
      <div className="space-y-4">
        {contacts.map((c, i) => isEditing ? (
          <div key={i} className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black uppercase text-slate-500">Contact {i + 1}</span>
              <button type="button" aria-label={`Remove ${c.name || 'contact'}`} onClick={() => removeContact(i)} className="text-red-600 p-1"><Trash2 size={14}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input val={c.name} set={v => updateContact(i, { name: v })} /></div>
              <div><Label>Phone</Label><Input val={c.phone} set={v => updateContact(i, { phone: v })} type="tel" /></div>
              <div className="col-span-2"><Label>Type</Label><Input val={c.type} set={v => updateContact(i, { type: v })} placeholder="Out-of-area, Neighbor, Doctor…" /></div>
            </div>
          </div>
        ) : (
          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-4 last:border-0 last:pb-0">
             <div>
               <div className="font-black text-slate-800">{c.name}</div>
               <div className="text-[10px] text-slate-600 font-bold uppercase">{[c.type, c.phone].filter(Boolean).join(' • ')}</div>
             </div>
             {c.phone && <a aria-label={`Call ${c.name || c.phone}`} href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} className="p-2 text-blue-500"><Phone size={16}/></a>}
          </div>
        ))}
      </div>
    </section>
  );
}

function EmergencyPlan({ plan, onUpdate, onRunDrill, isAiLoading, onOpenBinder, reminders = [], checklistChecks = [], onAddReminder, onUpdateReminder, onDeleteReminder, onCompleteReminder, onSnoozeReminder, onToggleChecklistItem }) {
  const [isEditing, setIsEditing] = useState(false);
  const [spot, setSpot] = useState(plan?.shelterSpot || '');
  const [family, setFamily] = useState(plan?.family || []);
  const [contacts, setContacts] = useState(plan?.contacts || []);
  const [meetingPrimary, setMeetingPrimary] = useState(plan?.meetingPoints?.primary || '');
  const [meetingSecondary, setMeetingSecondary] = useState(plan?.meetingPoints?.secondary || '');
  const [saveError, setSaveError] = useState(null);
  const resetFromPlan = () => {
    setSpot(plan?.shelterSpot || '');
    setFamily(plan?.family || []);
    setContacts(plan?.contacts || []);
    setMeetingPrimary(plan?.meetingPoints?.primary || '');
    setMeetingSecondary(plan?.meetingPoints?.secondary || '');
  };
  useEffect(() => { if (!isEditing) resetFromPlan(); }, [plan, isEditing]);

  const startEditing = () => setIsEditing(true);
  const cancelEditing = () => { resetFromPlan(); setSaveError(null); setIsEditing(false); };
  const saveEditing = async () => {
    setSaveError(null);
    const cleanedFamily = family.map(m => ({
      name: (m.name || '').trim(), role: (m.role || '').trim(), dob: (m.dob || '').trim(),
      kind: m.kind === 'pet' ? 'pet' : 'person',
      // A blank field stays blank rather than becoming 0: it means "use the household default"
      // for a person and "not counted yet" for a pet (see householdNeeds in shared/readiness.js).
      caloriesPerDay: String(m.caloriesPerDay ?? '').trim() === '' ? '' : Number(m.caloriesPerDay),
      waterGallonsPerDay: String(m.waterGallonsPerDay ?? '').trim() === '' ? '' : Number(m.waterGallonsPerDay),
    }));
    const cleanedContacts = contacts.map(c => ({ name: (c.name || '').trim(), phone: (c.phone || '').trim(), type: (c.type || '').trim() }));
    // A row with some fields filled in but no name (family) or no name/phone (contacts) is
    // refused rather than silently dropped below — only a row nothing was ever typed into
    // (e.g. "Add member" clicked but never filled in) is safe to discard without telling anyone.
    if (cleanedFamily.some(m => !m.name && (m.role || m.dob))) { setSaveError('Give each household member a name, or remove the empty row, before saving.'); return; }
    if (cleanedContacts.some(c => !c.name && !c.phone && c.type)) { setSaveError('Give each contact a name or phone number, or remove the empty row, before saving.'); return; }
    try {
      const ok = await onUpdate({
        ...plan,
        shelterSpot: spot,
        family: cleanedFamily.filter(m => m.name || m.role || m.dob || m.caloriesPerDay !== '' || m.waterGallonsPerDay !== ''),
        contacts: cleanedContacts.filter(c => c.name || c.phone || c.type),
        meetingPoints: { primary: meetingPrimary.trim(), secondary: meetingSecondary.trim() },
      });
      if (!ok) { setSaveError('Could not save plan. Please retry.'); return; }
      setIsEditing(false);
    } catch { setSaveError('Could not save plan. Please retry.'); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-xl font-black text-slate-800">Family Hub</h2>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button onClick={cancelEditing} className="text-[10px] font-black px-5 py-2.5 rounded-full bg-slate-100 text-slate-600 uppercase tracking-widest">
              Cancel
            </button>
          )}
          <button onClick={isEditing ? saveEditing : startEditing} className="text-[10px] font-black px-6 py-2.5 rounded-full bg-blue-50 text-blue-600 uppercase tracking-widest">
            {isEditing ? "Save" : "Edit"}
          </button>
        </div>
      </div>
      {saveError && <p role="alert" className="text-xs font-bold text-red-600 px-1">{saveError}</p>}

      <button onClick={onRunDrill} disabled={isAiLoading} className="w-full bg-indigo-50 text-indigo-700 py-4 rounded-[2.5rem] flex items-center justify-center gap-2 font-black text-xs uppercase tracking-widest border border-indigo-100 active:scale-95 transition-all">
        {isAiLoading ? <RefreshCw className="animate-spin" size={16}/> : <Siren size={16}/>}
        Run Emergency Simulation
      </button>

      <button onClick={onOpenBinder} className="w-full bg-slate-50 text-slate-700 py-4 rounded-[2.5rem] flex items-center justify-center gap-2 font-black text-xs uppercase tracking-widest border border-slate-200 active:scale-95 transition-all">
        <BookOpen size={16}/>
        Printable Emergency Binder
      </button>

      <FamilyMembersSection family={isEditing ? family : (plan?.family || [])} isEditing={isEditing} onChange={setFamily} />

      <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">Storm Point</h3>
        {isEditing ? (
          <textarea className="w-full bg-slate-50 border-2 rounded-2xl p-5 text-sm font-bold min-h-[100px] outline-none" value={spot} onChange={e => setSpot(e.target.value)} />
        ) : (
          <div className="p-5 bg-orange-50 rounded-3xl border border-orange-100 font-black text-slate-700 italic text-sm">"{plan?.shelterSpot}"</div>
        )}
      </section>

      <MeetingPointsSection
        primary={isEditing ? meetingPrimary : (plan?.meetingPoints?.primary || '')}
        secondary={isEditing ? meetingSecondary : (plan?.meetingPoints?.secondary || '')}
        isEditing={isEditing}
        onPrimaryChange={setMeetingPrimary}
        onSecondaryChange={setMeetingSecondary}
      />

      <ContactsSection contacts={isEditing ? contacts : (plan?.contacts || [])} isEditing={isEditing} onChange={setContacts} />

      <RemindersSection reminders={reminders} onAdd={onAddReminder} onUpdate={onUpdateReminder} onDelete={onDeleteReminder} onComplete={onCompleteReminder} onSnooze={onSnoozeReminder} />
      <ChecklistsSection checklistChecks={checklistChecks} onToggle={onToggleChecklistItem} />

      {/* Survival Sync Links Moved Here */}
      <div className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm mt-6">
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">Survival Sync</h3>
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
                <div className="text-[9px] text-slate-600 font-mono uppercase">{link.url.replace('https://', '')}</div>
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500"/>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Maintenance Reminders ---
function getReminderIcon(category) {
  switch (category) {
    case 'Water Rotation': return <Droplets size={20}/>;
    case 'Batteries': return <Battery size={20}/>;
    case 'Generator Test': return <Zap size={20}/>;
    case 'Medication': return <Shield size={20}/>;
    default: return <ClipboardList size={20}/>;
  }
}
const emptyReminderForm = () => ({ title: '', category: 'Water Rotation', recurringDays: 90, notes: '', startDate: todayLocal() });

function RemindersSection({ reminders, onAdd, onUpdate, onDelete, onComplete, onSnooze }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyReminderForm);

  const reset = () => { setForm(emptyReminderForm()); setEditingId(null); setShowAdd(false); };
  const submit = async (e) => {
    e.preventDefault();
    const data = { ...form, recurringDays: Number(form.recurringDays) };
    if (editingId) { if (!await onUpdate(editingId, data)) return; }
    else if (!await onAdd(data)) return;
    reset();
  };
  const handleEdit = (reminder) => {
    setForm({ title: reminder.title, category: reminder.category, recurringDays: reminder.recurringDays, notes: reminder.notes, startDate: reminder.startDate || todayLocal() });
    setEditingId(reminder.id);
    setShowAdd(true);
  };

  const sorted = useMemo(() => [...reminders].sort((a, b) => (effectiveReminderDueDate(a) || '9999-99-99').localeCompare(effectiveReminderDueDate(b) || '9999-99-99')), [reminders]);

  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2"><ClipboardList size={14}/> Maintenance Reminders</h3>
        <button aria-label={showAdd ? 'Cancel adding reminder' : 'Add reminder'} onClick={() => showAdd ? reset() : setShowAdd(true)} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1">
          {showAdd ? 'Cancel' : <><Plus size={14}/> Add</>}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="space-y-3 bg-slate-50 rounded-2xl p-5 mb-4">
          <div className="flex justify-between items-center">
            <h4 className="text-[10px] font-black uppercase text-blue-600">{editingId ? 'Edit Reminder' : 'New Reminder'}</h4>
            {editingId && <button type="button" onClick={async () => { if (await onDelete(editingId)) reset(); }} className="text-red-600 text-[10px] font-black uppercase flex items-center gap-1"><Trash2 size={12}/> Delete</button>}
          </div>
          <div><Label>Title</Label><Input val={form.title} set={v => setForm({...form, title: v})} placeholder="e.g. Rotate stored water" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Category</Label><Select val={form.category} set={v => setForm({...form, category: v})} opts={reminderCategories} /></div>
            <div><Label>Repeat every (days)</Label><Input val={form.recurringDays} set={v => setForm({...form, recurringDays: v})} type="number" /></div>
          </div>
          <div><Label>Start date</Label><Input val={form.startDate} set={v => setForm({...form, startDate: v})} type="date" /></div>
          <div><Label>Notes (optional)</Label><Input val={form.notes} set={v => setForm({...form, notes: v})} placeholder="Any details" /></div>
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-black text-sm">{editingId ? 'Save Changes' : 'Add Reminder'}</button>
        </form>
      )}

      <div className="space-y-3">
        {sorted.map(reminder => {
          const due = effectiveReminderDueDate(reminder);
          const overdue = isReminderOverdue(reminder);
          return (
            <div key={reminder.id} className={`border p-4 rounded-2xl ${overdue ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => handleEdit(reminder)}>
                <div className={`p-2.5 rounded-xl shrink-0 ${overdue ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{getReminderIcon(reminder.category)}</div>
                <div className="min-w-0">
                  <div className="font-black text-slate-800 text-sm truncate">{reminder.title}</div>
                  <div className="text-[10px] font-bold text-slate-600 uppercase">{reminder.category} • Every {reminder.recurringDays}d</div>
                  <div className={`text-[10px] font-black uppercase mt-0.5 ${overdue ? 'text-red-600' : 'text-slate-500'}`}>
                    {due ? (overdue ? `Overdue since ${due}` : `Due ${due}`) : 'No start date set'}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button aria-label={`Mark ${reminder.title} complete`} onClick={() => onComplete(reminder)} className="flex-1 bg-emerald-50 text-emerald-700 py-2 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-1"><CheckCircle size={12}/> Mark Complete</button>
                <button aria-label={`Snooze ${reminder.title} 7 days`} onClick={() => onSnooze(reminder, 7)} className="flex-1 bg-amber-50 text-amber-700 py-2 rounded-xl text-[10px] font-black uppercase">Snooze 7d</button>
              </div>
            </div>
          );
        })}
        {reminders.length === 0 && !showAdd && <p className="text-center py-6 text-slate-600 text-xs font-bold uppercase tracking-widest">No reminders yet</p>}
      </div>
      <ReminderHistoryPanel />
    </section>
  );
}

function ReminderHistoryPanel() {
  const [entries, setEntries] = useState(null);
  useEffect(() => { request('reminder-history').then(r => setEntries(r.entries)).catch(() => setEntries([])); }, []);
  if (!entries) return null;
  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-2"><History size={12}/> Recent checks</h4>
      {entries.length === 0 ? <p className="text-xs text-slate-500">No completed or snoozed reminders yet.</p> : (
        <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-slate-600">
          {entries.map((entry, i) => (
            <li key={i}>
              <span className="font-bold text-slate-800">{entry.reminderTitle || 'A reminder'}</span> was {entry.event}
              {entry.event === 'snoozed' ? ` until ${entry.eventDate}` : ` on ${entry.eventDate}`} by {entry.actorEmail || 'someone'}
              · <span className="text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Seasonal Checklists ---
function ChecklistsSection({ checklistChecks, onToggle }) {
  const checkedIds = useMemo(() => new Set(checklistChecks.map(c => c.id)), [checklistChecks]);
  const [openSeason, setOpenSeason] = useState(null);
  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4 flex items-center gap-2"><Layers size={14}/> Seasonal Checklists</h3>
      <div className="space-y-3">
        {checklistCatalog.map(({season, label, items}) => {
          const doneCount = items.filter(item => checkedIds.has(`${season}__${item.id}`)).length;
          const open = openSeason === season;
          return (
            <div key={season} className="border border-slate-100 rounded-2xl overflow-hidden">
              <button type="button" aria-expanded={open} onClick={() => setOpenSeason(open ? null : season)} className="w-full flex justify-between items-center px-4 py-3 bg-slate-50">
                <span className="font-black text-slate-800 text-sm">{label}</span>
                <span className={`text-[10px] font-black uppercase ${doneCount === items.length ? 'text-emerald-600' : 'text-slate-500'}`}>{doneCount}/{items.length}</span>
              </button>
              {open && (
                <div className="p-4 space-y-2">
                  {items.map(item => {
                    const id = `${season}__${item.id}`;
                    const checked = checkedIds.has(id);
                    return (
                      <label key={item.id} className="flex items-center gap-3 text-sm">
                        <input type="checkbox" checked={checked} onChange={e => onToggle(season, item.id, e.target.checked)} className="h-4 w-4 accent-blue-600 shrink-0" />
                        <span className={checked ? 'line-through text-slate-400' : 'text-slate-700'}>{item.text}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- Helper Components ---
const Label = ({ children }) => <label className="text-[10px] font-black uppercase text-slate-600 mb-1 block">{children}</label>;
const Input = ({ val, set, type="text", placeholder }) => <input type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold outline-none focus:bg-white focus:border-blue-400 border border-transparent transition-all" value={val ?? ""} onChange={e => set(e.target.value)} placeholder={placeholder} />;
const Select = ({ val, set, opts }) => <select className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold outline-none border border-transparent" value={val ?? ""} onChange={e => set(e.target.value)}>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>;

// Barcode scanning is progressive enhancement: browsers without BarcodeDetector (e.g. Safari)
// just get the manual text input above, which is the required fallback.
function BarcodeScanButton({ onDetected }) {
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const stop = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    setScanning(false);
  };

  useEffect(() => () => stop(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      const tick = async () => {
        if (!videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          if (results.length) { onDetected(results[0].rawValue); stop(); return; }
        } catch { /* keep trying past transient decode errors */ }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      alert('Could not access the camera. Enter the barcode manually.');
      stop();
    }
  };

  if (!supported) return null;

  return (
    <>
      <button type="button" aria-label="Scan barcode" onClick={start} className="px-4 bg-slate-50 text-slate-600 rounded-2xl text-[10px] font-black uppercase flex items-center gap-1 shrink-0">
        <Tag size={14}/> Scan
      </button>
      {scanning && (
        <div role="dialog" aria-modal="true" aria-label="Scan barcode" className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-6">
          <video ref={videoRef} className="w-full max-w-sm rounded-2xl" muted playsInline />
          <button type="button" onClick={stop} className="mt-4 px-6 py-3 bg-white text-slate-900 rounded-2xl font-black text-sm">Cancel</button>
        </div>
      )}
    </>
  );
}

function SummaryCard({ icon, color, label, value, unit, pct }) {
  const colors = { blue: 'bg-blue-50 text-blue-600 bg-blue-500', emerald: 'bg-emerald-50 text-emerald-600 bg-emerald-500', amber: 'bg-amber-50 text-amber-600 bg-amber-500', violet: 'bg-violet-50 text-violet-600 bg-violet-500' };
  const [bg, text, bar] = colors[color].split(' ');
  return (
    <div className="bg-white border border-slate-200 rounded-[2.5rem] p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
         <div className={`p-1.5 rounded-lg ${bg} ${text}`}>{icon}</div>
         <span className="text-[10px] font-black uppercase tracking-widest text-slate-800">{label}</span>
      </div>
      <div className="text-xl font-black text-slate-800 leading-none">{value.toFixed(1)} <span className="text-[9px] font-bold text-slate-600 ml-0.5 uppercase tracking-tighter">{unit}</span></div>
      <div className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
         <div className={`h-full transition-all duration-700 ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export function InventoryItem({ item, onClick, onBuy, selected, onSelect }) {
  const { icon, style } = getCategoryIcon(item.category);
  const price = item.price ? Number(item.price) : 0;
  const totalVal = price * (Number(item.quantity) || 0);

  const getTagColor = (tag) => {
    switch(tag) {
      case 'Carbs': return 'bg-orange-100 text-orange-800';
      case 'Protein': return 'bg-rose-100 text-rose-700';
      case 'Fat': return 'bg-yellow-100 text-yellow-800';
      case 'Balanced': return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const isExpiringSoon = item.expiryDate && new Date(item.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const expired = isExpired(item.expiryDate);

  return (
    <div className={`bg-white border border-slate-200 p-5 rounded-[2.25rem] flex justify-between items-center group shadow-sm active:scale-95 transition-all ${expired ? 'border-red-300 bg-red-50' : ''}`}>
       <div className="flex items-center gap-3 min-w-0">
          {onSelect && <input aria-label={`Select ${item.name}`} type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} className="h-4 w-4 accent-blue-600" />}
          {/* Edit control is scoped to just the icon/name so it doesn't nest the
              checkbox or buy button above inside a single focusable "button" region. */}
          <div role="button" tabIndex="0" aria-label={`Edit ${item.name}`} onClick={onClick} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }} className="flex items-center gap-3 min-w-0 cursor-pointer">
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
                 {isExpiringSoon && <span className="text-[8px] font-bold bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={8}/> {expired ? 'EXPIRED' : 'Expiring Soon'}</span>}
                 <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">
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
       </div>
       <div className="flex items-center gap-2">
         {onBuy && (
           <button aria-label={`Move ${item.name} to inventory`}
             onClick={() => onBuy(item)}
             className="p-2 bg-slate-100 text-slate-500 hover:bg-emerald-100 hover:text-emerald-600 rounded-full transition-colors"
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
      <div className="text-[10px] font-black uppercase text-slate-600 tracking-widest">{label}</div>
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

// Printable/offline fallback for when the app itself is unreachable (dead phone, no network):
// everything a household would need on paper, rendered from the same state already held in
// memory (which itself came from the local cache when offline), with nothing fetched here.
// Replaces the normal app shell entirely while open, so printing needs no print stylesheet to
// hide anything else — this is the only content on the page.
export function EmergencyBinder({ plan, inventory = [], stats, settings, checklistChecks = [], onClose }) {
  const checkedIds = useMemo(() => new Set(checklistChecks.map(c => c.id)), [checklistChecks]);
  const categoryCounts = useMemo(() => {
    const counts = {};
    inventory.forEach(item => { const cat = item.category || 'Uncategorized'; counts[cat] = (counts[cat] || 0) + 1; });
    return counts;
  }, [inventory]);
  const family = plan?.family || [];
  const contacts = plan?.contacts || [];
  const generatedAt = new Date().toLocaleString();

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 max-w-2xl mx-auto font-sans print:p-0">
      <div className="print:hidden flex justify-between items-center gap-3 mb-8">
        <h1 className="text-lg font-black">Emergency Binder</h1>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="px-5 py-2.5 rounded-full bg-blue-600 text-white text-xs font-black uppercase tracking-widest">Print</button>
          <button onClick={onClose} className="px-5 py-2.5 rounded-full bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest">Close</button>
        </div>
      </div>
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-black">NorthStar Prep — Emergency Binder</h1>
        <p className="text-xs text-slate-500">Generated {generatedAt}. Keep a copy where power and network aren't required to read it.</p>
      </div>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Shelter spot</h2>
        <p className="text-sm">{plan?.shelterSpot || 'Not set.'}</p>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Meeting points</h2>
        <p className="text-sm"><strong>Primary:</strong> {plan?.meetingPoints?.primary || 'Not set'}</p>
        <p className="text-sm"><strong>Secondary:</strong> {plan?.meetingPoints?.secondary || 'Not set'}</p>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Household members</h2>
        {family.length === 0 ? <p className="text-sm text-slate-500">None recorded.</p> : (
          <ul className="text-sm space-y-1">
            {family.map((m, i) => <li key={i}>{m.name} — {m.role || 'Household member'}{m.dob ? `, born ${m.dob}` : ''}</li>)}
          </ul>
        )}
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Emergency contacts</h2>
        {contacts.length === 0 ? <p className="text-sm text-slate-500">None recorded.</p> : (
          <ul className="text-sm space-y-1">
            {contacts.map((c, i) => <li key={i}>{c.name}{c.type ? ` (${c.type})` : ''} — {c.phone || 'no phone on file'}</li>)}
          </ul>
        )}
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Readiness summary</h2>
        <ul className="text-sm space-y-1">
          <li>Water: {stats.waterDays.toFixed(1)} of {settings.survivalGoalDays} goal days</li>
          <li>Food: {stats.foodDays.toFixed(1)} of {settings.survivalGoalDays} goal days</li>
          <li>Heat: {stats.totalFuelHours.toFixed(0)} of {settings.heatGoalHours} goal hours</li>
          <li>Power: {stats.totalPowerKwh.toFixed(1)} of {settings.powerGoalKwh} goal kWh</li>
          <li>{stats.lowStock} item{stats.lowStock === 1 ? '' : 's'} low stock, {stats.expired} item{stats.expired === 1 ? '' : 's'} expired</li>
        </ul>
      </section>

      <section className="mb-8 break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Inventory summary</h2>
        {Object.keys(categoryCounts).length === 0 ? <p className="text-sm text-slate-500">No supplies recorded.</p> : (
          <ul className="text-sm space-y-1">
            {Object.entries(categoryCounts).map(([cat, count]) => <li key={cat}>{cat}: {count} item{count === 1 ? '' : 's'}</li>)}
          </ul>
        )}
      </section>

      <section className="break-inside-avoid">
        <h2 className="text-sm font-black uppercase tracking-widest border-b border-slate-300 pb-2 mb-3">Seasonal checklists</h2>
        <div className="space-y-4">
          {checklistCatalog.map(season => (
            <div key={season.season}>
              <h3 className="text-xs font-black uppercase text-slate-600 mb-1">{season.label}</h3>
              <ul className="text-sm space-y-0.5">
                {season.items.map(item => (
                  <li key={item.id}>{checkedIds.has(`${season.season}__${item.id}`) ? '☑' : '☐'} {item.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Header({ hubId, isSyncing, online, pendingSync, lastSyncedAt, onSyncClick, error, onDownload }) {
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
              {error ? 'Sync error' : online ? (pendingSync ? `${pendingSync} queued` : formatRelativeTime(lastSyncedAt)) : 'Offline'}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button aria-current={active ? 'page' : undefined} aria-label={label} onClick={onClick} className={`flex flex-col items-center gap-1.5 p-3 min-w-0 flex-1 transition-all rounded-3xl ${active ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform text-slate-600 ${active ? 'text-blue-600' : ''}`}>{icon}</div>
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
export function useDialogFocus(dialogRef, onClose) {
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
      <h3 className="text-xs font-black uppercase text-slate-600 tracking-widest">Readiness assumptions</h3>
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
function MembersPanel({ currentUserId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' });
  const [inviteLink, setInviteLink] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => request('members').then(setData).catch(err => setError(err.message));
  useEffect(() => { load(); }, []);

  const invite = async e => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const result = await request('members', { type: 'invite', email: inviteForm.email, role: inviteForm.role });
      setInviteLink(`${window.location.origin}${window.location.pathname}?invite=${result.token}`);
      setInviteForm({ email: '', role: 'member' });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const remove = async userId => {
    if (!confirm('Remove this member? They will lose access immediately.')) return;
    setError(null);
    try { await request('members', { type: 'remove', userId }); await load(); } catch (err) { setError(err.message); }
  };
  const revoke = async invitationId => {
    setError(null);
    try { await request('members', { type: 'revoke', invitationId }); await load(); } catch (err) { setError(err.message); }
  };
  const copyLink = () => { if (inviteLink) navigator.clipboard?.writeText(inviteLink).catch(() => {}); };

  if (!data) return <p className="text-xs text-slate-500">Loading household members…</p>;
  return (
    <div className="space-y-3 border-t border-slate-100 pt-5">
      <h3 className="text-xs font-black uppercase text-slate-600 tracking-widest">Household members</h3>
      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      <ul className="space-y-2">
        {data.members.map(m => (
          <li key={m.user_id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-sm">
            <span className="truncate">{m.email} <span className="text-[10px] font-black uppercase text-slate-500">{m.role}</span></span>
            {data.role === 'owner' && m.user_id !== currentUserId && (
              <button onClick={() => remove(m.user_id)} className="text-red-600 text-[10px] font-black uppercase ml-2 shrink-0">Remove</button>
            )}
          </li>
        ))}
      </ul>
      {data.role === 'owner' && (
        <>
          <form onSubmit={invite} className="space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input val={inviteForm.email} set={v => setInviteForm({...inviteForm, email: v})} type="email" placeholder="Invite by email" />
              <Select val={inviteForm.role} set={v => setInviteForm({...inviteForm, role: v})} opts={['member', 'owner']} />
            </div>
            <button type="submit" disabled={busy || !inviteForm.email} className="w-full rounded-xl p-3 bg-slate-900 text-white font-bold text-sm disabled:opacity-50">Create invite link</button>
          </form>
          {inviteLink && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2 text-xs">
              <p className="font-black text-emerald-900">Send this link to the person you invited:</p>
              <input readOnly value={inviteLink} onFocus={e => e.target.select()} className="w-full bg-white rounded-lg p-2 text-[10px] font-mono border border-emerald-200" />
              <button type="button" onClick={copyLink} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 font-black">Copy link</button>
            </div>
          )}
          {data.invitations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase text-slate-500">Pending invitations</p>
              {data.invitations.map(inv => (
                <div key={inv.id} className="flex items-center justify-between bg-amber-50 rounded-xl px-3 py-2 text-xs">
                  <span>{inv.email} · {inv.role}</span>
                  <button onClick={() => revoke(inv.id)} className="text-red-600 font-black uppercase text-[10px]">Revoke</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityPanel() {
  const [entries, setEntries] = useState(null);
  useEffect(() => { request('audit').then(r => setEntries(r.entries)).catch(() => setEntries([])); }, []);
  if (!entries) return null;
  return (
    <div className="space-y-2 border-t border-slate-100 pt-5">
      <h3 className="text-xs font-black uppercase text-slate-600 tracking-widest">Recent activity</h3>
      {entries.length === 0 ? <p className="text-xs text-slate-500">No activity recorded yet.</p> : (
        <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-slate-600">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="font-bold text-slate-800">{e.actor_email || 'Someone'}</span> {e.action}
              {e.item_name ? ` "${e.item_name}"` : ''} · <span className="text-slate-400">{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SyncModal({onClose,onImport,pendingImport,onConfirmImport,onCancelImport,onRestoreBackup,onLogout,settings,onUpdateSettings,currentUserId,onOpenBinder}) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-6">
    <section ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="settings-title" className="bg-white w-full max-w-sm rounded-3xl p-8 space-y-5 max-h-[85vh] overflow-y-auto">
      <h2 id="settings-title" className="text-xl font-black">Household settings</h2>
      <p className="text-sm text-slate-600">Your household syncs across signed-in devices. Import a backup to merge supplies, shopping, appliances and your family plan.</p>
      <button type="button" onClick={onOpenBinder} className="w-full rounded-xl p-3 bg-slate-50 border border-slate-200 text-sm font-bold flex items-center justify-center gap-2"><BookOpen size={16}/> Printable emergency binder</button>
      <label className="block text-sm font-bold">Import JSON backup<input type="file" accept=".json,application/json" onChange={onImport} className="block mt-2 w-full text-xs" /></label>
      {pendingImport && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-2 text-sm">
        <p className="font-black text-amber-900">Backup ready to review</p>
        <p className="text-amber-800">{pendingImport.inventory.length} inventory items, {pendingImport.shoppingList.length} shopping items, {pendingImport.appliances.length} appliances and {pendingImport.plan ? 'a family plan' : 'no family plan'} will be merged by ID.</p>
        {pendingImport.reminders?.length > 0 && <p className="text-amber-800">{pendingImport.reminders.length} maintenance reminders will be merged.</p>}
        {pendingImport.settings && <p className="text-amber-800">Readiness assumptions are included.</p>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onConfirmImport} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white">Merge backup</button><button type="button" onClick={onCancelImport} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-amber-800">Cancel</button></div>
      </div>}
      <SettingsForm settings={settings} onSave={onUpdateSettings} />
      <ServiceHealthPanel />
      <BackupsPanel onRestore={onRestoreBackup} />
      <MembersPanel currentUserId={currentUserId} />
      <ActivityPanel />
      <button onClick={onLogout} className="w-full rounded-xl p-3 bg-slate-100">Sign out</button>
      <button onClick={onClose} className="w-full rounded-xl p-3 bg-slate-900 text-white">Close</button>
    </section>
  </div>;
}

// Operational visibility for whoever runs the deployment: API/database availability now, plus
// the last 24 hours of failed writes, sign-in failures and database latency. Everything shown
// comes from content-free counters (route, outcome, status, latency), never household data.
function ServiceHealthPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { request('health').then(setData).catch(err => setError(err.message)); }, []);
  const metrics = data?.metrics;
  const failing = metrics ? metrics.totals.failedWrites + metrics.totals.serverErrors : 0;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-5">
      <h3 className="text-xs font-black uppercase text-slate-600 tracking-widest">Service health</h3>
      {error && <p role="alert" className="text-xs font-bold text-red-600">API or database unavailable: {error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Checking service health…</p>}
      {data && <p className="text-xs text-slate-600">API and database reachable · {data.latencyMs} ms database round trip.</p>}
      {metrics && <>
        <p className={`text-xs font-bold ${failing ? 'text-red-700' : 'text-emerald-700'}`}>
          {failing ? `${failing} failed request${failing === 1 ? '' : 's'} in the last 24 hours` : 'No failed requests in the last 24 hours'}
        </p>
        <ul className="text-xs text-slate-600 space-y-1">
          <li>{metrics.totals.requests} requests measured · {metrics.totals.failedWrites} failed saves · {metrics.totals.serverErrors} server errors</li>
          <li>{metrics.totals.authFailures} sign-in failures · {metrics.totals.rateLimited} rate-limited attempts</li>
          {metrics.database.probes > 0 && <li>Database latency: {metrics.database.averageLatencyMs} ms average, {metrics.database.maxLatencyMs} ms peak</li>}
          <li>
            {metrics.alerting.webhookConfigured
              ? `Alerts on ${metrics.alerting.thresholdFailures} failures in ${metrics.alerting.windowMinutes} minutes.`
              : 'No alert webhook configured; failures are recorded in the server logs only.'}
          </li>
        </ul>
        <p className="text-[10px] text-slate-500">Counters cover routes, outcomes and timings only — no household contents — and are kept for {metrics.retentionDays} days.</p>
      </>}
    </div>
  );
}

function BackupsPanel({ onRestore }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  useEffect(() => { request('backup').then(setData).catch(err => setError(err.message)); }, []);

  return (
    <div className="space-y-2 border-t border-slate-100 pt-5">
      <h3 className="text-xs font-black uppercase text-slate-600 tracking-widest">Automatic backups</h3>
      {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Loading backup history…</p>}
      {data && !data.configured && <p className="text-xs text-amber-700">Scheduled encrypted backups are not configured for this deployment yet.</p>}
      {data && data.configured && (
        data.backups.some(b => b.status === 'success')
          ? (() => { const latest = data.backups.find(b => b.status === 'success'); return (
              <p className="text-xs text-slate-600">Last successful backup: {new Date(latest.created_at).toLocaleString()} ({latest.inventory_count} supplies, {latest.shopping_count} shopping, {latest.appliance_count} appliances).</p>
            ); })()
          : <p className="text-xs text-slate-600">No successful automatic backup yet.</p>
      )}
      {data && data.backups.length > 0 && (
        <ul className="space-y-1 max-h-40 overflow-y-auto text-xs">
          {data.backups.map(b => (
            <li key={b.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <span className={b.status === 'failed' ? 'text-red-700' : 'text-slate-700'}>
                {new Date(b.created_at).toLocaleString()} · {b.status}{b.status === 'failed' && b.error ? `: ${b.error}` : ''}
              </span>
              {b.status === 'success' && (
                <button type="button" disabled={busyId === b.id} onClick={async () => { setBusyId(b.id); try { await onRestore(b.id); } finally { setBusyId(null); } }} className="text-blue-700 font-black uppercase text-[10px] shrink-0 disabled:opacity-50">
                  {busyId === b.id ? 'Loading…' : 'Preview restore'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function Login({configured,error,onLogin}) {
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState(null);
  const [pending,setPending]=useState(false);
  const submit=async event=>{event.preventDefault();setPending(true);setMessage(null);try{const result=await request('session',{email,password});setPassword('');onLogin(result.user);}catch(error){setMessage(error.message);}finally{setPending(false);}};
  return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-sm space-y-6">
      <Shield className="text-blue-400" size={40}/><h1 className="text-3xl font-black">NorthStar Prep</h1>
      <p className="text-slate-300">Sign in to your household supplies and emergency plan.</p>
      {!configured && <p role="alert" className="text-amber-200">Setup required: connect the database and configure household login in Vercel.</p>}
      {(message||error) && <p role="alert" className="text-red-300">{message||error}</p>}
      <label className="block">Email<input autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl bg-white p-4 text-slate-900"/></label>
      <label className="block">Password<input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl bg-white p-4 text-slate-900"/></label>
      <button disabled={pending||!configured} className="w-full rounded-xl bg-blue-600 p-4 font-bold disabled:opacity-50">{pending?'Signing in…':'Sign in'}</button>
      <p className="text-xs text-slate-400">Household members join by invitation from an existing owner. Ask them for an invite link if you don't have an account yet.</p>
    </form>
  </main>;
}

function AcceptInvite({token,onJoined}) {
  const [status,setStatus]=useState('checking');
  const [invitation,setInvitation]=useState(null);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [message,setMessage]=useState(null);
  const [pending,setPending]=useState(false);
  useEffect(() => {
    request(`invite?token=${encodeURIComponent(token)}`).then(result => {
      if (!result.valid) { setStatus('invalid'); return; }
      setInvitation(result); setEmail(result.email); setStatus('ready');
    }).catch(() => setStatus('invalid'));
  }, [token]);
  const submit = async event => {
    event.preventDefault(); setPending(true); setMessage(null);
    try { const result = await request('invite', {token, email, password}); onJoined(result.user); }
    catch (error) { setMessage(error.message); }
    finally { setPending(false); }
  };
  return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
    <div className="w-full max-w-sm space-y-6">
      <Shield className="text-blue-400" size={40}/><h1 className="text-3xl font-black">NorthStar Prep</h1>
      {status === 'checking' && <p className="text-slate-300">Checking your invitation…</p>}
      {status === 'invalid' && <p role="alert" className="text-red-300">This invitation link is invalid, expired or already used. Ask the household owner for a new one.</p>}
      {status === 'ready' && (
        <form onSubmit={submit} className="space-y-6">
          <p className="text-slate-300">You've been invited to join as a household {invitation.role}. Set a password to create your account.</p>
          {message && <p role="alert" className="text-red-300">{message}</p>}
          <label className="block">Email<input autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl bg-white p-4 text-slate-900"/></label>
          <label className="block">Choose a password<input autoComplete="new-password" type="password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl bg-white p-4 text-slate-900"/></label>
          <button disabled={pending} className="w-full rounded-xl bg-blue-600 p-4 font-bold disabled:opacity-50">{pending?'Joining…':'Join household'}</button>
        </form>
      )}
    </div>
  </main>;
}

export function AiModal({ content, onClose }) {
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
      <div ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title" className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center mb-6">
          <h3 id="ai-modal-title" className="text-xl font-black text-slate-900">{content.title}</h3>
          <button aria-label="Close AI result" onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-500"><X aria-hidden="true" size={16}/></button>
        </div>
        <div className="overflow-y-auto text-sm text-slate-600 leading-relaxed whitespace-pre-wrap flex-1">{content.text}</div>
        <button onClick={onClose} className="mt-6 w-full bg-slate-900 text-white py-4 rounded-2xl font-black">Close</button>
      </div>
    </div>
  );
}

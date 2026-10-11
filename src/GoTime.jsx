import React, { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle, MapPin, Phone, Power, Siren, Users, X } from 'lucide-react';
import { activationModeLabels, checkinStatuses, checkinStatusLabels, goBagCoverage, grabList, lastOutSteps, shelterGuidance } from '../shared/gotime.js';
import { simulateOutage } from '../shared/outage.js';
import { loadGrabChecks, saveGrabChecks } from './offline.js';

const sectionClass = 'bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm';
const headingClass = 'text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-2 mb-3';
const memberLabel = email => String(email || '').split('@')[0] || 'Member';

// Activating the household plan: the one screen to open when something actually happens. Works
// from the state already on this device; only the shared activation and check-ins need a
// connection, and a check-in made offline is sent on reconnect.
export function GoTime({ go, online, plan, kits = [], inventory = [], medications = [], appliances = [], stats, settings, pendingCheckin, onActivate, onStandDown, onCheckin, onClose }) {
  const activation = go?.activation ?? null;
  const [drill, setDrill] = useState(null);
  const [choice, setChoice] = useState('evacuate');
  const [note, setNote] = useState('');
  const [checkinNote, setCheckinNote] = useState('');
  const [busy, setBusy] = useState(false);
  const mode = activation?.mode ?? drill;
  const scope = activation ? `event:${activation.startedAt}` : 'drill';
  const [checked, setChecked] = useState(() => new Set(loadGrabChecks(scope)));
  const [checkedScope, setCheckedScope] = useState(scope);
  if (checkedScope !== scope) { setCheckedScope(scope); setChecked(new Set(loadGrabChecks(scope))); }

  const family = plan?.family || [];
  const sections = useMemo(() => grabList({kits, inventory, medications, family}), [kits, inventory, medications, family]);
  const coverage = useMemo(() => goBagCoverage(family, kits, inventory), [family, kits, inventory]);
  const shelter = useMemo(() => mode === 'shelter' ? shelterGuidance(simulateOutage({inventory, appliances, plan}, settings), stats, settings) : null, [mode, inventory, appliances, plan, settings, stats]);
  const totalRows = sections.reduce((sum, section) => sum + section.rows.length, 0);

  const toggle = id => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next); saveGrabChecks(scope, [...next]);
  };
  const run = async action => { setBusy(true); try { await action(); } finally { setBusy(false); } };

  const myCheckin = go?.checkins?.find(row => row.userId === go.currentUserId);
  const checkinsByUser = new Map((go?.checkins || []).map(row => [row.userId, row]));
  const needHelp = (go?.checkins || []).filter(row => row.status === 'need_help');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className={`${mode ? 'bg-red-700' : 'bg-slate-900'} text-white p-4 sticky top-0 z-50 shadow-xl`}>
        <div className="max-w-xl mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Siren aria-hidden="true" className="w-6 h-6 shrink-0" />
            <h1 className="text-lg font-black tracking-tight truncate">
              {mode ? `${activationModeLabels[mode]}${drill && !activation ? ' (drill)' : ''}` : 'Go time'}
            </h1>
          </div>
          <button aria-label="Close go time" onClick={onClose} className="p-2 bg-white/10 rounded-full"><X aria-hidden="true" size={18}/></button>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4 pb-16 space-y-5">
        {!online && <p role="status" className="bg-amber-100 text-amber-900 rounded-2xl p-4 text-sm font-bold">Offline: this plan is from the last copy on this device. Check-ins are sent when you reconnect.</p>}

        {!mode && (
          <section className={sectionClass} aria-labelledby="go-start-heading">
            <h2 id="go-start-heading" className={headingClass}><Siren size={14}/> Activate the plan</h2>
            <p className="text-sm text-slate-600 mb-4">Activating alerts everyone in the household and opens check-ins. A drill runs only on this device and tells nobody.</p>
            <div role="radiogroup" aria-label="What is happening" className="grid grid-cols-2 gap-3 mb-4">
              {['evacuate', 'shelter'].map(value => (
                <button key={value} role="radio" aria-checked={choice === value} onClick={() => setChoice(value)}
                  className={`rounded-2xl p-4 text-sm font-black border-2 ${choice === value ? 'border-red-600 bg-red-50 text-red-800' : 'border-slate-200 text-slate-700'}`}>
                  {activationModeLabels[value]}
                </button>
              ))}
            </div>
            <label htmlFor="go-note" className="text-[10px] font-black uppercase text-slate-600 mb-1 block">Note for the household (optional)</label>
            <input id="go-note" value={note} onChange={e => setNote(e.target.value)} maxLength={280} placeholder="e.g. Wildfire evacuation order for our zone" className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold border border-slate-200 mb-4" />
            <div className="flex flex-col gap-2">
              <button disabled={busy || !online} onClick={() => run(() => onActivate(choice, note))} className="w-full bg-red-600 disabled:bg-red-300 text-white py-3 rounded-xl font-black text-sm">
                Activate for the household
              </button>
              {!online && <p className="text-xs text-slate-600">Activating needs a connection. You can still run the plan on this device as a drill.</p>}
              <button onClick={() => setDrill(choice)} className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl font-black text-sm">Practice drill on this device</button>
            </div>
          </section>
        )}

        {mode && activation && (
          <section className={sectionClass} aria-labelledby="go-active-heading">
            <h2 id="go-active-heading" className={headingClass}><AlertOctagon size={14}/> Active since {new Date(activation.startedAt).toLocaleString()}</h2>
            <p className="text-sm text-slate-700">Started by {memberLabel(activation.startedBy)}{activation.note ? `: ${activation.note}` : '.'}</p>
          </section>
        )}

        {mode && activation && (
          <section className={sectionClass} aria-labelledby="go-checkin-heading">
            <h2 id="go-checkin-heading" className={headingClass}><Users size={14}/> Check in</h2>
            {needHelp.length > 0 && (
              <p role="alert" className="bg-red-100 text-red-900 rounded-2xl p-3 text-sm font-bold mb-3">
                {needHelp.map(row => memberLabel(row.email)).join(', ')} need{needHelp.length === 1 ? 's' : ''} help
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {checkinStatuses.map(status => (
                <button key={status} aria-pressed={(pendingCheckin?.status ?? myCheckin?.status) === status} disabled={busy}
                  onClick={() => run(() => onCheckin(status, checkinNote))}
                  className={`rounded-2xl p-3 text-xs font-black border-2 ${(pendingCheckin?.status ?? myCheckin?.status) === status ? (status === 'need_help' ? 'border-red-600 bg-red-50 text-red-800' : 'border-emerald-600 bg-emerald-50 text-emerald-800') : 'border-slate-200 text-slate-700'}`}>
                  {checkinStatusLabels[status]}
                </button>
              ))}
            </div>
            <label htmlFor="go-checkin-note" className="text-[10px] font-black uppercase text-slate-600 mb-1 block">Note with your check-in (optional)</label>
            <input id="go-checkin-note" value={checkinNote} onChange={e => setCheckinNote(e.target.value)} maxLength={280} placeholder="e.g. At Grandma's, phone battery low" className="w-full bg-slate-50 rounded-2xl p-3 text-sm font-bold border border-slate-200 mb-3" />
            {pendingCheckin && <p role="status" className="text-xs font-bold text-amber-800 mb-3">Your check-in will be sent when you reconnect.</p>}
            <ul className="space-y-2" aria-label="Household check-ins">
              {(go?.members || []).map(member => {
                const row = checkinsByUser.get(member.userId);
                return (
                  <li key={member.userId} className="flex justify-between items-start gap-3 text-sm border-t border-slate-100 pt-2">
                    <span className="font-bold">{memberLabel(member.email)}{member.userId === go.currentUserId ? ' (you)' : ''}</span>
                    <span className={`text-right text-xs font-black ${!row ? 'text-slate-500' : row.status === 'need_help' ? 'text-red-700' : 'text-emerald-700'}`}>
                      {row ? checkinStatusLabels[row.status] : 'Not checked in'}
                      {row?.note && <span className="block font-normal text-slate-600">{row.note}</span>}
                      {row && <span className="block font-normal text-slate-500">{new Date(row.updatedAt).toLocaleTimeString()}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {mode && (
          <section className={sectionClass} aria-labelledby="go-where-heading">
            <h2 id="go-where-heading" className={headingClass}><MapPin size={14}/> {mode === 'evacuate' ? 'Where to go' : 'Where to shelter'}</h2>
            {mode === 'evacuate' ? (
              <>
                <p className="text-sm"><strong>Primary meeting point:</strong> {plan?.meetingPoints?.primary || 'Not set'}</p>
                <p className="text-sm"><strong>Secondary:</strong> {plan?.meetingPoints?.secondary || 'Not set'}</p>
              </>
            ) : <p className="text-sm"><strong>Shelter spot:</strong> {plan?.shelterSpot || 'Not set'}</p>}
            {(plan?.contacts || []).length > 0 && (
              <ul className="mt-3 space-y-1" aria-label="Emergency contacts">
                {plan.contacts.map((contact, i) => (
                  <li key={i} className="text-sm flex justify-between gap-3">
                    <span>{contact.name}{contact.type ? ` (${contact.type})` : ''}</span>
                    {contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="font-black text-blue-700 flex items-center gap-1"><Phone aria-hidden="true" size={12}/>{contact.phone}</a> : <span className="text-slate-500">no phone</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {mode === 'evacuate' && (
          <>
            {coverage.length > 0 && (
              <section className={sectionClass} aria-labelledby="go-bags-heading">
                <h2 id="go-bags-heading" className={headingClass}><Users size={14}/> Go-bags</h2>
                <ul className="space-y-1">
                  {coverage.map(row => (
                    <li key={row.name} className="text-sm flex justify-between gap-3">
                      <span>{row.name}</span>
                      <span className={`text-xs font-black ${row.status === 'packed' ? 'text-emerald-700' : row.status === 'partial' ? 'text-amber-700' : 'text-red-700'}`}>
                        {row.status === 'none' ? 'No go-bag' : row.status === 'packed' ? 'Packed' : `${row.percent}% packed`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className={sectionClass} aria-labelledby="go-grab-heading">
              <h2 id="go-grab-heading" className={headingClass}><CheckCircle size={14}/> Grab list · {checked.size}/{totalRows}</h2>
              <div className="space-y-5">
                {sections.map(section => (
                  <div key={section.key}>
                    <h3 className="text-sm font-black text-slate-800">{section.title}</h3>
                    {section.subtitle && <p className="text-xs text-slate-500 mb-1">{section.subtitle}</p>}
                    <ul className="space-y-1 mt-1">
                      {section.rows.map(row => (
                        <li key={row.id}>
                          <label className="flex items-start gap-3 text-sm py-1">
                            <input type="checkbox" checked={checked.has(row.id)} onChange={() => toggle(row.id)} className="mt-1 w-5 h-5 shrink-0" />
                            <span className={checked.has(row.id) ? 'line-through text-slate-500' : ''}>
                              {row.label}
                              {row.detail && <span className={`block text-xs ${row.missing ? 'text-red-700 font-bold' : 'text-slate-500'}`}>{row.detail}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {mode === 'shelter' && shelter && (
          <section className={sectionClass} aria-labelledby="go-shelter-heading">
            <h2 id="go-shelter-heading" className={headingClass}><Power size={14}/> Make supplies last {shelter.days} days</h2>
            <ul className="text-sm space-y-2">
              <li className={shelter.water.short ? 'text-red-800 font-bold' : ''}>
                Water: up to {shelter.water.perDay.toFixed(1)} gal/day for the household (need {Number(shelter.water.need).toFixed(1)}).
                {shelter.water.short && ' Not enough for the full goal: fill containers now.'}
              </li>
              <li className={shelter.food.short ? 'text-red-800 font-bold' : ''}>
                Food: up to {Math.round(shelter.food.perDay).toLocaleString()} kcal/day for the household (need {Math.round(shelter.food.need).toLocaleString()}).
              </li>
              {shelter.firstExhausted && <li className="text-red-800 font-bold">{shelter.firstExhausted.label} runs out first, after about {Math.floor(shelter.firstExhausted.runwayHours)} hours.</li>}
            </ul>
            <h3 className="text-sm font-black text-slate-800 mt-4">Turn off to save power</h3>
            {shelter.shedNow.length ? (
              <ul className="text-sm list-disc pl-5 mt-1">{shelter.shedNow.map(name => <li key={name}>{name}</li>)}</ul>
            ) : <p className="text-sm text-slate-600 mt-1">Nothing: stored power covers your active loads for the whole goal.</p>}
            {shelter.shedsCritical && <p className="text-xs font-bold text-red-800 mt-2">Lasting the full goal means turning off loads you marked critical.</p>}
          </section>
        )}

        {mode && (
          <section className={sectionClass} aria-labelledby="go-steps-heading">
            <h2 id="go-steps-heading" className={headingClass}><CheckCircle size={14}/> {mode === 'evacuate' ? 'Before you leave' : 'Right now'}</h2>
            <ol className="text-sm list-decimal pl-5 space-y-1">{lastOutSteps[mode].map(step => <li key={step}>{step}</li>)}</ol>
          </section>
        )}

        {mode && (
          activation
            ? <button disabled={busy || !online} onClick={() => { if (window.confirm('Stand down? This ends the event for everyone in the household.')) run(onStandDown); }} className="w-full bg-slate-900 disabled:bg-slate-400 text-white py-3 rounded-xl font-black text-sm">Stand down (everyone is safe)</button>
            : <button onClick={() => setDrill(null)} className="w-full bg-slate-900 text-white py-3 rounded-xl font-black text-sm">End drill</button>
        )}
      </main>
    </div>
  );
}

// The Dashboard's entry point: a quiet "activate" button normally, a loud banner during an event.
export function GoTimeBanner({ activation, checkins = [], members = [], onOpen }) {
  if (!activation) {
    return (
      <button onClick={onOpen} className="w-full flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-left active:scale-95 transition-all">
        <span className="flex items-center gap-2 font-bold text-slate-800"><Siren aria-hidden="true" size={16} className="text-red-600"/> Go time: activate the plan or run a drill</span>
      </button>
    );
  }
  const help = checkins.filter(row => row.status === 'need_help').length;
  return (
    <button onClick={onOpen} className="w-full flex items-center justify-between gap-3 bg-red-700 text-white rounded-2xl px-4 py-3 text-sm text-left active:scale-95 transition-all">
      <span className="flex items-center gap-2 font-black">
        <Siren aria-hidden="true" size={16}/>
        {activationModeLabels[activation.mode]} in progress · {checkins.length} of {members.length} checked in{help ? ` · ${help} need${help === 1 ? 's' : ''} help` : ''}
      </span>
    </button>
  );
}

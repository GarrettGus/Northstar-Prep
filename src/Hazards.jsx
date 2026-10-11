import React, { useState } from 'react';
import { AlertTriangle, ChevronRight, CloudLightning, LocateFixed, Plus, Trash2, Wind } from 'lucide-react';
import { hazardCatalog, roundCoordinate, selectedHazards } from '../shared/hazards.js';

const inputClass = 'w-full bg-slate-50 rounded-2xl p-3 text-sm font-bold outline-none focus:bg-white focus:border-blue-400 border border-transparent transition-all';
const labelClass = 'text-[10px] font-black uppercase text-slate-600 mb-1 block';

// Active NWS alerts for the household's location, most severe first. Each expands in place so the
// instructions are one tap away without leaving the Dashboard.
export function WeatherAlerts({ alerts, area }) {
  return (
    <section aria-label="Weather alerts" className="mb-6 space-y-2">
      {alerts.map(alert => {
        const severe = alert.severity === 'Extreme' || alert.severity === 'Severe';
        return (
          <details key={alert.id || alert.headline} className={`rounded-2xl border px-4 py-3 text-sm ${severe ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            <summary className="cursor-pointer font-black flex items-center gap-2">
              <CloudLightning aria-hidden="true" size={16}/>
              <span>{alert.event}{area ? ` · ${area}` : ''}</span>
            </summary>
            {alert.headline && <p className="mt-2 font-bold">{alert.headline}</p>}
            {alert.instruction && <p className="mt-2 whitespace-pre-line"><strong>What to do:</strong> {alert.instruction}</p>}
            {alert.description && <p className="mt-2 whitespace-pre-line text-xs">{alert.description}</p>}
            {alert.ends && <p className="mt-2 text-xs font-bold">Until {new Date(alert.ends).toLocaleString()}</p>}
          </details>
        );
      })}
      <p className="text-[10px] text-slate-500 px-1">Source: National Weather Service. Always follow instructions from local officials.</p>
    </section>
  );
}

// Where the household is, what it faces there, and its own quick links. Edited together with the
// rest of the Family Hub plan (the parent owns the draft state and the single Save).
export function HazardProfileSection({ plan, weather, isEditing, location, hazards, links, onLocationChange, onHazardsChange, onLinksChange }) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  const saved = plan || {};
  const chosen = selectedHazards(isEditing ? {hazards} : saved);
  const savedLinks = saved.links || [];

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocateError('This browser cannot share its location. Enter coordinates instead.'); return; }
    setLocating(true); setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      position => {
        onLocationChange({...location, latitude: roundCoordinate(position.coords.latitude), longitude: roundCoordinate(position.coords.longitude)});
        setLocating(false);
      },
      () => { setLocateError('Could not get your location. Enter coordinates instead.'); setLocating(false); },
      {enableHighAccuracy: false, timeout: 10000, maximumAge: 3600000},
    );
  };
  const toggleHazard = id => onHazardsChange(hazards.includes(id) ? hazards.filter(h => h !== id) : [...hazards, id]);
  const updateLink = (i, patch) => onLinksChange(links.map((link, idx) => idx === i ? {...link, ...patch} : link));

  const resourceLinks = [
    ...(weather?.office ? [{title: `NWS forecast office (${weather.office.id})`, url: weather.office.url, icon: <Wind size={20}/>, color: 'bg-orange-50 text-orange-600'}] : []),
    ...savedLinks.map(link => ({...link, icon: <ChevronRight size={20}/>, color: 'bg-blue-50 text-blue-600'})),
    ...selectedHazards(saved).map(hazard => ({title: `${hazard.label}: what to do (Ready.gov)`, url: hazard.readyUrl, icon: <AlertTriangle size={20}/>, color: 'bg-red-50 text-red-600'})),
  ];
  const hasLocation = saved.location && saved.location.latitude !== '' && saved.location.latitude !== undefined;

  return (
    <section className="bg-white p-7 rounded-[2.5rem] border border-slate-200 shadow-sm mt-6">
      <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">Local Hazards & Resources</h3>

      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="hazard-location-label" className={labelClass}>Location name</label>
            <input id="hazard-location-label" className={inputClass} value={location.label ?? ''} onChange={e => onLocationChange({...location, label: e.target.value})} placeholder="e.g. Home" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="hazard-latitude" className={labelClass}>Latitude</label>
              <input id="hazard-latitude" inputMode="decimal" className={inputClass} value={location.latitude ?? ''} onChange={e => onLocationChange({...location, latitude: e.target.value})} placeholder="44.98" />
            </div>
            <div>
              <label htmlFor="hazard-longitude" className={labelClass}>Longitude</label>
              <input id="hazard-longitude" inputMode="decimal" className={inputClass} value={location.longitude ?? ''} onChange={e => onLocationChange({...location, longitude: e.target.value})} placeholder="-93.27" />
            </div>
          </div>
          <button type="button" onClick={useMyLocation} disabled={locating} className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1"><LocateFixed size={12}/> {locating ? 'Locating…' : 'Use my location'}</button>
          {locateError && <p role="alert" className="text-xs font-bold text-red-600">{locateError}</p>}
          <p className="text-[11px] text-slate-500">Rounded to about 1 km. Used only to look up National Weather Service alerts for your area (US only).</p>

          <fieldset>
            <legend className={labelClass}>Hazards where you live</legend>
            <div className="grid grid-cols-2 gap-2">
              {hazardCatalog.map(hazard => (
                <label key={hazard.id} className="flex items-center gap-2 text-sm font-bold text-slate-700 bg-slate-50 rounded-xl px-3 py-2">
                  <input type="checkbox" checked={hazards.includes(hazard.id)} onChange={() => toggleHazard(hazard.id)} />
                  {hazard.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <span className={labelClass}>Quick links</span>
            <div className="space-y-2">
              {links.map((link, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input aria-label="Link title" className={`${inputClass} flex-1`} value={link.title} onChange={e => updateLink(i, {title: e.target.value})} placeholder="e.g. Power outage map" />
                  <input aria-label="Link address" className={`${inputClass} flex-1`} value={link.url} onChange={e => updateLink(i, {url: e.target.value})} placeholder="https://" />
                  <button type="button" aria-label={`Remove ${link.title || 'link'}`} onClick={() => onLinksChange(links.filter((_, idx) => idx !== i))} className="text-red-600 p-1"><Trash2 size={14}/></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => onLinksChange([...links, {title: '', url: ''}])} className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1 mt-2"><Plus size={12}/> Add link</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {hasLocation ? <>{saved.location.label || 'Saved location'}{weather?.area ? ` (${weather.area})` : ''}</> : 'No location set. Edit the plan to add one and get weather alerts.'}
          </p>
          {hasLocation && weather && !weather.available && (
            <p className="text-xs text-slate-500">{weather.reason === 'outside_us' ? 'Weather alerts are only available for US locations.' : 'Weather alerts could not be loaded right now.'}</p>
          )}
          {hasLocation && weather?.available && weather.alerts.length === 0 && <p className="text-xs font-bold text-emerald-700">No active weather alerts.</p>}
          {chosen.length > 0 && (
            <ul aria-label="Chosen hazards" className="flex flex-wrap gap-2">
              {chosen.map(hazard => <li key={hazard.id} className="px-3 py-1 rounded-full bg-red-50 text-red-800 text-[10px] font-black uppercase">{hazard.label}</li>)}
            </ul>
          )}
          {resourceLinks.length > 0 && (
            <div className="grid gap-3">
              {resourceLinks.map(link => (
                <a key={link.url + link.title} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-5 p-4 rounded-2xl hover:bg-slate-50 transition-colors group">
                  <div className={`p-3 rounded-xl ${link.color}`}>{link.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-sm text-slate-800">{link.title}</div>
                    <div className="text-[9px] text-slate-600 font-mono uppercase truncate">{link.url.replace(/^https?:\/\//, '')}</div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500"/>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

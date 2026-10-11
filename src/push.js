import { request } from './api.js';

// Browser side of push notifications. The service worker is only registered in production builds
// (src/main.jsx), so in development every function here reports "unsupported".
export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentSubscription() {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url) {
  const padded = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

export async function subscribe(publicKey) {
  const reg = await registration();
  if (!reg) throw new Error('Notifications need the installed app (open the deployed site, not the dev server).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings.');
  const subscription = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytes(publicKey)});
  await request('push', {type: 'subscribe', subscription: subscription.toJSON()});
  return subscription;
}

// Removes this browser's subscription from the server and the push service. Best effort: used on
// sign-out, where nothing should stop the sign-out itself.
export async function unsubscribe() {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  try { await request('push', {type: 'unsubscribe', endpoint: subscription.endpoint}); } catch { /* signed out or offline */ }
  try { await subscription.unsubscribe(); } catch { /* already gone */ }
}

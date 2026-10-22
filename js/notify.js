// In-app + system notifications with the matching sound/vibration.
import { feedback } from './feedback.js';
import { toast } from './ui.js';
import { speak } from './voice.js';

const COLOUR = { success: 'green', money: 'green', error: 'red', newTask: 'blue', waiting: 'yellow' };

// notify(kind, text, {speakIt})
export function notify(kind, text, { speakIt = false } = {}) {
  feedback(kind);
  toast(text, COLOUR[kind] || 'blue');
  if (speakIt) speak(text);
  // System notification only when the app is in the background and the user allowed it.
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification('AIEC', {
        body: text, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [40], tag: kind,
      }));
    }
  } catch { /* ignore */ }
}

export async function askNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

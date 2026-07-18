'use client';

import { useEffect, useState } from 'react';
import { BellOff, BellRing } from 'lucide-react';

type State = 'checking' | 'unsupported' | 'unconfigured' | 'blocked' | 'off' | 'on' | 'working' | 'error';

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function PushPreferences() {
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState('กำลังตรวจสอบอุปกรณ์นี้…');

  useEffect(() => {
    const check = async () => {
      await Promise.resolve();
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('unsupported'); setMessage('เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับ Web Push'); return;
      }
      if (Notification.permission === 'denied') {
        setState('blocked'); setMessage('การแจ้งเตือนถูกบล็อก กรุณาเปลี่ยนสิทธิ์ใน Browser Settings'); return;
      }
      try {
        const [registration, config] = await Promise.all([navigator.serviceWorker.ready, fetch('/api/push/subscriptions').then((response) => response.json())]);
        if (!config.data?.configured) { setState('unconfigured'); setMessage('ระบบ Push ยังไม่ได้ตั้งค่าบน server'); return; }
        const subscription = await registration.pushManager.getSubscription();
        setState(subscription ? 'on' : 'off'); setMessage(subscription ? 'อุปกรณ์นี้เปิดรับ Push แล้ว' : 'Push ยังปิดอยู่สำหรับอุปกรณ์นี้');
      } catch { setState('error'); setMessage('ตรวจสอบสถานะ Push ไม่สำเร็จ'); }
    };
    void check();
  }, []);

  async function enable() {
    setState('working');
    try {
      // Permission is requested only from this explicit user action.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'blocked' : 'off'); setMessage('ยังไม่ได้อนุญาตการแจ้งเตือน'); return; }
      const configResponse = await fetch('/api/push/subscriptions'); const config = await configResponse.json();
      if (!configResponse.ok || !config.data?.publicKey) throw new Error('Push is not configured');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.data.publicKey) });
      const response = await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subscription.toJSON()) });
      if (!response.ok) { await subscription.unsubscribe(); throw new Error('Subscription was not saved'); }
      setState('on'); setMessage('อุปกรณ์นี้เปิดรับ Push แล้ว');
    } catch { setState('error'); setMessage('เปิด Push ไม่สำเร็จ กรุณาลองใหม่'); }
  }

  async function disable() {
    setState('working');
    try {
      const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        if (!response.ok) throw new Error('Subscription was not removed');
        await subscription.unsubscribe();
      }
      setState('off'); setMessage('ปิด Push สำหรับอุปกรณ์นี้แล้ว');
    } catch { setState('error'); setMessage('ปิด Push ไม่สำเร็จ กรุณาลองใหม่'); }
  }

  const canEnable = state === 'off' || state === 'error';
  const canDisable = state === 'on';
  return <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
    <div className="flex items-start gap-3">{state === 'on' ? <BellRing className="mt-0.5 text-[#D4FF00]" size={20} /> : <BellOff className="mt-0.5 text-slate-400" size={20} />}
      <div className="min-w-0 flex-1"><p className="font-medium text-white">Web Push บนอุปกรณ์นี้</p><p className="mt-1 text-xs text-slate-400" role="status">{message}</p></div>
      {canEnable && <button type="button" onClick={() => void enable()} className="min-h-11 rounded-lg bg-[#D4FF00] px-4 text-sm font-semibold text-slate-950">เปิดใช้</button>}
      {canDisable && <button type="button" onClick={() => void disable()} className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm text-white">ปิด</button>}
    </div>
  </div>;
}

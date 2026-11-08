// 读这份邀请自己的使用记录；列表里新出现别的设备不会被当成这次配对成功。
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { BrowserPairingCodeResponse, BrowserPairingStatus } from '../../api/shared.ts';

/** 只在添加设备的面板开着时轮询；手机确认后最多两秒回到原设备。 */
const POLL_MS = 2000;
const CLOCK_MS = 1000;

export function usePairingInvitation(onConnected: () => void) {
  const api = useApi();
  const [invitation, setInvitation] = useState<BrowserPairingCodeResponse | null>(null);
  const [status, setStatus] = useState<BrowserPairingStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(Date.now);
  const first = useRef<Promise<BrowserPairingCodeResponse> | null>(null);
  const connected = useRef(onConnected);
  const reported = useRef<string | null>(null);
  const serverClock = useRef({ at: Date.now(), remaining: 0 });
  const mounted = useRef(false);
  connected.current = onConnected;

  const install = (next: BrowserPairingCodeResponse): void => {
    serverClock.current = { at: Date.now(), remaining: Date.parse(next.expiresAt) - Date.parse(next.issuedAt) };
    setNow(Date.now());
    setInvitation(next);
    setStatus(null);
    setBusy(false);
    setError(null);
  };
  useEffect(() => {
    mounted.current = true;
    // React StrictMode 的重挂不多领一个码。
    first.current ??= api.devices.issuePairingCode();
    let live = true;
    first.current.then((next) => { if (live) install(next); }, (cause: unknown) => {
      if (live) { setError(errorText(cause)); setBusy(false); }
    });
    return () => { live = false; mounted.current = false; };
  }, [api]);

  useEffect(() => {
    if (invitation === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await api.devices.pairingStatus(invitation.id, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(next);
        setError(null);
        serverClock.current = { at: Date.now(),
          remaining: Date.parse(next.expiresAt) - Date.parse(next.checkedAt) };
        setNow(Date.now());
        if (next.status === 'connected' && next.device !== null && reported.current !== invitation.id) {
          reported.current = invitation.id;
          connected.current();
        }
        if (next.status === 'waiting') timer = setTimeout(() => void poll(), POLL_MS);
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorText(cause));
      }
    };
    void poll();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [api, invitation?.id, round]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const regenerate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.devices.issuePairingCode();
      if (mounted.current) install(next);
    } catch (cause) {
      if (mounted.current) { setBusy(false); setError(errorText(cause)); }
    }
  };
  const remaining = Math.max(0, serverClock.current.remaining - (now - serverClock.current.at));
  return { invitation, status, busy, error, remaining, regenerate,
    reload: () => { setError(null); setRound((previous) => previous + 1); } };
}

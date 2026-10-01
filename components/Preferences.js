"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { setCurrency, currencySymbols } from "../lib/format";
const Context = createContext({ currency: 'INR', appearance: 'system' });
export const usePreferences = () => useContext(Context);
export default function Preferences({ children }) {
  const { user } = useAuth();
  const [value, setValue] = useState({ currency: 'INR', appearance: 'system' });
  useEffect(() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(`preferences:${user?.id || 'guest'}`) || '{}'); } catch {}
    const next = { currency: currencySymbols[saved.currency] ? saved.currency : 'INR', appearance: ['system','light','dark'].includes(saved.appearance) ? saved.appearance : 'system' };
    setCurrency(next.currency); setValue(next);
  }, [user?.id]);
  useEffect(() => { document.documentElement.dataset.appearance = value.appearance; }, [value.appearance]);
  function update(patch) {
    const next = { ...value, ...patch };
    setCurrency(next.currency); setValue(next);
    try { localStorage.setItem(`preferences:${user?.id || 'guest'}`, JSON.stringify(next)); } catch {}
  }
  return <Context.Provider value={{ ...value, update }}>{children}</Context.Provider>;
}

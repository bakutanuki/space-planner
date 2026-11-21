import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Sends you to GitHub to sign in, then back to this site
export async function signInWithGitHub(): Promise<void> {
  if (!supabase) throw new Error('Database not set up');
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: location.origin + '/' } });
  if (error) throw error;
}

// Emails a one-tap sign-in link (no password)
export async function signInWithEmail(email: string): Promise<void> {
  if (!supabase) throw new Error('Database not set up');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/' } });
  if (error) throw error;
}

// Who is signed in on this device (null if nobody)
export async function getUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// Signs out on this device
export async function signOut(): Promise<void> { await supabase?.auth.signOut(); }

// Runs cb whenever someone signs in or out
export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null));
  return () => data.subscription.unsubscribe();
}

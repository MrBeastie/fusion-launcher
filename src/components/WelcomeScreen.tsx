'use client';

import { FormEvent, useState } from 'react';
import { motion } from 'framer-motion';
import { Link2, Loader2, ShieldCheck } from 'lucide-react';

interface WelcomeScreenProps {
  initialMessage: string | null;
  onConnect: (url: string) => Promise<void>;
}

export function WelcomeScreen({ initialMessage, onConnect }: WelcomeScreenProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim()) return;

    setBusy(true);
    setMessage(null);
    try {
      await onConnect(url.trim());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f0f11] px-6 text-white">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl"
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-md bg-hydra-accent text-sm font-black shadow-glow">
            RH
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-normal">RetroHydra</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-white/50">
              <ShieldCheck className="h-4 w-4 text-hydra-green" />
              BYOR mode
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-semibold text-white/72" htmlFor="repository-url">
            Repository URL
          </label>
          <div className="flex min-h-14 items-center gap-3 rounded-lg border border-white/12 bg-white/[0.05] px-4 focus-within:border-hydra-accent/70">
            <Link2 className="h-5 w-5 text-white/36" />
            <input
              id="repository-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/index.json"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-hydra-accent px-4 text-sm font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect
            </button>
          </div>
          <p className="text-xs leading-6 text-white/42">
            RetroHydra includes a first-party smoke-test demo and loads community repositories only when you add them.
          </p>
          {message && (
            <div className="rounded-md border border-amber-300/24 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {message}
            </div>
          )}
        </form>
      </motion.section>
    </main>
  );
}

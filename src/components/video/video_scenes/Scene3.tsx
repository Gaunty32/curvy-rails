import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => setPhase(5), 3800),
      setTimeout(() => setPhase(6), 7000), // exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Left Content */}
      <div className="w-[40%] relative z-10">
        <motion.div
          className="w-16 h-16 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center mb-8"
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
        >
          <svg className="w-8 h-8 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </motion.div>

        <motion.h2
          className="text-5xl font-display font-bold text-white leading-tight mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          Sales Order Management
        </motion.h2>

        <div className="space-y-4">
          {[
            'Customer details & logos',
            'Complex product catalogues',
            'WooCommerce Sync'
          ].map((text, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-4 text-xl text-slate-300"
              initial={{ opacity: 0, x: -20 }}
              animate={phase >= i + 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
              {text}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right UI Mockup */}
      <div className="w-[50%] relative h-[60vh]" style={{ perspective: 1000 }}>
        {/* Main Window */}
        <motion.div
          className="absolute inset-0 bg-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col"
          initial={{ opacity: 0, rotateY: 20, z: -100 }}
          animate={{ opacity: 1, rotateY: -5, z: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="h-12 border-b border-slate-800 bg-slate-900/50 flex items-center px-4 gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-700" />
              <div className="w-3 h-3 rounded-full bg-slate-700" />
              <div className="w-3 h-3 rounded-full bg-slate-700" />
            </div>
            <div className="ml-4 text-xs font-mono text-slate-500">portal.example.invalid/orders/ORD-2048</div>
          </div>
          
          <div className="flex-1 p-6 relative">
            <div className="flex justify-between items-start mb-8">
              <div>
                <div className="text-sm text-sky-400 font-bold tracking-widest uppercase mb-1">ORDER SO-2048</div>
                <div className="text-2xl font-bold text-white">Acme Corp Ltd</div>
              </div>
              <div className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-sm font-bold border border-emerald-500/30">
                PROCESSING
              </div>
            </div>

            {/* List items */}
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <motion.div
                  key={i}
                  className="h-16 rounded-lg bg-slate-800 border border-slate-700 flex items-center px-4 gap-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                  transition={{ delay: i * 0.1, type: 'spring' }}
                >
                  <div className="w-10 h-10 rounded bg-slate-700" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 bg-slate-600 rounded" />
                    <div className="h-2 w-1/4 bg-slate-700 rounded" />
                  </div>
                  <div className="text-slate-400 font-mono text-sm">Qty: {Math.floor(Math.random() * 50) + 10}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Floating Sync Notification */}
        <motion.div
          className="absolute -right-8 top-1/4 bg-slate-800 rounded-lg border border-sky-500/30 p-4 shadow-xl flex items-center gap-3"
          initial={{ opacity: 0, x: 50 }}
          animate={phase >= 5 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-white">WooCommerce Synced</div>
            <div className="text-xs text-slate-400">Order imported automatically</div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

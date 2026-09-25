import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 2800),
      setTimeout(() => setPhase(4), 9000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center pt-10"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-12 z-10 relative">
        <motion.h2
          className="text-4xl md:text-6xl font-display font-bold text-white tracking-tight"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          Customer Portal
        </motion.h2>
        <motion.p
          className="text-xl text-sky-400 mt-4 font-medium"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Self-serve ordering & tracking.
        </motion.p>
      </div>

      {/* UI Mockup Grid */}
      <div className="relative w-full max-w-6xl h-[55vh] flex gap-6 px-8" style={{ perspective: 1200 }}>
        {/* Left Column - Product Wardrobe */}
        <motion.div
          className="flex-1 bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
          initial={{ opacity: 0, rotateY: -15, z: -100 }}
          animate={phase >= 1 ? { opacity: 1, rotateY: 0, z: 0 } : { opacity: 0, rotateY: -15, z: -100 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h3 className="text-slate-300 font-bold mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Company Wardrobe
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <motion.div
                key={i}
                className="bg-slate-800 rounded-lg p-4 border border-slate-700/50"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="w-full h-24 bg-slate-700 rounded mb-3" />
                <div className="h-3 w-3/4 bg-slate-600 rounded mb-2" />
                <div className="h-2 w-1/2 bg-slate-700 rounded" />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right Column - Invoices & Xero */}
        <div className="w-[40%] flex flex-col gap-6">
          <motion.div
            className="flex-1 bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl"
            initial={{ opacity: 0, rotateY: 15, x: 50 }}
            animate={phase >= 2 ? { opacity: 1, rotateY: 0, x: 0 } : { opacity: 0, rotateY: 15, x: 50 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Recent Invoices
            </h3>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-800 border border-slate-700/50">
                  <div className="space-y-1">
                    <div className="text-sm font-mono text-slate-300">INV-{2048 + i}</div>
                    <div className="text-xs text-slate-500">£{Math.floor(Math.random() * 500) + 100}.00</div>
                  </div>
                  <div className={`text-xs font-bold px-2 py-1 rounded border ${i === 0 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>
                    {i === 0 ? 'PENDING' : 'PAID'}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Xero Badge */}
          <motion.div
            className="h-20 bg-indigo-950 border border-indigo-500/30 rounded-2xl flex items-center justify-center gap-4 shadow-lg shadow-indigo-900/50"
            initial={{ opacity: 0, y: 50 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ type: "spring" }}
          >
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center font-bold text-indigo-600">X</div>
            <span className="text-indigo-200 font-medium">Syncs with Xero automatically</span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

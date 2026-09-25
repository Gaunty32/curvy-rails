import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 3500),
      setTimeout(() => setPhase(5), 4500),
      setTimeout(() => setPhase(6), 9000), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Visual Pipeline Left */}
      <div className="w-[55%] relative h-[60vh]">
        {/* Connection Line */}
        <motion.div
          className="absolute top-1/2 left-[10%] right-[10%] h-1 bg-slate-800 -translate-y-1/2 z-0"
          initial={{ scaleX: 0 }}
          animate={phase >= 1 ? { scaleX: 1 } : { scaleX: 0 }}
          style={{ originX: 0 }}
          transition={{ duration: 1 }}
        />

        {/* Nodes */}
        {[
          { icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: 'Production', color: 'sky' },
          { icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', label: 'Packaging', color: 'indigo' },
          { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: 'DPD Dispatch', color: 'cyan' },
        ].map((node, i) => (
          <motion.div
            key={i}
            className={`absolute top-1/2 -translate-y-1/2 z-10 flex flex-col items-center`}
            style={{ left: `${15 + i * 35}%` }}
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={phase >= i + 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.8 }}
            transition={{ type: 'spring' }}
          >
            <div className={`w-20 h-20 rounded-2xl bg-slate-900 border border-${node.color}-500/40 flex items-center justify-center shadow-xl shadow-${node.color}-500/10`}>
              <svg className={`w-10 h-10 text-${node.color}-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={node.icon} />
              </svg>
            </div>
            <div className="mt-4 font-bold text-slate-200 tracking-wide uppercase text-sm">
              {node.label}
            </div>
          </motion.div>
        ))}

        {/* Animated Package moving along line */}
        {phase >= 5 && (
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-cyan-400 rounded-sm shadow-[0_0_15px_rgba(34,211,238,0.8)] z-20"
            initial={{ left: '15%' }}
            animate={{ left: '85%' }}
            transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, repeatDelay: 1 }}
          />
        )}
      </div>

      {/* Right Content */}
      <div className="w-[35%] relative z-10">
        <motion.h2
          className="text-5xl font-display font-bold text-white leading-tight mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          Production & Dispatch
        </motion.h2>

        <div className="space-y-6">
          <motion.div
            className="flex items-start gap-4"
            initial={{ opacity: 0, x: 20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
          >
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center shrink-0 mt-1">
              <span className="text-sky-400 font-bold font-mono text-xs">01</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Track Workflow</h3>
              <p className="text-slate-400 text-sm mt-1">Assign items to operators through production.</p>
            </div>
          </motion.div>

          <motion.div
            className="flex items-start gap-4"
            initial={{ opacity: 0, x: 20 }}
            animate={phase >= 4 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
          >
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center shrink-0 mt-1">
              <span className="text-cyan-400 font-bold font-mono text-xs">02</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Automated Dispatch</h3>
              <p className="text-slate-400 text-sm mt-1">DPD integration. 1-click shipping labels & tracking.</p>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

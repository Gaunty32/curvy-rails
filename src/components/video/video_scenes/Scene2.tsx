import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000), // exit start
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-12"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative w-full max-w-5xl text-center">
        <motion.div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-slate-800/50 blur-[60px]"
          animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 4, repeat: Infinity }}
        />

        <motion.h2
          className="text-5xl md:text-7xl font-display font-bold text-slate-100 tracking-tight leading-tight"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          Orders <span className="text-sky-400">in.</span>
        </motion.h2>

        <motion.h2
          className="text-5xl md:text-7xl font-display font-bold text-slate-100 tracking-tight leading-tight mt-2"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          Uniforms <span className="text-cyan-400">out.</span>
        </motion.h2>

        <motion.div
          className="mt-12 text-3xl text-slate-400 font-medium"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.6 }}
        >
          But in between?
        </motion.div>

        {/* Chaos representation */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[400px] pointer-events-none -z-10">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-12 h-12 md:w-20 md:h-20 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center text-xs text-slate-500 font-mono"
              initial={{ 
                opacity: 0, 
                x: 0, 
                y: 0, 
                rotate: 0,
                scale: 0
              }}
              animate={phase >= 3 ? {
                opacity: [0, 0.8, 0],
                x: (Math.random() - 0.5) * 800,
                y: (Math.random() - 0.5) * 400,
                rotate: (Math.random() - 0.5) * 180,
                scale: Math.random() * 0.5 + 0.5
              } : {}}
              transition={{ 
                duration: 2, 
                ease: "easeOut",
                delay: Math.random() * 0.5
              }}
            >
              {['PO', 'INV', 'DPD', 'WOO', 'XERO'][i % 5]}
            </motion.div>
          ))}
        </div>

      </div>
    </motion.div>
  );
}

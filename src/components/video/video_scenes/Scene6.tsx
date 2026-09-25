import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 z-50"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
    >
      {/* Background flare */}
      <motion.div
        className="absolute w-[80vw] h-[80vw] rounded-full opacity-20 blur-[100px]"
        style={{ background: 'radial-gradient(circle, #0ea5e9, transparent)' }}
        animate={{ scale: [0.8, 1.2, 1], opacity: [0.1, 0.3, 0.1] }}
        transition={{ duration: 8, repeat: Infinity }}
      />

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <motion.div
          className="w-32 h-32 md:w-40 md:h-40 bg-slate-900 rounded-3xl flex items-center justify-center mb-8 border border-sky-500/30 overflow-hidden"
          initial={{ scale: 0, rotate: -180 }}
          animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <span className="font-display font-bold text-4xl md:text-5xl tracking-tighter text-white">WORKWEAR</span>
        </motion.div>

        <motion.h1
          className="text-4xl md:text-6xl lg:text-7xl font-display font-bold tracking-tight text-white mb-6 text-center"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          From order <span className="text-sky-400">to delivery.</span>
        </motion.h1>

        <motion.div
          className="px-8 py-3 rounded-full border border-slate-700 bg-slate-800/50 backdrop-blur-sm text-slate-300 font-medium tracking-wide uppercase text-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
        >
          Your configured uniform programme
        </motion.div>
      </div>
    </motion.div>
  );
}

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 3000), // Start exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, filter: 'blur(8px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo Reveal */}
        <motion.div
          className="w-32 h-32 md:w-48 md:h-48 bg-slate-900 rounded-2xl flex items-center justify-center mb-8 border border-sky-500/30 relative overflow-hidden"
          initial={{ opacity: 0, y: 40, rotateX: -30 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{ perspective: 1000 }}
        >
          <motion.div 
            className="absolute inset-0 bg-gradient-to-tr from-sky-500/20 to-cyan-400/20"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
          {/* Fallback text if logo fails, otherwise real logo */}
          <span className="font-display font-bold text-4xl md:text-5xl tracking-tighter text-white z-10">WORKWEAR</span>
        </motion.div>

        {/* Text Reveal */}
        <div className="text-center overflow-hidden">
          <motion.h1
            className="text-4xl md:text-6xl lg:text-7xl font-display font-bold tracking-tight text-white mb-4"
            initial={{ y: "100%" }}
            animate={phase >= 1 ? { y: 0 } : { y: "100%" }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          >
            Uniform <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-cyan-300">Management</span>
          </motion.h1>
        </div>

        <div className="overflow-hidden mt-2">
          <motion.p
            className="text-xl md:text-2xl text-slate-400 font-medium tracking-wide"
            initial={{ y: "100%", opacity: 0 }}
            animate={phase >= 2 ? { y: 0, opacity: 1 } : { y: "100%", opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            Uniform Management. <span className="text-slate-200">Simplified.</span>
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}

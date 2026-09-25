import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

const SCENE_DURATIONS = {
  hook: 4000,
  problem: 5000,
  sales: 8000,
  production: 10000,
  portal: 10000,
  close: 8000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 font-body text-slate-50">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full opacity-10 blur-[80px]"
          style={{ background: 'radial-gradient(circle, #0ea5e9, transparent)' }}
          animate={{
            x: ['-20%', '50%', '10%'],
            y: ['-10%', '30%', '60%'],
            scale: [1, 1.2, 0.8],
            opacity: [0.1, 0.15, 0.1],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[50vw] h-[50vw] rounded-full opacity-10 blur-[80px] right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }}
          animate={{
            x: ['20%', '-40%', '0%'],
            y: ['20%', '-20%', '10%'],
            scale: [0.8, 1.1, 1],
            opacity: [0.1, 0.15, 0.1],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Subtle grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '4vw 4vw'
          }}
        />
      </div>

      {/* Persistent Accents based on scene */}
      <motion.div
        className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-sky-500 to-cyan-400"
        animate={{
          scaleX: (currentScene + 1) / 6,
          opacity: currentScene === 5 ? 0 : 1,
        }}
        style={{ originX: 0 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      />

      {/* Scene Content */}
      <AnimatePresence initial={false} mode="wait">
        {currentScene === 0 && <Scene1 key="hook" />}
        {currentScene === 1 && <Scene2 key="problem" />}
        {currentScene === 2 && <Scene3 key="sales" />}
        {currentScene === 3 && <Scene4 key="production" />}
        {currentScene === 4 && <Scene5 key="portal" />}
        {currentScene === 5 && <Scene6 key="close" />}
      </AnimatePresence>
    </div>
  );
}

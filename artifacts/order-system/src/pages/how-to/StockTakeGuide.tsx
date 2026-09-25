import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { guides } from "@/data/how-to";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, ChevronLeft, ChevronRight, Volume2, VolumeX, AlertCircle, ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import MockStockUI from "@/components/how-to/MockStockUI";

export default function StockTakeGuide() {
  const guide = guides.find(g => g.slug === "stock-take");
  
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasError, setHasError] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => {
      setIsPlaying(false);
      setHasError(true);
    };
    audioRef.current = audio;
    
    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  if (!guide) return <Layout><div>Guide not found</div></Layout>;

  const stopAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
  };

  const playStep = async (stepIndex: number) => {
    const audio = audioRef.current;
    if (!audio || isMuted) return;
    
    stopAudio();
    setHasError(false);
    audio.src = `${import.meta.env.BASE_URL}audio/how-to/stock-take-step-${stepIndex + 1}.mp3`;
    audio.muted = isMuted;
    audio.load();
    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setHasError(true);
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (audio.src && audio.currentTime > 0 && !audio.ended) {
        audio.play()
          .then(() => setIsPlaying(true))
          .catch(() => setHasError(true));
      } else {
        void playStep(currentStep);
      }
    }
  };

  const nextStep = () => {
    const next = Math.min(currentStep + 1, guide.steps.length - 1);
    setCurrentStep(next);
    if (isPlaying && !isMuted) {
      void playStep(next);
    }
  };

  const prevStep = () => {
    const prev = Math.max(currentStep - 1, 0);
    setCurrentStep(prev);
    if (isPlaying && !isMuted) {
      void playStep(prev);
    }
  };

  const workAlongsideGuide = () => {
    stopAudio();
    const guideWindow = window.open(
      window.location.href,
      "sbs-stock-take-guide",
      "popup=yes,width=760,height=920,resizable=yes,scrollbars=yes"
    );
    if (!guideWindow) {
      window.alert("Please allow pop-ups, then choose “Work alongside guide” again.");
      return;
    }
    guideWindow.focus();
    window.location.assign(`${import.meta.env.BASE_URL}stock`);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto py-8 px-6">
        <Link href="/how-to" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-display font-bold text-[hsl(var(--sidebar))]">{guide.title}</h2>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => {
                        setIsMuted(!isMuted);
                        if (!isMuted && isPlaying) stopAudio();
                      }} 
                      className="p-2 text-muted-foreground hover:bg-muted rounded-md transition-colors" 
                      title={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-[hsl(var(--sidebar))] text-white p-4 rounded-xl mb-8">
                  <button 
                    onClick={togglePlay} 
                    className="w-12 h-12 shrink-0 flex items-center justify-center bg-white text-[hsl(var(--sidebar))] rounded-full hover:scale-105 transition-transform"
                    aria-label={isPlaying ? "Pause narration" : "Play narration"}
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{isPlaying ? "Playing Narration" : "Listen to Guide"}</div>
                    <div className="text-xs text-white/70 truncate">Step {currentStep + 1} of {guide.steps.length}</div>
                  </div>
                  <button 
                    onClick={stopAudio} 
                    disabled={!isPlaying}
                    className="p-2 shrink-0 text-white/70 hover:text-white disabled:opacity-30 transition-colors"
                    aria-label="Stop narration"
                  >
                    <Square className="w-5 h-5 fill-current" />
                  </button>
                </div>

                <div className="space-y-3">
                  {guide.steps.map((step, idx) => (
                    <div 
                      key={step.id} 
                      className={cn(
                        "p-4 rounded-xl border transition-all duration-300 cursor-pointer",
                        currentStep === idx 
                          ? "border-primary bg-primary/5 shadow-sm" 
                          : "border-transparent hover:bg-muted text-muted-foreground"
                      )}
                      onClick={() => {
                        setCurrentStep(idx);
                        if (isPlaying && !isMuted) {
                          void playStep(idx);
                        }
                      }}
                    >
                      <div className="flex gap-4">
                        <div className={cn(
                          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm transition-colors mt-0.5",
                          currentStep === idx ? "bg-primary text-white shadow-sm" : "bg-muted-foreground/20 text-muted-foreground"
                        )}>
                          {idx + 1}
                        </div>
                        <div>
                          <h3 className={cn("font-semibold mb-1", currentStep === idx ? "text-foreground" : "")}>{step.title}</h3>
                          {currentStep === idx && (
                            <p className="text-sm text-foreground/80 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-300 mt-2">
                              {step.content}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="p-4 bg-muted/30 border-t border-border flex items-center justify-between mt-auto">
                <Button variant="outline" onClick={prevStep} disabled={currentStep === 0} className="gap-2 text-xs h-9">
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </Button>
                <span className="text-xs font-medium text-muted-foreground">{currentStep + 1} / {guide.steps.length}</span>
                <Button onClick={nextStep} disabled={currentStep === guide.steps.length - 1} className="gap-2 bg-[hsl(var(--sidebar))] hover:bg-[hsl(var(--sidebar))]/90 text-white text-xs h-9">
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {hasError && (
               <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                 <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                 <p>The narration audio is currently unavailable. You can still read and follow the steps above.</p>
               </div>
            )}
            
            <button
              type="button"
              onClick={workAlongsideGuide}
              className="flex items-center justify-center gap-2 w-full py-3.5 px-6 rounded-xl border-2 border-primary/20 bg-primary/5 text-primary font-semibold hover:bg-primary hover:text-white transition-colors group"
            >
              Work alongside guide
              <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
            <p className="text-xs text-center text-muted-foreground -mt-3">
              Keeps this guide open in a separate window while the main screen moves to Stock.
            </p>
          </div>

          <div className="lg:col-span-7 sticky top-8">
            <div className="bg-muted/40 border border-border rounded-xl p-8 flex items-center justify-center shadow-inner overflow-hidden min-h-[500px]">
              <MockStockUI highlightAction={guide.steps[currentStep].highlightAction} />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

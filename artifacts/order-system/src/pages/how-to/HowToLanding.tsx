import { Link } from "wouter";
import Layout from "@/components/Layout";
import { guides } from "@/data/how-to";
import { BookOpen, Clock, Users, ChevronRight, PlayCircle } from "lucide-react";

export default function HowToLanding() {
  return (
    <Layout>
      <div className="max-w-5xl mx-auto py-8 px-6">
        <header className="mb-10">
          <h1 className="text-3xl font-display font-bold text-[hsl(var(--sidebar))] mb-2">How To Library</h1>
          <p className="text-muted-foreground text-lg">Operational guides and standard procedures for production staff.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {guides.map(guide => (
            <Link key={guide.slug} href={`/how-to/${guide.slug}`} className="group block">
              <div className="bg-card border border-border rounded-xl p-6 h-full shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/40 flex flex-col">
                <div className="w-12 h-12 rounded-lg bg-[hsl(var(--sidebar))] text-white flex items-center justify-center mb-5 group-hover:scale-105 transition-transform duration-200">
                  <PlayCircle className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold font-display text-[hsl(var(--sidebar))] mb-2 group-hover:text-primary transition-colors">{guide.title}</h2>
                <p className="text-muted-foreground text-sm flex-1 mb-6 leading-relaxed">
                  {guide.description}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-auto pt-4 border-t border-border/50 text-xs font-medium text-muted-foreground">
                  <div className="flex items-center gap-1.5 bg-muted px-2 py-1 rounded-md">
                    <Users className="w-3.5 h-3.5" />
                    {guide.audience}
                  </div>
                  <div className="flex items-center gap-1.5 bg-muted px-2 py-1 rounded-md">
                    <Clock className="w-3.5 h-3.5" />
                    {guide.duration}
                  </div>
                  <div className="ml-auto text-primary group-hover:translate-x-1 transition-transform">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
          
          {/* Empty state for future guides */}
          <div className="bg-muted/30 border border-dashed border-border rounded-xl p-6 h-full flex flex-col items-center justify-center text-center text-muted-foreground/60 min-h-[280px]">
            <BookOpen className="w-8 h-8 mb-3 opacity-50" />
            <span className="text-sm font-medium">More guides coming soon</span>
          </div>
        </div>
      </div>
    </Layout>
  );
}

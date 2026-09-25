import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { BookOpen, Calendar, ExternalLink } from "lucide-react";

interface BlogPost {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  link: string;
  slug: string;
  featuredImageUrl: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden animate-pulse">
      <div className="aspect-video bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-muted rounded w-24" />
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded" />
        <div className="h-3 bg-muted rounded w-5/6" />
        <div className="h-3 bg-muted rounded w-28 mt-3" />
      </div>
    </div>
  );
}

function ArticleCard({ post }: { post: BlogPost }) {
  return (
    <article className="group flex flex-col rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="aspect-video bg-muted overflow-hidden">
        {post.featuredImageUrl ? (
          <img
            src={post.featuredImageUrl}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="w-10 h-10 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <Calendar className="w-3.5 h-3.5" />
          {formatDate(post.date)}
        </div>
        <h2 className="text-sm font-bold text-foreground leading-snug mb-2 group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">
          {post.excerpt}
        </p>
        <a
          href={post.link}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          Read more <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </article>
  );
}

export default function KnowledgeCentre() {
  const { data: posts, isLoading, error } = useQuery<BlogPost[]>({
    queryKey: ["knowledge-centre-posts"],
    queryFn: () =>
      fetch("/api/shop/blog-posts").then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      }),
    staleTime: 1000 * 60 * 15,
  });

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge Centre</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tips, guides and workwear inspiration from the the configured business team.
          </p>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <BookOpen className="w-10 h-10 opacity-20" />
            <p className="font-medium text-sm">Could not load articles right now</p>
            <a
              href="#"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Visit our website to read the latest <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {posts && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <BookOpen className="w-10 h-10 opacity-20" />
            <p className="text-sm">No articles found</p>
          </div>
        )}

        {posts && posts.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {posts.map((post) => (
                <ArticleCard key={post.id} post={post} />
              ))}
            </div>
            <div className="text-center pt-2">
              <a
                href="#"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                View all articles on our website <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useSEO } from '@/hooks/useSEO';
import { Link } from 'wouter';
import { Calendar, BookOpen } from 'lucide-react';

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
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function BlogCard({ post }: { post: BlogPost }) {
  return (
    <article className="group flex flex-col rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white">
      <div className="aspect-video bg-gray-100 overflow-hidden relative">
        {post.featuredImageUrl ? (
          <img
            src={post.featuredImageUrl}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="w-10 h-10 text-gray-300" />
          </div>
        )}
      </div>
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <Calendar className="w-3.5 h-3.5" />
          {formatDate(post.date)}
        </div>
        <h2 className="text-base font-bold text-gray-900 leading-snug mb-2 group-hover:text-primary transition-colors line-clamp-2">
          {post.title}
        </h2>
        <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 flex-1">
          {post.excerpt}
        </p>
        <Link
          href={`/knowledge-centre/${post.slug}`}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          Read more →
        </Link>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white animate-pulse">
      <div className="aspect-video bg-gray-200" />
      <div className="p-5 space-y-3">
        <div className="h-3 bg-gray-200 rounded w-24" />
        <div className="h-5 bg-gray-200 rounded w-3/4" />
        <div className="h-3 bg-gray-200 rounded" />
        <div className="h-3 bg-gray-200 rounded w-5/6" />
        <div className="h-3 bg-gray-200 rounded w-4/6" />
        <div className="h-4 bg-gray-200 rounded w-24 mt-4" />
      </div>
    </div>
  );
}

export default function KnowledgeCentre() {
  useSEO({
    title: 'Knowledge Centre — Workwear & Uniform Advice',
    description: 'Practical advice on workwear, uniform management and corporate clothing. Written to answer the questions businesses actually ask — from fabric choice to logo application.',
  });
  const { data: posts, isLoading, error } = useQuery<BlogPost[]>({
    queryKey: ['blog-posts'],
    queryFn: () => fetch('/api/shop/blog-posts').then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    staleTime: 1000 * 60 * 15,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-primary text-primary-foreground py-12">
        <div className="container mx-auto px-4">
          <p className="text-sm font-semibold uppercase tracking-widest opacity-70 mb-2">
            the configured business
          </p>
          <h1 className="text-3xl font-bold">Knowledge Centre</h1>
          <p className="mt-2 opacity-80 text-sm max-w-lg">
            Tips, guides and workwear inspiration to help you get the most from your uniform programme.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Could not load articles right now</p>
            <p className="text-sm mt-1">Please check back shortly.</p>
          </div>
        )}

        {posts && posts.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No articles found</p>
          </div>
        )}

        {posts && posts.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map(post => <BlogCard key={post.id} post={post} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

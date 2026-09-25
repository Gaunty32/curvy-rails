import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';
import { Calendar, ArrowLeft, ArrowRight, BookOpen } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface Article {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  slug: string;
  featuredImageUrl: string | null;
  content: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function KnowledgeCentreArticle() {
  const { slug } = useParams<{ slug: string }>();

  const { data: post, isLoading, error } = useQuery<Article>({
    queryKey: ['blog-post', slug],
    queryFn: () => fetch(`/api/shop/blog-posts/${slug}`).then(r => {
      if (!r.ok) throw new Error('Not found');
      return r.json();
    }),
    enabled: !!slug,
    staleTime: 1000 * 60 * 15,
  });

  useSEO({
    title: post ? `${post.title} — Knowledge Centre` : 'Knowledge Centre',
    description: post?.excerpt ?? 'Workwear advice and uniform guides from the configured business.',
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-primary text-primary-foreground py-8">
          <div className="container mx-auto px-4 max-w-3xl">
            <Skeleton className="h-4 w-40 bg-white/20 mb-4" />
            <Skeleton className="h-8 w-2/3 bg-white/20" />
          </div>
        </div>
        <div className="container mx-auto px-4 py-10 max-w-3xl space-y-3">
          <Skeleton className="h-64 w-full rounded-xl" />
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-gray-500">
        <div className="text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">Article not found</p>
          <Link href="/knowledge-centre" className="mt-3 inline-block text-sm text-primary underline">
            Back to Knowledge Centre
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-primary text-primary-foreground py-10">
        <div className="container mx-auto px-4 max-w-3xl">
          <Link
            href="/knowledge-centre"
            className="inline-flex items-center gap-1.5 text-sm opacity-70 hover:opacity-100 transition-opacity mb-5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Knowledge Centre
          </Link>
          <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">{post.title}</h1>
          <div className="flex items-center gap-1.5 mt-3 text-sm opacity-70">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(post.date)}
          </div>
        </div>
      </div>

      {/* Featured image */}
      {post.featuredImageUrl && (
        <div className="container mx-auto px-4 max-w-3xl -mt-1 pt-8">
          <img
            src={post.featuredImageUrl}
            alt={post.title}
            className="w-full rounded-xl object-cover max-h-80 shadow-md"
          />
        </div>
      )}

      {/* Article body */}
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <div
          className="prose prose-gray prose-headings:font-bold prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-primary prose-li:text-gray-700 max-w-none"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />

        <section className="mt-12 rounded-2xl bg-primary px-6 py-8 md:px-10 md:py-9 text-primary-foreground shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-75 mb-2">
                Need help with your uniform programme?
              </p>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                Book a Discovery Call
              </h2>
              <p className="mt-2 text-sm md:text-base opacity-85 leading-relaxed">
                Talk through your requirements with the the configured business team.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 shrink-0 rounded-md bg-white px-5 py-3 text-sm font-bold text-primary shadow-sm transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              Book a Discovery Call
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

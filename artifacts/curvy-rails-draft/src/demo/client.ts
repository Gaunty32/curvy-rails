import { useQuery } from '@tanstack/react-query';
import {
  demoAdminOverview,
  demoMyRail,
  experiences,
  products,
  questions,
  summary,
} from './fixtures';
import type {
  AdminOverviewResponse,
  CommunityResponse,
  HomeResponse,
  ListCurvyRailsProductsParams,
  MyRailResponse,
  Product,
  ProductDetailResponse,
  ProductExperience,
  ProductQuestion,
  ProductsResponse,
} from './api.schemas';

export type { Product, ProductExperience, ProductQuestion, ListCurvyRailsProductsParams } from './api.schemas';

// This restored preview is intentionally self-contained: no requests to the
// imported shop, its database, or its setup-only API.
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
const catalogue = products.map((item) => ({
  ...item,
  sizes: [...item.sizes],
  imageUrl: asset(item.imageUrl),
})) as Product[];
const stories = experiences.map((item) => ({
  ...item,
  photoUrl: item.photoUrl ? asset(item.photoUrl) : null,
})) as ProductExperience[];
const productQuestions = questions.map((item) => ({
  ...item,
  answers: item.answers.map((answer) => ({ ...answer })),
})) as ProductQuestion[];

type DemoQueryOptions = { query?: { queryKey?: readonly unknown[]; enabled?: boolean } };

function useDemoQuery<T>(key: readonly unknown[], getData: () => T, options?: DemoQueryOptions) {
  return useQuery<T>({
    queryKey: options?.query?.queryKey ?? key,
    queryFn: async () => getData(),
    enabled: options?.query?.enabled,
  });
}

export const getGetCurvyRailsHomeQueryKey = () => ['draft', 'home'] as const;
export const useGetCurvyRailsHome = (options?: DemoQueryOptions) =>
  useDemoQuery<HomeResponse>(getGetCurvyRailsHomeQueryKey(), () => ({
    justLanded: catalogue.filter((item) => item.isNew).slice(0, 4),
    experiences: stories,
    questions: productQuestions,
    summary,
  }), options);

export const getListCurvyRailsProductsQueryKey = (params?: ListCurvyRailsProductsParams) =>
  ['draft', 'products', params] as const;
export const useListCurvyRailsProducts = (params: ListCurvyRailsProductsParams = {}, options?: DemoQueryOptions) =>
  useDemoQuery<ProductsResponse>(getListCurvyRailsProductsQueryKey(params), () => {
    const query = params.search?.trim().toLowerCase();
    const items = catalogue.filter((item) => {
      if (params.category === 'new' && !item.isNew) return false;
      if (params.category && params.category !== 'new' && item.productType !== params.category) return false;
      return !query || `${item.name} ${item.description} ${item.category} ${item.colour}`.toLowerCase().includes(query);
    });
    return {
      items,
      categories: [...new Set(items.map((item) => item.category))].sort(),
      sizes: [...new Set(items.flatMap((item) => item.sizes))],
    };
  }, options);

export const getGetCurvyRailsProductQueryKey = (slug: string) => ['draft', 'product', slug] as const;
export const useGetCurvyRailsProduct = (slug: string, options?: DemoQueryOptions) =>
  useDemoQuery<ProductDetailResponse>(getGetCurvyRailsProductQueryKey(slug), () => {
    const product = catalogue.find((item) => item.slug === slug);
    if (!product) throw new Error('Product not found in the draft catalogue');
    return {
      product,
      experiences: stories.filter((item) => item.productSlug === slug),
      questions: productQuestions.filter((item) => item.productSlug === slug),
      relatedProducts: catalogue.filter((item) => item.slug !== slug).slice(0, 3),
    };
  }, options);

export const getGetCurvyRailsCommunityQueryKey = () => ['draft', 'community'] as const;
export const useGetCurvyRailsCommunity = (options?: DemoQueryOptions) =>
  useDemoQuery<CommunityResponse>(getGetCurvyRailsCommunityQueryKey(), () => ({
    summary,
    experiences: stories,
    questions: productQuestions,
  }), options);

export const getGetCurvyRailsMyRailQueryKey = () => ['draft', 'my-rail'] as const;
export const useGetCurvyRailsMyRail = (options?: DemoQueryOptions) =>
  useDemoQuery<MyRailResponse>(getGetCurvyRailsMyRailQueryKey(), () => ({
    ...demoMyRail,
    ownedProducts: demoMyRail.ownedProducts.map((item) => catalogue.find((product) => product.slug === item.slug)!),
  }) as MyRailResponse, options);

export const getGetCurvyRailsAdminOverviewQueryKey = () => ['draft', 'admin'] as const;
export const useGetCurvyRailsAdminOverview = (options?: DemoQueryOptions) =>
  useDemoQuery<AdminOverviewResponse>(getGetCurvyRailsAdminOverviewQueryKey(), () =>
    demoAdminOverview as AdminOverviewResponse, options);
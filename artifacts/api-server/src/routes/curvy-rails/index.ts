import { Router, type IRouter } from "express";
import {
  GetCurvyRailsAdminOverviewResponse,
  GetCurvyRailsCommunityResponse,
  GetCurvyRailsHomeResponse,
  GetCurvyRailsMyRailResponse,
  GetCurvyRailsProductParams,
  GetCurvyRailsProductResponse,
  ListCurvyRailsProductsQueryParams,
  ListCurvyRailsProductsResponse,
} from "@workspace/api-zod";
import {
  demoAdminOverview,
  demoMyRail,
  experiences,
  products,
  questions,
  summary,
} from "./fixtures";

const router: IRouter = Router();

router.get("/curvy-rails/home", (_req, res): void => {
  res.json(
    GetCurvyRailsHomeResponse.parse({
      justLanded: products.filter((product) => product.isNew).slice(0, 4),
      experiences,
      questions,
      summary,
    }),
  );
});

router.get("/curvy-rails/products", (req, res): void => {
  const parsed = ListCurvyRailsProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid catalogue filters" });
    return;
  }

  const { category, search } = parsed.data;
  const query = search?.trim().toLowerCase();
  const items = products.filter((product) => {
    if (category === "new" && !product.isNew) return false;
    if (category && category !== "new" && product.productType !== category)
      return false;
    if (
      query &&
      !`${product.name} ${product.description} ${product.category} ${product.colour}`
        .toLowerCase()
        .includes(query)
    )
      return false;
    return true;
  });

  res.json(
    ListCurvyRailsProductsResponse.parse({
      items,
      categories: [...new Set(items.map((item) => item.category))].sort(),
      sizes: [...new Set(items.flatMap((item) => item.sizes))],
    }),
  );
});

router.get("/curvy-rails/products/:slug", (req, res): void => {
  const parsed = GetCurvyRailsProductParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid product identifier" });
    return;
  }

  const product = products.find((item) => item.slug === parsed.data.slug);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(
    GetCurvyRailsProductResponse.parse({
      product,
      experiences: experiences.filter((item) => item.productSlug === product.slug),
      questions: questions.filter((item) => item.productSlug === product.slug),
      relatedProducts: products
        .filter((item) => item.slug !== product.slug)
        .slice(0, 3),
    }),
  );
});

router.get("/curvy-rails/community", (_req, res): void => {
  res.json(
    GetCurvyRailsCommunityResponse.parse({ summary, experiences, questions }),
  );
});

router.get("/curvy-rails/my-rail", (_req, res): void => {
  res.json(GetCurvyRailsMyRailResponse.parse(demoMyRail));
});

router.get("/curvy-rails/admin/overview", (_req, res): void => {
  res.json(GetCurvyRailsAdminOverviewResponse.parse(demoAdminOverview));
});

export default router;
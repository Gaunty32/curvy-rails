import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, productCategoriesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/product-categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select()
    .from(productCategoriesTable)
    .orderBy(asc(productCategoriesTable.name));
  res.json(categories);
});

export default router;

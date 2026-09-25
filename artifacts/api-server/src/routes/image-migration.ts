/**
 * One-shot WordPress media migration.
 *
 * Downloads every remaining wp-content image referenced by catalogue records into
 * public object storage, then rewrites the database to use the permanent local
 * serving URLs. Safe to rerun: stored object names are derived from the source URL.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { persistProductImage } from "../services/product-image-storage.js";

const router = Router();
// Historical source-business media is intentionally not transferred.
const STATIC_WORDPRESS_ASSET_URLS: string[] = [];

type ProductImageRow = {
  id: number;
  image_url: string | null;
  gallery_images: string[] | string | null;
};

function galleryFor(value: ProductImageRow["gallery_images"]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((url): url is string => typeof url === "string");
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

function isLegacyWordPressImage(url: string | null | undefined): url is string {
  return typeof url === "string" && url.includes("/wp-content/uploads/");
}

async function getLegacyImageRows() {
  const [products, variants, categories, selectExtraOffers, settings] = await Promise.all([
    db.execute(sql`
      SELECT id, image_url, gallery_images
      FROM products
      WHERE image_url LIKE '%/wp-content/uploads/%'
         OR gallery_images::text LIKE '%/wp-content/uploads/%'
    `),
    db.execute(sql`
      SELECT id, image_url
      FROM product_variants
      WHERE image_url LIKE '%/wp-content/uploads/%'
    `),
    db.execute(sql`
      SELECT id, image_url
      FROM product_categories
      WHERE image_url LIKE '%/wp-content/uploads/%'
    `),
    db.execute(sql`
      SELECT id, image_url
      FROM select_extra_offers
      WHERE image_url LIKE '%/wp-content/uploads/%'
    `),
    db.execute(sql`
      SELECT key, value
      FROM settings
      WHERE value LIKE '%/wp-content/uploads/%'
    `),
  ]);

  return {
    products: products.rows as ProductImageRow[],
    variants: variants.rows as Array<{ id: number; image_url: string | null }>,
    categories: categories.rows as Array<{ id: number; image_url: string | null }>,
    selectExtraOffers: selectExtraOffers.rows as Array<{ id: number; image_url: string | null }>,
    settings: settings.rows as Array<{ key: string; value: string | null }>,
  };
}

router.get("/image-migration/status", async (_req: Request, res: Response): Promise<void> => {
  const { products, variants, categories, selectExtraOffers, settings } = await getLegacyImageRows();
  const urls = new Set<string>();
  let galleryReferences = 0;

  for (const product of products) {
    if (isLegacyWordPressImage(product.image_url)) urls.add(product.image_url);
    for (const url of galleryFor(product.gallery_images)) {
      if (isLegacyWordPressImage(url)) {
        urls.add(url);
        galleryReferences++;
      }
    }
  }
  for (const row of [...variants, ...categories, ...selectExtraOffers]) {
    if (isLegacyWordPressImage(row.image_url)) urls.add(row.image_url);
  }
  for (const setting of settings) {
    if (isLegacyWordPressImage(setting.value)) urls.add(setting.value);
    if (setting.key === "shop_team_members") {
      try {
        for (const member of JSON.parse(setting.value ?? "[]")) {
          if (isLegacyWordPressImage(member?.photoUrl)) urls.add(member.photoUrl);
        }
      } catch {
        // The setting is reported below and will be left untouched if malformed.
      }
    }
  }

  res.json({
    uniqueLegacyUrls: urls.size,
    products: products.length,
    variants: variants.length,
    categories: categories.length,
    selectExtraOffers: selectExtraOffers.length,
    settings: settings.length,
    galleryReferences,
    readyToSwitchOffWordPress: urls.size === 0,
  });
});

router.post("/image-migration/download-from-wp", async (_req: Request, res: Response): Promise<void> => {
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    res.status(500).json({ error: "Object storage is not configured" });
    return;
  }

  const { products, variants, categories, selectExtraOffers, settings } = await getLegacyImageRows();
  const sourceUrls = new Set<string>(STATIC_WORDPRESS_ASSET_URLS);

  for (const product of products) {
    if (isLegacyWordPressImage(product.image_url)) sourceUrls.add(product.image_url);
    for (const url of galleryFor(product.gallery_images)) {
      if (isLegacyWordPressImage(url)) sourceUrls.add(url);
    }
  }
  for (const row of [...variants, ...categories, ...selectExtraOffers]) {
    if (isLegacyWordPressImage(row.image_url)) sourceUrls.add(row.image_url);
  }
  for (const setting of settings) {
    if (isLegacyWordPressImage(setting.value)) sourceUrls.add(setting.value);
    if (setting.key === "shop_team_members") {
      try {
        for (const member of JSON.parse(setting.value ?? "[]")) {
          if (isLegacyWordPressImage(member?.photoUrl)) sourceUrls.add(member.photoUrl);
        }
      } catch {
        errors.push("shop_team_members is not valid JSON");
      }
    }
  }

  const urlMap = new Map<string, string>();
  const errors: string[] = [];
  const urls = [...sourceUrls];
  const BATCH_SIZE = 8;

  for (let index = 0; index < urls.length; index += BATCH_SIZE) {
    await Promise.all(urls.slice(index, index + BATCH_SIZE).map(async (sourceUrl) => {
      try {
        const storedUrl = await persistProductImage(sourceUrl);
        if (!storedUrl) throw new Error("Storage did not return a URL");
        urlMap.set(sourceUrl, storedUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${sourceUrl}: ${message}`);
      }
    }));
  }

  let databaseUpdates = 0;
  const rewritten = (url: string | null): string | null => url ? (urlMap.get(url) ?? null) : null;

  for (const product of products) {
    const primary = rewritten(product.image_url);
    const gallery = galleryFor(product.gallery_images);
    const nextGallery = gallery.map((url) => urlMap.get(url) ?? url);
    const galleryChanged = JSON.stringify(gallery) !== JSON.stringify(nextGallery);

    if (primary || galleryChanged) {
      await db.execute(sql`
        UPDATE products
        SET image_url = COALESCE(${primary}, image_url),
            gallery_images = CASE
              WHEN ${galleryChanged} THEN ${JSON.stringify(nextGallery)}::jsonb
              ELSE gallery_images
            END,
            updated_at = NOW()
        WHERE id = ${product.id}
      `);
      databaseUpdates++;
    }
  }

  for (const row of variants) {
    const storedUrl = rewritten(row.image_url);
    if (!storedUrl) continue;
    await db.execute(sql`UPDATE product_variants SET image_url = ${storedUrl} WHERE id = ${row.id}`);
    databaseUpdates++;
  }

  for (const row of categories) {
    const storedUrl = rewritten(row.image_url);
    if (!storedUrl) continue;
    await db.execute(sql`UPDATE product_categories SET image_url = ${storedUrl} WHERE id = ${row.id}`);
    databaseUpdates++;
  }
  for (const row of selectExtraOffers) {
    const storedUrl = rewritten(row.image_url);
    if (!storedUrl) continue;
    await db.execute(sql`UPDATE select_extra_offers SET image_url = ${storedUrl} WHERE id = ${row.id}`);
    databaseUpdates++;
  }
  for (const setting of settings) {
    let updatedValue: string | null = null;
    if (setting.key === "shop_team_members") {
      try {
        const members = JSON.parse(setting.value ?? "[]");
        const nextMembers = members.map((member: any) => ({
          ...member,
          photoUrl: urlMap.get(member?.photoUrl) ?? member?.photoUrl,
        }));
        const nextValue = JSON.stringify(nextMembers);
        if (nextValue !== setting.value) updatedValue = nextValue;
      } catch {
        // This was added to errors above; do not replace a malformed setting.
      }
    } else {
      updatedValue = rewritten(setting.value);
    }
    if (!updatedValue) continue;
    await db.execute(sql`
      UPDATE settings
      SET value = ${updatedValue}, updated_at = NOW()
      WHERE key = ${setting.key}
    `);
    databaseUpdates++;
  }

  const remaining = await getLegacyImageRows();
  const remainingReferences =
    remaining.products.length + remaining.variants.length + remaining.categories.length +
    remaining.selectExtraOffers.length + remaining.settings.length;

  res.json({
    totalUrls: urls.length,
    storedUrls: urlMap.size,
    databaseUpdates,
    failedUrls: errors.length,
    errors: errors.slice(0, 30),
    staticAssets: STATIC_WORDPRESS_ASSET_URLS.map((sourceUrl) => ({
      sourceUrl,
      storedUrl: urlMap.get(sourceUrl) ?? null,
    })),
    remainingRecordsWithLegacyUrls: remainingReferences,
    readyToSwitchOffWordPress: errors.length === 0 && remainingReferences === 0,
  });
});

export default router;
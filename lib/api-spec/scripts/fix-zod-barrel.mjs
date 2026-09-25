import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Orval emits both runtime Zod schemas and TypeScript interfaces named
// Create*/Update* into the same barrel. The duplicate names make TypeScript
// reject the package. Consumers of @workspace/api-zod use the runtime schemas;
// generated interfaces remain available from the generated/types path.
const indexPath = resolve(import.meta.dirname, "../../api-zod/src/index.ts");
await writeFile(indexPath, 'export * from "./generated/api";\n');

// Orval v8 currently emits the Zod 4 `z.int()` shorthand even when the
// consumer package uses Zod 3. Keep generated runtime schemas compatible
// with the workspace's Zod 3 dependency.
const generatedApiPath = resolve(import.meta.dirname, "../../api-zod/src/generated/api.ts");
const generatedApi = await readFile(generatedApiPath, "utf8");
await writeFile(generatedApiPath, generatedApi.replaceAll("zod.int()", "zod.number().int()"));
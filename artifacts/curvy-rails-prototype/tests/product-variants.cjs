const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const store = new Map();
const localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
};
function load(file, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/data', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInNewContext(code, {
    exports, localStorage,
    require: (name) => { if (!(name in modules)) throw new Error(`Missing test dependency: ${name}`); return modules[name]; },
  });
  return exports;
}
const types = load('types.ts');
const seed = load('seed.ts', { './types': types });
const delivery = load('delivery.ts');
const react = { createContext: () => ({}) };
const { normalizeBasket } = load('basket.tsx', {
  react, './catalogue': {}, './types': types, './delivery': delivery,
});
const product = seed.FIRST_PRODUCT;
const legacy = { ...product, name: 'Preserved edit', image: 'assets/custom-white.webp', variants: undefined };
store.set('cr.demo.catalogue.v1', JSON.stringify([legacy]));
store.set('cr.demo.catalogue.patience-added', 'true');
const repo = load('repository.ts', { './types': types, './seed': seed }).localProductRepository;
const upgraded = repo.list()[0];
assert.equal(upgraded.name, 'Preserved edit');
assert.equal(upgraded.variants.length, 2);
assert.equal(types.productForColour(upgraded, 'White').image, 'assets/custom-white.webp');
assert.equal(types.productForColour(upgraded, 'Black').image, 'assets/patience-sold-separately-black.webp');
assert.equal(JSON.parse(store.get('cr.demo.catalogue.v1'))[0].variants.length, 2);
repo.save({ ...upgraded, image: 'assets/edited-white.webp' });
assert.equal(types.productForColour(repo.list()[0], 'White').image, 'assets/edited-white.webp');
assert.equal(types.productForColour(repo.list()[0], 'Black').image, 'assets/patience-sold-separately-black.webp');
const blackDefault = types.productForColour(repo.list()[0], 'Black');
repo.save({ ...blackDefault, image: 'assets/edited-black.webp' });
assert.equal(types.productForColour(repo.list()[0], 'Black').image, 'assets/edited-black.webp');
assert.equal(types.productForColour(repo.list()[0], 'White').image, 'assets/edited-white.webp');
const normalized = normalizeBasket([
  { productId: product.id, size: '20', qty: 2 },
  { productId: product.id, size: '16-24', qty: 1, colour: 'White' },
  { productId: product.id, size: '16-24', qty: 2, colour: 'Black' },
], [product]);
assert.equal(normalized.length, 2);
assert.equal(normalized[0].colour, 'White');
assert.equal(normalized[0].qty, 3);
assert.equal(normalized[1].colour, 'Black');
assert.equal(normalized[1].qty, 2);
for (const variant of product.variants) {
  assert.equal(variant.images.length, 2);
  for (const file of [...variant.images, ...(variant.artwork ? [variant.artwork] : [])]) {
    assert.ok(fs.existsSync(path.join(__dirname, '../public', file)), `Missing ${file}`);
  }
}
for (const item of seed.SEED_PRODUCTS) assert.equal(item.price, item.category === 'tshirt' ? 20 : 35);
assert.equal(delivery.calculateDelivery(50, 'mainland').delivery, 3.99);
assert.equal(delivery.calculateDelivery(50.01, 'mainland').delivery, 0);
assert.equal(delivery.calculateDelivery(60, 'outside-mainland').total, null);
console.log('PASS: catalogue upgrade preserves edits, variant edits remain separate, legacy basket quantities and colours survive, all variant assets exist, and prices/delivery remain correct.');

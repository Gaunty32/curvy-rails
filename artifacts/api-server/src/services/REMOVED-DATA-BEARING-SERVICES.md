# Services intentionally excluded from this working copy

`email.ts` and `startup-migrations.ts` were removed from the staged copy.
They contained extensive current-installation identity, contact details,
financial/payment information, embedded branded assets, historical repairs,
business-specific seeds, and outbound message templates. They require a
separate generic rewrite before this copy can be executable.

The remaining historical route/service imports are intentionally unreachable:
`src/index.ts` remains a fail-closed throw and the staged `app.ts` is
setup-only. Do not restore these modules from the original project. Rebuild
generic email rendering around `business_config`, and create reviewed clean
bootstrap migrations from the schema baseline instead.

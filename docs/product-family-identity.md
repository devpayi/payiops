# Product family identity across sales and ads

The product sales dashboard and the ad spend dashboard retain their existing source mappings and calculations. Sales orders resolve to master SKUs through `skuMapping` and form the existing sales groups. Ad report Product IDs resolve through `ad_product_mappings` to a family in the Ops catalog. The ad mapping does not create another display name.

Both APIs now read product families from the same catalog loader. Each sales group additionally returns `familyKey` and `familyLinkStatus` for its selected calendar month (or all included months when `month=all`):

- `linked`: every source business/SKU in the sales group belongs to exactly one catalog family. `familyKey` matches the ad group's mapped `familyKey` and is safe for a product detail join.
- `unmatched`: at least one source business/SKU has no catalog family. `familyKey` is `null`.
- `ambiguous`: sources in one sales group point to multiple families, including a group shared across businesses. `familyKey` is `null`; never allocate the aggregate revenue by name.
- `unavailable`: the catalog could not be loaded. Sales totals still render and `familyKey` is `null`.

One Ops family may correspond to several existing sales groups, such as shoe sizes the Pricing catalog combines. A detail view must aggregate all `linked` sales groups with the same `familyKey`, while fetching the ad total through that same key. It must keep order revenue separate from platform-attributed ad sales, which can overlap across platforms. A sales group marked `ambiguous` needs a SKU-level query before its revenue can be assigned to a family.

The current family key is derived from business and the Ops grouping rule. A future change to that grouping rule or a family rename must migrate saved `ad_product_mappings` keys and recheck the bridge before rollout. Treat `familyKey` as the current catalog identity, not an immutable database ID. Do not join products by display name.

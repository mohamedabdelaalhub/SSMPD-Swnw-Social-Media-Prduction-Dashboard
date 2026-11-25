# Center price list «قائمة أسعار سونو / دار النقاهة» — standing rules

The active center list is the anchor for every price in the dashboard: cash prices, contract/union lists that link their rows to
Sono services, offers and reception services. Live changes go through the main chat after the owner's «انشر» / «طبق».

## Rules that a new version or clone must keep
| Setting | Value | Why / source |
|---|---|---|
| `allow_extra_discount` | **true** («نعم وفق صلاحيات الاستقبال») | Owner 2026-11-25 «افتح الخصم على قايمة المركز». With false, `guard_order_discount` refused every booking discount (نقابات 30%، فيزيتا، كارت العيلة، خاص) at arrival. Applied live 19:15Z (audit `owner_allow_extra_discount`). The clone form copies the source value — check it stays «نعم» when a new version is made. |
| `fallback` | `base` | Services not in the list keep their own base price (e.g. 0001402 chin laser 200, 0001403 «جلسة ديرما بن أمبر» 1500). |
| one active center list per period | — | `decide_list` refuses an overlapping active center version: end the current one before activating a new one. |

Offer lists (`list_kind='offer'`, e.g. White Friday) keep `allow_extra_discount=false`: «خصم واحد بس» — the patient gets the offer
or the union discount, never both (mig 20261123160000 / 20261123190000, `offer_no_other_discount`).

## Owner price decisions applied in place (2026-11-25)
| Service | Change | Path |
|---|---|---|
| 0001402 «جلسة ليزر تحديد الذقن (إزالة شعر الذقن والشارب) كانديلا» | new, 200 fixed, not in any offer | `tests/price-matching/26` |
| 0001403 «جلسة ديرما بن أمبر» | new, 1500 | `tests/price-matching/31` |
| 0001260 «جلسة تنظيف بشرة عميق» | 600 → 800 in the active center list item | `tests/price-matching/32` (audit `owner_item_price_change`) |

A new center version must carry these prices (0001260 at 800). New services 0001402/0001403 are priced by fallback `base`; if a new
version lists them, use the same prices.

## Packages
Package prices from the owner's sheet (2026-11-25) are pinned with `pricing_packages.booking_fixed_price`
(mig 20261125120000): they do not move when a service price changes. Packages without a fixed price follow
Σ service prices × (1 + margin) and DO move with the center list.

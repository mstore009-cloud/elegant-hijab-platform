# Meta Catalog fields reference

Source: https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/fields

Key verified fields from Meta's official Catalog Fields documentation (updated Jan 13, 2025):

- `link`: must be a valid URL hosted on the merchant's business website; Meta says not to provide a Facebook domain or another external destination.
- `image_link`: main JPEG/PNG image URL; Meta specifies at least 500x500 and up to 8 MB.
- `additional_image_link`: a string containing up to 20 additional image URLs.
- `item_group_id`: same group ID for variants of one product, including size/color variants.
- `fb_product_category`: most specific Facebook product category name or ID.
- `color`: main color as words, not hex.
- `material`: material of the item, such as cotton, polyester, denim, or leather.
- `video[0].url` through `video[19].url`: up to 20 direct-download video URLs; Meta specifies direct video file links, not player pages, with maximum file size 200 MB and listed supported formats.
- `additional_variant_attribute`: for non-core variant attributes; Meta says not to use a core attribute such as size or color in this field.

Design consequence: a WhatsApp `wa.me` URL is not a valid final `link` under Meta's standard field guidance because `link` must be hosted on the merchant's website. The implementation should use a first-party product landing URL on the platform with a WhatsApp CTA, and keep the WhatsApp URL as a configurable CTA/redirect target rather than directly putting it in `link` unless Meta's live validation explicitly accepts it.

Media consequence: the exporter must use publicly reachable direct high-quality URLs. OneDrive web preview URLs are not necessarily direct downloadable media links, so original-media URL resolution needs an explicit signed/public delivery path that preserves origin quality without copying bytes into the platform's operational storage.

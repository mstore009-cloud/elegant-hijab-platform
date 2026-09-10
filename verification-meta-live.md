# Meta Catalog live verification

- Catalog URL checked in Meta Commerce Manager: https://business.facebook.com/commerce/catalogs/998320369206650/products?business_id=7507630669304075
- Catalog ID: `998320369206650`.
- Product group inspected: `h04` / `حجاب اميرة جكار لمع`.
- Meta Commerce Manager showed the group as **Eligible**, with 7 variants and last updated at `11 Sep at 00:24`.
- Expanded h04 showed all seven content IDs: `h04-1170001`, `h04-1170003`, `h04-1440001`, `h04-1170004`, `h04-1440004`, `h04-1440003`, and `h04-1440002`.
- Opened content item `h04-1170001` in the detail panel. The visible **Product link** was `https://wa.me/message/EL7M7TRX6QQVN1/h04`.
- The Graph API v26 product-items read endpoint does not expose the `link` field (direct read returned Meta error `(#100) Tried accessing nonexisting field (link)`), so the link was verified in the Commerce Manager UI after the successful live export.
- Live test result: `META_CATALOG_LINK_LIVE_CHECK=1 pnpm vitest run server/integrations/meta/catalogLink.live.test.ts` passed; export status `completed`, `reused: false`, and all seven expected retailer IDs were found in Meta.

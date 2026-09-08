# ملاحظات مصدر Facebook Product Taxonomy

## نتيجة التحقق

تؤكد وثائق Meta الرسمية أن حقل `fb_product_category` يعتمد Facebook Product Taxonomy، وأنه يقبل **معرّف الفئة الرقمي** أو **مسارها الهرمي**. كما توفر Meta ملف قائمة الفئات بالإنجليزية الأمريكية بصيغة نصية على الرابط التالي، وهو المصدر الذي ستستخرجه المنصة إلى سجل بحثي داخلي قابل للتحديث:

`https://www.facebook.com/products/categories/en_US.txt`

تشير الوثائق أيضاً إلى أن تزويد فئة المنتج يسمح باستخدام الحقول الإضافية الخاصة بالفئة لتقديم وصف أدق للعنصر. لا ينبغي تثبيت قيمة مثل Clothing & Accessories في الكود؛ بل تُحفظ الفئة التي يختارها مدير المتجر ومعرّفها الرسمي في إعدادات المتجر أو في الاستثناء المنطبق.

## المصادر

1. [Meta for Developers — Product categories: Catalog](https://developers.facebook.com/documentation/ads-commerce/catalog/guides/product-categories)
2. [Facebook Product Categories — en_US.txt](https://www.facebook.com/products/categories/en_US.txt)

## ملاحظات طلب التحديث الدفعي

وفق مرجع `Product Item` الرسمي، يجب أن يكون مُعرّف العنصر `retailer_id` على مستوى كل طلب داخل مصفوفة `requests` في `items_batch`، بينما تنتقل الحقول القابلة للعرض داخل `data`. تُستخدم أسماء الحقول البرمجية الرسمية مثل `name` و`description` و`url` و`image_url` و`additional_image_urls` و`fb_product_category` و`retailer_product_group_id`. كذلك يوضح المرجع أن الفيديوهات تظهر في حقل `videos` ككائنات تحتوي رابطًا، وتوضح وثائق فيديو الكتالوج أن إدخال الفيديو يتم من حقل `video` في طلب `items_batch`.

لا يجب وضع `retailer_id` داخل `data`؛ إذ أظهرت استجابة Meta الحية تحذير `Unrecognised field` عند إرساله هناك. كما يجب تحويل أي رابط تخزين نسبي مثل `/manus-storage/...` إلى رابط HTTPS عام قبل أن يقرأ الخادم الوسيط أو تطلبه Meta.

3. [Meta for Developers — Product Item](https://developers.facebook.com/docs/marketing-api/reference/product-item/)
4. [Meta for Developers — Catalog Batch API](https://developers.facebook.com/docs/marketing-api/catalog-batch/)
5. [Meta for Developers — Allow Product Video](https://developers.facebook.com/documentation/ads-commerce/marketing-api/advantage-catalog-ads/allow-product-video)

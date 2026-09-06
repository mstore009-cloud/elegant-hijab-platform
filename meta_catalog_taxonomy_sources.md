# ملاحظات مصدر Facebook Product Taxonomy

## نتيجة التحقق

تؤكد وثائق Meta الرسمية أن حقل `fb_product_category` يعتمد Facebook Product Taxonomy، وأنه يقبل **معرّف الفئة الرقمي** أو **مسارها الهرمي**. كما توفر Meta ملف قائمة الفئات بالإنجليزية الأمريكية بصيغة نصية على الرابط التالي، وهو المصدر الذي ستستخرجه المنصة إلى سجل بحثي داخلي قابل للتحديث:

`https://www.facebook.com/products/categories/en_US.txt`

تشير الوثائق أيضاً إلى أن تزويد فئة المنتج يسمح باستخدام الحقول الإضافية الخاصة بالفئة لتقديم وصف أدق للعنصر. لا ينبغي تثبيت قيمة مثل Clothing & Accessories في الكود؛ بل تُحفظ الفئة التي يختارها مدير المتجر ومعرّفها الرسمي في إعدادات المتجر أو في الاستثناء المنطبق.

## المصادر

1. [Meta for Developers — Product categories: Catalog](https://developers.facebook.com/documentation/ads-commerce/catalog/guides/product-categories)
2. [Facebook Product Categories — en_US.txt](https://www.facebook.com/products/categories/en_US.txt)

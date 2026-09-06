# متطلبات إثراء Meta Catalog

تُستخدم هذه الوثيقة كأساس تقني لطبقة الإثراء قبل التصدير. لا تغيّر الإعدادات أو المنتجات الموجودة.

## الحقول الأساسية التي تتحقق منها المنصة قبل التصدير

يتطلب Meta Catalog لكل عنصر: `id` فريد، `title`، `description`، `availability`، `condition`، `price` بصيغة عملة ISO، `link`، وصورة رئيسية عبر `image` أو `image_link`، و`brand`. يجب أن يطابق `id` معرفاً ثابتاً يستخدمه Pixel عند تفعيل الإعلانات الديناميكية.

## الحقول التي ستديرها طبقة الإثراء

| المصدر | الحقول |
|---|---|
| إعداد المتجر | العلامة التجارية، العملة، الحالة، الجنس، الفئة العمرية، فئة Facebook الافتراضية، رابط قاعدة المنتجات، رابط WhatsApp البديل، وسياسة نشر الوسائط |
| المنتج | استثناء فئة Facebook، الخامة، النقشة، الرابط، نوع المنتج، وسياسات خاصة بالوسائط |
| اللون والقياس | `color` و`size` و`item_group_id` ومخزون كل متغير |
| وسائط OneDrive | صورة رئيسية، صور إضافية، وفيديوهات بروابط مباشرة قابلة للوصول العام عند توافرها |

لا تُرسل المنصة حقلاً افتراضياً مضللاً إذا لم تتوفر قيمته. تعرض المعاينة سبب النقص أو الاستبعاد قبل أن يسمح زر التصدير بإرسال أي دفعة.

## المراجع

1. [Product data specifications for catalogs in Commerce Manager](https://www.facebook.com/business/help/120325381656392)
2. [Catalog Fields — Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/fields)
3. [About variants in your catalog](https://www.facebook.com/business/help/363060785327110)
4. [Product Catalog Items Batch — Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/items_batch)

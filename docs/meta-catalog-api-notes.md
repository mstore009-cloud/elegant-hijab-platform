# ملاحظات Meta Catalog API

## قرار التنفيذ

سيُستخدم `POST /{catalog_id}/items_batch` لمسارات CREATE وUPDATE وDELETE، وليس endpoint `/batch` القديم. توضح وثائق Meta أن `items_batch` يقبل حتى 5000 سجلاً، ويوصى بأقل من 3000 سجلاً وحمولة لا تتجاوز 28 MB. يعيد endpoint handles وحالة تحقق لكل `retailer_id`، ويمكن استخدام handle مع `check_batch_request_status` حتى اكتمال المعالجة.

في الإصدار الأول من المنصة سيُسمح بالتصدير للمنتجات التي حالتها `active` فقط، مع منع المنتجات `draft` و`needs_review`، ومنع `costPrice` و`margin` وأي بيانات مالية داخلية من الحمولة. سيُستخدم `retailer_id` مستقر مبني على product code/variant code، وستُرسل الصورة العامة التشغيلية فقط عندما تكون URL قابلة للوصول العام وآمنة.

## الحقول الأساسية المطلوبة

| حقل Meta | مصدره داخل المنصة | قاعدة السلامة |
|---|---|---|
| `id` / `retailer_id` | product code أو variant code | ثابت وغير مكرر داخل المتجر |
| `title` | اسم المنتج واسم اللون/القياس عند الحاجة | لا يضم حقولاً داخلية |
| `description` | وصف المنتج | يرشح ويحد إلى 5000 حرف |
| `availability` | مجموع مخزون المتغير | `in stock` عند كمية موجبة وإلا `out of stock` |
| `condition` | ثابت `new` | لا يُستنتج من نص العميل |
| `brand` | اسم المتجر/العلامة | قيمة معلنة فقط |
| `price` | السعر الحالي فقط | لا يرسل سعر التكلفة أو الهامش |
| `image` / `image_link` | public/operational image URL | لا تُرسل روابط OneDrive الخاصة أو الرموز |
| `color` | لون المتغير | اختياري ومحدود الطول |

## قيود التشغيل

لا يُنشأ كتالوج جديد تلقائياً من داخل مسار التصدير، ولا يُرسل أي طلب قبل أن يحدد المشغل Catalog asset ويملك Meta capability المناسبة. يجب تسجيل كل batch في سجل خاص بالمتجر مع payload hash وidempotency key وhandle وvalidation status. إعادة إرسال نفس snapshot يجب أن تعيد السجل القائم أو تنتج no-op، لا أن تنشئ دفعات متكررة بلا داعٍ.

## المراجع الرسمية

[1]: https://developers.facebook.com/documentation/ads-commerce/catalog/guides/manage-catalog-items/catalog-batch-api "Meta Catalog Batch API"
[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/items_batch "Meta Product Catalog Items Batch"
[3]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/batch "Meta Product Catalog Batch (legacy guidance)"

# نتيجة بحث فيديو Meta مع المتغيرات

توضح وثائق Meta الرسمية أن المتغيرات ليست سجلات تابعة قابلة للتحديث تحت منتج أب مستقل؛ بل تُنشأ بإرسال عدة Product Items لها القيمة نفسها في `item_group_id`، وتمثل Meta المنتج الأب كـ virtual parent. لذلك فإن حقول الوسائط مثل `video` تُرسل على مستوى Product Item. لكي يتوفر فيديو عام عند فتح مجموعة المنتج، يجب أن يُنسخ رابط الفيديو العام إلى كل Product Item داخل المجموعة، مع بقاء الفيديو الخاص بمتغير معين في متغيره فقط.

المصدر الرسمي: https://developers.facebook.com/documentation/ads-commerce/catalog/guides/product-variants

توضح وثائق Meta الخاصة بالفيديو أن Batch API يقبل `video` كمصفوفة روابط على Product Item، وأن `videos` و`videos_metadata` و`video_fetch_status` يمكن قراءتها من Product Item API. كما أن الفيديو متاح للإعلانات من الكتالوج، وليس هناك حقل مستقل لوسيط على المنتج الأب الافتراضي.

المصدر الرسمي: https://developers.facebook.com/documentation/ads-commerce/marketing-api/advantage-catalog-ads/allow-product-video

بناءً على ذلك، عُدّل الباني ليجمع الوسائط العامة ذات `variantId = null` مع وسائط المتغير، ثم يرسل الفيديو العام إلى كل متغير ضمن `item_group_id` نفسه. أضيف اختبار عقد يثبت أن اللونين يشتركان في فيديو المنتج العام، بينما يبقى فيديو لون واحد محصورًا في ذلك اللون.

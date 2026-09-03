# أدلة وصول Instagram Messaging

## حالة التحقق الحالية

في 2026-09-03، أكد اختبار المستخدم أن تطبيق Meta منشور، وحساب Instagram المحدد متصل، وحالة اشتراك التطبيق والصفحة المرتبطة جاهزة من داخل المنصة. مع ذلك، لم يُسجَّل حدث Instagram وارد جديد في `channel_webhook_events` بعد إرسال رسالة Direct من حساب أعمال آخر ضمن المحفظة نفسها.

أظهرت لقطة لوحة Meta أن صلاحية `instagram_business_manage_messages` بحالة **Ready for testing** وليست Advanced Access.

## مراجع Meta الرسمية

1. [Webhooks for Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks) — محدّث في 26 يونيو 2026. يذكر أن استقبال Webhooks لرسائل Instagram يتطلب `instagram_basic` و`instagram_manage_messages` و`pages_manage_metadata`، وأن التطبيق يجب أن يكون منشوراً. كما يذكر أن بيانات الأشخاص الذين لا يملكون دوراً في التطبيق تتطلب موافقة App Review.
2. [App Review for Instagram API](https://developers.facebook.com/documentation/instagram-platform/app-review) — محدّث في 30 يونيو 2026. يوضح فرق المسارين: Instagram API مع Facebook Login يستخدم `instagram_manage_messages`، بينما Instagram Login يستخدم `instagram_business_manage_messages`. ولتطبيق Tech Provider يخدم أعمالاً متعددة يلزم Advanced Access وApp Review. كما يوضح عناصر الطلب: إعدادات التطبيق، إرشادات اختبار للمراجع، وصف لكل صلاحية، وتسجيل شاشة يوضح الاستخدام.
3. [App Roles](https://developers.facebook.com/documentation/development/build-and-test/app-roles) — محدّث في 8 سبتمبر 2025. يوضح أن أدوار التطبيق تُمنح للأشخاص عبر لوحة التطبيق أو Business Manager، ولا تُمنح تلقائياً لأصول المحفظة. يمكن دعوة المستخدم كـTester ويجب أن يقبل الدعوة.
4. [Setup Webhooks Subscriptions](https://developers.facebook.com/documentation/instagram-platform/webhooks) — محدّث في 3 مارس 2026. يوضح أن Messenger API support for Instagram يستخدم Facebook User أو Page access token وFacebook Page ID، وأن تسلسل الإعداد هو: endpoint، ثم حقول التطبيق من لوحة Meta، ثم تفعيل اشتراك حساب Instagram/الصفحة عبر `POST /me/subscribed_apps`، ثم إرسال رسالة اختبار. كما يبيّن أن `messages` و`messaging_postbacks` لقناة Instagram Messaging تعتمد `instagram_basic` و`instagram_manage_messages` و`pages_manage_metadata` و`pages_read_engagement` و`pages_show_list`.
5. [Get started with Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started) — محدّث في 1 أبريل 2026. يؤكد أن Instagram Messaging API يدعم Facebook Login for Business، ويوصي بتفعيل Connected Tools > Allow Access to Messages في الحساب الاحترافي، ويشير إلى Instagram setup tool تحت Developer App Dashboard → Messenger → Instagram Settings عندما يكون متاحاً.

## قرار تشخيصي قيد التحقق

لا يجوز افتراض أن حالة `Ready for testing` وحدها هي السبب النهائي قبل تنفيذ قراءة Graph فعلية لاشتراك `instagram` في التطبيق والصفحة المرتبطة. يجب أن تتحقق المنصة من callback URL ووجود حقل `messages` فعلياً، بدلاً من اعتبار نجاح POST للاشتراك دليلاً نهائياً على الاستقبال.

## تقوية الفحص في المنصة

أضيف فحص Graph فعلي لمسار إصلاح استقبال Instagram. يفحص الفحص الآن سجل `/{app-id}/subscriptions` للتأكد من وجود كائن `instagram` على رابط callback المنشور وحقول `messages` و`messaging_postbacks` و`comments` و`mentions`، ثم يفحص `/{page-id}/subscribed_apps` للتأكد من ارتباط التطبيق بالصفحة المرتبطة ووجود حقل `messages`.

إذا فشل هذا الفحص، تتحول حالة القناة إلى اختبار مع سبب محدد بدلاً من عرض `Ready` زائف. إذا نجح، يبقى السبب التالي المرشح هو مستوى الوصول أو اختلاف مسار تسجيل الدخول الظاهر في App Review، ويجب التحقق منه من لوحة Meta قبل تقديم طلب وصول.

## تصحيح مسار التشخيص

لقطات 2026-09-03 أظهرت أن `instagram_manage_messages` يملك 4 API test calls وهو المسار المستخدم فعلياً مع Facebook Login for Business. أما `instagram_business_manage_messages` بعدد صفر فيخص Instagram Login ولا ينبغي تفعيله أو إكمال اختباره لهذه المنصة. حالة Testing in progress للمجموعة لا تعادل حالة اشتراك Webhook ولا ينبغي استخدامها كدليل أن Messenger أو Instagram غير عاملين.

## القرار التنفيذي المصحح

توضح مرجعية `/{app-id}/subscriptions` أن Instagram Webhooks لا تُدار عبر POST إلى هذا الطرف؛ تضبط حقول التطبيق من App Dashboard. لذلك أزيلت محاولة المنصة لإنشاء كائن `instagram` برمجياً، كما أزيلت مطالبة الصحة بقراءة حقول Instagram من الطرف نفسه. ما تبقى قابلاً للتحقق آلياً هو ربط التطبيق بالصفحة المرتبطة عبر `/{page-id}/subscribed_apps` وحقل `messages`.

تنبه واجهة المنصة الآن بوضوح إلى أن حقول Instagram يجب ضبطها من **Meta → Webhooks → Instagram**، وأن الاختبار التشغيلي التالي هو رسالة Direct بعد تفعيل `messages` و`messaging_postbacks` في لوحة Meta، مع تفعيل **Connected Tools → Allow Access to Messages** في حساب Instagram الاحترافي. لا تتحول القناة إلى متصلة نهائياً قبل وصول أول رسالة فعلية.

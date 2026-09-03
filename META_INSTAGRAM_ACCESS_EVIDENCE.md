# أدلة وصول Instagram Messaging

## حالة التحقق الحالية

في 2026-09-03، أكد اختبار المستخدم أن تطبيق Meta منشور، وحساب Instagram المحدد متصل، وحالة اشتراك التطبيق والصفحة المرتبطة جاهزة من داخل المنصة. مع ذلك، لم يُسجَّل حدث Instagram وارد جديد في `channel_webhook_events` بعد إرسال رسالة Direct من حساب أعمال آخر ضمن المحفظة نفسها.

أظهرت لقطة لوحة Meta أن صلاحية `instagram_business_manage_messages` بحالة **Ready for testing** وليست Advanced Access.

## مراجع Meta الرسمية

1. [Webhooks for Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks) — محدّث في 26 يونيو 2026. يذكر أن استقبال Webhooks لرسائل Instagram يتطلب `instagram_basic` و`instagram_manage_messages` و`pages_manage_metadata`، وأن التطبيق يجب أن يكون منشوراً. كما يذكر أن بيانات الأشخاص الذين لا يملكون دوراً في التطبيق تتطلب موافقة App Review.
2. [App Review for Instagram API](https://developers.facebook.com/documentation/instagram-platform/app-review) — محدّث في 30 يونيو 2026. يوضح فرق المسارين: Instagram API مع Facebook Login يستخدم `instagram_manage_messages`، بينما Instagram Login يستخدم `instagram_business_manage_messages`. ولتطبيق Tech Provider يخدم أعمالاً متعددة يلزم Advanced Access وApp Review. كما يوضح عناصر الطلب: إعدادات التطبيق، إرشادات اختبار للمراجع، وصف لكل صلاحية، وتسجيل شاشة يوضح الاستخدام.
3. [App Roles](https://developers.facebook.com/documentation/development/build-and-test/app-roles) — محدّث في 8 سبتمبر 2025. يوضح أن أدوار التطبيق تُمنح للأشخاص عبر لوحة التطبيق أو Business Manager، ولا تُمنح تلقائياً لأصول المحفظة. يمكن دعوة المستخدم كـTester ويجب أن يقبل الدعوة.

## قرار تشخيصي قيد التحقق

لا يجوز افتراض أن حالة `Ready for testing` وحدها هي السبب النهائي قبل تنفيذ قراءة Graph فعلية لاشتراك `instagram` في التطبيق والصفحة المرتبطة. يجب أن تتحقق المنصة من callback URL ووجود حقل `messages` فعلياً، بدلاً من اعتبار نجاح POST للاشتراك دليلاً نهائياً على الاستقبال.

## تقوية الفحص في المنصة

أضيف فحص Graph فعلي لمسار إصلاح استقبال Instagram. يفحص الفحص الآن سجل `/{app-id}/subscriptions` للتأكد من وجود كائن `instagram` على رابط callback المنشور وحقول `messages` و`messaging_postbacks` و`comments` و`mentions`، ثم يفحص `/{page-id}/subscribed_apps` للتأكد من ارتباط التطبيق بالصفحة المرتبطة ووجود حقل `messages`.

إذا فشل هذا الفحص، تتحول حالة القناة إلى اختبار مع سبب محدد بدلاً من عرض `Ready` زائف. إذا نجح، يبقى السبب التالي المرشح هو مستوى الوصول أو اختلاف مسار تسجيل الدخول الظاهر في App Review، ويجب التحقق منه من لوحة Meta قبل تقديم طلب وصول.

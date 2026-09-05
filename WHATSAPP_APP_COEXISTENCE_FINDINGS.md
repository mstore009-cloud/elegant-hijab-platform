# WhatsApp Business App Coexistence — Findings

## نتيجة التدقيق

الأرقام الموجودة تحت **WhatsApp Business App** ليست بالضرورة أصول `whatsapp_phone` قابلة للاختيار من قائمة `/owned_whatsapp_business_accounts/{waba}/phone_numbers` في الربط الموحد. توثيق Meta يفرق بين مسار Cloud API المعتاد ومسار **Embedded Signup المخصص لمستخدمي WhatsApp Business App**.

المسار المدعوم للأرقام الموجودة في تطبيق WhatsApp Business للمتاجر **الخارجية** هو إطلاق Embedded Signup مع `featureType: whatsapp_business_app_onboarding` و`sessionInfoVersion: 3`. بعد إكمال التحقق من الرقم وموافقة مشاركة البيانات من تطبيق WhatsApp Business، يعيد التدفق `wabaId` و`phoneNumberId` ورمزاً قابلاً للاستبدال. بعدها يمكن للخادم إنشاء أصل `whatsapp_business` وأصل `whatsapp_phone` وربط القناة.

تؤكد Meta أن الرقم المستخدم في Business App يمكن أن يعمل بالتزامن مع Cloud API، وأن المزامنة التاريخية والجهات والرسائل الفردية تتم عبر webhook fields مثل `history` و`smb_app_state_sync` و`smb_message_echoes`. محادثات المجموعات لا تُزامن.

## مقارنة بالكود الحالي

الكود الحالي يملك بالفعل إجراء `beginWhatsAppEmbeddedSignup` ويعيد `featureType: whatsapp_business_app_onboarding` و`sessionInfoVersion: 3`. كما يملك `completeWhatsAppEmbeddedSignup` الذي يستقبل `wabaId` و`phoneNumberId`، يفحص الرقم، يحفظ الأصلين، يحدد الرقم، ينشئ قناة WhatsApp، ويبدأ طلب مزامنة التاريخ عند `isOnBizApp`.

الفجوة الفعلية ليست في إنشاء الأصل بعد نجاح التدفق، بل في أن شاشة Embedded Signup ترفض اختيار محفظة الأعمال التي تملك تطبيق Meta نفسه. ظهر هذا القيد فعلياً في حساب المنصة: محفظة **عالم الحجابات الأنيقة** ظهرت غير قابلة للاختيار لأنها مالكة التطبيق. لذلك لا يجوز استخدام زر Embedded Signup في واجهة متجر المالك أو طلب Configuration ID منه؛ هذا مسار إعداد متاجر خارجية فقط.

المسار المطلوب لمالك التطبيق هو إبقاء WhatsApp ضمن الاتصال Meta الموحد وSystem User Token القائمين، ثم اكتشاف أصول WhatsApp التي تسمح بها واجهات Graph لهذا الاتصال وعرضها في تبويب الأصول بجانب Messenger وInstagram. الأرقام التي لا تملك أصلاً قابلاً للوصول عبر Graph قبل تحويلها إلى Cloud API/Coexistence لا يمكن إيهام المستخدم بأنها أصول جاهزة؛ يجب أن تظهر بوضوح كـ«غير متاحة عبر الاتصال الموحد» بدلاً من فتح تدفق Embedded Signup المرفوض.

## القيد المثبت والقرار المعماري

اختبار المستخدم أكد رسالة Meta: **"This Meta Business Account owns the app"**. كما توجد مناقشات Meta Community حديثة تصف القيد نفسه عند محاولة Tech Provider ربط رقمه الإنتاجي من محفظة مالكة للتطبيق عبر Coexistence Embedded Signup.[3]

بناءً على ذلك، القرار هو فصل المسارين في المنصة. مسار **مالك التطبيق** يستخدم الاتصال الموحد المباشر وSystem User Token واكتشاف Graph فقط. أما **Embedded Signup** فيبقى بنية داخلية محتملة لربط متجر خارجي في مرحلة التعدد الفعلي للمتاجر، ولا يظهر في واجهة متجر المالك الحالية.

## المصادر

1. [Meta — Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
2. [Meta — Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
3. [Meta Community — Coexistence Embedded Signup cannot select own business portfolio](https://developers.facebook.com/community/threads/3515826451898650/)

ملاحظة الإصدار: توثيق Meta يذكر أن Embedded Signup v2 سيُهمل في 15 أكتوبر 2026، لذلك ينبغي عدم بناء مسار جديد يعتمد على v2 دون خطة ترقية إلى v4.

## إنشاء Configuration ID للمتاجر الخارجية فقط

وفق توثيق Meta الرسمي، يستخدم Configuration ID في ربط متاجر خارجية عبر Facebook Login for Business. لا يُعرض ولا يُطلب في واجهة متجر مالك التطبيق.

لإظهار خيار الأرقام الموجودة في WhatsApp Business App يجب أن يكون التدفق مخصصاً لـ Business App onboarding، ويستخدم التطبيق في نافذة SDK `featureType: whatsapp_business_app_onboarding` و`sessionInfoVersion: 3`. توثيق Meta يذكر أيضاً أن Embedded Signup v2 سيُهمل في 15 أكتوبر 2026، ولذلك ينبغي ترقية التنفيذ إلى v4 ضمن دورة لاحقة قبل ذلك الموعد.

المصدر: [Meta Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).

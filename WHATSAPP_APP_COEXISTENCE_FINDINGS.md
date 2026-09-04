# WhatsApp Business App Coexistence — Findings

## نتيجة التدقيق

الأرقام الموجودة تحت **WhatsApp Business App** ليست بالضرورة أصول `whatsapp_phone` قابلة للاختيار من قائمة `/owned_whatsapp_business_accounts/{waba}/phone_numbers` في الربط الموحد. توثيق Meta يفرق بين مسار Cloud API المعتاد ومسار **Embedded Signup المخصص لمستخدمي WhatsApp Business App**.

المسار الصحيح للأرقام الموجودة في تطبيق WhatsApp Business هو إطلاق Embedded Signup مع `featureType: whatsapp_business_app_onboarding` و`sessionInfoVersion: 3`. بعد إكمال التحقق من الرقم وموافقة مشاركة البيانات من تطبيق WhatsApp Business، يعيد التدفق `wabaId` و`phoneNumberId` ورمزاً قابلاً للاستبدال. بعدها يمكن للخادم إنشاء أصل `whatsapp_business` وأصل `whatsapp_phone` وربط القناة.

تؤكد Meta أن الرقم المستخدم في Business App يمكن أن يعمل بالتزامن مع Cloud API، وأن المزامنة التاريخية والجهات والرسائل الفردية تتم عبر webhook fields مثل `history` و`smb_app_state_sync` و`smb_message_echoes`. محادثات المجموعات لا تُزامن.

## مقارنة بالكود الحالي

الكود الحالي يملك بالفعل إجراء `beginWhatsAppEmbeddedSignup` ويعيد `featureType: whatsapp_business_app_onboarding` و`sessionInfoVersion: 3`. كما يملك `completeWhatsAppEmbeddedSignup` الذي يستقبل `wabaId` و`phoneNumberId`، يفحص الرقم، يحفظ الأصلين، يحدد الرقم، ينشئ قناة WhatsApp، ويبدأ طلب مزامنة التاريخ عند `isOnBizApp`.

الفجوة الفعلية ليست في إنشاء الأصل بعد نجاح التدفق، بل في توقع أن تظهر أرقام Business App مسبقاً داخل اختيار الأصول الموحد. هذه الأرقام يجب اختيارها من داخل شاشة Embedded Signup نفسها، لا من قائمة الأصول المكتشفة مسبقاً. واجهة الأصول الحالية تعرض الأصول المكتشفة فقط، بينما بطاقة Embedded Signup الحالية تعرض مساراً واحداً عاماً ولا تشرح للمستخدم أن عليه اختيار أحد الرقمين من داخل التدفق.

## المصادر

1. [Meta — Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
2. [Meta — Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)

ملاحظة الإصدار: توثيق Meta يذكر أن Embedded Signup v2 سيُهمل في 15 أكتوبر 2026، لذلك ينبغي عدم بناء مسار جديد يعتمد على v2 دون خطة ترقية إلى v4.

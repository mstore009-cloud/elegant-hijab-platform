# مرجع إرسال رسائل Meta — 2026-08-28

## Instagram

تدعم Meta مسارين حسب نوع التفويض. عند استخدام **Instagram Login** يكون المضيف `graph.instagram.com` والمسار `/<IG_ID>/messages` أو `/me/messages` مع `instagram_business_manage_messages`. عند ارتباط حساب Instagram Professional بصفحة Facebook يمكن استخدام Messenger Platform ومسار `/<PAGE_ID>/messages` على `graph.facebook.com` مع Page access token و`instagram_manage_messages`.[1] [2]

لا يبدأ النظام محادثة Instagram من الصفر؛ يجب أن يبدأ المستخدم المحادثة، وتكون نافذة الرد الحر 24 ساعة. النص لا يتجاوز 1000 بايت في المسار الحديث. تدعم الصور JPEG/PNG حتى 8MB.[1]

## Messenger

يرسل النص إلى `/<PAGE_ID>/messages` على `graph.facebook.com` مع PSID للمستلم وPage access token و`messaging_type: RESPONSE`. المحادثة يجب أن يبدأها الشخص، والنافذة القياسية 24 ساعة. حالات delivered/read تأتي عبر webhooks عند الاشتراك بالحقول المناسبة.[3]

## WhatsApp

يستخدم Cloud API مسار `/<PHONE_NUMBER_ID>/messages` على Graph API مع `messaging_product: whatsapp`. تبقى القوالب المعتمدة هي المسار المطلوب خارج نافذة المحادثة حسب سياسات WhatsApp الحالية؛ هذه الدفعة لا تنشئ قوالب أو رسائل استباقية.

## قرار التنفيذ

لأن مركز الاتصال الحالي يكتشف Instagram عبر صفحة Facebook ويخزن Page token مشفراً، يستخدم الإصدار الأول مسار `graph.facebook.com/<PAGE_ID>/messages` لكل من Messenger وInstagram المرتبط بالصفحة، ويستخدم `graph.facebook.com/<PHONE_NUMBER_ID>/messages` لـWhatsApp. إذا اعتمد المشروع Instagram Login المستقل لاحقاً، يضاف مزود `graph.instagram.com` منفصل ولا يخلط الرمز أو الصلاحيات بالمسار الحالي.

## المراجع

[1]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api "Instagram API with Instagram Login — Send Messages"
[2]: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message "Instagram Messaging — Send a Message"
[3]: https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages "Messenger Platform — Send a Message"

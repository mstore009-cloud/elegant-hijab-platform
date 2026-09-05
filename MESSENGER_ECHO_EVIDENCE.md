# دليل فني: Messenger Message Echoes

## المصدر الرسمي

أوضحت Meta في مرجع **message_echoes Webhook Event Reference**، المحدّث في 1 يونيو 2026، أن هذا الحدث يصل عندما ترسل الصفحة رسالة، سواء كانت نصاً أو وسائط، وأن الاشتراك يتم باختيار حقل `message_echoes` عند إعداد Webhook. يتضمن الحدث `sender.id` للصفحة و`recipient.id` لمستخدم PSID و`message.is_echo: true` ومعرف الرسالة. 

المصدر: [Meta — message_echoes Webhook Event Reference](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes)

## الأثر على المنصة

كانت قائمة `messengerPageSubscribedFields` تتضمن `messages` و`messaging_postbacks` و`message_deliveries` و`message_reads` فقط. لذلك يجب إضافة `message_echoes` إلى اشتراك التطبيق والصفحة، ثم استخدام زر إصلاح استقبال Messenger لإعادة تطبيق الاشتراك على الأصل المختار. يبقى تطبيع `message.is_echo` موجوداً في `server/channels/metaEvents.ts`، ويحتاج الاختبار الحي للتحقق أن Meta بدأت إرسال الحدث بعد إعادة الاشتراك.

مرجع إضافي: [Meta — messages Webhook Event Reference](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messages)

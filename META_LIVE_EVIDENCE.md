# حالة اختبار Meta الحي — 2026-09-05

## ما تؤكده اللقطات

الربط الموحد ظاهر بحالة متصل، والواجهة تعرض ستة أصول محددة: Business Portfolio، Facebook Page، Instagram، Pixel، حساب إعلانات، وCatalog. لا يظهر رقم WhatsApp ضمن قائمة الأصول المحددة.

صلاحيات الرسائل والقنوات، المحتوى والتفاعل، قراءة الإعلانات، Lead Ads، Meta Catalog، والقياس والتحويلات ظاهرة بحالة جاهزة ومفعلة.

## الأخطاء المرصودة

Messenger: المزامنة تفشل عند حفظ مرفق في `inbox_message_media`، وكان معرّف الوسيط الظاهر ملصقاً (`sticker_3692392632228222`). السبب المرجح المتوافق مع بنية الفهرس هو فرض uniqueness على `(channelAccountId, providerMediaId)` رغم إمكان إعادة استخدام معرّف الملصق عبر رسائل متعددة. عولج ذلك بفهرس فريد يشمل `messageId`، مع فهارس مستقلة لقيدي FK.

Instagram: المزامنة التاريخية تفشل برسالة Meta: `Please reduce the amount of data you're asking for, then retry your request`. عولج المسار داخلياً بتقليل حقول conversations إلى `id,updated_time`، وحقول messages إلى `id,message,created_time,from,attachments`، وتقليل حدود الصفحات إلى 5 للمحادثات و10 للرسائل.

WhatsApp: قسم Embedded Signup يظهر `غير مرتبط` و`مؤهل البدء غير متاحة`، وصفحة الأمان تعرض أن System User Token غير مضاف. هذا ليس خطأ كود؛ يحتاج إكمال الربط اليدوي للرقم وإدخال الرمز الدائم مرة واحدة من إعدادات المنصة.

## نتائج الاختبار الداخلي بعد الإصلاح

نجحت اختبارات القنوات وMeta history sync، بما فيها اختبار إعادة استخدام providerMediaId في رسالتين مختلفتين، واختبارات pagination وInstagram fields. ما زال اختبار WhatsApp الحي متوقفاً على إكمال Embedded Signup وSystem User Token من حساب Meta.

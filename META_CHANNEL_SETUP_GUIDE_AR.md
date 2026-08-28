# دليل تجهيز Meta لربط WhatsApp وInstagram مع بوت العملاء

**الهدف الآن:** إنشاء تطبيق Meta واحد وتجهيز حسابي القناتين للاختبار.  
**ما لن نفعله الآن:** لن نفعّل إرسالاً تلقائياً، ولن نفصل رقم WhatsApp العامل حالياً، ولن نمنح النظام صلاحية تعديل رسائل أو طلبات أو أسعار.

> **مهم:** لا تضعي رابط webhook في Meta بعد. أنا ما زلت أُكمل طبقة الاستقبال داخل المنصة، وسأعطيك الرابط الصحيح فقط بعد نشر النسخة واختبارها. يمكنك إنهاء كل الخطوات الأخرى الآن بأمان.

## قبل البدء

ستحتاجين إلى حساب Facebook تستطيعين منه إدارة النشاط، وإلى حساب Meta Business Portfolio الخاص بالمتجر أو حساب جديد باسم المتجر. لمرحلة الاختبار، جهزي **رقم WhatsApp اختبارياً** إن كان ذلك ممكناً، وحساب Instagram من نوع **Professional** (Business أو Creator). لا تنقلي الرقم الأساسي أو تفصليه من تطبيق WhatsApp Business قبل أن نتأكد من مسار الربط المناسب؛ مسار النقل يختلف عن إنشاء رقم Cloud API جديد.[1]

| ما ستحتاجينه | لماذا نحتاجه | هل هو سر؟ |
|---|---|---|
| تطبيق Meta واحد | يجمع إعداد WhatsApp وInstagram وwebhooks | لا |
| Meta App Secret | للتحقق من أن الرسائل الواردة أصلها Meta | **نعم** |
| Verify Token عشوائي | للتحقق الأولي من webhook | **نعم** |
| Meta System User Token | لتنزيل وسائط WhatsApp الواردة فقط | **نعم** |
| WhatsApp Phone Number ID | لتمييز رقم المتجر عند وصول الرسالة | لا |
| Instagram Professional Account ID | لتمييز حساب Instagram عند وصول الرسالة | لا |

## المرحلة الأولى: إنشاء مساحة الأعمال

1. افتحي [Meta Business Suite](https://business.facebook.com/) وسجلي دخولك بحساب Facebook الذي تملكين به صلاحية إدارة النشاط.
2. افتحي **Settings** ثم **Business portfolio**. إذا كان حساب المتجر موجوداً، استخدميه. إن لم يكن موجوداً، أنشئي Business Portfolio جديداً باسم **عالم الحجابات الأنيقة** وببريد عمل تستطيعين الوصول إليه.
3. لا تدخلي بيانات بطاقة أو معلومات دفع. لا توجد خطوة دفع مطلوبة لإعداد الاستقبال والاختبار الذي نبنيه الآن.
4. من صفحة المستخدمين، تأكدي أن حسابك يملك **Full control** أو صلاحية إدارة مناسبة على مساحة الأعمال. احتفظي باسم مساحة الأعمال؛ ستختارينها عند إنشاء التطبيق.

## المرحلة الثانية: إنشاء تطبيق Meta

1. افتحي [لوحة تطبيقات Meta للمطورين](https://developers.facebook.com/apps/).
2. اختاري **Create App**.
3. اكتبي اسماً داخلياً واضحاً، مثل: `Elegant Hijab Customer Assistant`، ثم اختاري بريد العمل.
4. عند ظهور اختيار حالة الاستخدام، اختاري **Connect with customers through WhatsApp** ثم **Next**، وبعدها اختاري Business Portfolio الذي أنشأته أو الموجود مسبقاً.[1]
5. راجعي الخيارات ثم اختاري **Create app**. سيأخذك Meta إلى صفحة إعداد WhatsApp.
6. من القائمة الجانبية أو صفحة إعداد التطبيق، تأكدي من إضافة المنتجين التاليين:

   | المنتج | الهدف في مشروعنا |
   |---|---|
   | **WhatsApp** | استقبال رسائل وصور WhatsApp Business |
   | **Instagram** أو **Instagram API with Instagram Login** | استقبال رسائل وصور Instagram Professional |
   | **Webhooks** | إشعار منصتنا بوصول رسالة جديدة |

7. من **App settings → Basic** انسخي قيمة **App Secret**. لا ترسليها في الدردشة؛ ستوضع لاحقاً في حقل الأسرار الآمن داخل المشروع.

## المرحلة الثالثة: تجهيز WhatsApp Business للاختبار

1. داخل التطبيق، افتحي **WhatsApp → API Setup** ثم اضغطي **Start using the API**.[1]
2. عند طلب WhatsApp Business Account، اختاري الحساب الموجود إن كان الرقم المخصص موجوداً فيه، أو أنشئي حساب WhatsApp Business جديداً للاختبار.
3. اختاري **رقم اختبار** أو أضيفي رقماً جديداً. إذا كان الرقم الحالي يعمل بالفعل في تطبيق WhatsApp Business، **توقفي هنا ولا تنقليه** قبل أن تخبريني؛ سنحدد لاحقاً إن كان يلزم Embedded Signup أو نقل رسمي.
4. بعد ربط الرقم، ستظهر قيمتان مهمتان:
   - **Phone Number ID:** انسخيها؛ ستُدخل لاحقاً في مركز بوت العملاء تحت WhatsApp Business.
   - **WhatsApp Business Account ID:** احتفظي بها للمرجع؛ لا تحتاجها المنصة في نموذجها الأولي.
5. لا نستخدم **Temporary access token** للاعتماد الدائم لأنه ينتهي سريعاً.[1]

### إنشاء رمز وصول WhatsApp طويل الأجل

1. افتحي [Business Settings](https://business.facebook.com/latest/settings) من مساحة الأعمال، ثم افتحي **System users**.
2. اختاري **Add**، وأنشئي System User جديداً باسم مثل `Elegant Hijab Bot - Inbound Media`.
3. اختاري مستخدم النظام ثم **Assign Assets**:
   - اختاري تطبيق Meta وأنشئي له صلاحية **Manage app**.
   - اختاري حساب WhatsApp Business وأنشئي له صلاحية **Manage WhatsApp Business accounts**.
4. اختاري **Generate token**، ثم حددي التطبيق وأضيفي فقط الصلاحيات التي تذكرها وثيقة WhatsApp الرسمية: `business_management` و`whatsapp_business_messaging` و`whatsapp_business_management`.[1]
5. انسخي الرمز فوراً واحفظيه في مدير كلمات مرور. لا تضعيه في ملاحظة أو لقطة شاشة أو دردشة. سنضعه في حقل الأسرار الآمن باسم `META_GRAPH_ACCESS_TOKEN`.

## المرحلة الرابعة: تجهيز Instagram Professional

1. افتحي تطبيق Instagram أو إعدادات الحساب، وتحققي أن الحساب من نوع **Professional**. إذا كان شخصياً، حوّليه إلى Business أو Creator وفق إعدادات Instagram.
2. ارجعي إلى App Dashboard، ثم افتحي **Instagram → API setup with Instagram login** أو المنتج باسم قريب منه.
3. في **Business login settings** أضيفي صلاحيات الرسائل فقط في هذه المرحلة:
   - `instagram_business_basic`
   - `instagram_business_manage_messages`

   هذه هي أسماء الصلاحيات الحالية لمسار Instagram Login؛ لا نحتاج حالياً صلاحية نشر المحتوى.[2]
4. لا تنفذي تدفق تسجيل دخول Instagram الآن ولا تضعي Redirect URL بنفسك. سنضيف رابط العودة الصحيح من المنصة في خطوة لاحقة حتى لا ينشأ رمز دخول لا يمكن استعماله.
5. افتحي معلومات الحساب الاحترافي وانسخي **Instagram Professional Account ID** إن ظهر لك. إذا لم يظهر، لا مشكلة؛ سنستخرجه في خطوة الربط بعد أن تنتهي من إعداد التطبيق.

## المرحلة الخامسة: اختاري Verify Token

1. افتحي مدير كلمات مرور أو مولّد كلمات عشوائية موثوقاً.
2. أنشئي سلسلة عشوائية من **32 حرفاً أو أكثر**، تضم أحرفاً وأرقاماً ورموزاً آمنة، مثال الشكل فقط: `m7X...`.
3. سمّيها في مدير كلمات المرور: `Elegant Hijab / Meta Webhook Verify Token`.
4. لا تشاركيها في الدردشة. سنضعها في حقل الأسرار الآمن باسم `META_WEBHOOK_VERIFY_TOKEN`، ثم سنضع **نفسها حرفياً** في خانة Verify Token داخل Meta عندما يصل وقت webhook.

## ما ترسلينه لي بعد إنهاء الإعداد

اكتبي فقط: **«تم إعداد Meta»**. سيظهر لك نموذج آمن لإدخال الأسرار الثلاثة. بعدها أطلب منك في رسالة واحدة إدخال المعرفين غير السريين داخل مركز البوت، ثم أعطيك رابط webhook المنشور وخطوات اختبار استقبال رسالة وصورة واحدة.

| القيمة | أين تحفظ | أين تجدينها |
|---|---|---|
| `META_APP_SECRET` | حقل الأسرار الآمن | App Dashboard → App settings → Basic |
| `META_WEBHOOK_VERIFY_TOKEN` | حقل الأسرار الآمن | السلسلة التي ولدتها أنت |
| `META_GRAPH_ACCESS_TOKEN` | حقل الأسرار الآمن | Business Settings → System users → Generate token |
| WhatsApp Phone Number ID | مركز البوت → WhatsApp Business | WhatsApp → API Setup |
| Instagram Professional Account ID | مركز البوت → Instagram Professional | إعدادات Instagram/Meta بعد تجهيز المنتج |

## ماذا سيحدث بعد ذلك

عند وصول رسالة نصية أو صورة من حساب مرتبط، تتحقق المنصة أولاً من توقيع Meta، تمنع الحدث المكرر، وتحفظ الرسالة في Inbox. تحفظ الصورة في تخزين المنصة ضمن متجرها، ثم تحللها كمؤشرات مرئية وتقترح منتجات من **المتجر نفسه فقط**. إذا كانت الثقة منخفضة أو فشل التحليل، تتحول للمراجعة البشرية ولا يخمّن البوت المنتج. لا يُرسل رد إلى الزبون في هذه المرحلة.

## المراجع

[1]: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started "WhatsApp Cloud API Get Started — Meta Developers، تحديث 16 يونيو 2026"

[2]: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login "Business Login for Instagram — Meta Developers، تحديث 13 مارس 2026"

[3]: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/ "Get started with Webhooks — Meta Developers"

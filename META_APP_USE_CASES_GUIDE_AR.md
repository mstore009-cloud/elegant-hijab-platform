# إعداد تطبيق Meta للربط العميق — خطوة بخطوة

**إعداد:** Manus AI  
**تاريخ المراجعة:** 2026-08-28  
**الهدف الحالي:** تجهيز الرسائل عبر WhatsApp وMessenger وInstagram أولاً، من دون تفعيل الرد الآلي أو النشر أو الإعلانات.

> **قاعدة مهمة:** إضافة Use Case إلى التطبيق لا تمنح المنصة صلاحية تلقائياً. الصلاحية الفعلية تأتي لاحقاً عندما يضغط صاحب المتجر «تسجيل الدخول والربط» ويوافق داخل Meta، ثم تختار المنصة الأصول المسموح بها فقط.[1] [2]

## المرحلة الأولى: تأكد من نوع التطبيق

افتح [Meta for Developers](https://developers.facebook.com/apps/) ثم اختر التطبيق الذي أنشأته. يجب أن يكون **Business type app**؛ لأن Facebook Login for Business هو مسار Meta المفضل للمنصات التي تدير أدوات الأعمال والرسائل والتسويق نيابة عن المتاجر.[2]

إذا كان التطبيق من نوع **Business**، تابع في التطبيق نفسه. إذا لم يكن كذلك، لا تضف أسراراً ولا تربط صفحة بعد؛ أخبرني بنوعه أولاً لأن التحويل أو إنشاء تطبيق Business جديد يعتمد على نوع التطبيق الحالي.

## المرحلة الثانية: أضف Use Cases المطلوبة

من القائمة الجانبية افتح **Use cases** ثم **Add use case**. أضف الاستخدامات التالية:

| الترتيب | Use Case في لوحة Meta | القرار الآن | الغرض في منصتنا |
|---:|---|---|---|
| 1 | **Connect with customers through WhatsApp** | أضفه الآن | استقبال وإرسال رسائل WhatsApp Business والصور والحالات |
| 2 | **Engage with customers on Messenger from Meta** | أضفه الآن | رسائل صفحة Facebook والتحويل بين البوت والموظف |
| 3 | **Manage messaging & content on Instagram** | أضفه الآن | Instagram Direct، ثم التعليقات والـmentions والنشر في مراحل لاحقة |
| 4 | **Authenticate and request data from users with Facebook Login** | أضفه الآن إذا ظهر بهذا الاسم | أساس Facebook Login for Business ومنح الأصول والصلاحيات لكل متجر |
| 5 | **Manage everything on your Page** | أضفه الآن، ولا تطلب Advanced Access بعد | منشورات Facebook والتعليقات والـPage insights لاحقاً |
| 6 | **Manage products with Catalog API** | أضفه الآن، واتركه غير مفعّل | مزامنة المنتجات النشطة إلى Meta Catalog لاحقاً |
| 7 | **Capture & manage ad leads with Marketing API** | أضفه الآن، واتركه غير مفعّل | إدخال Lead Ads إلى CRM لاحقاً |
| 8 | **Measure ad performance data with Marketing API** | أضفه الآن، واتركه قراءة فقط | Ads Insights وربط النتائج بالتحليلات |
| 9 | **Create & manage ads with Marketing API** | أضفه الآن، ولا تمنحه صلاحية الآن | مرحلة إعلانات محكومة بالموافقتين والسقف المالي مستقبلاً |

هذه الأسماء مطابقة لقائمة Use Cases الرسمية الحالية في Meta.[1] لا تضف **Create & manage app ads with Meta Ads Manager**؛ فهذا خاص بالترويج لتثبيت تطبيقات الهاتف ولا يمنح Marketing API الذي نحتاجه.[1]

## المرحلة الثالثة: خصص استخدام WhatsApp

افتح **Use cases → Connect with customers through WhatsApp → Customize**. ستجد أقسام **Permissions and features، Quickstart، API Setup، Configuration، Embedded Signup Builder**.[3]

في **Permissions and features** تأكد من وجود الصلاحيات المطلوبة افتراضياً:

| الصلاحية | الحالة |
|---|---|
| `public_profile` | مطلوبة وتضاف افتراضياً |
| `whatsapp_business_management` | مطلوبة |
| `whatsapp_business_messaging` | مطلوبة |
| `business_management` | أضفها لأن منصتنا ستكتشف Business Portfolio وWhatsApp Business Account برمجياً |

لا تضف `whatsapp_business_manage_events` الآن؛ نحتاجه فقط عندما نصل إلى Marketing Messages Lite وConversions API for Business Messaging.[3]

لا تستخدم **Temporary Access Token** كحل إنتاجي، ولا تنسخ أي token إلى الدردشة. يمكن استخدام رقم Meta التجريبي للاختبار الأول فقط.

## المرحلة الرابعة: أنشئ Facebook Login for Business Configuration للرسائل

من المنتج **Facebook Login for Business → Configurations** اختر **Create configuration**.[2]

أنشئ إعداداً باسم مقترح: **Elegant Hijab — Messaging Test**.

| الحقل | الاختيار المقترح |
|---|---|
| Token type | **User access token** للاختبار الأول على أصولك أنت |
| Expiration | المدة الافتراضية للاختبار |
| Assets | Facebook Pages، Instagram accounts، WhatsApp Business accounts المتاحة |
| Purpose | الرسائل فقط |

أضف الصلاحيات التالية إلى Configuration الرسائل:

```text
pages_show_list
pages_messaging
pages_manage_metadata
pages_read_engagement
instagram_basic
instagram_manage_messages
whatsapp_business_management
whatsapp_business_messaging
business_management
```

لا تضف صلاحيات المحتوى أو الإعلانات أو Leads إلى Configuration الرسائل. سننشئ لكل غرض Configuration مستقلاً لاحقاً، حتى يستطيع المتجر منح الرسائل من دون أن يمنح الإعلانات أو النشر.

بعد الحفظ ستظهر قيمة **Configuration ID**. احتفظ بها في مكان خاص؛ هي ليست Access Token، لكنها إعداد مركزي لتجربة تسجيل الدخول.

> في مرحلة الإنتاج متعددة المتاجر، سننشئ Configuration ثانية من نوع **Business Integration System User access token** لأن Meta توصي بهذا النوع للأعمال الآلية المستمرة مثل الردود المؤتمتة، تحديث الكتالوج، واسترجاع Ads Insights. هذا المسار يتطلب Tech Provider وBusiness Portfolio وApp Review المناسب.[2]

## المرحلة الخامسة: اضبط الروابط الأساسية

من **App settings → Basic**:

| الحقل | القيمة |
|---|---|
| App Domains | `eleganthijab-efpivkpx.manus.space` |
| Privacy Policy URL | اتركها حتى نبني صفحة السياسة الرسمية قبل نشر التطبيق للعامة |
| User Data Deletion | اتركها حتى نبني callback أو صفحة تعليمات الحذف قبل App Review |
| Contact Email | بريد إداري فعّال تتابعه |
| Category | Business and Pages أو أقرب تصنيف أعمال متاح |

في **Facebook Login for Business → Settings** أضف إلى **Valid OAuth Redirect URIs**:

```text
https://eleganthijab-efpivkpx.manus.space/api/meta/oauth/callback
```

هذا هو رابط عودة تسجيل الدخول. لا تضع فيه رابط webhook.

## المرحلة السادسة: جهز Webhooks للرسائل

رابط webhook الموحد في منصتنا هو:

```text
https://eleganthijab-efpivkpx.manus.space/api/webhooks/meta
```

لا تضغط **Verify and Save** قبل أن نثبت إعداد تطبيق Meta المركزي في المنصة؛ لأن Meta ستطلب Verify Token مطابقاً لما هو محفوظ في خادم المنصة.

بعد أن نثبته، سنستخدم الرابط نفسه في المنتجات الثلاث، ثم نختبر الحقول تدريجياً:

| المنتج | الاشتراكات الأولى |
|---|---|
| WhatsApp | messages وحالات الرسائل المتاحة ضمن Messages webhook |
| Messenger | messages، message_deliveries، message_reads، messaging_postbacks |
| Instagram | messages والحقول المتاحة لرسائل Instagram Professional |

سنضيف التعليقات والـmentions وLead Ads وحالات النشر لاحقاً بعد اكتمال وحداتها، لا أثناء اختبار الرسائل الأول.

## المرحلة السابعة: جهز الحسابات قبل الربط

تأكد من الشروط التالية قبل الضغط على زر الربط في منصتنا:

| الأصل | ما يجب أن يكون جاهزاً |
|---|---|
| Meta Business Portfolio | التطبيق مرتبط بمحفظة أعمال تملكها وتتحكم بها |
| Facebook Page | لديك Full control أو صلاحية إدارية مناسبة |
| Instagram | Professional account ومربوط بصفحة Facebook المختارة |
| WhatsApp | WhatsApp Business Account ورقم تجريبي أو رقم أعمال جاهز |
| App Roles | حسابك مضاف Administrator أو Developer أو Tester في التطبيق أثناء Development mode |

## ما لا تفعله الآن

لا تنشر التطبيق Live، ولا ترسل App Review، ولا تطلب `ads_management`، ولا تضف وسيلة دفع، ولا تنقل رقم WhatsApp إنتاجياً، ولا تربط صفحات العملاء الآخرين. Meta تطلب ألا نطلب صلاحيات لا تستخدمها الواجهة فعلياً؛ طلب الصلاحيات غير اللازمة سبب شائع لرفض App Review.[4]

## ما ترسله لي بعد الإكمال

لا ترسل App Secret أو Access Token في الدردشة. اكتب فقط هذه الإجابات:

| السؤال | الإجابة المطلوبة |
|---|---|
| نوع التطبيق | Business / غير ذلك |
| أُضيفت Use Cases 1–9 | نعم / اذكر الناقص |
| Messaging Configuration | تم إنشاؤها / لم يتم |
| Valid OAuth Redirect URI | تمت إضافته / لم يتم |
| Instagram مربوط بالصفحة | نعم / لا |
| WhatsApp | رقم تجريبي / رقم أعمال / لم يجهز |

بعدها سأرشدك إلى **إعداد التطبيق المركزي مرة واحدة** عبر الحقول الآمنة، ثم ستجرب من المنصة زر **تسجيل الدخول والربط** واختيار الأصول. لن نفعّل الرد المباشر في تلك الخطوة.

## المراجع

[1]: https://developers.facebook.com/documentation/development/app-customization "Meta — Use Case Customization"
[2]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business "Meta — Facebook Login for Business"
[3]: https://developers.facebook.com/documentation/development/create-an-app/whatsapp-use-case "Meta — Customize WhatsApp Use Case"
[4]: https://developers.facebook.com/docs/permissions/ "Meta — Permissions Reference"

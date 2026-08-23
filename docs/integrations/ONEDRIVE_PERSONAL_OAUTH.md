# OneDrive Personal: قرار الربط وخطة الاختبار

## النتيجة

حساب Microsoft 365 Personal يمكن استخدامه مع Microsoft Graph عبر **تفويض OAuth مفوض**؛ لا يصل النظام إلى ملفات أكثر مما يستطيع المستخدم الموقع الدخول الوصول إليه. لا يصلح مسار التطبيق الخلفي غير التفاعلي للحسابات الشخصية، لذلك لا نعتمد مفاتيح طويلة المدى أو تفويضًا واسعًا بلا تسجيل دخول المستخدم. [1] [2]

## الإعداد المقترح للاختبار الأول

| الإعداد | القيمة المقترحة |
|---|---|
| نوع التطبيق | Web application مع OAuth Authorization Code + PKCE |
| نوع الحسابات المدعومة | **Personal Microsoft accounts only**، أو **Any Entra ID tenant + personal Microsoft accounts** إذا أردنا دعم حساب أعمال لاحقًا [3] |
| أدنى صلاحيات القراءة | `User.Read` و`Files.Read` بصلاحيات مفوضة؛ لا نطلب صلاحيات كتابة في اختبار القراءة [1] |
| نطاق الاختبار | حساب المستخدم الموقع + مجلد منتجات تجريبي واحد فقط |
| معيار النجاح | تسجيل الدخول، قراءة ملفات المجلد، قراءة اسم الملف/الكود، وتسجيل النواقص دون إنشاء أو تعديل منتج منشور |
| معيار الفشل الآمن | يبقى الموصل في حالة `not_configured` أو `failed` وتستمر عملية الإدخال اليدوي دون تغيير نموذج المنتجات |

## ما يلزم من المستخدم لاحقًا

يسجل المستخدم تطبيقًا في Microsoft Entra من حسابه الشخصي، ويختار نوع الحسابات الذي يدعم الحسابات الشخصية، ثم يضيف رابط العودة الذي نوفره له ويحفظ `Client ID` فقط. لا نطلب كلمة المرور، ولا نطلب `Client Secret` لمسار OAuth مع PKCE. يتطلب التسجيل حساب Azure نشطًا أو حسابًا مجانيًا حسب متطلبات Microsoft الحالية. [3]

## مراجع

[1] [Microsoft Graph permissions overview](https://learn.microsoft.com/en-us/graph/permissions-overview)

[2] [Microsoft identity platform — supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types)

[3] [Register an application in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

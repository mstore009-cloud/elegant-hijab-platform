# ADR-002: الوصول إلى OneDrive Personal

**الحالة:** صلاحية الحد الأدنى معتمدة؛ الموصل المباشر محجوب مؤقتًا بعطل خدمة Microsoft Graph موثق.  
**النطاق:** إدخال منتجات من OneDrive الشخصي، وليس التخزين الداخلي للمنصة.

## القرار

لا نعتمد رابط مشاركة عام كموصل إنتاج. المسار الموصى به هو تطبيق Microsoft مستقل يستخدم OAuth مفوضًا وصلاحية `Files.ReadWrite.AppFolder` فقط، ثم تُنقل أو تُنشأ ملفات المنتجات في مجلد التطبيق الذي ينشئه OneDrive تلقائيًا تحت `Apps/<اسم التطبيق>`. بهذه الصلاحية لا يصل التطبيق إلى بقية ملفات OneDrive الخاصة بالمستخدم. [1] [2]

> مجلد `EHP-TEST-PRODUCT` الذي أنشأه المستخدم يظل مفيدًا لاختبار تنظيم المحتوى، لكنه ليس نطاقًا يمكن لتطبيق Graph تقييده عليه وحده عبر صلاحية محدودة للحساب الشخصي. عند اعتماد الموصل ننشئ مجلد الاختبار المقابل داخل مجلد التطبيق.

## مقارنة الخيارات

| الخيار | الوصول | ملاءمة الاختبار | ملاءمة الإنتاج | القرار |
|---|---|---|---|---|
| OAuth مفوض مع `Files.Read` أو `Files.Read.All` | يقرأ ما يستطيع المستخدم الوصول إليه، وقد يشمل نطاقًا واسعًا | ممكن | غير مفضل لاحتياجه صلاحية أوسع من اللازم | مرفوض كمسار افتراضي |
| OAuth مفوض مع `Files.ReadWrite.AppFolder` | مجلد تطبيق واحد فقط تحت `Apps/<اسم التطبيق>` | ممتاز | ممتاز | **المسار الموصى به** |
| رابط مشاركة `Anyone with the link` | من يملك الرابط يستطيع الوصول؛ قد يُعاد توجيهه، وقد يبطل عند نقل الملف | مناسب كفحص يدوي مؤقت فقط | غير مناسب | لا يعتمد إنتاجيًا |
| الرفع الداخلي إلى تخزين المنصة | لا يعتمد على OneDrive | بديل آمن دائم | مناسب | يبقى متاحًا دائمًا |

## بوابات التنفيذ

1. ينشئ المستخدم حساب Azure مجانيًا أو يصل إلى تسجيل التطبيقات الذي يدعم حسابه الشخصي.
2. يُسجّل تطبيق من نوع Web مع حسابات Microsoft الشخصية.
3. نضيف رابط العودة الذي ستعرضه المنصة، ثم يوافق المستخدم بنفسه على صلاحية مجلد التطبيق.
4. يختبر الموصل إنشاء أو قراءة `Apps/<اسم التطبيق>/EHP-TEST-PRODUCT/HJB-TEST-001` فقط.
5. لا نستورد منتجًا حقيقيًا ولا ننشر وسائط قبل نجاح هذا الاختبار وتسجيل النتيجة.

## ملاحظة تنفيذية بعد الاختبار الحي

أكد توثيق Microsoft أن `Files.ReadWrite.AppFolder` هو أقل صلاحية مفوضة لحساب Microsoft شخصي عند استخدام `GET /me/drive/special/approot`. ويؤكد التوثيق أن نداء `approot` ينشئ مجلد التطبيق إن لم يكن موجودًا، ثم يعيد عنصر المجلد الذي تستخدمه المنصة للعمليات اللاحقة. [1] [5]

عند الاختبار الحي، وصل التفويض إلى الخادم وتبادل الرمز بنجاح بعد إضافة Client Secret. ثم استخدمت المنصة المسار الرسمي `GET /me/drive/special/approot`، لكن Microsoft Graph أعاد: `403 / accessDenied / serviceReadOnly — Database Is Read Only`. تحققنا أيضًا مباشرة من قاعدة بيانات المنصة، وكانت `read_only=0` و`super_read_only=0`، كما نجح اختبار عميل قاعدة البيانات نفسه؛ لذلك لا يرتبط العائق بقاعدة بيانات المنصة أو ببيانات الاعتماد المحفوظة فيها.

تدل الأدلة على عائق في خدمة Microsoft Graph أو حالة OneDrive الشخصية، لا على حاجة إلى توسيع الصلاحية. لا تُعاد محاولة التفويض تلقائيًا ولا تُضاف `Files.ReadWrite` أو `Files.ReadWrite.All`. يبقى الإدخال اليدوي الآمن متاحًا، ويظل اختبار إدخال المنتج الحقيقي محجوبًا حتى تزول حالة `serviceReadOnly` أو يقدم Microsoft دعمًا/حلًا موثقًا. [6]

## مراجع

[1] [Using app folder in OneDrive and SharePoint — Microsoft Learn](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)

[2] [Using an App Folder to store user content without access to all files — Microsoft Learn](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/special-folders-appfolder?view=odsp-graph-online)

[3] [Create a sharing link for a DriveItem — Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/driveitem-createlink?view=graph-rest-1.0)

[4] [Share files and folders in Microsoft OneDrive — Microsoft Support](https://support.microsoft.com/en-us/onedrive/share-files-and-folders-in-microsoft-onedrive)

[5] [Get a special folder by name — Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/drive-get-specialfolder?view=graph-rest-1.0)

[6] [OneDrive personal account: accessDenied / serviceReadOnly — Microsoft Q&A](https://learn.microsoft.com/pt-br/answers/questions/5982450/onedrive-account-returning-accessdenied-servicerea)

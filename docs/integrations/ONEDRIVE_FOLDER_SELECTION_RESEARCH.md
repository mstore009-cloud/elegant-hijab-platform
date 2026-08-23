# بحث مسار اختيار مجلد كتالوج OneDrive

**الحالة:** نتيجة تحقق أولي؛ لا تغيير صلاحيات أو تنفيذ قبل موافقة المالك.

## النتيجة الأساسية

لا يجوز أن تطلب المنصة اسم مستخدم Microsoft أو كلمة مروره أو تخزنهما. المسار السليم هو OAuth المفوض، حيث يسجل المستخدم الدخول داخل Microsoft نفسها ويمنح الإذن المطلوب في شاشة Microsoft.

يوفر Microsoft **OneDrive File Picker** واجهة يختار فيها المستخدم ملفًا أو مجلدًا من حسابه. يعيد الـ Picker معرف العنصر ومعرف الـ drive، لكنه يعمل بتفويض المستخدم ويتطلب رمزًا صالحًا ذا صلاحية قراءة مناسبة للوصول إلى العنصر بعد اختياره.

## الحدود المهمة للحساب الشخصي

| المطلب | ما يدعمه Microsoft للحساب الشخصي | الأثر |
|---|---|---|
| اختيار مجلد من OneDrive | File Picker مع OAuth مفوض | ممكن كواجهة اختيار. |
| قراءة مجلد الكتالوج المختار بعد ذلك | `Files.Read` المفوض | الصلاحية تقرأ ملفات المستخدم الموقّع، وليست مقيدة تقنيًا بالمجلد المختار. |
| صلاحية دائمة لـ «المجلد المختار فقط» عبر Graph | غير متاحة للحساب الشخصي | لا يجوز ادعاء أن اختيار المجلد يفرض قيدًا تقنيًا على بقية OneDrive. |
| `Files.Read.Selected` | خاص بحسابات العمل/المدرسة، مؤقت ومحدود | لا يصلح لهذا الحساب الشخصي أو لاستيراد Graph المباشر. |
| App Folder المحدود | `Files.ReadWrite.AppFolder` | هو الأقل صلاحية، لكنه محجوب حاليًا بخطأ `serviceReadOnly` من Microsoft Graph. |

## العلاقة بعطل الخدمة الحالي

يتجنب File Picker مسار `approot` في واجهته، لذلك قد يقدم اختبارًا مستقلًا لواجهة الاختيار. لكنه لا يثبت أن Graph سيستطيع قراءة المجلد المختار، ولا يحل تلقائيًا خطأ `403 / accessDenied / serviceReadOnly` الذي ظهر في التكامل الحالي. يلزم فصل «نجاح اختيار المجلد» عن «نجاح الاستيراد الخلفي» في الاختبار والتوثيق.

## المسار المقترح إذا وافق المالك

1. تطلب المنصة موافقة واضحة على `Files.Read` **لجلسة اختيار واحدة**، ولا تحفظ كلمة المرور.
2. يفتح المستخدم File Picker الرسمي ويختار جذر `Catalog` فقط.
3. تحفظ المنصة مرجع الجذر المختار (معرف drive والعنصر والمسار الظاهر) وسجل التدقيق، لا كلمة المرور.
4. تستعمل المنصة الرمز فقط لفحص بنية الجذر كمسودة؛ ولا تعتمد منتجًا أو تنشر وسائط.
5. بعد التجربة، يُعرض ما أمكن قراءته وما فشل، ويُقرر المالك الاحتفاظ بالتفويض أو سحبه من Microsoft.

## مراجع

[1] [Microsoft OneDrive File Picker](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/?view=odsp-graph-online)

[2] [Microsoft OneDrive API permissions reference](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/permissions_reference?view=odsp-graph-online)

[3] [Microsoft Graph Selected permissions overview](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)

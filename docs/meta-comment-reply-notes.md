# ملاحظات Meta الرسمية — ردود التعليقات

تمت مراجعة وثائق Meta الرسمية في 2026-09-04 قبل إضافة بوابة `comment_guarded`.

## Facebook Pages

يوضح دليل [Comments and @mentions](https://developers.facebook.com/documentation/pages-api/comments-mentions) أن الرد على تعليق صفحة يتم عبر `POST /{comment-id}` مع الحقل `message`، وأن التعليق على منشور الصفحة يتم عبر `POST /{page-post-id}/comments`. يتطلب المسار صلاحيات مرتبطة بالتفاعل وإدارة الصفحة، ومنها `pages_manage_engagement` و`pages_read_engagement` و`pages_read_user_engagement`، مع مهام `MODERATE` و`CREATE_CONTENT`.

## Instagram

توضح وثيقة [IG Comment Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) أن الرد على تعليق Instagram يتم عبر `POST /{ig-comment-id}/replies?message={message}`. توجد قيود على التعليقات المخفية والرد على ردود فرعية، ويجب توفير صلاحيات إدارة تعليقات Instagram المناسبة.

## اختيار البنية

توضح [Instagram Platform overview](https://developers.facebook.com/documentation/instagram-platform/overview) أن تطبيق Facebook Login for Business يستخدم `graph.facebook.com` لحساب Instagram الاحترافي المرتبط بصفحة، وأن Advanced Access مطلوب للحسابات التي لا يملكها المستخدم أو لا يديرها. لذلك يجب أن يظل الرد محكوماً بصحة اتصال Meta وقدرة `content` والأصل المحدد، ولا يُفترض نجاح الإرسال الحي من الاختبارات المحلية وحدها.

## قرار التنفيذ

أضيفت دالة `sendMetaCommentReply` بوضع `comment_guarded`، مع سجل idempotent مستقل في `meta_outbound_messages` و`conversationId` اختياري. الربط الآلي الكامل بين قرار Bot-H3 وأحداث التعليقات ما زال منفصلاً عن بوابة الإرسال ويحتاج اختباراً حياً وصلاحيات Meta المعتمدة قبل تفعيله.

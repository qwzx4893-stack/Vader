<p align="center">
  <img src="docs/assets/banner.jpg" alt="Vader is what you need" width="100%">
</p>

<h1 align="center">Vader</h1>

<p align="center" dir="rtl">
  <b>بيئة تطوير مدعومة بالذكاء الاصطناعي، بوكيل برمجي تستطيع الوثوق به.</b><br>
  وكيل حقيقي، ومحرّك سياسات صارم أمام كل إجراء، وبلا أي تتبّع، وبأي نموذج تريده.
</p>

<div dir="rtl">

[English](./README.md)

## لماذا Vader

أغلب محررات الذكاء الاصطناعي مجرد نافذة محادثة بجانب الشيفرة. Vader يتعامل مع الوكيل كما تتعامل مع مهندس جديد يملك وصولاً حقيقياً إلى ملفاتك وطرفيتك: **لا ثقة عمياء، وكل شيء يمرّ عبر بوابة.**

- **محرّك سياسات صارم وليس مجرد اقتراح.** كل كتابة أو حذف ملف وكل أمر طرفية يُفحص أمام قواعد (اسمح / اسأل / امنع) قبل التنفيذ، بغض النظر عمّا يقرّره النموذج وعن نافذة الموافقة. وتُحلّ المسارات عبر الروابط الرمزية و`..`، فلا يمكن الالتفاف على القاعدة برابط إلى `~/.aws` مثلاً. والقواعد المقفلة (`locked`) لا يمكن تعطيلها من الإعدادات.
- **خصوصية افتراضية.** لا تتبّع ولا تحليلات ولا اتصال خفي. مفاتيح المزوّدين تُشفَّر بسلسلة مفاتيح نظام التشغيل.
- **أحضر نموذجك.** OpenAI وAnthropic وGemini وOpenRouter وMistral وDeepSeek وxAI وGroq وQwen وKimi وMiniMax وOllama وLM Studio وvLLM وأي واجهة متوافقة مع OpenAI.
- **مُتحقَّق منه فعلاً.** مجموعة اختبارات تشغّل التطبيق **المثبَّت** على ويندوز، بما فيها تشغيل مع نموذج حقيقي، وأداة «النموذج داخل الحلقة» التي تتيح لك (أو لوكيل ذكي) أن تلعب دور النموذج.

## التنزيل

مثبّتات ويندوز في صفحة [Releases](https://github.com/qwzx4893-stack/Vader/releases). المثبّتات حالياً **غير موقّعة**، فقد يحذّرك SmartScreen عند أول تشغيل.

## البناء من المصدر

```bash
git clone https://github.com/qwzx4893-stack/Vader.git
cd Vader
npm install
npm run buildreact
npm run buildcline
npm run compile
./scripts/code.sh        # على ويندوز: scripts\code.bat
```

اقرأ [`AGENTS.md`](./AGENTS.md) و[`CONTRIBUTING.md`](./CONTRIBUTING.md) قبل أي تعديل.

## التوثيق

[`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`PROVIDERS.md`](./PROVIDERS.md) · [`docs/`](./docs/) · [`SECURITY.md`](./SECURITY.md) · [`CHANGELOG.md`](./CHANGELOG.md)

## الترخيص

شيفرة Vader نفسها بترخيص **Apache 2.0** ([`LICENSE.txt`](./LICENSE.txt))، وهي مبنية على مكوّنات مفتوحة المصدر بتراخيصها المحفوظة في [`LICENSE-VS-Code.txt`](./LICENSE-VS-Code.txt) و[`ThirdPartyNotices.txt`](./ThirdPartyNotices.txt).

</div>

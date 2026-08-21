import type { AppLocale } from '../i18n/config';

export const LEGAL_LAST_UPDATED = '2026-08-20';

export type LegalSection = { heading: string; paragraphs: string[]; bullets?: string[] };
export type LegalDocument = { intro: string; sections: LegalSection[] };

/**
 * Plain-language policy text. It describes what this software actually does -
 * it is not a claim of compliance with any particular jurisdiction. See
 * THREAT_MODEL.md and DEPLOYMENT.md for where data physically lives.
 */
export const PRIVACY: Record<AppLocale, LegalDocument> = {
  en: {
    intro:
      "O'quv Markaz is a management platform for education centres. This page explains what data the service stores, why, and what you can do about it.",
    sections: [
      {
        heading: 'Who controls the data',
        paragraphs: [
          "The education centre that registers is the controller of the student records inside its workspace. O'quv Markaz processes that data on the centre’s behalf and does not use it for any other purpose.",
        ],
      },
      {
        heading: 'What we store about you (the account holder)',
        bullets: [
          'Your phone number or email address, used to sign in and to send verification codes.',
          'Your name, and optionally a photo, teaching subject, bio, language and timezone.',
          'A password hash (Argon2id). The password itself is never stored.',
          'Session records: creation time, last activity, a truncated browser identifier and a keyed hash of your IP address — never the raw address.',
          'An audit log of significant actions (sign-in, record changes, reminders sent).',
        ],
        paragraphs: [],
      },
      {
        heading: 'What you store about students',
        bullets: [
          'Name, and optionally phone, email, date of birth and free-text notes.',
          'A parent or guardian name and phone number, if you enter one.',
          'Attendance records, lesson history, charges and payments.',
        ],
        paragraphs: [
          "Only enter what you need. O'quv Markaz does not require a student’s email, birth date or photo, and the service works fully without them.",
        ],
      },
      {
        heading: 'Telegram',
        paragraphs: [
          'A Telegram account is linked only when its owner redeems a one-time code inside Telegram. We identify recipients by their Telegram user id, never by guessing from a phone number. You can revoke a link at any time, and every message sent is recorded in an audit log.',
        ],
      },
      {
        heading: 'What we never log',
        paragraphs: [
          'Passwords, verification codes, session tokens, API keys and raw IP addresses are never written to application logs.',
        ],
      },
      {
        heading: 'Retention and deletion',
        paragraphs: [
          'Archived students are kept so that historical attendance and payments stay meaningful. Deleting your account removes your profile, and removes any workspace where you are the only owner, along with its students, lessons, payments and uploaded files. Verification codes are deleted 24 hours after they expire.',
        ],
      },
      {
        heading: 'Your controls',
        bullets: [
          'Export everything in your workspace as JSON at any time.',
          'Export students, payments and reports as CSV.',
          'Delete your account and workspace from Settings → Security.',
          'Turn off any notification type individually.',
        ],
        paragraphs: [],
      },
      {
        heading: 'Where data is stored',
        paragraphs: [
          'This depends on how your instance is deployed. The operator of your instance documents the database and file-storage region in DEPLOYMENT.md. If you are self-hosting, you choose that location yourself.',
        ],
      },
    ],
  },
  uz: {
    intro:
      "O'quv Markaz — o'quv markazlar uchun boshqaruv platformasi. Bu sahifada xizmat qanday ma'lumotni, nima uchun saqlashi va siz nima qila olishingiz tushuntiriladi.",
    sections: [
      {
        heading: "Ma'lumotni kim nazorat qiladi",
        paragraphs: [
          "Ro'yxatdan o'tgan o'quv markaz o'z ish maydonidagi o'quvchi yozuvlarining egasi hisoblanadi. O'quv Markaz bu ma'lumotni markaz nomidan qayta ishlaydi va boshqa maqsadda ishlatmaydi.",
        ],
      },
      {
        heading: "Siz (hisob egasi) haqingizda nima saqlanadi",
        bullets: [
          "Telefon raqamingiz yoki email manzilingiz — kirish va tasdiqlash kodlarini yuborish uchun.",
          "Ismingiz, ixtiyoriy ravishda rasm, o'qitadigan fan, qisqacha ma'lumot, til va vaqt mintaqasi.",
          "Parol hashi (Argon2id). Parolning o'zi hech qachon saqlanmaydi.",
          "Seans yozuvlari: yaratilgan vaqt, oxirgi faollik, brauzer belgisi va IP manzilingizning kalitli hashi — xom manzil emas.",
          "Muhim amallar jurnali (kirish, yozuv o'zgarishi, yuborilgan eslatmalar).",
        ],
        paragraphs: [],
      },
      {
        heading: "O'quvchilar haqida siz nima saqlaysiz",
        bullets: [
          "Ism, ixtiyoriy ravishda telefon, email, tug'ilgan sana va erkin izohlar.",
          "Agar kiritsangiz — ota-ona yoki vasiyning ismi va telefon raqami.",
          "Davomat yozuvlari, dars tarixi, hisob-kitoblar va to'lovlar.",
        ],
        paragraphs: [
          "Faqat kerakli ma'lumotni kiriting. O'quv Markaz o'quvchining emaili, tug'ilgan sanasi yoki rasmini talab qilmaydi va ularsiz ham to'liq ishlaydi.",
        ],
      },
      {
        heading: 'Telegram',
        paragraphs: [
          "Telegram hisobi faqat uning egasi Telegram ichida bir martalik kodni kiritganda ulanadi. Qabul qiluvchini Telegram foydalanuvchi ID orqali aniqlaymiz, telefon raqamidan taxmin qilmaymiz. Ulanishni istalgan vaqtda bekor qilishingiz mumkin va yuborilgan har bir xabar jurnalga yoziladi.",
        ],
      },
      {
        heading: 'Hech qachon jurnalga yozilmaydi',
        paragraphs: [
          "Parollar, tasdiqlash kodlari, seans tokenlari, API kalitlari va xom IP manzillar ilova jurnaliga hech qachon yozilmaydi.",
        ],
      },
      {
        heading: "Saqlash va o'chirish",
        paragraphs: [
          "Arxivlangan o'quvchilar saqlanadi, chunki davomat va to'lov tarixi ma'noli qolishi kerak. Hisobingizni o'chirsangiz, profilingiz va siz yagona egasi bo'lgan ish maydoni — o'quvchilari, darslari, to'lovlari va yuklangan fayllari bilan birga o'chiriladi. Tasdiqlash kodlari muddati tugagach 24 soat ichida o'chiriladi.",
        ],
      },
      {
        heading: 'Sizning nazoratingiz',
        bullets: [
          "Ish maydonidagi hamma narsani istalgan vaqtda JSON ko'rinishida eksport qiling.",
          "O'quvchilar, to'lovlar va hisobotlarni CSV'ga eksport qiling.",
          "Sozlamalar → Xavfsizlik bo'limidan hisob va ish maydonini o'chiring.",
          "Har bir bildirishnoma turini alohida o'chiring.",
        ],
        paragraphs: [],
      },
      {
        heading: "Ma'lumot qayerda saqlanadi",
        paragraphs: [
          "Bu instansiya qanday joylashtirilganiga bog'liq. Instansiya operatori ma'lumotlar bazasi va fayl saqlash hududini DEPLOYMENT.md faylida hujjatlashtiradi. O'zingiz joylashtirsangiz, joyni o'zingiz tanlaysiz.",
        ],
      },
    ],
  },
  ru: {
    intro:
      "O'quv Markaz — платформа управления учебными центрами. На этой странице описано, какие данные хранит сервис, зачем и что вы можете с ними сделать.",
    sections: [
      {
        heading: 'Кто контролирует данные',
        paragraphs: [
          "Зарегистрировавшийся учебный центр является владельцем записей об учениках в своём рабочем пространстве. O'quv Markaz обрабатывает эти данные от имени центра и не использует их для других целей.",
        ],
      },
      {
        heading: 'Что мы храним о вас (владельце аккаунта)',
        bullets: [
          'Номер телефона или email — для входа и отправки кодов подтверждения.',
          'Ваше имя, по желанию фото, преподаваемый предмет, описание, язык и часовой пояс.',
          'Хеш пароля (Argon2id). Сам пароль не хранится никогда.',
          'Записи сессий: время создания, последняя активность, идентификатор браузера и хеш IP-адреса с секретным ключом — не сам адрес.',
          'Журнал значимых действий (вход, изменение записей, отправленные напоминания).',
        ],
        paragraphs: [],
      },
      {
        heading: 'Что вы храните об учениках',
        bullets: [
          'Имя, по желанию телефон, email, дата рождения и произвольные заметки.',
          'Имя и телефон родителя или опекуна, если вы их вводите.',
          'Посещаемость, история уроков, начисления и платежи.',
        ],
        paragraphs: [
          "Вводите только необходимое. O'quv Markaz не требует email, даты рождения или фото ученика и полностью работает без них.",
        ],
      },
      {
        heading: 'Telegram',
        paragraphs: [
          'Аккаунт Telegram привязывается только тогда, когда его владелец сам вводит одноразовый код в Telegram. Получателя мы определяем по Telegram user id, а не угадываем по номеру телефона. Привязку можно отозвать в любой момент, каждое отправленное сообщение записывается в журнал.',
        ],
      },
      {
        heading: 'Что никогда не логируется',
        paragraphs: [
          'Пароли, коды подтверждения, токены сессий, API-ключи и необработанные IP-адреса никогда не попадают в логи приложения.',
        ],
      },
      {
        heading: 'Хранение и удаление',
        paragraphs: [
          'Архивные ученики сохраняются, чтобы история посещаемости и платежей оставалась осмысленной. Удаление аккаунта удаляет ваш профиль и рабочие пространства, где вы единственный владелец, вместе с учениками, уроками, платежами и загруженными файлами. Коды подтверждения удаляются через 24 часа после истечения срока.',
        ],
      },
      {
        heading: 'Ваши возможности',
        bullets: [
          'Экспортировать всё содержимое пространства в JSON в любой момент.',
          'Выгружать учеников, платежи и отчёты в CSV.',
          'Удалить аккаунт и пространство в разделе Настройки → Безопасность.',
          'Отключить любой тип уведомлений по отдельности.',
        ],
        paragraphs: [],
      },
      {
        heading: 'Где хранятся данные',
        paragraphs: [
          'Это зависит от способа развёртывания. Оператор вашего экземпляра указывает регион базы данных и файлового хранилища в DEPLOYMENT.md. При самостоятельном размещении вы выбираете это сами.',
        ],
      },
    ],
  },
};

export const TERMS: Record<AppLocale, LegalDocument> = {
  en: {
    intro:
      "These terms describe what O'quv Markaz provides and what is expected of you when you use it.",
    sections: [
      {
        heading: 'The service',
        paragraphs: [
          "O'quv Markaz helps an education centre keep track of students, groups, lessons, attendance, payments and payroll. It is a management and record-keeping tool. It does not process tuition payments between the centre and its students, and it does not act as a marketplace.",
        ],
      },
      {
        heading: 'Your account',
        paragraphs: [
          'You are responsible for keeping your sign-in credentials private and for the accuracy of what you enter. You must be legally able to enter into this agreement.',
        ],
      },
      {
        heading: 'Data you enter about other people',
        paragraphs: [
          'You are responsible for having a lawful basis to record information about your students and their parents, and for telling them what you record. Do not enter information you do not need.',
        ],
      },
      {
        heading: 'Acceptable use',
        bullets: [
          'Do not use the service to send unsolicited bulk messages.',
          'Do not attempt to access another workspace’s data.',
          'Do not probe, scan or attempt to breach the service without written permission.',
        ],
        paragraphs: [],
      },
      {
        heading: 'Plans and payment',
        paragraphs: [
          'The Free plan is limited to 10 active students. Paid plans are billed in advance for the stated period. Where online payment is enabled, plan changes take effect only after the payment provider confirms the transaction to our servers.',
        ],
      },
      {
        heading: 'Availability and liability',
        paragraphs: [
          'The service is provided as-is. We do not guarantee uninterrupted availability. Keep your own exports of anything you cannot afford to lose — the export function exists for exactly this.',
        ],
      },
      {
        heading: 'Ending the agreement',
        paragraphs: [
          'You may delete your account at any time from Settings → Security. We may suspend an account that is being used to attack the service or to send unsolicited messages.',
        ],
      },
    ],
  },
  uz: {
    intro:
      "Bu shartlar O'quv Markaz nimani taqdim etishini va undan foydalanishda sizdan nima kutilishini tavsiflaydi.",
    sections: [
      {
        heading: 'Xizmat',
        paragraphs: [
          "O'quv Markaz o'quv markazga o'quvchilar, guruhlar, darslar, davomat, to'lovlar va maoshlarni kuzatishga yordam beradi. Bu boshqaruv va hisob yuritish vositasi. U markaz bilan o'quvchilar o'rtasidagi to'lovlarni amalga oshirmaydi va marketplace emas.",
        ],
      },
      {
        heading: 'Hisobingiz',
        paragraphs: [
          "Kirish ma'lumotlaringizni maxfiy saqlash va kiritgan ma'lumotlaringiz to'g'riligi uchun siz javobgarsiz. Ushbu kelishuvni tuzishga qonuniy huquqingiz bo'lishi kerak.",
        ],
      },
      {
        heading: "Boshqalar haqida kiritgan ma'lumotingiz",
        paragraphs: [
          "O'quvchilaringiz va ularning ota-onalari haqidagi ma'lumotni yozib olish uchun qonuniy asosga ega bo'lish va ularga nimani yozib olayotganingizni aytish sizning javobgarligingiz. Keraksiz ma'lumotni kiritmang.",
        ],
      },
      {
        heading: 'Maqbul foydalanish',
        bullets: [
          "Xizmatdan so'ralmagan ommaviy xabarlar yuborish uchun foydalanmang.",
          "Boshqa ish maydoni ma'lumotlariga kirishga urinmang.",
          "Yozma ruxsatsiz xizmatni skanerlash yoki buzishga urinmang.",
        ],
        paragraphs: [],
      },
      {
        heading: "Tariflar va to'lov",
        paragraphs: [
          "Bepul tarif 10 ta faol o'quvchi bilan cheklangan. Pullik tariflar ko'rsatilgan davr uchun oldindan to'lanadi. Onlayn to'lov yoqilgan bo'lsa, tarif o'zgarishi to'lov provayderi tranzaksiyani serverlarimizga tasdiqlagandan keyingina kuchga kiradi.",
        ],
      },
      {
        heading: 'Mavjudlik va javobgarlik',
        paragraphs: [
          "Xizmat mavjud holicha taqdim etiladi. Uzluksiz ishlashni kafolatlamaymiz. Yo'qotib bo'lmaydigan ma'lumotlarni o'zingiz eksport qilib saqlang — eksport funksiyasi aynan shu uchun mavjud.",
        ],
      },
      {
        heading: 'Kelishuvni tugatish',
        paragraphs: [
          "Sozlamalar → Xavfsizlik bo'limidan hisobingizni istalgan vaqtda o'chirishingiz mumkin. Xizmatga hujum qilish yoki so'ralmagan xabarlar yuborish uchun ishlatilgan hisobni to'xtatib qo'yishimiz mumkin.",
        ],
      },
    ],
  },
  ru: {
    intro:
      "Эти условия описывают, что предоставляет O'quv Markaz и что ожидается от вас при использовании сервиса.",
    sections: [
      {
        heading: 'Сервис',
        paragraphs: [
          "O'quv Markaz помогает учебному центру вести учёт учеников, групп, уроков, посещаемости, платежей и зарплат. Это инструмент управления и учёта. Он не проводит платежи между центром и учениками и не является маркетплейсом.",
        ],
      },
      {
        heading: 'Ваш аккаунт',
        paragraphs: [
          'Вы отвечаете за сохранность своих учётных данных и за точность вводимой информации. Вы должны иметь право заключать данное соглашение.',
        ],
      },
      {
        heading: 'Данные о других людях',
        paragraphs: [
          'Вы отвечаете за наличие законного основания записывать сведения о своих учениках и их родителях и за информирование их об этом. Не вводите то, что вам не нужно.',
        ],
      },
      {
        heading: 'Допустимое использование',
        bullets: [
          'Не используйте сервис для массовых нежелательных рассылок.',
          'Не пытайтесь получить доступ к данным чужого рабочего пространства.',
          'Не сканируйте и не пытайтесь взломать сервис без письменного разрешения.',
        ],
        paragraphs: [],
      },
      {
        heading: 'Тарифы и оплата',
        paragraphs: [
          'Бесплатный тариф ограничен 10 активными учениками. Платные тарифы оплачиваются авансом за указанный период. Если онлайн-оплата включена, смена тарифа вступает в силу только после подтверждения транзакции платёжным провайдером на наших серверах.',
        ],
      },
      {
        heading: 'Доступность и ответственность',
        paragraphs: [
          'Сервис предоставляется «как есть». Мы не гарантируем бесперебойную работу. Храните собственные выгрузки того, что нельзя потерять — функция экспорта существует именно для этого.',
        ],
      },
      {
        heading: 'Прекращение соглашения',
        paragraphs: [
          'Вы можете удалить аккаунт в любой момент в разделе Настройки → Безопасность. Мы можем приостановить аккаунт, используемый для атак на сервис или нежелательных рассылок.',
        ],
      },
    ],
  },
};

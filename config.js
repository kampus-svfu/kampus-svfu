// Настройки подключения к Supabase.
// Если очистить два поля ниже, сайт перейдёт в демо-режим (объявления только в браузере).
// Где взять значения: Supabase → Connect → App Frameworks. Ключи secret / service_role сюда НЕ вставлять.
window.KAMPUS_CONFIG = {
  SUPABASE_URL: "https://iagmvzoyhyjskbqwzfpa.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_GUKjx5EkLnlkCegXuFuiCw_R9qBphwr",  // публичный ключ (Publishable key), его можно держать в открытом коде

  // Разрешить вход только с этих доменов почты (пусто — любая почта).
  // Студенты СВФУ: ["stud.s-vfu.ru"]. Такая же проверка стоит в schema.sql — меняйте оба места вместе.
  ALLOWED_EMAIL_DOMAINS: [],

  // Сколько дней объявление видно в ленте.
  LISTING_TTL_DAYS: 60
};

# Деплой KES CRM

Сайт хостится на **Cloudflare Pages** → https://kes-crm.pages.dev
Проект Pages: `kes-crm`. Сайт статический (HTML/CSS/JS), сборки нет.

## Авто-деплой через GitHub Actions (основной способ)

Настроен workflow `.github/workflows/deploy.yml`. Деплой делает CI, поэтому
**сотрудникам не нужны личные доступы Cloudflare и не нужен wrangler на их машинах.**

### Как задеплоить
- **Мёрж в `main`** — любой влитый в `main` коммит автоматически деплоится на прод.
- **Вручную из браузера** (с любого устройства, хоть с телефона):
  GitHub → вкладка **Actions** → workflow **Deploy to Cloudflare Pages** →
  **Run workflow**. Доступ к деплою = право запускать workflow в репозитории.

### Разовая настройка (делает владелец репозитория, один раз)

1. **Создать API-токен Cloudflare**
   Cloudflare Dashboard → My Profile → **API Tokens** → Create Token →
   шаблон **«Edit Cloudflare Pages»** (или Custom: *Account → Cloudflare Pages → Edit*).
   Скопировать токен (показывается один раз).

2. **Добавить секреты в GitHub**
   Репозиторий → Settings → **Secrets and variables → Actions** → *New repository secret*:
   | Имя | Значение |
   |-----|----------|
   | `CLOUDFLARE_API_TOKEN` | токен из шага 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | `d0655e161d8fca8487f88d55c0eeb215` |

3. **Дать сотрудникам доступ** к репозиторию (роль Write — чтобы пушить/мёржить
   и запускать workflow). Токен Cloudflare остаётся только в секретах репозитория,
   на устройствах сотрудников ничего не хранится.

> Workflow начнёт работать после того, как файл `.github/workflows/deploy.yml`
> попадёт в ветку `main` (т.е. после мёржа PR). Кнопка «Run workflow» тоже
> появляется только когда workflow есть в `main`.

## ⚠️ Двойной деплой

Если в дашборде Cloudflare Pages у проекта **подключена Git-интеграция**
(автодеплой при пуше в `main`), то после добавления этого workflow деплой будет
происходить **дважды**. Оставьте что-то одно:

- **Рекомендуется — оставить GitHub Actions** (он в репозитории, прозрачен, ревьюится):
  в CF Dashboard → проект `kes-crm` → Settings → **Builds & deployments** →
  отключить **automatic deployments** для Git.
- Либо наоборот — удалить `.github/workflows/deploy.yml` и пользоваться только
  Git-интеграцией Cloudflare.

## Ручной деплой (запасной вариант)

Нужен установленный wrangler и доступ к аккаунту Cloudflare:

```bash
wrangler pages deploy . --project-name=kes-crm
```

## Локальный запуск

```bash
python3 -m http.server 8805
# открыть http://127.0.0.1:8805
```

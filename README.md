# Uptime Empire

Экономический симулятор админа ЦОД для ПК (Electron + TypeScript + React).
Главные документы: **GAME.md** (правила и дорожная карта) и **DESIGN.md** (детальный дизайн).

## Запуск

```bash
npm install
npm run dev      # окно Electron + Vite с HMR
npm run build    # типы, интерфейс в dist/, main-процесс в dist-electron/
npm test         # Vitest
npm start        # собрать и запустить как приложение
```

Требуется Node.js LTS (проверено на 24.x) и npm.

## Управление (этап 0)

| Клавиши | Действие |
|---|---|
| Пробел | пауза |
| 1 / 2 / 3 / 4 | скорость ×1 / ×5 / ×20 / ×60 |
| F3 | оверлей производительности |
| F11 | полный экран (обрабатывает main-процесс) |

## Структура

```
electron/        main-процесс и preload (окно, IPC, логи)
src/sim/         чистая логика: RNG, календарь, тики (без React и DOM)
src/state/       Zustand-хранилище и игровой цикл (requestAnimationFrame)
src/ui/          React-компоненты и стили
src/platform/    доступ к системе через мост window.uptime
src/data/        числа баланса (balance.json) и их валидация
src/i18n/        ru.json, en.json
tests/           Vitest
tools/           dev-скрипт, позже balance-sim
```

## Правила

- Все числа баланса — в `src/data/*.json`, интерфейсные строки — только через i18n.
- `src/sim/` не импортирует React/DOM/Electron.
- Случайность только через seeded RNG, `Math.random` запрещён.
- Файловая система — только через `preload` и каналы `save:*`, `settings:*`, `log:*`.
- Один этап за раз, коммит `stage N: описание`, обновление чек-листа и CHANGELOG.md.

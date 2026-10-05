# Передача на игровой стенд — 0.8

Статус игры: **NOT RUN**. Пакет содержит исполняемое ядро/протокол и контракт адаптера. Он не содержит готового ESP, игровых данных или подтверждённых привязок. Все null в bindings.example.json намеренны.

## Воспроизведение независимой части

Node 24.19.0, чистый checkout:

```sh
npm ci
npm run check:content
npm run check:bindings -- config/bindings.example.json --template
npm run typecheck
npm run build
npm test
npm run qa:extended -- 10000
npm run test:browser
npm run demo:ui
```

Playwright требует предварительного `npx playwright install --with-deps chromium`. Проверка шаблона bindings сообщает `complete:false`; без `--template` она обязана завершаться ошибкой `UNRESOLVED_BINDINGS`. Это ожидаемая остановка перед игрой.

## Установка ядра

```sh
npm run package -- /absolute/path/core-0.8.0.sxe.gz
node scripts/install-release.mjs /absolute/path/core-0.8.0.sxe.gz /srv/extraction-core
node scripts/install-release.mjs /absolute/path/core-0.8.0.sxe.gz /srv/extraction-core --apply
```

Первый вызов установки — dry-run без записи. Формат .sxe.gz: gzip JSON с относительными путями, размером и SHA-256 каждого файла. Проверка хешей защищает от повреждения, не подтверждает автора: брать архив только из доверенной сборки. Установка/обновление запрещает чужие или изменённые файлы; предыдущий каталог остаётся рядом как `.backup-UUID`. Нельзя запускать службу во время замены каталога. В установленном каталоге не выполнять npm install: это неизменяемая runtime-сборка. Для разработки использовать checkout.

База и ключ всегда вне каталога программы. Создать данные через `init-server.mjs` в отдельном рабочем каталоге, затем задать EXTRACTION_DB и EXTRACTION_TOKEN_FILE (пути из config/server.example.json — пример). `node /srv/extraction-core/scripts/serve.ts` требует аренду адаптера; старый POST /v1/command запрещён. Ключ читается только сервером, не передаётся CEF/игрокам и не помещается в манифест.

```sh
node scripts/backup.mjs /srv/extraction-data/core.sqlite /srv/backups/new.sqlite
node scripts/restore.mjs /srv/backups/new.sqlite /srv/extraction-data/restored.sqlite
```

Restore публикует только новый файл, меняет databaseId и закрывает старые соединения. Остановить службу, сохранить прежние данные, переключить EXTRACTION_DB на новый файл и пересоздать игровой проектор. Старые receipts сохраняются. При неоднозначном игровом состоянии использовать аварийное закрытие мира до reconcile.

## Что подключить к SkyMP

1. Подтверждённый серверный login → AuthenticationPort.session. Клиентские profileId/offlineLogin не являются удостоверением личности. OpenConnection выполняется сервером после проверки login, не из произвольного клиентского пакета.
2. FencedCoreClient.acquire → ProjectionBridge.synchronize → IntentRouter. Серверный адаптер обновляет аренду каждые 5 секунд через /v1/adapter/renew; lease живёт 15 секунд. При любой ошибке heartbeat немедленно заморозить взаимодействия. При запуске ядра прежнее поколение отсекается.
3. SkyMpInventoryPort требует actor/container/template resolver и действующий interactions(blocked). Получить реальные plugin/localId/hash из законной установки; заполнить config/bindings.example.json локально. Полная `check:bindings` обязана пройти до применения. Уровни light/full plugins разрешаются через resolveForm и измеренный load order. Позиции выходов не выдуманы.
4. AuthenticationPort.approve использует серверные позиции, расстояния, живость, экспедицию, владение контейнером и ExtractionPolicy. Для расходников отдельно подтвердить запрет повторного игрового эффекта. Само списание в ядре не лечит персонажа.
5. recordMissionEvent получает стабильный ID реально подтверждённого события. Группа 1–4, party/range проверяет игровой адаптер. observeArea хранит монотонный sequence и обе стороны перехода; отключение не освобождает область. Tick `advanceWorld` — доверенное серверное игровое время, не часы клиента. ResetArea — только текущий день и незанятая область.
6. При потере мира: новый lease остаётся FROZEN. `/v1/adapter/recover` с lease/requestId/worldId закрывает мир и возвращает лишь сохранившиеся исходные UUID снаряжения, не добычу/потраченные вещи. После этого полная проекция, readback, reconcile; заново provision мира. При восстановимом мире можно сверить полную проекцию без компенсации. Решение принимает доверенный оператор, не игрок.
7. Журнал G1_RUN_LOG.csv заполнить по G1_CHECKLIST.md, приложить два клиентских видео и обезличенные диагностические записи. Любой обход доверия/дублирование/рассинхронизация блокирует игровой релиз.

Тестовая HTTP-конфигурация createCoreServer без requireLease сохранена только для изолированной модели и старых тестов. Производственный entry point всегда включает requireLease. Отключать его для обхода ошибки интеграции нельзя.

# SkyMP: запрет расхода зелья

`skymp-respect-consumption-veto.patch` применяется к SkyMP commit `2849e676fe008925384b26f34476e382a30bd877`.

```sh
git apply --check /path/to/skyrim-extraction/patches/skymp-respect-consumption-veto.patch
git apply /path/to/skyrim-extraction/patches/skymp-respect-consumption-veto.patch
```

EatItem возвращает результат GameModeEvent::Fire. При запрете OnEquip возвращает false до удаления предмета/рассылки equip и отправляет актуальный инвентарь. Добавлен upstream Catch2-тест: запрещённое зелье не меняет количество и здоровье.

Проверено соответствие diff исходному снимку (reverse apply check на изменённом дереве). Компиляция и native тест не выполнены: конфигурация остановилась на системных зависимостях libsodium; тест дополнительно требует ESM-фикстуры upstream. Патч экспериментальный, не утверждён как рабочая защита. Производная часть исходников распространяется с соблюдением лицензии соответствующих файлов SkyMP; это не самостоятельное разрешение на распространение игровых ресурсов.

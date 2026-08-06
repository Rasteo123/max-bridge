# Протокол MAX (web.max.ru) — снято с живой сессии 2026-08-06

Транспорт: WebSocket, бинарные кадры.

## Кадр

```
byte 0      protocolVersion = 10
byte 1      cmd   (0 = request, 1 = response, 2/3 = push/notify)
byte 2..3   seq   (uint16, big-endian)
byte 4..5   opcode (int16, big-endian)
byte 6      compressionMultiplier (0 = без сжатия, иначе LZ4-block, capacity = len * multiplier)
byte 7..9   payloadLength (24 бита, big-endian)
byte 10..   msgpack payload
```

msgpack с расширением ext type 1 = вложенный msgpack-инт (используется для больших id).
Ответ приходит с тем же `seq` и `cmd = 1`.

## Опкоды

| op | направление | запрос | ответ |
|----|-------------|--------|-------|
| 1 | out | `{interactive: bool}` | пусто — ping/keepalive |
| 5 | out | `{events: [{type:"NAV", userId, time, sessionId, event, params}]}` | пусто — аналитика |
| 6 | in | — | приходит в составе стартовой синхронизации |
| 19 | out | `{token, chatsCount, lastLogin, interactive, chatsSync, contactsSync, presenceSync, draftsSync, configHash}` | `{profile, chats, messages, contacts, presence, config, time, updates}` — логин + синхронизация. `chatsSync: 0` = полная выдача. Отправляется один раз на соединение; повторная отправка рвёт сокет. |
| 27 | out | `{type: "STICKER"\|"FAVORITE_STICKER"\|"REACTION"\|"ANIMOJI_SET", sync}` | `{sync, sections: [{type, id, reactions: [animojiId], updateTime}], animojiUpdates: {animojiId: updateTime}}`. `sync: 0` = полная выдача. |
| 28 | out | `{type: "ANIMOJI"\|"ANIMOJI_SET", ids: [int]}` | `{animojis: [{id, emoji, iconUrl, lottieUrl, lottiePlayUrl, setId}]}` / `{animojiSets: [{id, name, iconUrl, iconLottieUrl, animojiIds}]}` |
| 32 | out | `{contactIds: [int]}` | `{contacts: [{id, names:[{name, firstName, lastName, type}], baseUrl, baseRawUrl, photoId, gender, options: [...], flags, link, accountStatus, updateTime, registrationTime}]}` |
| 35 | out | `{contactIds: [int]}` | `{presence: {userId: {seen: <epoch СЕКУНДЫ>}}, time: <epoch мс>}` |
| 49 | out | `{chatId, from: <epoch мс>, forward: int, backward: int, getMessages: true}` | `{messages: [...]}` — история. Пагинация по `from`, курсора и `hasMore` НЕТ. |
| 75 | out | `{chatId, subscribe: bool}` | пусто — подписка на события чата |
| 163 | out | — | `{callHistoryItems, callHistorySync}` |
| 180 | out | `{chatId, messageIds: [int]}` | `{messagesReactions: {messageId: {...}}}` |
| 208 | out | `{cursor, count}` | `{storiesPreviews: []}` |
| 300 | out | — | рекомендации каналов |
| 302 | in | — | приходит в стартовой синхронизации |

Не разобрано: 27x/30x прочие, отправка сообщения, редактирование, удаление, отметка о прочтении, поиск.

## Объект контакта

`options` — массив строковых флагов. Встречены:
`SERVICE_ACCOUNT`, `TT`, `ONEME`, `OFFICIAL`, `BOT`, `NO_FORWARD`, `RESTRICTED`.

**`OFFICIAL` — это и есть галочка верификации** (синий бейдж рядом с именем).
`BOT` — бот, `SERVICE_ACCOUNT` — служебный аккаунт.

## Объект чата

```
{
  id, cid, type: "DIALOG" | "CHAT" | "CHANNEL",
  status: "ACTIVE",
  owner: <userId>,
  participants: { "<userId>": <epoch мс> },
  lastMessage: <Message>,
  lastEventTime, lastDelayedUpdateTime, lastFireDelayedErrorTime,
  created, prevMessageId, restrictions, joinTime, hasBots, modified,
  options: { SERVICE_CHAT: true, ... }
}
```

`participants` — это **не** время вступления, а отметка о прочтении каждого участника
(в служебном чате моя отметка = «сейчас», собеседника = старая). Отсюда берётся
статус доставки исходящих сообщений: если отметка собеседника ≥ `message.time`,
сообщение прочитано (двойная галочка), иначе доставлено (одинарная).

## Объект сообщения

```
{
  id: <uint64, ВЫХОДИТ за Number.MAX_SAFE_INTEGER — только BigInt/строка>,
  time: <epoch мс>,
  type: "USER",
  sender: <userId>,
  text: string,
  attaches: [ { _type: ..., ... } ],
  reactionInfo: {},
  options: int,
  elements: [ {type: "STRONG", from, length} ]   // разметка текста
}
```

Важное:
- **поля `status` у сообщения нет** — статус доставки вычисляется по `participants` чата;
- реакции лежат в **`reactionInfo`**, а не в `reactions`/`reactionSummary`;
- `elements` — форматирование (жирный и т.п.), сейчас бриджем игнорируется;
- `attaches[]._type` встречен как `CALL` (`{callType: "AUDIO", hangupType: "CANCELED"|"HUNGUP", duration, conversationId, contactIds}`).

## Каналы

Веб-версия MAX **не показывает ленту постов неподписанного канала** — только шапку,
описание и кнопку «Подписаться». Посты приходят только после подписки.
Вкладка «Каналы» у неподписанного пользователя показывает рекомендации (op 300).

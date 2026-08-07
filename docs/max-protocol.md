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
| 48 | out | `{chatIds: [int]}` | чаты по идентификаторам |
| 60 | out | `{query, count, type: "ALL"}` | `{result: [{chat: {...}, highlights: [...]}], total, marker, ucpQId}` — **глобальный поиск** по каналам и чатам |
| 91 | out | `{chatId, postIds}` | `{commentsInfoUpdates: [{postId, commentsInfo: {totalCount}}]}` — счётчики комментариев к постам канала |
| 180 | out | `{chatId, messageIds}` | `{messagesReactions: {<messageId>: {counters, totalCount}}}` — массовое обновление реакций; в канале клиент дополняет им уже полученную историю |
| 64 | out | `{chatId, message: {text, cid, elements: [], attaches: []}, notify}` | `{message: {...}}` — отправка. `cid` — отрицательный клиентский идентификатор |
| 68 | out | `{query, count}` | `{result, ucpQId}` — поиск по своим чатам и контактам |
| 65 | out | `{chatId, type: "TEXT"}` | уведомление «печатает» |
| 66 | out | `{chatId, messageIds: [int], forMe: bool}` | удаление. **`forMe: false` = удалить у всех** |
| 67 | out | `{chatId, messageId, text, elements: [], attachments: []}` | редактирование |
| 75 | out | `{chatId, subscribe: bool}` | пусто — подписка на события чата |
| 177 | out | `{userId, time}` | отметка о прочтении |
| 178 | out | `{chatId, messageId, reaction: {reactionType: "EMOJI", id: "❤️"}}` | `{reactionInfo}` — поставить реакцию |
| 179 | out | `{chatId, messageId}` | снять свою реакцию |
| 180 | out | `{chatId, messageIds: [int]}` | `{messagesReactions: {messageId: {...}}}` |
| 208 | out | `{cursor, count}` | `{storiesPreviews: []}` |
| 83 | out | `{videoId, token, chatId, messageId}` | `{cache, EXTERNAL, MP4_144, MP4_240, …}` — ссылки на воспроизведение видео по качествам |
| 88 | out | `{fileId, chatId, messageId, itemType: "REGULAR"}` | `{url: "https://fd.oneme.ru/getfile?rq=…&expires=…", unsafe}` — ссылка на скачивание файла |
| 163 | out | — | `{callHistoryItems, callHistorySync}` |
| 300 | out | — | рекомендации каналов |
| 302 | in | — | приходит в стартовой синхронизации |

Найденный в поиске чат канала несёт больше полей, чем чат из списка:
`link`, `access: "PUBLIC"`, `participantsCount`, `description`, `messagesCount`
и `options` — объект флагов, где **`OFFICIAL` означает верификацию канала**,
а `COMMENTS` — включены ли комментарии к постам.

## Комментарии к постам канала

Отдельного опкода у комментариев нет: это та же история (**49**) с добавленным
`postId`. Ветка комментариев к посту `postId` запрашивается так:

```
49 → {chatId, postId, from, forward, backward, getMessages: true}
```

Ответ — обычный `{messages: [...]}`, где каждый комментарий имеет `sender`,
`text` и `attaches`, то есть разбирается тем же адаптером, что и сообщения.

Пост канала (`type: "CHANNEL"`) несёт сверх обычного сообщения:

- `reactionInfo: {counters: [{reaction, count}], totalCount}` — реакции приходят
  прямо в истории, **своей реакции в них нет**;
- `stats: {views}` — число просмотров.

Не разобрано: подписка на канал и отписка.

## Вложения (`attaches[]`)

Различаются по `_type`:

```
PHOTO   { _type, photoId, photoToken, baseUrl, width, height, previewData: <bin> }
VIDEO   { _type, videoId, token, thumbnail: <url>, duration, width, height,
          videoType, previewData: <bin> }
FILE    { _type, fileId, token, name, size, preview?: <PHOTO-подобный объект> }
CALL    { _type, callType: "AUDIO"|"VIDEO", hangupType: "CANCELED"|"HUNGUP",
          duration, conversationId, contactIds }
CONTROL { _type, event: "system", message, shortMessage }
```

Ссылок на сам файл в сообщении нет — их нужно получать:

- **PHOTO** — `baseUrl` уже готовая подписанная ссылка на `i.oneme.ru`, но с `expires`
  (несколько часов). Перезапрашивается вместе с историей.
- **VIDEO** — опкод 83. `thumbnail` доступен сразу (CDN `iv.okcdn.ru`).
- **FILE** — опкод 88.

`previewData` — крошечная бинарная превьюшка, годится как заглушка при загрузке.

## Стикеры

Наборы — опкод 27 (`type: "STICKER"`, `sync: 0`):

```
sections: [
  { type: "STICKER_SETS", id: "NEW_STICKER_SETS",
    stickerSets: [223822, 227918, …], title, totalCount, collapsed },
  { type: "RECENTS", id: "RECENT", emojiList, recentEmojiList, recentsList }
]
```

Набор разворачивается опкодом 28 (`type: "STICKER_SET"`):

```
{ id, name, iconUrl, updateTime, link, stickers: [24393260366, …] }
```

Сам стикер — опкодом 28 (`type: "STICKER"`):

```
{ id, width, height, tags: ["😏","🤫"], type: "LOTTIE",
  url: "https://i.oneme.ru/getSmile?smileId=…&smileType=4",
  lottieUrl, setId, authorType, fileId }
```

`url` — готовая картинка на `i.oneme.ru`, скачивать отдельно не нужно.
`lottieUrl` — анимация для анимированных стикеров.

Вложение в сообщении:

```
{ _type: "STICKER", stickerId, setId, url, lottieUrl,
  stickerType: "LOTTIE", width, height, tags, audio, authorType, time }
```

Отправка — опкод 64, как обычное сообщение:

```
{ chatId, message: { cid, attaches: [ { _type: "STICKER", stickerId } ] }, notify: true }
```

## Реакции

В сообщении:

```
reactionInfo: {
  counters: [ { reaction: "👍", count: 1 } ],
  yourReaction: "👍",
  totalCount: 1
}
```

Реакция — **обычная строка-эмодзи**, а не идентификатор и не фиксированный ключ.
Список доступных реакций для пикера — опкод 27 (`type: "REACTION"`, `sync: 0`):
секция `POPULAR` с 74 идентификаторами анимоджи, которые разворачиваются опкодом 28
(`type: "ANIMOJI"`) в `{id, emoji, iconUrl, lottieUrl}`.

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

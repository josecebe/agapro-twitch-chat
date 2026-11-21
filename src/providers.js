(function (ChatWidget) {
    'use strict';

    const rateLimits = new Map();
    ChatWidget.fetchJSON = async function (url, options = {}) {
        const host = new URL(url).hostname;
        const remaining = (rateLimits.get(host) || 0) - Date.now();
        if (remaining > 0) {
            const error = Error('HTTP 429 · API cooldown');
            error.status = 429;
            error.retryAfter = remaining;
            throw error;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                credentials: 'omit'
            });
            if (!response.ok) {
                const error = Error('HTTP ' + response.status);
                error.status = response.status;
                const retry = response.headers.get('Retry-After');
                const seconds =
                    retry && Number.isFinite(Number(retry))
                        ? Number(retry)
                        : (Date.parse(retry) - Date.now()) / 1000;
                error.retryAfter = Math.max(
                    10000,
                    Number.isFinite(seconds) ? seconds * 1000 : 60000
                );
                if (response.status === 429) {
                    rateLimits.set(host, Date.now() + error.retryAfter);
                }
                throw error;
            }
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    };
    ChatWidget.sharedAssetFetcher = function (fetcher = ChatWidget.fetchJSON) {
        const cache = new Map();
        return function (url, options) {
            const ttl =
                url === 'https://7tv.io/v3/emote-sets/global'
                    ? 600000
                    : url === 'https://api.ivr.fi/v2/twitch/badges/global'
                      ? 2700000
                      : 0;
            if (!ttl) {
                return fetcher(url, options);
            }
            const old = cache.get(url);
            const fresh = ['no-cache', 'reload', 'no-store'].includes(options?.cache);
            if (old && (old.pending || (!fresh && old.expires > Date.now()))) {
                return old.promise;
            }
            const entry = {
                expires: Date.now() + ttl,
                pending: true
            };
            entry.promise = Promise.resolve()
                .then(() => fetcher(url, options))
                .catch((error) => {
                    if (cache.get(url) === entry) {
                        cache.delete(url);
                    }
                    throw error;
                })
                .finally(() => {
                    entry.pending = false;
                });
            cache.set(url, entry);
            return entry.promise;
        };
    };
    ChatWidget.normalizeBadges = function (data) {
        if (!Array.isArray(data)) {
            throw Error('Unknown badge schema');
        }
        const sets = Object.create(null);
        for (const set of data) {
            if (typeof set?.set_id !== 'string' || !set.set_id || !Array.isArray(set.versions)) {
                throw Error('Invalid badge set');
            }
            const versions = Object.create(null);
            for (const badge of set.versions) {
                if (typeof badge?.id !== 'string' || !badge.id) {
                    continue;
                }
                const normalized = {
                    title: typeof badge.title === 'string' ? badge.title : set.set_id
                };
                for (const key of ['image_url_1x', 'image_url_2x', 'image_url_4x']) {
                    const src =
                        typeof badge[key] === 'string' &&
                        ChatWidget.safeURL(badge[key], ['static-cdn.jtvnw.net']);
                    if (src) {
                        normalized[key] = src;
                    }
                }
                if (normalized.image_url_1x || normalized.image_url_2x || normalized.image_url_4x) {
                    versions[badge.id] = normalized;
                }
            }
            sets[set.set_id] = {
                versions
            };
        }
        return sets;
    };
    ChatWidget.Assets = class {
        constructor(report, fetcher = ChatWidget.fetchJSON) {
            this.report = report;
            this.fetcher = fetcher;
            this.sourceChannels = new Map();
            this.sourceQueue = [];
            this.activeSources = 0;
            this.globalBadges = {};
            this.channelBadges = {};
            this.globalEmotes = new Map();
            this.channelEmotes = new Map();
            this.listeners = new Set();
            this.emoteSets = new Map();
            this.liveEmoteJobs = new Map();
        }
        watchEmoteSet(roomId, set) {
            if (this.stopped) return;
            const key = roomId || 'global';
            const id = typeof set?.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(set.id) ? set.id : '';
            if (this.emoteSets.get(key) === id) return;
            if (id) this.emoteSets.set(key, id);
            else this.emoteSets.delete(key);
            this.connectEmoteEvents();
        }
        connectEmoteEvents() {
            if (
                this.stopped ||
                !this.config?.showSevenTVEmotes ||
                typeof EventSource === 'undefined'
            )
                return;
            for (const key of this.emoteSets.keys()) {
                if (key !== 'global' && key !== this.channelId && !this.sourceChannels.has(key))
                    this.emoteSets.delete(key);
            }
            const ids = [...new Set(this.emoteSets.values())].sort();
            const signature = ids.join(',');
            if (this.emoteEventSource && signature === this.emoteEventSignature) return;
            this.emoteEventSource?.close();
            clearTimeout(this.emoteHeartbeat);
            clearTimeout(this.emoteEventRetry);
            this.emoteEventSource = null;
            this.emoteEventSignature = signature;
            if (!ids.length) return;
            const subscriptions = ids.map((id) => `emote_set.*<object_id=${id}>`).join(',');
            let stream;
            try {
                stream = new EventSource(
                    'https://events.7tv.io/v3@' + encodeURIComponent(subscriptions)
                );
            } catch {
                this.emoteEventRetry = setTimeout(() => this.connectEmoteEvents(), 10000);
                return;
            }
            this.emoteEventSource = stream;
            const current = () => !this.stopped && this.emoteEventSource === stream;
            let heartbeatInterval = 15000;
            const heartbeat = () => {
                if (!current()) return;
                clearTimeout(this.emoteHeartbeat);
                this.emoteHeartbeat = setTimeout(() => restart(), heartbeatInterval * 3);
            };
            stream.addEventListener('hello', (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    const interval = Number((payload.d || payload).heartbeat_interval);
                    if (interval > 0)
                        heartbeatInterval = Math.max(1000, Math.min(120000, interval));
                } catch {
                    /* Retain the default heartbeat interval. */
                }
                heartbeat();
            });
            stream.addEventListener('heartbeat', heartbeat);
            stream.addEventListener('open', () => {
                if (!current()) return;
                heartbeat();
                this.report('7TV events', 'connected');
                // A new connection may have missed events. Revalidate each complete set.
                for (const id of ids) this.queueEmoteSetReload(id);
            });
            stream.addEventListener('dispatch', (event) => {
                if (!current()) return;
                heartbeat();
                try {
                    const payload = JSON.parse(event.data);
                    const data = payload.d || payload;
                    if (data.type?.startsWith('emote_set.') && ids.includes(data.body?.id)) {
                        this.queueEmoteSetReload(data.body.id);
                    }
                } catch {
                    /* Ignore malformed event frames; polling remains available. */
                }
            });
            stream.addEventListener('error', () => {
                if (!current()) return;
                clearTimeout(this.emoteHeartbeat);
                this.report('7TV events', 'reconnecting · periodic refresh remains active');
                if (stream.readyState === 2) restart();
            });
            const restart = (delay = 10000) => {
                if (!current()) return;
                stream.close();
                clearTimeout(this.emoteHeartbeat);
                this.emoteEventSource = null;
                clearTimeout(this.emoteEventRetry);
                if (delay !== false)
                    this.emoteEventRetry = setTimeout(() => this.connectEmoteEvents(), delay);
            };
            stream.addEventListener('reconnect', () => restart());
            stream.addEventListener('end_of_stream', (event) => {
                let code;
                try {
                    const payload = JSON.parse(event.data);
                    code = (payload.d || payload).code;
                } catch {
                    /* Retry an unexpected shutdown. */
                }
                const fatal = [4001, 4002, 4003, 4004, 4005, 4009, 4010, 4011].includes(code);
                restart(fatal ? false : code === 4007 ? 300000 : 10000);
            });
        }
        queueEmoteSetReload(id) {
            if (this.stopped || ![...this.emoteSets.values()].includes(id)) return;
            const existing = this.liveEmoteJobs.get(id);
            if (existing) {
                if (existing.running) existing.dirty = true;
                return;
            }
            const job = { dirty: false };
            this.liveEmoteJobs.set(id, job);
            job.timer = setTimeout(async () => {
                job.running = true;
                try {
                    const set = await this.fetcher(
                        'https://7tv.io/v3/emote-sets/' + encodeURIComponent(id),
                        { cache: 'no-cache' }
                    );
                    if (this.stopped) return;
                    for (const [room, watchedId] of this.emoteSets) {
                        if (watchedId !== id) continue;
                        const map = this.normalize(set, room);
                        if (room === 'global') this.globalEmotes = map;
                        else if (room === this.channelId) this.channelEmotes = map;
                        else {
                            const source = this.sourceChannels.get(room);
                            if (!source) continue;
                            source.emotes = map;
                            source.emotesDue = Date.now() + 600000;
                        }
                    }
                    this.changed();
                    this.report('7TV live emotes', 'updated');
                } catch (error) {
                    if (this.stopped) return;
                    if (error.status === 404) {
                        for (const [room, watchedId] of this.emoteSets) {
                            if (watchedId !== id) continue;
                            if (room === 'global') this.globalEmotes = new Map();
                            else if (room === this.channelId) this.channelEmotes = new Map();
                            else if (this.sourceChannels.has(room))
                                this.sourceChannels.get(room).emotes = new Map();
                            this.emoteSets.delete(room);
                        }
                        this.connectEmoteEvents();
                        this.changed();
                    }
                    // Keep the last good catalog on network errors and rate limits.
                    this.report('7TV live emotes', error.message + ' · keeping cached emotes');
                } finally {
                    if (this.liveEmoteJobs.get(id) === job) this.liveEmoteJobs.delete(id);
                    if (!this.stopped && job.dirty) this.queueEmoteSetReload(id);
                }
            }, 250);
        }
        changed() {
            for (const listener of this.listeners) {
                listener();
            }
        }
        async badges(id) {
            const key = id ? 'channel' : 'global';
            try {
                const data = await this.fetcher(
                    'https://api.ivr.fi/v2/twitch/badges/' +
                        (id ? 'channel?id=' + encodeURIComponent(id) : 'global')
                );
                const sets = ChatWidget.normalizeBadges(data);
                if (id && this.channelId !== id) {
                    return;
                }
                this[id ? 'channelBadges' : 'globalBadges'] = sets;
                this.report(
                    'badges ' + key,
                    'OK · ' + Object.keys(sets).length + ' sets · IVR / Twitch'
                );
                this.changed();
            } catch (error) {
                this.report('badges ' + key, error.message + ' · keeping previously loaded badges');
            }
        }
        badge(set, version, roomId = this.channelId) {
            const sets =
                roomId && roomId !== this.channelId
                    ? this.sourceChannels.get(roomId)?.badges
                    : this.channelBadges;
            return sets?.[set]?.versions?.[version] || this.globalBadges[set]?.versions?.[version];
        }
        enableSubscriptionBadges(roomId) {
            if (!this.subscriptionBadges) {
                this.subscriptionBadges = true;
                if (!this.config?.showBadges) {
                    this.badges();
                    if (this.channelId) this.badges(this.channelId);
                }
            }
            if (roomId && roomId !== this.channelId) this.ensureSource(roomId);
        }
        emote(name, roomId = this.channelId) {
            const map =
                roomId && roomId !== this.channelId
                    ? this.sourceChannels.get(roomId)?.emotes
                    : this.channelEmotes;
            return map?.get(name) || this.globalEmotes.get(name);
        }
        ensureSource(id, touch = true) {
            if (
                typeof id !== 'string' ||
                !/^\d+$/.test(id) ||
                id === this.channelId ||
                this.stopped
            ) {
                return Promise.resolve(null);
            }
            const now = Date.now();
            let source = this.sourceChannels.get(id);
            if (!source) {
                for (const [key, cachedSource] of this.sourceChannels) {
                    if (!cachedSource.pending && now - cachedSource.lastSeen > 1200000) {
                        this.sourceChannels.delete(key);
                    }
                }
                if (this.sourceChannels.size >= 32) {
                    const oldest = [...this.sourceChannels]
                        .filter(([, cachedSource]) => !cachedSource.pending)
                        .sort(
                            (firstEntry, secondEntry) =>
                                firstEntry[1].lastSeen - secondEntry[1].lastSeen
                        )[0];
                    if (!oldest) {
                        return Promise.resolve(null);
                    }
                    this.sourceChannels.delete(oldest[0]);
                }
                source = {
                    id,
                    badges: {},
                    emotes: new Map(),
                    badgesDue: 0,
                    emotesDue: 0
                };
                this.sourceChannels.set(id, source);
            }
            if (touch || !source.lastSeen) {
                source.lastSeen = now;
            }
            if (source.pending) {
                return source.pending;
            }
            const badges =
                (this.config?.showBadges !== false || this.subscriptionBadges) &&
                now >= source.badgesDue;
            const emotes = this.config?.showSevenTVEmotes !== false && now >= source.emotesDue;
            if (!badges && !emotes) {
                return Promise.resolve(source);
            }
            source.pending = new Promise((resolve) =>
                this.sourceQueue.push({
                    source,
                    badges,
                    emotes,
                    resolve
                })
            );
            this.pumpSources();
            return source.pending;
        }
        pumpSources() {
            while (!this.stopped && this.activeSources < 2 && this.sourceQueue.length) {
                this.activeSources++;
                this.loadSource(this.sourceQueue.shift());
            }
        }
        async loadSource({ source, badges, emotes, resolve }) {
            const tasks = [];
            if (badges) {
                tasks.push(
                    (async () => {
                        try {
                            const data = await this.fetcher(
                                'https://api.ivr.fi/v2/twitch/badges/channel?id=' +
                                    encodeURIComponent(source.id)
                            );
                            source.badges = ChatWidget.normalizeBadges(data);
                            source.badgesDue = Date.now() + 2700000;
                            this.report(
                                'badges origen ' + source.id,
                                'OK · ' + Object.keys(source.badges).length + ' sets'
                            );
                        } catch (error) {
                            source.badgesDue = Date.now() + Math.max(60000, error.retryAfter || 0);
                            this.report(
                                'badges origen ' + source.id,
                                error.message + ' · keeping cached assets'
                            );
                        }
                    })()
                );
            }
            if (emotes) {
                tasks.push(
                    (async () => {
                        try {
                            const data = await this.fetcher(
                                'https://7tv.io/v3/users/twitch/' + encodeURIComponent(source.id),
                                { cache: 'no-cache' }
                            );
                            let set = data.emote_set;
                            if (set?.id || data.emote_set_id) {
                                set = await this.fetcher(
                                    'https://7tv.io/v3/emote-sets/' +
                                        encodeURIComponent(set?.id || data.emote_set_id),
                                    { cache: 'no-cache' }
                                );
                            }
                            source.emotes = set ? this.normalize(set, source.id) : new Map();
                            this.watchEmoteSet(source.id, set);
                            source.emotesDue = Date.now() + 600000;
                            this.report(
                                '7TV origen ' + source.id,
                                'OK · ' + source.emotes.size + ' emotes'
                            );
                        } catch (error) {
                            if (error.status === 404) {
                                source.emotes = new Map();
                                this.watchEmoteSet(source.id, null);
                            }
                            source.emotesDue =
                                Date.now() +
                                (error.status === 404
                                    ? 600000
                                    : Math.max(60000, error.retryAfter || 0));
                            this.report(
                                '7TV origen ' + source.id,
                                error.status === 404
                                    ? 'Channel has no 7TV account'
                                    : error.message + ' · keeping cached assets'
                            );
                        }
                    })()
                );
            }
            await Promise.all(tasks);
            source.pending = null;
            this.activeSources--;
            resolve(source);
            if (!this.stopped) {
                this.changed();
            }
            this.pumpSources();
        }
        normalize(set, origin) {
            if (!Array.isArray(set?.emotes)) {
                throw Error('Unknown emote set schema');
            }
            const map = new Map();
            for (const emote of set.emotes) {
                const emoteData = emote.data;
                const files = emoteData?.host?.files;
                if (!files || !emote.name) {
                    continue;
                }
                const size = (file) =>
                    Number.isFinite(file.size) && file.size > 0 ? file.size : Infinity;
                const formatRank = (file) =>
                    ['webp', 'avif', 'gif'].indexOf(file.name.split('.')[1]);
                const candidates = files
                    .filter((candidate) => /^[1-4]x\.(webp|avif|gif)$/.test(candidate.name))
                    .sort(
                        (a, b) =>
                            size(a) - size(b) ||
                            formatRank(a) - formatRank(b) ||
                            a.name.localeCompare(b.name)
                    );
                const preferred = (scale) =>
                    candidates.find(
                        (file) =>
                            file.name.startsWith(scale + 'x.') && /\.(webp|avif)$/.test(file.name)
                    ) || candidates.find((file) => file.name.startsWith(scale + 'x.'));
                const file = preferred(1) || candidates[0];
                if (!file) {
                    continue;
                }
                const src = ChatWidget.safeURL(emoteData.host.url + '/' + file.name, [
                    'cdn.7tv.app',
                    'cdn.7tv.io'
                ]);
                if (!src) {
                    continue;
                }
                const double = preferred(2);
                map.set(emote.name, {
                    id: emote.id,
                    src,
                    ...(double
                        ? {
                              src2x: ChatWidget.safeURL(emoteData.host.url + '/' + double.name, [
                                  'cdn.7tv.app',
                                  'cdn.7tv.io'
                              ])
                          }
                        : {}),
                    animated: !!emoteData.animated,
                    zeroWidth: !!(Number(emoteData.flags) & 256),
                    ratio: ChatWidget.clamp(file.width / file.height, 0.1, 12, 1),
                    origin
                });
            }
            return map;
        }
        async emotes(id) {
            const key = id ? 'channel' : 'global';
            try {
                const data = await this.fetcher(
                    id
                        ? 'https://7tv.io/v3/users/twitch/' + encodeURIComponent(id)
                        : 'https://7tv.io/v3/emote-sets/global',
                    { cache: 'no-cache' }
                );
                if (id && this.channelId !== id) {
                    return;
                }
                let set = id ? data.emote_set : data;
                if (id && (set?.id || data.emote_set_id)) {
                    set = await this.fetcher(
                        'https://7tv.io/v3/emote-sets/' +
                            encodeURIComponent(set?.id || data.emote_set_id),
                        { cache: 'no-cache' }
                    );
                }
                const map = set ? this.normalize(set, key) : new Map();
                if (this.stopped || (id && this.channelId !== id)) {
                    return;
                }
                this[id ? 'channelEmotes' : 'globalEmotes'] = map;
                this.watchEmoteSet(id, set);
                this.report('7TV ' + key, 'OK · ' + map.size + ' emotes');
                this.changed();
            } catch (error) {
                if (this.stopped) return;
                if (id && error.status === 404) {
                    this.channelEmotes = new Map();
                    this.watchEmoteSet(id, null);
                    this.changed();
                }
                this.report(
                    '7TV ' + key,
                    error.status === 404 ? 'Channel has no 7TV account' : error.message
                );
            }
        }
        // Channel avatar for Shared Chat origin icons; fetched once per room and cached.
        channelAvatar(id) {
            if (typeof id !== 'string' || !/^\d+$/.test(id)) return null;
            this.avatars ||= new Map();
            let entry = this.avatars.get(id);
            if (!entry) {
                if (this.avatars.size >= 64) this.avatars.delete(this.avatars.keys().next().value);
                entry = { src: null, name: '', due: 0 };
                this.avatars.set(id, entry);
            }
            if (!entry.pending && !this.stopped && Date.now() >= entry.due) {
                entry.pending = Promise.resolve()
                    .then(() =>
                        this.fetcher(
                            'https://api.ivr.fi/v2/twitch/user?id=' + encodeURIComponent(id)
                        )
                    )
                    .then(
                        (data) => {
                            const user = Array.isArray(data) ? data[0] : data;
                            // Twitch serves smaller avatar sizes under the same name.
                            entry.src = ChatWidget.safeURL(
                                String(user?.logo || '').replace(
                                    /-profile_image-\d+x\d+\./,
                                    '-profile_image-150x150.'
                                ),
                                ['static-cdn.jtvnw.net']
                            );
                            entry.name = String(user?.displayName || user?.login || '');
                            entry.due = Date.now() + 3600000;
                            if (entry.src && !this.stopped) this.changed();
                        },
                        (error) => {
                            entry.due = Date.now() + Math.max(60000, error?.retryAfter || 0);
                            this.report('avatar ' + id, error?.message || String(error));
                        }
                    )
                    .finally(() => {
                        entry.pending = null;
                    });
            }
            return entry.src ? entry : null;
        }
        setChannel(id) {
            if (!/^\d+$/.test(id) || id === this.channelId) {
                return;
            }
            if (this.channelId) this.emoteSets.delete(this.channelId);
            this.channelId = id;
            this.connectEmoteEvents();
            this.channelBadges = {};
            this.channelEmotes.clear();
            if (this.config?.showBadges || this.subscriptionBadges) this.badges(id);
            if (this.config?.showSevenTVEmotes) {
                this.emotes(id);
            }
        }
        start(config) {
            this.stopped = false;
            this.config = config;
            this.connectEmoteEvents();
            if (config.showBadges || this.subscriptionBadges) this.badges();
            if (config.showSevenTVEmotes) {
                this.emotes();
            }
            // A tab can predate the user's first 7TV set. There is no set ID
            // to subscribe to yet, so discover it without waiting ten minutes.
            this.emoteDiscovery = setInterval(async () => {
                const id = this.channelId;
                if (
                    this.stopped ||
                    !config.showSevenTVEmotes ||
                    !id ||
                    this.emoteSets.has(id) ||
                    this.discoveringEmotes
                )
                    return;
                this.discoveringEmotes = true;
                try {
                    await this.emotes(id);
                } finally {
                    this.discoveringEmotes = false;
                }
            }, 15000);
            this.refresh = setInterval(() => {
                if (config.showSevenTVEmotes) {
                    this.emotes();
                    if (this.channelId) {
                        this.emotes(this.channelId);
                    }
                }
                for (const source of this.sourceChannels.values()) {
                    if (Date.now() - source.lastSeen < 1200000) {
                        this.ensureSource(source.id, false);
                    }
                }
            }, 600000);
            this.badgeRefresh = setInterval(() => {
                if (config.showBadges || this.subscriptionBadges) {
                    this.badges();
                    if (this.channelId) this.badges(this.channelId);
                }
            }, 2700000);
        }
        stop() {
            this.stopped = true;
            clearInterval(this.refresh);
            clearInterval(this.badgeRefresh);
            clearInterval(this.emoteDiscovery);
            this.emoteEventSource?.close();
            this.emoteEventSource = null;
            clearTimeout(this.emoteEventRetry);
            clearTimeout(this.emoteHeartbeat);
            for (const job of this.liveEmoteJobs.values()) clearTimeout(job.timer);
            this.liveEmoteJobs.clear();
            for (const job of this.sourceQueue) {
                job.source.pending = null;
                job.resolve(null);
            }
            this.sourceQueue = [];
        }
    };
    ChatWidget.sevenTVBadge = function (badge) {
        if (!badge || typeof badge.id !== 'string' || !Array.isArray(badge.images)) {
            return null;
        }
        const images = badge.images.filter(
            (candidateImage) =>
                ['image/webp', 'image/png', 'image/gif'].includes(candidateImage.mime) &&
                typeof candidateImage.url === 'string' &&
                ChatWidget.safeURL(candidateImage.url, ['cdn.7tv.app', 'cdn.7tv.io'])
        );
        const image =
            images.find(
                (candidateImage) =>
                    candidateImage.scale === 2 &&
                    candidateImage.mime === 'image/webp' &&
                    !candidateImage.url.includes('_static')
            ) ||
            images.find((candidateImage) => candidateImage.scale === 2) ||
            images[0];
        return image
            ? {
                  id: badge.id,
                  title: typeof badge.name === 'string' ? badge.name : '7TV',
                  src: ChatWidget.safeURL(image.url, ['cdn.7tv.app', 'cdn.7tv.io'])
              }
            : null;
    };
    ChatWidget.paintQuery = /* GraphQL */ `
        query EquippedCosmetics($id: String!, $platform: Platform! = TWITCH) {
            users {
                userByConnection(platform: $platform, platformId: $id) {
                    style {
                        activeBadge {
                            id
                            name
                            images {
                                url
                                mime
                                width
                                height
                                scale
                            }
                        }
                        activePaint {
                            id
                            name
                            data {
                                layers {
                                    opacity
                                    ty {
                                        __typename
                                        ... on PaintLayerTypeSingleColor {
                                            color {
                                                r
                                                g
                                                b
                                                a
                                            }
                                        }
                                        ... on PaintLayerTypeLinearGradient {
                                            angle
                                            repeating
                                            stops {
                                                at
                                                color {
                                                    r
                                                    g
                                                    b
                                                    a
                                                }
                                            }
                                        }
                                        ... on PaintLayerTypeRadialGradient {
                                            shape
                                            repeating
                                            stops {
                                                at
                                                color {
                                                    r
                                                    g
                                                    b
                                                    a
                                                }
                                            }
                                        }
                                        ... on PaintLayerTypeImage {
                                            images {
                                                url
                                                mime
                                                width
                                                height
                                            }
                                        }
                                    }
                                }
                                shadows {
                                    offsetX
                                    offsetY
                                    blur
                                    color {
                                        r
                                        g
                                        b
                                        a
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;
    ChatWidget.paintColor = function (color, opacity = 1) {
        if (
            !color ||
            !['r', 'g', 'b', 'a'].every(
                (component) =>
                    Number.isFinite(color[component]) &&
                    color[component] >= 0 &&
                    color[component] <= 255
            )
        ) {
            return null;
        }
        return `rgba(${color.r},${color.g},${color.b},${(color.a / 255) * opacity})`;
    };
    ChatWidget.paintCSS = function (paint) {
        if (!Array.isArray(paint?.data?.layers) || !paint.data.layers.length) {
            return null;
        }
        const backgrounds = [];
        for (const layer of paint.data.layers.slice(0, 12)) {
            const layerType = layer.ty;
            const opacity = ChatWidget.clamp(layer.opacity, 0, 1, 1);
            if (!layerType) {
                return null;
            }
            if (layerType.__typename === 'PaintLayerTypeSingleColor') {
                const color = ChatWidget.paintColor(layerType.color, opacity);
                if (!color) {
                    return null;
                }
                backgrounds.push(`linear-gradient(${color},${color})`);
            } else if (
                ['PaintLayerTypeLinearGradient', 'PaintLayerTypeRadialGradient'].includes(
                    layerType.__typename
                )
            ) {
                if (!Array.isArray(layerType.stops) || layerType.stops.length < 2) {
                    return null;
                }
                const stops = layerType.stops.slice(0, 32).map((stop) => {
                    const color = ChatWidget.paintColor(stop.color, opacity);
                    return color && Number.isFinite(stop.at) && stop.at >= 0 && stop.at <= 1
                        ? `${color} ${stop.at * 100}%`
                        : null;
                });
                if (stops.includes(null)) {
                    return null;
                }
                const linear = layerType.__typename === 'PaintLayerTypeLinearGradient';
                const shape = String(layerType.shape).toLowerCase();
                if (!linear && !['circle', 'ellipse'].includes(shape)) {
                    return null;
                }
                if (linear && !Number.isFinite(layerType.angle)) {
                    return null;
                }
                backgrounds.push(
                    `${layerType.repeating ? 'repeating-' : ''}${linear ? 'linear' : 'radial'}-gradient(${linear ? (layerType.angle % 360) + 'deg' : shape},${stops.join(',')})`
                );
            } else if (layerType.__typename === 'PaintLayerTypeImage') {
                const img =
                    layerType.images?.find(
                        (image) => image.mime === 'image/webp' && /\/2x\.webp$/.test(image.url)
                    ) ||
                    layerType.images?.find(
                        (image) => image.mime === 'image/webp' && !image.url.includes('_static')
                    ) ||
                    layerType.images?.find((image) =>
                        ['image/webp', 'image/png', 'image/gif'].includes(image.mime)
                    ) ||
                    layerType.images?.[0];
                const url = img && ChatWidget.safeURL(img.url, ['cdn.7tv.app', 'cdn.7tv.io']);
                if (!url || opacity !== 1) {
                    return null;
                }
                backgrounds.push(`url("${url}")`);
            } else {
                return null;
            }
        }
        const shadows = [];
        for (const shadow of (paint.data.shadows || []).slice(0, 8)) {
            const color = ChatWidget.paintColor(shadow.color);
            if (!color || ![shadow.offsetX, shadow.offsetY, shadow.blur].every(Number.isFinite)) {
                return null;
            }
            shadows.push(
                `drop-shadow(${ChatWidget.clamp(shadow.offsetX, -50, 50)}px ${ChatWidget.clamp(shadow.offsetY, -50, 50)}px ${ChatWidget.clamp(shadow.blur, 0, 50)}px ${color})`
            );
        }
        return {
            backgroundImage: backgrounds.join(','),
            filter: shadows.join(' ')
        };
    };
    ChatWidget.Paints = class {
        constructor(report, fetcher = ChatWidget.fetchJSON) {
            this.report = report;
            this.fetcher = fetcher;
            this.cache = new Map();
            this.pending = new Map();
            this.queue = [];
            this.active = 0;
            this.cooldown = 0;
        }
        get(id, visible = () => true, platform = 'TWITCH') {
            return this.getCosmetics(id, visible, platform).then((value) => value?.paint || null);
        }
        getCosmetics(id, visible = () => true, platform = 'TWITCH') {
            if (platform !== 'TWITCH') {
                return Promise.resolve(null);
            }
            const key = id;
            if (!/^\d+$/.test(id)) {
                return Promise.resolve(null);
            }
            const cached = this.cache.get(key);
            if (cached && cached.expires > Date.now()) {
                return Promise.resolve(cached.value);
            }
            if (this.pending.has(key)) {
                return this.pending.get(key);
            }
            if (this.queue.length >= 80 || Date.now() < this.cooldown) {
                return Promise.resolve(null);
            }
            const pendingRequest = new Promise((resolve) =>
                this.queue.push({
                    id,
                    key,
                    platform,
                    resolve,
                    visible
                })
            );
            this.pending.set(key, pendingRequest);
            this.pump();
            return pendingRequest;
        }
        pump() {
            while (this.active < 3 && this.queue.length) {
                const job = this.queue.shift();
                if (!job.visible() || Date.now() < this.cooldown) {
                    this.pending.delete(job.key);
                    job.resolve(null);
                    continue;
                }
                this.active++;
                this.run(job);
            }
        }
        async run({ id, key, platform, resolve }) {
            let value = null;
            let ttl = 1800000;
            try {
                const data = await this.fetcher('https://7tv.io/v4/gql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        query: ChatWidget.paintQuery,
                        variables: {
                            id,
                            platform
                        }
                    })
                });
                if (data.errors) {
                    throw Error('GraphQL: schema or query rejected');
                }
                if (!data.data?.users || !Object.hasOwn(data.data.users, 'userByConnection')) {
                    throw Error('Unknown paint schema');
                }
                const user = data.data.users.userByConnection;
                if (user && !Object.hasOwn(user.style || {}, 'activePaint')) {
                    throw Error('Unable to verify the equipped paint');
                }
                const equippedPaint = user?.style?.activePaint;
                const paint = equippedPaint ? ChatWidget.paintCSS(equippedPaint) : null;
                const badge = ChatWidget.sevenTVBadge(user?.style?.activeBadge);
                value =
                    paint || badge
                        ? {
                              paint,
                              badge
                          }
                        : null;
                this.report(
                    'paints',
                    equippedPaint
                        ? paint
                            ? 'Equipped paint loaded: ' + equippedPaint.name
                            : 'Unsupported paint: using the original color'
                        : 'No paint: using the original color'
                );
                this.report('7TV badge', badge ? 'Equipped: ' + badge.title : 'No badge equipped');
            } catch (error) {
                ttl = 60000;
                if (error.status === 429) {
                    this.cooldown = Date.now() + error.retryAfter;
                    ttl = error.retryAfter;
                }
                this.report('paints', error.message + ' · original color');
            }
            if (this.cache.size >= 1500) {
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(key, {
                value,
                expires: Date.now() + ttl
            });
            this.pending.delete(key);
            this.active--;
            resolve(value);
            this.pump();
        }
    };
})(window.ChatWidget);
